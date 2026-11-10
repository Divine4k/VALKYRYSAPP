//go:build !windows

package main

import (
	"fmt"
	"os/exec"
)

func openWindow(url string) *exec.Cmd { fmt.Println("open", url); return nil }
