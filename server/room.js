'use strict';

/**
 * TypeWar 房间管理：创建/加入房间、选卡、就绪、开局种子下发、
 * 战斗事件与快照转发、再战与掉线处理。
 */

const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function makeCode(rooms) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(code)) return code;
  }
}

class Player {
  constructor(ws) {
    this.ws = ws;
    this.card = null;   // 选中的卡片 id
    this.ready = false;
    this.again = false; // 再战意愿
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.slots = [null, null]; // Player | null
    this.inBattle = false;
    this.seed = 0;
  }
  get full() { return this.slots[0] && this.slots[1]; }
  peerOf(ws) {
    const idx = this.slots.findIndex(p => p && p.ws === ws);
    if (idx === -1) return { player: null, peer: null, index: -1 };
    const peer = idx === 0 ? this.slots[1] : this.slots[0];
    return { player: this.slots[idx], peer, index: idx };
  }
  broadcast(msg) {
    for (const p of this.slots) {
      if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
    }
  }
  sendTo(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
  sendPeer(ws, msg) {
    const { peer } = this.peerOf(ws);
    if (peer && peer.ws.readyState === 1) peer.ws.send(JSON.stringify(msg));
  }
  newRound() {
    this.seed = (Math.random() * 2 ** 31) | 0;
    for (const p of this.slots) if (p) p.again = false;
  }
  tryStart() {
    if (!this.full) return;
    const [a, b] = this.slots;
    if (!a.card || !b.card || !a.ready || !b.ready) return;
    this.newRound();
    this.inBattle = true;
    const players = [a.card, b.card];
    this.broadcast({ t: 'start', seed: this.seed, players });
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
    this.byWs = new Map();  // ws -> Room
  }

  attach(ws) {
    ws.on('message', raw => this.onMessage(ws, raw));
    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => {});
    this.send(ws, { t: 'hello' });
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  leave(ws, notifyPeer = true) {
    const room = this.byWs.get(ws);
    if (!room) return null;
    const { peer } = room.peerOf(ws);
    const wasInBattle = room.inBattle;
    room.slots = room.slots.map(p => (p && p.ws === ws) ? null : p);
    this.byWs.delete(ws);
    if (!room.slots[0] && !room.slots[1]) {
      this.rooms.delete(room.code);
    } else if (notifyPeer && peer) {
      room.sendTo(peer.ws, { t: 'peer-left', inBattle: wasInBattle });
    }
    return room;
  }

  onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'create': {
        this.leave(ws, false);
        const room = new Room(makeCode(this.rooms));
        this.rooms.set(room.code, room);
        room.slots[0] = new Player(ws);
        this.byWs.set(ws, room);
        this.send(ws, { t: 'created', code: room.code });
        break;
      }
      case 'join': {
        const code = String(msg.code || '').trim().toUpperCase();
        const room = this.rooms.get(code);
        if (!room) return this.send(ws, { t: 'error', msg: '房间不存在，请检查房间码' });
        if (room.full) return this.send(ws, { t: 'error', msg: '房间已满（2 人）' });
        this.leave(ws, false);
        // 找一个空位
        const idx = room.slots[0] ? 1 : 0;
        room.slots[idx] = new Player(ws);
        this.byWs.set(ws, room);
        this.send(ws, { t: 'joined', code: room.code });
        room.sendPeer(ws, { t: 'peer-joined' });
        // 若对方已选卡，同步给自己
        const { peer } = room.peerOf(ws);
        if (peer && peer.card) this.send(ws, { t: 'peer-card', card: peer.card });
        break;
      }
      case 'card': {
        const room = this.byWs.get(ws);
        if (!room) return;
        const { player } = room.peerOf(ws);
        if (!player) return;
        const changed = player.card !== msg.card;
        player.card = typeof msg.card === 'string' ? msg.card : null;
        if (changed) { player.ready = false; player.again = false; }
        this.send(ws, { t: 'card-ok', card: player.card, ready: player.ready });
        room.sendPeer(ws, { t: 'peer-card', card: player.card });
        room.sendPeer(ws, { t: 'peer-ready', ready: player.ready });
        break;
      }
      case 'ready': {
        const room = this.byWs.get(ws);
        if (!room) return;
        const { player } = room.peerOf(ws);
        if (!player) return;
        if (!player.card) return this.send(ws, { t: 'error', msg: '请先选择人物卡片' });
        player.ready = !!msg.ready;
        player.again = false;
        room.sendPeer(ws, { t: 'peer-ready', ready: player.ready });
        this.send(ws, { t: 'ready-ok', ready: player.ready });
        room.tryStart();
        break;
      }
      case 'evt':
      case 'snap': {
        const room = this.byWs.get(ws);
        if (!room || !room.inBattle) return;
        room.sendPeer(ws, { t: 'peer-' + msg.t, data: msg.data });
        break;
      }
      case 'again': {
        const room = this.byWs.get(ws);
        if (!room) return;
        const { player, peer } = room.peerOf(ws);
        if (!player) return;
        player.again = true;
        if (peer && peer.ws.readyState === 1) room.sendTo(peer.ws, { t: 'peer-again' });
        if (room.full && room.slots.every(p => p && p.again)) room.tryStart();
        break;
      }
      case 'leave': {
        this.leave(ws, true);
        break;
      }
    }
  }

  onClose(ws) {
    this.leave(ws, true);
  }
}

module.exports = { RoomManager };
