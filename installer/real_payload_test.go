package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Unpacks the real payload the way the installer does (skipped when no payload has been built yet).
func TestRealPayload(t *testing.T) {
	z, err := os.ReadFile("payload/app.zip")
	if err != nil {
		t.Skip("no payload/app.zip")
	}
	dir := filepath.Join(t.TempDir(), "Valkyrys app")
	os.MkdirAll(dir, 0o755)
	var last, total int64
	written, err := unpack(z, dir, func(d, tot int64, f string) { last, total = d, tot })
	if err != nil {
		t.Fatal(err)
	}
	if last != total || total < 200<<20 {
		t.Errorf("progress %d of %d", last, total)
	}
	for _, p := range []string{exeName, filepath.Join("resources", "app", "main.js"), filepath.Join("resources", "app", "web", "index.html"), "resources.pak"} {
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			t.Errorf("%s missing after unpacking", p)
		}
	}
	t.Logf("%d files, %d MB", len(written), total>>20)
}
