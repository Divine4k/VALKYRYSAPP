//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func hide(c *exec.Cmd) *exec.Cmd {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return c
}

func browsers() []string {
	var out []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		out = append(out,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"),
		)
	}
	return out
}

// openWindow shows the page as an app window of its own (no tabs, no address bar), with a separate profile so it is not mixed up
// with the normal browser. Edge comes with Windows 10/11; Chrome is the fallback. It returns the window process, or nil.
func openWindow(url string) *exec.Cmd {
	profile := filepath.Join(filepath.Dir(dataPath()), "window")
	args := []string{"--app=" + url, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--disable-sync", "--disable-features=Translate"}
	for _, exe := range browsers() {
		if _, err := os.Stat(exe); err == nil {
			c := exec.Command(exe, args...)
			if c.Start() == nil {
				return c
			}
		}
	}
	_ = hide(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
	return nil
}
