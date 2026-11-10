// Parts of the installer that do not touch Windows itself, so they can be tested anywhere:
// texts in three languages, checking the chosen folder, unpacking with progress, and the list of installed files.
package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	name      = "Valkyrys app"
	version   = "1.2.0"
	exeName   = "Valkyrys app.exe"
	uninstall = "Uninstall Valkyrys app.exe"
	manifest  = "Valkyrys app.files" // every file the installer wrote, one per line; the uninstaller removes exactly these
	regKey    = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ValkyrysApp`

	// the app was called "Valkyrys Facturen" before: setup finds that version and replaces it (the data folder is moved along by the app itself)
	oldName      = "Valkyrys Facturen"
	oldExe       = "Valkyrys Facturen.exe"
	oldUninstall = "Uninstall Valkyrys Facturen.exe"
	oldManifest  = "Valkyrys Facturen.files"
	oldRegKey    = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ValkyrysFacturen`
)

var sep = string(os.PathSeparator)

func sleep(ms int) { time.Sleep(time.Duration(ms) * time.Millisecond) }

// ---- texts: Dutch, English and Polish (chosen from the Windows display language)
var texts = map[string]map[string]string{
	"nl": {
		"window": "Valkyrys app – Installatie", "tInstall": "Valkyrys app installeren", "tUpdate": "Valkyrys app bijwerken",
		"dInstall": "Dit installeert Valkyrys app voor jouw Windows-account. Je hebt geen beheerdersrechten nodig.",
		"dUpdate":  "Er staat al een versie op deze computer. Die wordt bijgewerkt. Je facturen en instellingen blijven bewaard.",
		"fInstall": "Installeren in:", "fUpdate": "Bijwerken in:", "browse": "Bladeren…", "browseTitle": "Kies de map waarin Valkyrys app moet komen",
		"chkDesktop": "Snelkoppeling op het bureaublad maken", "note": "Je facturen en instellingen staan los van de programmamap en blijven altijd bewaard.",
		"bInstall": "Installeren", "bUpdate": "Bijwerken", "bCancel": "Annuleren", "bFinish": "Voltooien", "bClose": "Sluiten",
		"wInstall": "Bezig met installeren…", "wUpdate": "Bezig met bijwerken…",
		"sClosing": "Valkyrys app wordt afgesloten…", "sOld": "De vorige versie wordt verwijderd…", "sClean": "Oude bestanden worden opgeruimd…", "sCopy": "Bestanden worden gekopieerd… %d%%", "sUninst": "Verwijderprogramma wordt klaargezet…",
		"sShort": "Snelkoppelingen worden gemaakt…", "sReg": "Wordt aangemeld bij Windows…", "sDone": "Klaar.",
		"tDoneI": "Installatie voltooid", "tDoneU": "Bijwerken voltooid", "dDone": "Valkyrys app staat klaar. Je vindt de app in het Startmenu%s.", "dDoneDesk": " en op je bureaublad",
		"chkLaunch": "Valkyrys app nu openen", "tErr": "Er ging iets mis",
		"eFolder": "De map kon niet worden aangemaakt, of er kan niet in worden geschreven:\n%s\n\nKies een andere map, bijvoorbeeld in je gebruikersmap.",
		"eUnpack": "De programmabestanden konden niet worden geschreven. Sluit Valkyrys app en probeer het opnieuw.\n\n%s",
		"ePath":   "Kies een geldige map, bijvoorbeeld D:\\Programma's\\Valkyrys app.", "eRoot": "Kies een map en niet de hoofdmap van een schijf.", "eSys": "Kies een andere map: in deze map kan de app niet worden geïnstalleerd.",
		"uAsk":   "Valkyrys app van deze computer verwijderen?\n\nJe facturen en instellingen blijven bewaard.",
		"uDone":  "Valkyrys app is verwijderd.\n\nJe facturen en instellingen staan nog in %APPDATA%\\Valkyrys app en worden opnieuw gebruikt als je de app weer installeert.",
		"fbAsk":  "Valkyrys app installeren op deze computer?\n\nHet wordt geïnstalleerd voor jouw Windows-account, in:\n%s",
		"fbDone": "Valkyrys app is geïnstalleerd.\n\nEr is een snelkoppeling op je bureaublad en in het Startmenu. Nu openen?",
	},
	"en": {
		"window": "Valkyrys app – Setup", "tInstall": "Install Valkyrys app", "tUpdate": "Update Valkyrys app",
		"dInstall": "This installs Valkyrys app for your Windows account. You do not need administrator rights.",
		"dUpdate":  "A version is already on this computer. It will be updated. Your invoices and settings are kept.",
		"fInstall": "Install in:", "fUpdate": "Update in:", "browse": "Browse…", "browseTitle": "Choose the folder for Valkyrys app",
		"chkDesktop": "Create a desktop shortcut", "note": "Your invoices and settings are kept apart from the program folder and always stay.",
		"bInstall": "Install", "bUpdate": "Update", "bCancel": "Cancel", "bFinish": "Finish", "bClose": "Close",
		"wInstall": "Installing…", "wUpdate": "Updating…",
		"sClosing": "Closing Valkyrys app…", "sOld": "Removing the previous version…", "sClean": "Removing old files…", "sCopy": "Copying files… %d%%", "sUninst": "Preparing the uninstaller…",
		"sShort": "Creating shortcuts…", "sReg": "Registering with Windows…", "sDone": "Done.",
		"tDoneI": "Installation complete", "tDoneU": "Update complete", "dDone": "Valkyrys app is ready. You can find it in the Start menu%s.", "dDoneDesk": " and on your desktop",
		"chkLaunch": "Open Valkyrys app now", "tErr": "Something went wrong",
		"eFolder": "The folder could not be created, or it cannot be written to:\n%s\n\nChoose another folder, for example one in your user folder.",
		"eUnpack": "The program files could not be written. Close Valkyrys app and try again.\n\n%s",
		"ePath":   "Choose a valid folder, for example D:\\Programs\\Valkyrys app.", "eRoot": "Choose a folder, not the root of a drive.", "eSys": "Choose another folder: the app cannot be installed in this one.",
		"uAsk":   "Remove Valkyrys app from this computer?\n\nYour invoices and settings are kept.",
		"uDone":  "Valkyrys app has been removed.\n\nYour invoices and settings are still in %APPDATA%\\Valkyrys app and are used again if you reinstall.",
		"fbAsk":  "Install Valkyrys app on this computer?\n\nIt is installed for your Windows account, in:\n%s",
		"fbDone": "Valkyrys app is installed.\n\nThere is a shortcut on your desktop and in the Start menu. Open it now?",
	},
	"pl": {
		"window": "Valkyrys app – Instalator", "tInstall": "Instalacja Valkyrys app", "tUpdate": "Aktualizacja Valkyrys app",
		"dInstall": "Instalator zainstaluje Valkyrys app dla Twojego konta Windows. Nie potrzebujesz uprawnień administratora.",
		"dUpdate":  "Na tym komputerze jest już zainstalowana wersja. Zostanie zaktualizowana. Twoje faktury i ustawienia zostaną zachowane.",
		"fInstall": "Zainstaluj w:", "fUpdate": "Zaktualizuj w:", "browse": "Przeglądaj…", "browseTitle": "Wybierz folder dla Valkyrys app",
		"chkDesktop": "Utwórz skrót na pulpicie", "note": "Twoje faktury i ustawienia są przechowywane osobno od folderu programu i zawsze zostają.",
		"bInstall": "Zainstaluj", "bUpdate": "Zaktualizuj", "bCancel": "Anuluj", "bFinish": "Zakończ", "bClose": "Zamknij",
		"wInstall": "Trwa instalacja…", "wUpdate": "Trwa aktualizacja…",
		"sClosing": "Zamykanie Valkyrys app…", "sOld": "Usuwanie poprzedniej wersji…", "sClean": "Usuwanie starych plików…", "sCopy": "Kopiowanie plików… %d%%", "sUninst": "Przygotowanie programu odinstalowującego…",
		"sShort": "Tworzenie skrótów…", "sReg": "Rejestrowanie w systemie Windows…", "sDone": "Gotowe.",
		"tDoneI": "Instalacja zakończona", "tDoneU": "Aktualizacja zakończona", "dDone": "Valkyrys app jest gotowy. Znajdziesz go w menu Start%s.", "dDoneDesk": " i na pulpicie",
		"chkLaunch": "Otwórz teraz Valkyrys app", "tErr": "Coś poszło nie tak",
		"eFolder": "Nie można utworzyć folderu lub zapisać w nim plików:\n%s\n\nWybierz inny folder, na przykład w folderze użytkownika.",
		"eUnpack": "Nie udało się zapisać plików programu. Zamknij Valkyrys app i spróbuj ponownie.\n\n%s",
		"ePath":   "Wybierz prawidłowy folder, na przykład D:\\Programy\\Valkyrys app.", "eRoot": "Wybierz folder, a nie katalog główny dysku.", "eSys": "Wybierz inny folder: w tym folderze nie można zainstalować aplikacji.",
		"uAsk":   "Usunąć Valkyrys app z tego komputera?\n\nTwoje faktury i ustawienia zostaną zachowane.",
		"uDone":  "Valkyrys app został usunięty.\n\nTwoje faktury i ustawienia nadal znajdują się w %APPDATA%\\Valkyrys app i będą użyte ponownie po ponownej instalacji.",
		"fbAsk":  "Zainstalować Valkyrys app na tym komputerze?\n\nZostanie zainstalowany dla Twojego konta Windows w:\n%s",
		"fbDone": "Valkyrys app został zainstalowany.\n\nSkrót znajduje się na pulpicie i w menu Start. Otworzyć teraz?",
	},
}

// langFromID picks the interface language from a Windows language id (low ten bits: 0x13 Dutch, 0x15 Polish)
func langFromID(id uint16) string {
	switch id & 0x3ff {
	case 0x13:
		return "nl"
	case 0x15:
		return "pl"
	}
	return "en"
}

var lang = "en"

func t(key string, args ...any) string {
	s, ok := texts[lang][key]
	if !ok {
		s = texts["en"][key]
	}
	if len(args) > 0 {
		return fmt.Sprintf(s, args...)
	}
	return s
}

// ---- the install folder
func samePath(a, b string) bool { return strings.EqualFold(filepath.Clean(a), filepath.Clean(b)) }

func inside(root, p string) bool {
	root, p = strings.ToLower(filepath.Clean(root)), strings.ToLower(filepath.Clean(p))
	return p != root && strings.HasPrefix(p, strings.TrimSuffix(root, sep)+sep)
}

// resolveDir turns what the user typed or picked into the folder the program is installed in. It is always a folder of its own:
// an existing folder with other things in it gets a "Valkyrys app" folder inside it, so nothing of theirs is ever replaced.
// protected lists folders that must never be used (and nothing inside the first few of them directly).
func resolveDir(input string, protected []string) (string, error) {
	p := strings.Trim(strings.TrimSpace(input), `"`)
	if p == "" || !filepath.IsAbs(p) {
		return "", errors.New("path")
	}
	p = filepath.Clean(p)
	if filepath.Dir(p) == p {
		return "", errors.New("root")
	}
	for _, s := range protected {
		if s != "" && samePath(p, s) {
			return "", errors.New("system")
		}
	}
	if ents, err := os.ReadDir(p); err == nil && len(ents) > 0 {
		_, errNew := os.Stat(filepath.Join(p, exeName))
		_, errOld := os.Stat(filepath.Join(p, oldExe))
		if errNew != nil && errOld != nil && !strings.EqualFold(filepath.Base(p), name) && !strings.EqualFold(filepath.Base(p), oldName) { // not an earlier install of ours
			p = filepath.Join(p, name)
		}
	}
	return p, nil
}

// writable creates the folder (when needed) and proves that files can be written in it
func writable(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".write-test-*")
	if err != nil {
		return err
	}
	f.Close()
	return os.Remove(f.Name())
}

// ---- unpacking with progress
type progress func(done, total int64, file string)

func zipTotal(zr *zip.Reader) (total int64) {
	for _, f := range zr.File {
		if !f.FileInfo().IsDir() {
			total += int64(f.UncompressedSize64)
		}
	}
	return
}

type countWriter struct {
	w   io.Writer
	add func(n int)
}

func (c *countWriter) Write(p []byte) (int, error) { n, err := c.w.Write(p); c.add(n); return n, err }

// unpack writes the files of the zip into dir (never outside it) and returns the relative paths it wrote
func unpack(zipData []byte, dir string, report progress) ([]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, err
	}
	total := zipTotal(zr)
	var done int64
	var written []string
	for _, f := range zr.File {
		target := filepath.Join(dir, filepath.FromSlash(f.Name))
		if !inside(dir, target) {
			continue // never write outside the install folder
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(target, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return written, err
		}
		if err := copyEntry(f, target, func(n int) {
			done += int64(n)
			if report != nil {
				report(done, total, f.Name)
			}
		}); err != nil {
			return written, err
		}
		written = append(written, filepath.ToSlash(f.Name))
	}
	if report != nil {
		report(total, total, "")
	}
	return written, nil
}

func copyEntry(f *zip.File, target string, add func(int)) error {
	var err error
	for i := 0; i < 8; i++ { // a program that was just closed may still hold the file for a moment
		var out *os.File
		if out, err = os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755); err == nil {
			var rc io.ReadCloser
			if rc, err = f.Open(); err == nil {
				_, err = io.Copy(&countWriter{w: out, add: add}, rc)
				rc.Close()
			}
			out.Close()
			return err
		}
		sleep(500)
	}
	return err
}

// cleanOld removes what an earlier version put in the folder (its own list of files, plus the folders every version has)
func cleanOld(dir string) {
	for _, rel := range readManifest(dir) {
		_ = os.Remove(filepath.Join(dir, filepath.FromSlash(rel)))
	}
	_ = os.RemoveAll(filepath.Join(dir, "resources"))
	_ = os.RemoveAll(filepath.Join(dir, "locales"))
}

func writeManifest(dir string, files []string) error {
	sort.Strings(files)
	return os.WriteFile(filepath.Join(dir, manifest), []byte(strings.Join(files, "\n")+"\n"), 0o644)
}

func readManifest(dir string) []string { return readManifestNamed(dir, manifest) }

func readManifestNamed(dir, listName string) []string {
	f, err := os.Open(filepath.Join(dir, listName))
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if l := strings.TrimSpace(sc.Text()); l != "" && !strings.Contains(l, "..") {
			out = append(out, l)
		}
	}
	return out
}

// removeInstalled deletes exactly the files the installer wrote (and the folders that become empty). Returns false when there is no list,
// which is the case for the very first version: then the caller removes its own known folder completely.
func removeInstalled(dir string) bool { return removeListed(dir, manifest) }

// removeListed does the same for the list file with the given name (the one of the old "Valkyrys Facturen" install has another name)
func removeListed(dir, listName string) bool {
	files := readManifestNamed(dir, listName)
	if len(files) == 0 {
		return false
	}
	dirs := map[string]bool{}
	for _, rel := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		_ = os.Remove(p)
		for d := filepath.Dir(p); inside(dir, d); d = filepath.Dir(d) {
			dirs[d] = true
		}
	}
	list := make([]string, 0, len(dirs))
	for d := range dirs {
		list = append(list, d)
	}
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) }) // deepest first
	for _, d := range list {
		_ = os.Remove(d) // only succeeds when empty
	}
	_ = os.Remove(filepath.Join(dir, listName))
	return true
}
