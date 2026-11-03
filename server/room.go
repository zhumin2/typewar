package main

// 房间管理：创建/加入/选卡/就绪/开局/事件转发/再战/掉线
//
// 协议（与 public/js/net.js 一一对应）
//
//	客户端 → 服务端: create | join{code} | card{card} | ready{ready} |
//	                 evt{data} | snap{data} | again | leave
//	服务端 → 客户端: hello | created{code} | joined{code} | error{msg} |
//	                 peer-joined | peer-card{card} | peer-ready{ready} |
//	                 peer-left{inBattle} | start{seed,players} |
//	                 peer-evt{data} | peer-snap{data} | peer-again |
//	                 card-ok{card,ready} | ready-ok{ready}

import (
	"encoding/json"
	"math/rand"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	codeChars   = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	codeLen     = 4
	pingPeriod  = 25 * time.Second
	readTimeout = 70 * time.Second
	writeWait   = 10 * time.Second
	maxMsgBytes = 1 << 20
)

/* ---------------- 连接 ---------------- */

// Conn 是一条 WebSocket 连接：读写各自独立 goroutine
type Conn struct {
	ws    *websocket.Conn
	send  chan []byte
	done  chan struct{}
	once  sync.Once
	hub   *Hub
	room  *Room  // 所属房间（由 Hub 在加锁下维护）
	me    *Player // 本连接在房间中的玩家对象
}

func (c *Conn) close() {
	c.once.Do(func() {
		close(c.done)
		_ = c.ws.Close()
	})
}

// enqueue 非阻塞投递；缓冲满视为慢客户端，直接断开
func (c *Conn) enqueue(b []byte) {
	select {
	case <-c.done:
	case c.send <- b:
	default:
		c.close()
	}
}

func (c *Conn) sendJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.enqueue(b)
}

func (c *Conn) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Conn) readPump() {
	defer func() {
		c.hub.leave(c, true)
		c.close()
	}()
	c.ws.SetReadLimit(maxMsgBytes)
	_ = c.ws.SetReadDeadline(time.Now().Add(readTimeout))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(readTimeout))
	})
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		c.hub.handle(c, data)
	}
}

/* ---------------- 玩家与房间 ---------------- */

type Player struct {
	conn  *Conn
	card  *string
	ready bool
	again bool
}

type Room struct {
	code     string
	players  [2]*Player
	inBattle bool
	seed     int64
}

func (r *Room) isFull() bool { return r.players[0] != nil && r.players[1] != nil }

// peerOf 返回 (自己, 对手, 自己的槽位)
func (r *Room) peerOf(c *Conn) (*Player, *Player, int) {
	for i, p := range r.players {
		if p != nil && p.conn == c {
			return p, r.players[1-i], i
		}
	}
	return nil, nil, -1
}

func (r *Room) broadcast(v any) {
	for _, p := range r.players {
		if p != nil {
			p.conn.sendJSON(v)
		}
	}
}

func (r *Room) sendPeer(c *Conn, v any) {
	if _, peer, _ := r.peerOf(c); peer != nil {
		peer.conn.sendJSON(v)
	}
}

func (r *Room) newRound() {
	r.seed = rand.Int63n(1 << 31)
	for _, p := range r.players {
		if p != nil {
			p.again = false
		}
	}
}

func (r *Room) tryStart() {
	if !r.isFull() {
		return
	}
	a, b := r.players[0], r.players[1]
	if a.card == nil || b.card == nil || !a.ready || !b.ready {
		return
	}
	r.newRound()
	r.inBattle = true
	r.broadcast(map[string]any{
		"t":       "start",
		"seed":    r.seed,
		"players": []string{*a.card, *b.card},
	})
}

/* ---------------- Hub ---------------- */

type Hub struct {
	mu     sync.Mutex
	rooms  map[string]*Room // 房间码 → 房间
	byConn map[*Conn]*Room  // 连接 → 房间
}

func NewHub() *Hub {
	return &Hub{
		rooms:  make(map[string]*Room),
		byConn: make(map[*Conn]*Room),
	}
}

// serve 启动一条连接的读写循环
func (h *Hub) serve(c *Conn) {
	go c.writePump()
	c.sendJSON(map[string]any{"t": "hello"})
	c.readPump() // 阻塞直到连接结束
}

func (h *Hub) newCode() string {
	for {
		b := make([]byte, codeLen)
		for i := range b {
			b[i] = codeChars[rand.Intn(len(codeChars))]
		}
		code := string(b)
		if _, exists := h.rooms[code]; !exists {
			return code
		}
	}
}

// leave 断开连接与房间的关联；notifyPeer 为真时通知对手
func (h *Hub) leave(c *Conn, notifyPeer bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.byConn[c]
	if room == nil {
		delete(h.byConn, c)
		return
	}
	_, peer, _ := room.peerOf(c)
	wasInBattle := room.inBattle

	for i, p := range room.players {
		if p != nil && p.conn == c {
			room.players[i] = nil
		}
	}
	delete(h.byConn, c)
	c.room = nil
	c.me = nil

	if room.players[0] == nil && room.players[1] == nil {
		delete(h.rooms, room.code)
		return
	}
	if notifyPeer && peer != nil {
		peer.conn.sendJSON(map[string]any{"t": "peer-left", "inBattle": wasInBattle})
	}
}

func (h *Hub) handle(c *Conn, data []byte) {
	var m struct {
		T     string          `json:"t"`
		Code  string          `json:"code"`
		Card  *string         `json:"card"`
		Ready bool            `json:"ready"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	switch m.T {
	case "create":
		h.leaveLocked(c, false)
		room := &Room{code: h.newCode()}
		h.rooms[room.code] = room
		p := &Player{conn: c}
		room.players[0] = p
		h.byConn[c] = room
		c.room, c.me = room, p
		c.sendJSON(map[string]any{"t": "created", "code": room.code})

	case "join":
		code := toUpperTrim(m.Code)
		room, ok := h.rooms[code]
		if !ok {
			c.sendJSON(map[string]any{"t": "error", "msg": "房间不存在，请检查房间码"})
			return
		}
		if room.isFull() {
			c.sendJSON(map[string]any{"t": "error", "msg": "房间已满（2 人）"})
			return
		}
		h.leaveLocked(c, false)
		slot := 0
		if room.players[0] != nil {
			slot = 1
		}
		p := &Player{conn: c}
		room.players[slot] = p
		h.byConn[c] = room
		c.room, c.me = room, p
		c.sendJSON(map[string]any{"t": "joined", "code": room.code})
		room.sendPeer(c, map[string]any{"t": "peer-joined"})
		if _, peer, _ := room.peerOf(c); peer != nil && peer.card != nil {
			c.sendJSON(map[string]any{"t": "peer-card", "card": *peer.card})
		}

	case "card":
		room := h.byConn[c]
		if room == nil {
			return
		}
		player, _, _ := room.peerOf(c)
		if player == nil {
			return
		}
		changed := (player.card == nil) != (m.Card == nil) ||
			(player.card != nil && m.Card != nil && *player.card != *m.Card)
		player.card = m.Card
		if changed {
			player.ready = false
			player.again = false
		}
		c.sendJSON(map[string]any{"t": "card-ok", "card": player.card, "ready": player.ready})
		room.sendPeer(c, map[string]any{"t": "peer-card", "card": player.card})
		room.sendPeer(c, map[string]any{"t": "peer-ready", "ready": player.ready})

	case "ready":
		room := h.byConn[c]
		if room == nil {
			return
		}
		player, _, _ := room.peerOf(c)
		if player == nil {
			return
		}
		if player.card == nil {
			c.sendJSON(map[string]any{"t": "error", "msg": "请先选择人物卡片"})
			return
		}
		player.ready = m.Ready
		player.again = false
		room.sendPeer(c, map[string]any{"t": "peer-ready", "ready": player.ready})
		c.sendJSON(map[string]any{"t": "ready-ok", "ready": player.ready})
		room.tryStart()

	case "evt", "snap":
		room := h.byConn[c]
		if room == nil || !room.inBattle {
			return
		}
		room.sendPeer(c, map[string]any{"t": "peer-" + m.T, "data": m.Data})

	case "again":
		room := h.byConn[c]
		if room == nil {
			return
		}
		player, peer, _ := room.peerOf(c)
		if player == nil {
			return
		}
		player.again = true
		if peer != nil {
			peer.conn.sendJSON(map[string]any{"t": "peer-again"})
		}
		if room.isFull() && room.players[0].again && room.players[1].again {
			room.tryStart()
		}

	case "leave":
		h.leaveLocked(c, true)
	}
}

// leaveLocked 与 leave 相同，但要求调用方已持有 h.mu
func (h *Hub) leaveLocked(c *Conn, notifyPeer bool) {
	room := h.byConn[c]
	if room == nil {
		delete(h.byConn, c)
		return
	}
	_, peer, _ := room.peerOf(c)
	wasInBattle := room.inBattle

	for i, p := range room.players {
		if p != nil && p.conn == c {
			room.players[i] = nil
		}
	}
	delete(h.byConn, c)
	c.room = nil
	c.me = nil

	if room.players[0] == nil && room.players[1] == nil {
		delete(h.rooms, room.code)
		return
	}
	if notifyPeer && peer != nil {
		peer.conn.sendJSON(map[string]any{"t": "peer-left", "inBattle": wasInBattle})
	}
}

func toUpperTrim(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			continue
		}
		if r >= 'a' && r <= 'z' {
			r -= 'a' - 'A'
		}
		out = append(out, r)
	}
	return string(out)
}
