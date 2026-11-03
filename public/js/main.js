/**
 * TypeWar 入口：持有页面流状态，串联网络与战斗生命周期
 */
import { CARDS, DIFFICULTIES } from './data.js';
import { Battle } from './battle.js';
import { net } from './net.js';
import { showMenu, showPveSetup, showJoin, showLobby, showBattleScreen, showResult, showPeerAgain, toast } from './ui.js';

const screenState = { name: 'menu' };

const lobby = {
  code: null,
  self: { card: null, ready: false },
  peer: { joined: false, card: null, ready: false },
};

let battle = null;

const isLobby = () => screenState.name === 'lobby';

/* ---------------- 战斗 ---------------- */
function launchBattle(cfg) {
  if (battle) battle.destroy();
  battle = new Battle(cfg);
  screenState.name = 'battle';
  showBattleScreen();
  battle.mount(document.getElementById('app'));
  battle.start();
  window.__battle = battle; // 调试 / 自动化测试钩子
}

function startPve(difficultyId, cardId, vocab = 'mixed') {
  launchBattle({
    mode: 'pve',
    myCard: cardId,
    foeCard: pickFoeCard(cardId),
    difficulty: DIFFICULTIES[difficultyId],
    vocab,
    seed: (Math.random() * 2 ** 31) | 0,
    onEnd: r => showResult(r, {
      pvp: false,
      onAgain: () => startPve(difficultyId, cardId, vocab),
      onMenu: backToMenu,
    }),
  });
}

// PVE 敌方用卡：与玩家不同，随机挑选
function pickFoeCard(myCard) {
  const all = Object.keys(CARDS).filter(c => c !== myCard);
  return all[Math.floor(Math.random() * all.length)];
}

function backToMenu() {
  if (battle) { battle.destroy(); battle = null; }
  screenState.name = 'menu';
  renderMenu();
}

function renderMenu() {
  showMenu({
    onPve: () => {
      screenState.name = 'pve';
      showPveSetup({
        onBack: backToMenu,
        onStart: startPve,
      });
    },
    onCreate: async () => {
      try { await net.connect(); } catch { return toast(pvpConnectError()); }
      net.send({ t: 'create' });
    },
    onJoin: async () => {
      try { await net.connect(); } catch { return toast(pvpConnectError()); }
      screenState.name = 'join';
      showJoin({
        onBack: backToMenu,
        onJoinCode: code => net.send({ t: 'join', code }),
      });
    },
  });
}

/* ---------------- PVP 服务器提示 ---------------- */
// 静态托管（GitHub Pages 等）没有内置联机服务器
function onStaticHosting() {
  return /\.github\.io$/.test(location.hostname) || /githubusercontent\.com$/.test(location.hostname);
}
function pvpConnectError() {
  return onStaticHosting()
    ? '⚠️ 静态托管无联机服务器：PVE 可正常游玩；PVP 请本地 npm start，或在本页地址后加 ?ws=wss://你的服务器/ws'
    : '⚠️ 无法连接服务器，请确认 npm start 已运行';
}

/* ---------------- PVP 大厅 ---------------- */
function renderLobby() {
  screenState.name = 'lobby';
  showLobby({
    code: lobby.code,
    self: lobby.self,
    peer: lobby.peer,
    onLeave: () => { net.send({ t: 'leave' }); backToMenu(); },
    onCard: id => {
      lobby.self.card = id;
      lobby.self.ready = false;
      net.send({ t: 'card', card: id });
      renderLobby();
    },
    onReady: ready => {
      lobby.self.ready = ready;
      net.send({ t: 'ready', ready });
      renderLobby();
    },
  });
}

/* ---------------- 网络事件 ---------------- */
net.on('created', m => {
  net.isHost = true;
  lobby.code = m.code;
  lobby.self = { card: null, ready: false };
  lobby.peer = { joined: false, card: null, ready: false };
  renderLobby();
});

net.on('joined', m => {
  net.isHost = false;
  lobby.code = m.code;
  lobby.self = { card: null, ready: false };
  lobby.peer = { joined: true, card: null, ready: false }; // 房主必然已在
  renderLobby();
});

net.on('error', m => toast('⚠️ ' + (m.msg || '操作失败')));

net.on('peer-joined', () => {
  lobby.peer.joined = true;
  toast('👥 对手已加入房间！');
  if (isLobby()) renderLobby();
});

net.on('peer-card', m => {
  lobby.peer.card = m.card;
  lobby.peer.ready = false;
  if (isLobby()) renderLobby();
});

net.on('peer-ready', m => {
  lobby.peer.ready = m.ready;
  if (isLobby()) renderLobby();
});

net.on('peer-left', () => {
  if (battle && screenState.name === 'battle' && !battle.over) {
    toast('🏁 对手掉线，你赢了！');
    battle.end('me');
    return;
  }
  if (isLobby()) {
    lobby.peer = { joined: false, card: null, ready: false };
    toast('对手离开了房间');
    renderLobby();
  }
});

net.on('start', m => {
  const my = net.isHost ? m.players[0] : m.players[1];
  const foe = net.isHost ? m.players[1] : m.players[0];
  // 重置大厅就绪状态，为再战做准备
  lobby.self.ready = false;
  lobby.peer.ready = false;
  launchBattle({
    mode: 'pvp',
    myCard: my,
    foeCard: foe,
    seed: m.seed,
    net,
    onEnd: r => showResult(r, {
      pvp: true,
      foeCard: foe,
      onAgain: () => net.send({ t: 'again' }),
      onMenu: () => { net.send({ t: 'leave' }); backToMenu(); },
    }),
  });
});

net.on('peer-evt', m => { if (battle && !battle.over) battle.receive(m.data); });
net.on('peer-snap', m => { if (battle && !battle.over) battle.remoteSnap(m.data); });

net.on('peer-again', () => showPeerAgain());

net.on('_closed', () => {
  if (screenState.name === 'battle') return;
  toast('⚠️ 与服务器断开连接');
  backToMenu();
});

/* ---------------- 启动 ---------------- */
renderMenu();
