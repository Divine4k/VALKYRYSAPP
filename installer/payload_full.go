//go:build windows && !uninst

package main

import _ "embed"

//go:embed payload/app.zip
var appZip []byte

//go:embed payload/uninstall.exe
var uninstExe []byte
