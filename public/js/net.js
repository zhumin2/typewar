/**
 * WebSocket 客户端
 */
class Net {
  constructor() {
    this.ws = null;
    this.isHost = false;
    this.code = null;
    this.handlers = new Map();
    this.connected = false;
  }

  connect() {
    if (this.ws && this.connected) return Promise.resolve();
    // 支持通过 ?ws= 参数连接自建服务器（如 GitHub Pages 静态托管场景）
    const override = new URLSearchParams(location.search).get('ws');
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const url = override || (proto + location.host + '/ws');
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (e) { return reject(e); }
      this.ws.onopen = () => { this.connected = true; settled = true; resolve(); };
      this.ws.onerror = () => { if (!settled) { settled = true; reject(new Error('无法连接服务器')); } };
      this.ws.onclose = () => {
        // 仅当此前真正连上过才广播断开，避免首次连接失败时覆盖掉具体错误提示
        const had = this.connected;
        this.connected = false;
        if (had) this.emit('_closed');
      };
      this.ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m && m.t) this.emit(m.t, m);
      };
    });
  }

  on(t, fn) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t).push(fn);
  }
  off(t, fn) {
    const arr = this.handlers.get(t);
    if (arr) this.handlers.set(t, arr.filter(f => f !== fn));
  }
  emit(t, m) {
    (this.handlers.get(t) || []).forEach(f => { try { f(m); } catch (e) { console.error(e); } });
  }
  send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }
}

export const net = new Net();
