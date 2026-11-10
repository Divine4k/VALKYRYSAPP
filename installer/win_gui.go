//go:build windows

// The setup window, drawn with plain Windows calls (no extra libraries): a welcome page with the folder choice,
// a progress page while the files are written, and a closing page.
package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	comctl32 = syscall.NewLazyDLL("comctl32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")

	pRegisterClassExW   = user32.NewProc("RegisterClassExW")
	pCreateWindowExW    = user32.NewProc("CreateWindowExW")
	pDefWindowProcW     = user32.NewProc("DefWindowProcW")
	pGetMessageW        = user32.NewProc("GetMessageW")
	pTranslateMessage   = user32.NewProc("TranslateMessage")
	pDispatchMessageW   = user32.NewProc("DispatchMessageW")
	pIsDialogMessageW   = user32.NewProc("IsDialogMessageW")
	pPostQuitMessage    = user32.NewProc("PostQuitMessage")
	pPostMessageW       = user32.NewProc("PostMessageW")
	pSendMessageW       = user32.NewProc("SendMessageW")
	pShowWindow         = user32.NewProc("ShowWindow")
	pUpdateWindow       = user32.NewProc("UpdateWindow")
	pDestroyWindow      = user32.NewProc("DestroyWindow")
	pSetWindowTextW     = user32.NewProc("SetWindowTextW")
	pGetWindowTextW     = user32.NewProc("GetWindowTextW")
	pGetWindowTextLenW  = user32.NewProc("GetWindowTextLengthW")
	pEnableWindow       = user32.NewProc("EnableWindow")
	pLoadCursorW        = user32.NewProc("LoadCursorW")
	pLoadIconW          = user32.NewProc("LoadIconW")
	pGetSystemMetrics   = user32.NewProc("GetSystemMetrics")
	pSetForegroundWnd   = user32.NewProc("SetForegroundWindow")
	pSetFocus           = user32.NewProc("SetFocus")
	pAdjustWindowRectEx = user32.NewProc("AdjustWindowRectEx")
	pGetDpiForSystem    = user32.NewProc("GetDpiForSystem")
	pGetDC              = user32.NewProc("GetDC")
	pReleaseDC          = user32.NewProc("ReleaseDC")

	pGetModuleHandleW  = kernel32.NewProc("GetModuleHandleW")
	pGetUserUILang     = kernel32.NewProc("GetUserDefaultUILanguage")
	pCreateFontW       = gdi32.NewProc("CreateFontW")
	pGetStockObject    = gdi32.NewProc("GetStockObject")
	pCreateSolidBrush  = gdi32.NewProc("CreateSolidBrush")
	pSetBkColor        = gdi32.NewProc("SetBkColor")
	pSetTextColor      = gdi32.NewProc("SetTextColor")
	pGetDeviceCaps     = gdi32.NewProc("GetDeviceCaps")
	pInitCommonCtrlsEx = comctl32.NewProc("InitCommonControlsEx")
	pSHBrowseForFolder = shell32.NewProc("SHBrowseForFolderW")
	pSHGetPathFromID   = shell32.NewProc("SHGetPathFromIDListW")
	pCoInitializeEx    = ole32.NewProc("CoInitializeEx")
	pCoTaskMemFree     = ole32.NewProc("CoTaskMemFree")
)

const (
	wmDestroy, wmClose, wmCommand, wmSetFont, wmCtlColorStatic = 0x2, 0x10, 0x111, 0x30, 0x138
	wmProgress, wmDone                                         = 0x8001, 0x8002
	wsChild, wsVisible, wsTabStop, wsBorder                    = 0x40000000, 0x10000000, 0x10000, 0x800000
	wsWindow                                                   = 0x00C00000 | 0x00080000 | 0x00020000 // caption, system menu, minimize box
	wsExClientEdge                                             = 0x200
	ssCenterImage, ssNoPrefix, ssPathEllipsis                  = 0x200, 0x80, 0x8000
	bsPush, bsDefPush, bsAutoCheck                             = 0x0, 0x1, 0x3
	esAutoHScroll, esReadOnly                                  = 0x80, 0x800
	pbmSetRange32, pbmSetPos, pbsSmooth                        = 0x406, 0x402, 0x1
	bmGetCheck, bmSetCheck                                     = 0xF0, 0xF1
	idOK, idCancel, idBrowse, idChkDesktop, idChkLaunch        = 1, 2, 101, 102, 103
	swHide, swShow                                             = 0, 5
)

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}
type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	ptX     int32
	ptY     int32
}
type winRect struct{ left, top, right, bottom int32 }
type browseInfo struct {
	hwndOwner      uintptr
	pidlRoot       uintptr
	pszDisplayName *uint16
	lpszTitle      *uint16
	ulFlags        uint32
	lpfn           uintptr
	lParam         uintptr
	iImage         int32
}
type initCC struct{ size, icc uint32 }

func init() { runtime.LockOSThread() } // the window and its messages live on the main thread

func p16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func userUILanguage() uint16 { r, _, _ := pGetUserUILang.Call(); return uint16(r) }

type progState struct {
	sync.Mutex
	frac       float64
	text, file string
}

var (
	prog    progState
	pending int32
)

var ui struct {
	hwnd, hinst                                                uintptr
	dpi                                                        int
	fNormal, fTitle, fHead, fSmall                             uintptr
	white, black, yellow                                       uintptr
	header, stripe, title, desc, fLabel, edit, browse          uintptr
	chkDesk, note, status, bar, fileLbl, chkLaunch, ok, cancel uintptr
	page                                                       int // 1 welcome, 2 working, 3 done, 4 error
	updating, installing                                       bool
	opts                                                       options
	err                                                        error
	lastStatus, lastFile                                       string
}

func px(n int) int { return n * ui.dpi / 96 }

func send(h uintptr, m uint32, w, l uintptr) uintptr {
	r, _, _ := pSendMessageW.Call(h, uintptr(m), w, l)
	return r
}
func setText(h uintptr, s string) {
	p := p16(s)
	pSetWindowTextW.Call(h, uintptr(unsafe.Pointer(p)))
	runtime.KeepAlive(p)
}
func getText(h uintptr) string {
	n, _, _ := pGetWindowTextLenW.Call(h)
	buf := make([]uint16, n+2)
	pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), n+1)
	return syscall.UTF16ToString(buf)
}
func show(h uintptr, on bool) {
	f := uintptr(swHide)
	if on {
		f = swShow
	}
	pShowWindow.Call(h, f)
}
func enable(h uintptr, on bool) {
	var v uintptr
	if on {
		v = 1
	}
	pEnableWindow.Call(h, v)
}
func checked(h uintptr) bool { return send(h, bmGetCheck, 0, 0) == 1 }

func newFont(pt, weight int, face string) uintptr {
	f := p16(face)
	h, _, _ := pCreateFontW.Call(uintptr(uint32(int32(-pt*ui.dpi/72))), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(f)))
	runtime.KeepAlive(f)
	return h
}

func mk(class, text string, style, ex uint32, x, y, w, h int, id uintptr, font uintptr) uintptr {
	c, tx := p16(class), p16(text)
	hw, _, _ := pCreateWindowExW.Call(uintptr(ex), uintptr(unsafe.Pointer(c)), uintptr(unsafe.Pointer(tx)), uintptr(style|wsChild|wsVisible),
		uintptr(px(x)), uintptr(px(y)), uintptr(px(w)), uintptr(px(h)), ui.hwnd, id, ui.hinst, 0)
	runtime.KeepAlive(c)
	runtime.KeepAlive(tx)
	if hw != 0 && font != 0 {
		send(hw, wmSetFont, font, 1)
	}
	return hw
}

const winW, winH = 540, 340

func showPage(p int) {
	ui.page = p
	for _, h := range []uintptr{ui.fLabel, ui.edit, ui.browse, ui.chkDesk, ui.note} {
		show(h, p == 1)
	}
	for _, h := range []uintptr{ui.status, ui.bar, ui.fileLbl} {
		show(h, p == 2)
	}
	show(ui.chkLaunch, p == 3)
	show(ui.cancel, p == 1)
	enable(ui.ok, p != 2)
	switch p {
	case 1:
		setText(ui.ok, t(map[bool]string{true: "bUpdate", false: "bInstall"}[ui.updating]))
	case 3:
		setText(ui.ok, t("bFinish"))
	case 4:
		setText(ui.ok, t("bClose"))
	}
}

func report(frac float64, text, file string) {
	prog.Lock()
	prog.frac, prog.text, prog.file = frac, text, file
	prog.Unlock()
	if atomic.CompareAndSwapInt32(&pending, 0, 1) { // one message in flight at a time, so a fast copy never floods the window
		pPostMessageW.Call(ui.hwnd, wmProgress, 0, 0)
	}
}

func dirProblem(err error) string {
	switch err.Error() {
	case "root":
		return t("eRoot")
	case "system":
		return t("eSys")
	}
	return t("ePath")
}

func alert(msg string) { box(msg, mbOK|iconError) }

func startInstall() {
	d, err := resolveDir(getText(ui.edit), protectedDirs())
	if err != nil {
		alert(dirProblem(err))
		pSetFocus.Call(ui.edit)
		return
	}
	setText(ui.edit, d)
	ui.opts = options{dir: d, desktop: checked(ui.chkDesk), updating: ui.updating}
	setText(ui.title, t(map[bool]string{true: "wUpdate", false: "wInstall"}[ui.updating]))
	setText(ui.desc, d)
	setText(ui.status, t("sClosing"))
	send(ui.bar, pbmSetPos, 0, 0)
	showPage(2)
	ui.installing = true
	o := ui.opts
	go func() {
		err := doInstall(o, report)
		ui.err = err
		pPostMessageW.Call(ui.hwnd, wmDone, 0, 0)
	}()
}

func finished() {
	ui.installing = false
	send(ui.bar, pbmSetPos, 1000, 0)
	if ui.err != nil {
		setText(ui.title, t("tErr"))
		setText(ui.desc, ui.err.Error())
		showPage(4)
		return
	}
	suffix := ""
	if ui.opts.desktop {
		suffix = t("dDoneDesk")
	}
	setText(ui.title, t(map[bool]string{true: "tDoneU", false: "tDoneI"}[ui.updating]))
	setText(ui.desc, t("dDone", suffix))
	showPage(3)
	pSetFocus.Call(ui.ok)
}

func browseFolder() {
	name16 := make([]uint16, 1024)
	title := p16(t("browseTitle"))
	bi := browseInfo{hwndOwner: ui.hwnd, pszDisplayName: &name16[0], lpszTitle: title, ulFlags: 0x1 | 0x40} // folders only, new-style dialog with "make new folder"
	pidl, _, _ := pSHBrowseForFolder.Call(uintptr(unsafe.Pointer(&bi)))
	runtime.KeepAlive(title)
	runtime.KeepAlive(name16)
	if pidl == 0 {
		return
	}
	path := make([]uint16, 1024)
	pSHGetPathFromID.Call(pidl, uintptr(unsafe.Pointer(&path[0])))
	pCoTaskMemFree.Call(pidl)
	picked := syscall.UTF16ToString(path)
	if picked == "" {
		return
	}
	d, err := resolveDir(picked, protectedDirs())
	if err != nil {
		alert(dirProblem(err))
		return
	}
	setText(ui.edit, d)
}

func wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch uint32(msg) {
	case wmCommand:
		id, code := wp&0xffff, (wp>>16)&0xffff
		if code != 0 && id != idOK { // only button clicks (and Enter, which comes as OK)
			break
		}
		switch id {
		case idOK:
			switch ui.page {
			case 1:
				startInstall()
			case 3:
				if checked(ui.chkLaunch) {
					_ = exec.Command(filepath.Join(ui.opts.dir, exeName)).Start()
				}
				pDestroyWindow.Call(hwnd)
			case 4:
				pDestroyWindow.Call(hwnd)
			}
			return 0
		case idCancel:
			if ui.page == 1 || ui.page == 4 {
				pDestroyWindow.Call(hwnd)
			}
			return 0
		case idBrowse:
			browseFolder()
			return 0
		}
	case wmCtlColorStatic: // text on white, except the black header and the yellow line
		switch lp {
		case ui.header:
			pSetTextColor.Call(wp, 0xFFFFFF)
			pSetBkColor.Call(wp, 0x000000)
			return ui.black
		case ui.stripe:
			return ui.yellow
		case ui.note, ui.fileLbl:
			pSetTextColor.Call(wp, 0x6B6B6B)
		default:
			pSetTextColor.Call(wp, 0x1A1A1A)
		}
		pSetBkColor.Call(wp, 0xFFFFFF)
		return ui.white
	case wmProgress:
		atomic.StoreInt32(&pending, 0)
		prog.Lock()
		frac, text, file := prog.frac, prog.text, prog.file
		prog.Unlock()
		send(ui.bar, pbmSetPos, uintptr(frac*1000), 0)
		if text != ui.lastStatus {
			ui.lastStatus = text
			setText(ui.status, text)
		}
		if file != ui.lastFile {
			ui.lastFile = file
			setText(ui.fileLbl, file)
		}
		return 0
	case wmDone:
		finished()
		return 0
	case wmClose:
		if ui.installing {
			return 0 // never stop halfway through writing the files
		}
		pDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, msg, wp, lp)
	return r
}

// runWizard shows the window and runs it until it is closed. It returns false when the window could not be made at all.
func runWizard(dirArg string) bool {
	hinst, _, _ := pGetModuleHandleW.Call(0)
	ui.hinst = hinst
	ui.dpi = 96
	if pGetDpiForSystem.Find() == nil {
		if d, _, _ := pGetDpiForSystem.Call(); d >= 96 {
			ui.dpi = int(d)
		}
	}
	icc := initCC{size: uint32(unsafe.Sizeof(initCC{})), icc: 0x20} // progress bar class
	pInitCommonCtrlsEx.Call(uintptr(unsafe.Pointer(&icc)))
	pCoInitializeEx.Call(0, 2) // needed by the folder dialog

	ui.white, _, _ = pGetStockObject.Call(0)
	ui.black, _, _ = pCreateSolidBrush.Call(0x000000)
	ui.yellow, _, _ = pCreateSolidBrush.Call(0x17BDFE) // Valkyrys yellow (BGR order)
	ui.fNormal, ui.fSmall = newFont(9, 400, "Segoe UI"), newFont(8, 400, "Segoe UI")
	ui.fTitle, ui.fHead = newFont(13, 700, "Segoe UI"), newFont(14, 700, "Segoe UI")

	cursor, _, _ := pLoadCursorW.Call(0, 32512)
	icon, _, _ := pLoadIconW.Call(hinst, 1) // the program icon (resource 1), if it is there
	class := p16("ValkyrysSetup")
	wc := wndClassEx{cbSize: uint32(unsafe.Sizeof(wndClassEx{})), style: 3, lpfnWndProc: syscall.NewCallback(wndProc), hInstance: hinst, hIcon: icon, hCursor: cursor,
		hbrBackground: ui.white, lpszClassName: class, hIconSm: icon}
	if a, _, _ := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); a == 0 {
		return false
	}
	rc := winRect{0, 0, int32(px(winW)), int32(px(winH))}
	pAdjustWindowRectEx.Call(uintptr(unsafe.Pointer(&rc)), wsWindow, 0, 0)
	w, h := int(rc.right-rc.left), int(rc.bottom-rc.top)
	sw, _, _ := pGetSystemMetrics.Call(0)
	sh, _, _ := pGetSystemMetrics.Call(1)
	title := p16(t("window"))
	hw, _, _ := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)), wsWindow, uintptr((int(sw)-w)/2), uintptr((int(sh)-h)/3), uintptr(w), uintptr(h), 0, 0, hinst, 0)
	runtime.KeepAlive(class)
	runtime.KeepAlive(title)
	if hw == 0 {
		return false
	}
	ui.hwnd = hw

	cur := installedDir()
	if cur == "" {
		cur = upgradeDir() // the old Valkyrys Facturen is replaced by this version, in the same place
	}
	ui.updating = cur != ""
	dir := dirArg
	if dir == "" {
		dir = cur
	}
	if dir == "" {
		dir = defaultDir()
	}
	W := winW
	ui.header = mk("STATIC", "   VALKYRYS   APP", ssCenterImage|ssNoPrefix, 0, 0, 0, W, 60, 0, ui.fHead)
	ui.stripe = mk("STATIC", "", 0, 0, 0, 60, W, 3, 0, 0)
	ui.title = mk("STATIC", t(map[bool]string{true: "tUpdate", false: "tInstall"}[ui.updating]), ssNoPrefix, 0, 28, 84, W-56, 28, 0, ui.fTitle)
	ui.desc = mk("STATIC", t(map[bool]string{true: "dUpdate", false: "dInstall"}[ui.updating]), ssNoPrefix, 0, 28, 118, W-56, 48, 0, ui.fNormal)
	ui.fLabel = mk("STATIC", t(map[bool]string{true: "fUpdate", false: "fInstall"}[ui.updating]), ssNoPrefix, 0, 28, 172, 300, 20, 0, ui.fNormal)
	editStyle := uint32(wsTabStop | esAutoHScroll)
	if ui.updating {
		editStyle |= esReadOnly
	}
	ui.edit = mk("EDIT", dir, editStyle, wsExClientEdge, 28, 194, W-56-120, 26, 0, ui.fNormal)
	ui.browse = mk("BUTTON", t("browse"), wsTabStop|bsPush, 0, W-28-110, 193, 110, 28, idBrowse, ui.fNormal)
	if ui.updating {
		enable(ui.browse, false)
	}
	ui.chkDesk = mk("BUTTON", t("chkDesktop"), wsTabStop|bsAutoCheck, 0, 28, 234, W-56, 22, idChkDesktop, ui.fNormal)
	send(ui.chkDesk, bmSetCheck, 1, 0)
	ui.note = mk("STATIC", t("note"), ssNoPrefix, 0, 28, 266, W-56, 36, 0, ui.fSmall)
	ui.status = mk("STATIC", "", ssNoPrefix, 0, 28, 190, W-56, 22, 0, ui.fNormal)
	ui.bar = mk("msctls_progress32", "", pbsSmooth, 0, 28, 216, W-56, 22, 0, 0)
	send(ui.bar, pbmSetRange32, 0, 1000)
	ui.fileLbl = mk("STATIC", "", ssNoPrefix|ssPathEllipsis, 0, 28, 246, W-56, 20, 0, ui.fSmall)
	ui.chkLaunch = mk("BUTTON", t("chkLaunch"), wsTabStop|bsAutoCheck, 0, 28, 200, W-56, 22, idChkLaunch, ui.fNormal)
	send(ui.chkLaunch, bmSetCheck, 1, 0)
	ui.ok = mk("BUTTON", "", wsTabStop|bsDefPush, 0, W-28-230, winH-52, 110, 32, idOK, ui.fNormal)
	ui.cancel = mk("BUTTON", t("bCancel"), wsTabStop|bsPush, 0, W-28-110, winH-52, 110, 32, idCancel, ui.fNormal)
	showPage(1)

	pShowWindow.Call(hw, swShow)
	pUpdateWindow.Call(hw)
	pSetForegroundWnd.Call(hw)
	pSetFocus.Call(ui.ok)

	var m winMsg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		if d, _, _ := pIsDialogMessageW.Call(hw, uintptr(unsafe.Pointer(&m))); d != 0 {
			continue // Tab, Enter and Esc between the controls
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	return true
}
