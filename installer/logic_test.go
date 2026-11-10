package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func mkZip(t *testing.T, files map[string][]byte, order []string) []byte {
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, n := range order {
		f, err := w.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		f.Write(files[n])
	}
	w.Close()
	return b.Bytes()
}

func TestTextsComplete(t *testing.T) {
	ph := regexp.MustCompile(`%[sd]`)
	for key, en := range texts["en"] {
		for _, l := range []string{"nl", "pl"} {
			s, ok := texts[l][key]
			if !ok {
				t.Errorf("%s is missing %q", l, key)
				continue
			}
			if len(ph.FindAllString(s, -1)) != len(ph.FindAllString(en, -1)) {
				t.Errorf("%s %q: placeholders differ from English", l, key)
			}
		}
	}
	for _, l := range []string{"nl", "pl"} {
		if len(texts[l]) != len(texts["en"]) {
			t.Errorf("%s has %d texts, English has %d", l, len(texts[l]), len(texts["en"]))
		}
	}
}

func TestLang(t *testing.T) {
	for id, want := range map[uint16]string{0x0413: "nl", 0x0813: "nl", 0x0415: "pl", 0x0409: "en", 0x0407: "en"} {
		if got := langFromID(id); got != want {
			t.Errorf("langFromID(%#x) = %s, want %s", id, got, want)
		}
	}
}

func TestResolveDir(t *testing.T) {
	root := t.TempDir()
	mkdir := func(p string) string { p = filepath.Join(root, p); os.MkdirAll(p, 0o755); return p }
	touch := func(p string) { os.WriteFile(p, []byte("x"), 0o644) }
	for _, bad := range []string{"", "   ", "relative/path", "/"} {
		if _, err := resolveDir(bad, nil); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
	if _, err := resolveDir("/", nil); err == nil || err.Error() != "root" {
		t.Errorf("a drive root should say root, got %v", err)
	}
	prot := mkdir("protected")
	if _, err := resolveDir(prot, []string{prot}); err == nil || err.Error() != "system" {
		t.Errorf("a protected folder should be refused, got %v", err)
	}
	fresh := filepath.Join(root, "new", "deeper")
	if got, err := resolveDir(fresh, nil); err != nil || got != fresh {
		t.Errorf("a new folder is used as it is: %v %v", got, err)
	}
	empty := mkdir("empty")
	if got, _ := resolveDir(empty, nil); got != empty {
		t.Errorf("an empty folder is used as it is: %v", got)
	}
	full := mkdir("apps")
	touch(filepath.Join(full, "other.txt"))
	if got, _ := resolveDir(full, nil); got != filepath.Join(full, name) {
		t.Errorf("a folder with other things gets its own subfolder: %v", got)
	}
	ours := mkdir("ours")
	touch(filepath.Join(ours, exeName))
	touch(filepath.Join(ours, "x.dll"))
	if got, _ := resolveDir(ours, nil); got != ours {
		t.Errorf("an earlier install is updated in place: %v", got)
	}
	named := mkdir(name)
	touch(filepath.Join(named, "something"))
	if got, _ := resolveDir(named, nil); got != named {
		t.Errorf("a folder already called %q is used: %v", name, got)
	}
	if got, _ := resolveDir(`"`+fresh+`"  `, nil); got != fresh {
		t.Errorf("quotes and spaces are trimmed: %v", got)
	}
	if err := writable(filepath.Join(root, "w", "x")); err != nil {
		t.Errorf("writable: %v", err)
	}
}

func TestUnpackAndRemove(t *testing.T) {
	big := make([]byte, 3<<20)
	rand.Read(big)
	files := map[string][]byte{"Valkyrys app.exe": []byte("exe"), "a/b/c.bin": big, "resources/app/x.js": []byte("js"), "../evil.txt": []byte("no"), "locales/nl.pak": []byte("p")}
	order := []string{"Valkyrys app.exe", "a/b/c.bin", "resources/app/x.js", "../evil.txt", "locales/nl.pak"}
	z := mkZip(t, files, order)
	root := t.TempDir()
	dir := filepath.Join(root, "inst")
	os.MkdirAll(dir, 0o755)
	var last, total int64
	steps := 0
	written, err := unpack(z, dir, func(done, tot int64, file string) {
		if done < last {
			t.Errorf("progress went backwards: %d after %d", done, last)
		}
		last, total = done, tot
		steps++
	})
	if err != nil {
		t.Fatal(err)
	}
	if last != total || total != int64(3<<20+3+2+2+1) {
		t.Errorf("progress should end at the full size, got %d of %d", last, total)
	}
	if steps < 3 {
		t.Errorf("progress was reported only %d times", steps)
	}
	if _, err := os.Stat(filepath.Join(root, "evil.txt")); err == nil {
		t.Error("an entry with .. was written outside the folder")
	}
	got, _ := os.ReadFile(filepath.Join(dir, "a", "b", "c.bin"))
	if !bytes.Equal(got, big) {
		t.Error("file content differs")
	}
	if len(written) != 4 {
		t.Errorf("written list should hold 4 files, has %v", written)
	}
	// the list of installed files, then an update and a removal that leave the user's own file alone
	os.WriteFile(filepath.Join(dir, uninstall), []byte("u"), 0o755)
	if err := writeManifest(dir, append(written, uninstall)); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "mine.txt"), []byte("mine"), 0o644)
	os.WriteFile(filepath.Join(dir, "a", "mine-too.txt"), []byte("mine"), 0o644)
	cleanOld(dir)
	if _, err := os.Stat(filepath.Join(dir, "resources")); err == nil {
		t.Error("cleanOld left resources")
	}
	if _, err := os.Stat(filepath.Join(dir, "Valkyrys app.exe")); err == nil {
		t.Error("cleanOld left a listed file")
	}
	if _, err := os.Stat(filepath.Join(dir, "mine.txt")); err != nil {
		t.Error("cleanOld removed the user's file")
	}
	// unpack again, then remove
	written, _ = unpack(z, dir, nil)
	writeManifest(dir, append(written, uninstall))
	os.WriteFile(filepath.Join(dir, uninstall), []byte("u"), 0o755)
	if !removeInstalled(dir) {
		t.Fatal("removeInstalled should find the list")
	}
	for _, p := range []string{"Valkyrys app.exe", "locales", "resources", filepath.Join("a", "b"), manifest, uninstall} {
		if _, err := os.Stat(filepath.Join(dir, p)); err == nil {
			t.Errorf("%s should be gone", p)
		}
	}
	for _, p := range []string{"mine.txt", filepath.Join("a", "mine-too.txt")} {
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			t.Errorf("%s (the user's) must stay", p)
		}
	}
	if removeInstalled(t.TempDir()) {
		t.Error("without a list removeInstalled must say so")
	}
}

func TestManifestIgnoresDangerousLines(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, manifest), []byte("ok.txt\n../outside.txt\n\n"), 0o644)
	got := readManifest(dir)
	if len(got) != 1 || got[0] != "ok.txt" {
		t.Errorf("got %v", got)
	}
}

// the app used to be called "Valkyrys Facturen": its install is recognised, and removed by its own list of files
func TestOldInstallIsRecognisedAndRemoved(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "Valkyrys Facturen")
	os.MkdirAll(filepath.Join(old, "resources", "app"), 0o755)
	for _, f := range []string{oldExe, oldUninstall, filepath.Join("resources", "app", "main.js")} {
		os.WriteFile(filepath.Join(old, f), []byte("x"), 0o644)
	}
	os.WriteFile(filepath.Join(old, oldManifest), []byte(oldExe+"\n"+oldUninstall+"\nresources/app/main.js\n"), 0o644)
	os.WriteFile(filepath.Join(old, "mine.txt"), []byte("mine"), 0o644)
	if got, _ := resolveDir(old, nil); got != old {
		t.Errorf("the old install folder is used as it is: %v", got)
	}
	if !removeListed(old, oldManifest) {
		t.Fatal("the old list of files should be found")
	}
	for _, p := range []string{oldExe, oldUninstall, filepath.Join("resources", "app", "main.js"), oldManifest} {
		if _, err := os.Stat(filepath.Join(old, p)); err == nil {
			t.Errorf("%s should be gone", p)
		}
	}
	if _, err := os.Stat(filepath.Join(old, "mine.txt")); err != nil {
		t.Error("the user's own file must stay")
	}
	// a folder next to it is the new home: the same parent, the new name
	if got := filepath.Join(filepath.Dir(old), name); filepath.Base(got) != "Valkyrys app" {
		t.Errorf("new home: %v", got)
	}
	// names that must never be mixed up
	if name == oldName || exeName == oldExe || manifest == oldManifest || regKey == oldRegKey || uninstall == oldUninstall {
		t.Error("the new names must differ from the old ones")
	}
}
