//go:build !windows || uninst

package main

// the small uninstaller carries no program files; on other systems this is only used by the tests
var appZip []byte
var uninstExe []byte
