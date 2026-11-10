// Valkyrys Facturen: a tiny local server that shows the invoice tool in its own app window and keeps the data in a file.
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

const addr = "127.0.0.1:47631"

var (
	mu       sync.Mutex
	docs     = map[string]json.RawMessage{}
	dataFile string
	lastPing = time.Now()
	pinged   bool
)

func dataPath() string {
	if p := os.Getenv("VALKYRYS_DATA"); p != "" {
		return p
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "Valkyrys Facturen", "data.json")
}

func load() {
	b, err := os.ReadFile(dataFile)
	if err != nil {
		// first start: fill in the usual settings (change the starting number under Instellingen)
		docs["settings/main"] = json.RawMessage(`{"startNumber":62,"startYear":2026,"betaaltermijn":"14 dagen","btw":"verlegd","fileTemplate":"VALKYRYS {nummer}","client":{"name":"Piguillet BV","street":"Edisonstraat 8","city":"2652 XS Berkel en Rodenrijs","kvk":"52742938","btw":"NL850577950B01"}}`)
		return
	}
	_ = json.Unmarshal(b, &docs)
}

// save writes atomically and keeps one backup of the previous version.
func save() {
	b, err := json.MarshalIndent(docs, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(dataFile), 0o755)
	if old, err := os.ReadFile(dataFile); err == nil {
		_ = os.WriteFile(dataFile+".bak", old, 0o644)
	}
	tmp := dataFile + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, dataFile)
	}
}

func api(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	switch r.URL.Path {
	case "/api/ping":
		mu.Lock()
		lastPing, pinged = time.Now(), true
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	case "/api/db":
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(docs)
	case "/api/doc":
		path := r.URL.Query().Get("path")
		if path == "" {
			http.Error(w, "path required", http.StatusBadRequest)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
			if err != nil || !json.Valid(body) {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			docs[path] = body
		case http.MethodDelete:
			delete(docs, path)
		default:
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		save()
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

func main() {
	dataFile = dataPath()
	load()

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// already running: just bring up another window on the running instance
		if cmd := openWindow("http://" + addr + "/"); cmd != nil {
			time.Sleep(2 * time.Second)
		}
		return
	}

	sub, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", api)
	mux.Handle("/", http.FileServer(http.FS(sub)))
	srv := &http.Server{Handler: mux}

	quit := func(why string) {
		mu.Lock()
		save()
		mu.Unlock()
		fmt.Println("closing:", why)
		os.Exit(0)
	}

	// fallback: quit when the page has stopped pinging for a long time (a minimised window pings slowly)
	go func() {
		start := time.Now()
		for range time.Tick(5 * time.Second) {
			mu.Lock()
			idle := time.Since(lastPing)
			seen := pinged
			mu.Unlock()
			if (seen && idle > 10*time.Minute) || (!seen && time.Since(start) > 3*time.Minute) {
				quit("idle")
			}
		}
	}()

	go func() {
		time.Sleep(300 * time.Millisecond)
		t0 := time.Now()
		cmd := openWindow("http://" + addr + "/")
		if cmd == nil {
			return
		}
		_ = cmd.Wait() // returns when the app window has been closed
		if time.Since(t0) > 5*time.Second {
			quit("window closed")
		}
	}()
	_ = srv.Serve(ln)
}
