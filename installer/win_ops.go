//go:build windows

// Setup for Valkyrys app: installs for the current user (no administrator rights), adds Start menu + desktop shortcuts and an
// entry under "Installed apps". Running it again updates the app. The small Uninstall program removes it.
package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var msgBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

const (
	mbOK, mbYesNo                     = 0x0, 0x4
	iconError, iconQuestion, iconInfo = 0x10, 0x20, 0x40
	idYes                             = 6
)

func box(text string, flags uintptr) int {
	tp, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(name)
	r, _, _ := msgBox.Call(0, uintptr(unsafe.Pointer(tp)), uintptr(unsafe.Pointer(c)), flags)
	return int(r)
}

func hidden(prog string, args ...string) *exec.Cmd {
	c := exec.Command(prog, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return c
}

func powershell(script string) error {
	u := utf16.Encode([]rune(script))
	b := make([]byte, 0, len(u)*2)
	for _, v := range u {
		b = append(b, byte(v), byte(v>>8))
	}
	return hidden("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64.StdEncoding.EncodeToString(b)).Run()
}

func q(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func stopApp() {
	_ = hidden("taskkill.exe", "/F", "/IM", exeName).Run()
	_ = hidden("taskkill.exe", "/F", "/IM", oldExe).Run() // the app under its old name
	sleep(800)
}

func defaultDir() string { return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", name) }

// installedDir: where Valkyrys app is installed now ("" when it is not), from the entry under "Installed apps"
func installedDir() string { return regDir(regKey, exeName) }

// legacyDir: where the app is installed under its old name, Valkyrys Facturen ("" when it is not)
func legacyDir() string { return regDir(oldRegKey, oldExe) }

// upgradeDir: where this version goes when the old one is found: next to it, under the new name ("" when there is no old one)
func upgradeDir() string {
	if d := legacyDir(); d != "" {
		return filepath.Join(filepath.Dir(d), name)
	}
	return ""
}

func regDir(key, exe string) string {
	out, err := hidden("reg.exe", "query", key, "/v", "InstallLocation").Output()
	if err != nil {
		return ""
	}
	for _, l := range strings.Split(string(out), "\n") {
		if i := strings.Index(l, "REG_SZ"); i >= 0 {
			d := strings.TrimSpace(l[i+len("REG_SZ"):])
			if _, err := os.Stat(filepath.Join(d, exe)); err == nil {
				return d
			}
		}
	}
	return ""
}

func protectedDirs() []string {
	var p []string
	for _, e := range []string{"SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PUBLIC"} {
		p = append(p, os.Getenv(e))
	}
	return p
}

type options struct {
	dir      string // final install folder
	desktop  bool   // desktop shortcut
	updating bool
}

// doInstall does the work and reports progress as a fraction (0..1) with a line of text and the current file
func doInstall(o options, report func(frac float64, text, file string)) error {
	self, _ := os.Executable()
	exe := filepath.Join(o.dir, exeName)
	ico := filepath.Join(o.dir, "resources", "app", "build", "icon.ico")
	report(0.01, t("sClosing"), "")
	stopApp()
	if legacyDir() != "" || legacyShortcuts() {
		report(0.04, t("sOld"), "")
		removeLegacy()
	}
	if err := writable(o.dir); err != nil {
		return fmt.Errorf("%s", t("eFolder", o.dir)+"\n\n"+err.Error())
	}
	report(0.08, t("sClean"), "")
	cleanOld(o.dir)
	last := -1
	files, err := unpack(appZip, o.dir, func(done, total int64, file string) {
		pct := 0
		if total > 0 {
			pct = int(done * 100 / total)
		}
		if pct != last || file == "" { // the bar moves in whole percents, not for every block
			last = pct
			report(0.10+0.78*float64(done)/float64(max64(total, 1)), t("sCopy", pct), file)
		}
	})
	if err != nil {
		return fmt.Errorf("%s", t("eUnpack", err.Error()))
	}
	report(0.89, t("sUninst"), "")
	if len(uninstExe) > 0 {
		if err := os.WriteFile(filepath.Join(o.dir, uninstall), uninstExe, 0o755); err != nil {
			return fmt.Errorf("%s", t("eUnpack", err.Error()))
		}
	} else if me, err := os.ReadFile(self); err == nil {
		_ = os.WriteFile(filepath.Join(o.dir, uninstall), me, 0o755)
	}
	_ = writeManifest(o.dir, append(files, uninstall))
	report(0.92, t("sShort"), "")
	folders := `@([Environment]::GetFolderPath('Programs'))`
	if o.desktop {
		folders = `@([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))`
	}
	_ = powershell(`$w = New-Object -ComObject WScript.Shell
foreach ($d in ` + folders + `) {
  $s = $w.CreateShortcut((Join-Path $d ` + q(name+".lnk") + `))
  $s.TargetPath = ` + q(exe) + `
  $s.WorkingDirectory = ` + q(o.dir) + `
  $s.IconLocation = ` + q(ico) + `
  $s.Description = ` + q(name) + `
  $s.Save()
}`)
	if !o.desktop { // an earlier desktop shortcut that is no longer wanted
		_ = powershell(`Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) ` + q(name+".lnk") + `) -Force -ErrorAction SilentlyContinue`)
	}
	report(0.97, t("sReg"), "")
	reg := func(args ...string) { _ = hidden("reg.exe", append([]string{"add", regKey, "/f"}, args...)...).Run() }
	reg("/v", "DisplayName", "/t", "REG_SZ", "/d", name)
	reg("/v", "DisplayVersion", "/t", "REG_SZ", "/d", version)
	reg("/v", "Publisher", "/t", "REG_SZ", "/d", "Valkyrys")
	reg("/v", "InstallLocation", "/t", "REG_SZ", "/d", o.dir)
	reg("/v", "DisplayIcon", "/t", "REG_SZ", "/d", ico)
	reg("/v", "UninstallString", "/t", "REG_SZ", "/d", `"`+filepath.Join(o.dir, uninstall)+`" /uninstall`)
	reg("/v", "NoModify", "/t", "REG_DWORD", "/d", "1")
	reg("/v", "NoRepair", "/t", "REG_DWORD", "/d", "1")
	report(1, t("sDone"), "")
	return nil
}

// legacyShortcuts: whether a shortcut of the old Valkyrys Facturen is still on the desktop or in the Start menu
func legacyShortcuts() bool {
	for _, k := range []string{"Desktop", "Programs"} {
		out, err := hidden("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('`+k+`')) `+q(oldName+".lnk")+`)`).Output()
		if err == nil && strings.Contains(string(out), "True") {
			return true
		}
	}
	return false
}

// removeLegacy takes the old Valkyrys Facturen away (its shortcuts, its entry under "Installed apps" and exactly the files it installed), so only one app is left.
// The data folder is not touched: the new app moves it along to its new name on its first start.
func removeLegacy() {
	dir := legacyDir()
	_ = powershell(`foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { Remove-Item -LiteralPath (Join-Path $d ` + q(oldName+".lnk") + `) -Force -ErrorAction SilentlyContinue }`)
	_ = hidden("reg.exe", "delete", oldRegKey, "/f").Run()
	if dir == "" {
		return
	}
	if !removeListed(dir, oldManifest) && strings.EqualFold(filepath.Base(dir), oldName) { // the first version kept no list of files: its folder was only ever ours
		_ = os.RemoveAll(filepath.Join(dir, "resources"))
		_ = os.RemoveAll(filepath.Join(dir, "locales"))
		if ents, err := os.ReadDir(dir); err == nil {
			for _, e := range ents {
				if !e.IsDir() {
					_ = os.Remove(filepath.Join(dir, e.Name()))
				}
			}
		}
	}
	_ = os.Remove(filepath.Join(dir, oldUninstall))
	_ = os.Remove(dir) // only succeeds when nothing of the user's is left in it
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// plainInstall: no window (the /S switch, or when the window cannot be made)
func plainInstall(dir string, ask bool) int {
	if dir == "" {
		dir = installedDir()
		if dir == "" {
			dir = upgradeDir()
		}
		if dir == "" {
			dir = defaultDir()
		}
	}
	d, err := resolveDir(dir, protectedDirs())
	if err != nil {
		if ask {
			box(t("ePath"), mbOK|iconError)
		}
		return 1
	}
	if ask && box(t("fbAsk", d), mbYesNo|iconQuestion) != idYes {
		return 0
	}
	if err := doInstall(options{dir: d, desktop: true}, func(float64, string, string) {}); err != nil {
		if ask {
			box(err.Error(), mbOK|iconError)
		}
		return 1
	}
	if ask && box(t("fbDone"), mbYesNo|iconInfo) == idYes {
		_ = exec.Command(filepath.Join(d, exeName)).Start()
	}
	return 0
}

func remove() {
	self, _ := os.Executable()
	dir := filepath.Dir(self)
	if !strings.EqualFold(filepath.Base(self), uninstall) { // started from the setup program: use the recorded folder
		if d := installedDir(); d != "" {
			dir = d
		} else {
			dir = defaultDir()
		}
	}
	if box(t("uAsk"), mbYesNo|iconQuestion) != idYes {
		return
	}
	stopApp()
	_ = powershell(`foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { Remove-Item -LiteralPath (Join-Path $d ` + q(name+".lnk") + `) -Force -ErrorAction SilentlyContinue }`)
	_ = hidden("reg.exe", "delete", regKey, "/f").Run()
	if !removeInstalled(dir) { // the first version kept no list of files: its folder was only ever ours
		if samePath(dir, defaultDir()) {
			_ = os.RemoveAll(filepath.Join(dir, "resources"))
			_ = os.RemoveAll(filepath.Join(dir, "locales"))
			ents, _ := os.ReadDir(dir)
			for _, e := range ents {
				if !e.IsDir() && !strings.EqualFold(e.Name(), uninstall) {
					_ = os.Remove(filepath.Join(dir, e.Name()))
				}
			}
		}
	}
	// this program is still running, so its own file and the (then empty) folder go a moment after it exits; a folder that still holds something is left alone
	_ = hidden("cmd.exe", "/C", "ping 127.0.0.1 -n 3 >nul & del /f /q \""+filepath.Join(dir, uninstall)+"\" & rmdir \""+dir+"\"").Start()
	box(t("uDone"), mbOK|iconInfo)
}

func main() {
	lang = langFromID(userUILanguage())
	self, _ := os.Executable()
	silent, dir := false, ""
	for _, a := range os.Args[1:] {
		switch {
		case strings.EqualFold(a, "/uninstall"):
			remove()
			return
		case strings.EqualFold(a, "/S"):
			silent = true
		case strings.HasPrefix(strings.ToUpper(a), "/D="):
			dir = a[3:]
		}
	}
	if strings.EqualFold(filepath.Base(self), uninstall) || len(appZip) == 0 { // the small uninstaller has no program files inside
		remove()
		return
	}
	if silent {
		os.Exit(plainInstall(dir, false))
	}
	if !runWizard(dir) { // the window could not be made: fall back to plain questions
		os.Exit(plainInstall(dir, true))
	}
}
