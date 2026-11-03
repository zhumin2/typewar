// TypeWar 服务器：静态文件托管 + WebSocket 房间对战
//
// 与前端 public/js/net.js、room 协议完全兼容，消息格式参见 room.go。
//
//	go run ./server                  # 默认 :3000，静态目录 ./public
//	go run ./server -addr :8080 -dir ./public
//	go run ./server -tls-cert cert.pem -tls-key key.pem   # 直连 HTTPS/WSS
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

var mimeTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".ico":   "image/x-icon",
	".woff2": "font/woff2",
}

// upgrader 允许任意 Origin：GitHub Pages 上的前端需要跨域连到自建服务器
var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func main() {
	addr := flag.String("addr", defaultAddr(), "监听地址")
	dir := flag.String("dir", "public", "静态文件目录")
	cert := flag.String("tls-cert", "", "TLS 证书路径（可选）")
	key := flag.String("tls-key", "", "TLS 私钥路径（可选）")
	flag.Parse()

	root, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatalf("解析静态目录失败: %v", err)
	}
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		log.Fatalf("静态目录不存在: %s", root)
	}

	hub := NewHub()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return // Upgrade 已写入错误响应
		}
		hub.serve(&Conn{ws: conn, send: make(chan []byte, 64), done: make(chan struct{}), hub: hub})
	})
	mux.HandleFunc("/", staticHandler(root))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Println("========================================")
	log.Println("  TYPEWAR  ⌨️⚔️  打字对战（Go 服务端）")
	if *cert != "" && *key != "" {
		log.Printf("  ➜  https://localhost%s", *addr)
		log.Fatal(srv.ListenAndServeTLS(*cert, *key))
	}
	log.Printf("  ➜  http://localhost%s", *addr)
	log.Println("  PVP 联机：同一局域网访问本机 IP")
	log.Println("========================================")
	log.Fatal(srv.ListenAndServe())
}

func defaultAddr() string {
	if p := os.Getenv("PORT"); p != "" {
		if strings.HasPrefix(p, ":") {
			return p
		}
		return ":" + p
	}
	return ":3000"
}

// staticHandler 返回静态文件处理器："/" 映射 index.html，禁止路径穿越
func staticHandler(root string) http.HandlerFunc {
	prefix := root + string(os.PathSeparator)
	return func(w http.ResponseWriter, r *http.Request) {
		upath := r.URL.Path
		if upath == "/" || upath == "" {
			upath = "/index.html"
		}
		clean := path.Clean("/" + upath)
		fp := filepath.Join(root, filepath.FromSlash(clean))
		if fp != root && !strings.HasPrefix(fp, prefix) {
			http.Error(w, "403 Forbidden", http.StatusForbidden)
			return
		}
		data, err := os.ReadFile(fp)
		if err != nil {
			http.Error(w, "404 Not Found", http.StatusNotFound)
			return
		}
		ct := mimeTypes[strings.ToLower(filepath.Ext(fp))]
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(data)
	}
}
