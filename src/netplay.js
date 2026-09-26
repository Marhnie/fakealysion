// Online 2-player P2P play (design: docs/netplay-design.md). WebRTC via PeerJS's free public broker
// (0.peerjs.com) — no server of our own, no account creation for players, a short room code IS the peer id.
// Host-authoritative: the host runs the real engine (unchanged) and broadcasts a REDACTED clone of `state`
// (+ the UI-local `sel.pendingAttack`) after every render; the guest is a thin client that only ever assigns
// whatever it receives onto its own `state`/`sel.pendingAttack` and sends back named "intents" for its own
// clicks. This module has NO game logic of its own — see main.js for how intents are applied (cpuApiObj reuse).
import * as SN from './snapshot.js';
import * as Cpu from './cpu.js';

const PEERJS_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: read out loud without ambiguity
const ROOM_PREFIX = 'digisim-'; // namespaced on the shared public broker so our short codes don't collide with unrelated peerjs apps

export function randomRoomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += PEERJS_ID_CHARS[Math.floor(Math.random() * PEERJS_ID_CHARS.length)];
  return s;
}

// mutable connection state (single active connection at a time — v1 is exactly 2 players)
export const NET = {
  role: null,      // null | 'host' | 'guest'
  mySeat: null,    // 'p1' (host) | 'p2' (guest)
  peer: null,      // Peer instance
  conn: null,      // DataConnection
  connected: false,
  roomCode: null,
  peerError: null,
  onState: null,   // (payload) => void   -- guest: called on every {t:'state'} message
  onIntent: null,  // (action, args) => void -- host: called on every {t:'intent'} message
  onStatus: null,  // (text) => void      -- both: connection lifecycle text for the UI
};

export function isActive() { return NET.role === 'host' || NET.role === 'guest'; }

function say(msg) { NET.onStatus && NET.onStatus(msg); }

function loadPeerCtor() {
  // index.html loads the PeerJS UMD build as a plain <script> tag (same pattern as the existing jszip CDN
  // tag) — this project has no bundler for the deployed static site, so `npm install peerjs` would not be
  // reachable from a <script type=module> without also shipping a bundler step.
  if (typeof window !== 'undefined' && window.Peer) return window.Peer;
  throw new Error('PeerJS를 불러오지 못했습니다 (네트워크 연결을 확인하세요)');
}

function wireConn(conn, resolve, reject) {
  let settled = false;
  conn.on('open', () => {
    NET.conn = conn; NET.connected = true;
    settled = true;
    conn.on('data', (raw) => {
      let msg = null;
      try { msg = typeof raw === 'string' ? SN.parse(raw) : raw; } catch (e) { console.warn('netplay: bad message', e); return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'state' && NET.onState) NET.onState(msg);
      else if (msg.t === 'intent' && NET.onIntent) NET.onIntent(msg.action, msg.args || []);
      else if (msg.t === 'hello') say('상대와 연결되었습니다');
    });
    conn.on('close', () => { NET.connected = false; say('연결이 끊어졌습니다'); });
    conn.on('error', (e) => { say('연결 오류: ' + (e && e.message || e)); });
    send({ t: 'hello', v: 1 });
    resolve(conn);
  });
  conn.on('error', (e) => { if (!settled) reject(e); else say('연결 오류: ' + (e && e.message || e)); });
}

// Host: create a room. Returns { code } once the peer is registered on the broker (before any guest joins).
export function hostRoom() {
  return new Promise((resolve, reject) => {
    const Peer = loadPeerCtor();
    const code = randomRoomCode();
    const peer = new Peer(ROOM_PREFIX + code);
    NET.peer = peer; NET.role = 'host'; NET.mySeat = 'p1'; NET.roomCode = code;
    peer.on('open', () => { say('방 생성됨: ' + code + ' — 상대의 접속을 기다리는 중…'); resolve({ code }); });
    peer.on('error', (e) => { NET.peerError = e; reject(e); });
    peer.on('connection', (conn) => {
      if (NET.conn) { try { conn.close(); } catch (e) { /* ignore */ } return; } // v1: exactly one guest
      wireConn(conn, () => {}, () => {});
    });
  });
}

// Guest: join a room by its code. Resolves once the data channel is open.
export function joinRoom(code) {
  return new Promise((resolve, reject) => {
    const Peer = loadPeerCtor();
    const peer = new Peer();
    NET.peer = peer; NET.role = 'guest'; NET.mySeat = 'p2'; NET.roomCode = String(code || '').trim().toUpperCase();
    peer.on('open', () => {
      say('연결 중…');
      const conn = peer.connect(ROOM_PREFIX + NET.roomCode, { reliable: true });
      wireConn(conn, resolve, reject);
    });
    peer.on('error', (e) => { NET.peerError = e; reject(e); });
  });
}

export function reset() {
  try { NET.conn && NET.conn.close(); } catch (e) { /* ignore */ }
  try { NET.peer && NET.peer.destroy(); } catch (e) { /* ignore */ }
  NET.role = null; NET.mySeat = null; NET.peer = null; NET.conn = null; NET.connected = false; NET.roomCode = null; NET.peerError = null;
}

// Belt-and-suspenders fallback for `obj` shapes buildSnapshot/buildPa didn't anticipate (state.js's engine
// objects are large and occasionally cyclic — see the `attackCtx` note on DROP_KEYS below for a real instance
// this caught live): if the normal Set/Map-aware stringify throws, retry once with a plain circular-safe
// replacer so one bad field drops silently instead of losing the whole message (and the connection looking dead).
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (k, v) => {
    if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); }
    if (typeof v === 'function') return undefined;
    return v;
  });
}
function send(obj) {
  if (!NET.conn || !NET.conn.open) return false;
  try { NET.conn.send(SN.stringify(obj)); return true; }
  catch (e) {
    console.warn('netplay: primary send failed, retrying with a circular-safe fallback', e);
    try { NET.conn.send(safeStringify(obj)); return true; } catch (e2) { console.warn('netplay send failed', e2); return false; }
  }
}

export function sendIntent(action, args) { return send({ t: 'intent', action, args: args || [] }); }

// ---------- redaction ----------

// Reproduces securityui.js's own face-up walk exactly (see docs/netplay-design.md "Redaction"): an id is only
// ever real over the wire for the copies its owner's secUp count actually covers, top-down — never more than
// what the existing single-process UI would already draw for that seat.
function redactSecurity(pl) {
  const left = { ...(pl.secUp || {}) };
  return (pl.security || []).map((id) => {
    const up = (left[id] || 0) > 0;
    if (up) left[id]--;
    return up ? id : null;
  });
}

function redactPlayer(pl, seat, forSeat) {
  return {
    ...pl,
    hand: seat === forSeat ? pl.hand : (pl.hand || []).map(() => null),
    security: redactSecurity(pl),
    deck: (pl.deck || []).map(() => null),
    digitamaDeck: (pl.digitamaDeck || []).map(() => null),
  };
}

// `attackCtx` (== the host's `sel.pendingAttack`, mirrored onto `state` for card scripts to read "is this stack
// currently attacking") turned out to hold a cycle back to itself once queried mid-attack (observed live: a
// `TypeError: Converting circular structure to JSON` naming 'attackCtx' as the closing property) — the guest
// never needs it (it gets the same information via the separate `pa` field on the wire, see buildPa/broadcastState).
const DROP_KEYS = new Set(['pendingReplacements', '_rcDepth', '_caster', '_fxOp', '_replWaiters', '_leavePending', 'fxHistory', '_fxRec', 'log', 'uiChoice', 'players', 'attackCtx']);

// Builds the plain, JSON-safe, redacted object sent to `forSeat` ('p1'|'p2'). Functions (pending[].fn, pa
// closures, etc.) are dropped for free by JSON.stringify inside SN.stringify — not handled here explicitly.
export function buildSnapshot(state, forSeat) {
  const out = {};
  for (const k of Object.keys(state)) { if (!DROP_KEYS.has(k)) out[k] = state[k]; }
  out.players = { p1: redactPlayer(state.players.p1, 'p1', forSeat), p2: redactPlayer(state.players.p2, 'p2', forSeat) };
  // 효과 연출(배너/필드 표기/공격 연출)은 state.fxHistory·_fxRec·log를 보고 그려진다 — 게스트에게도 보내야 같은 연출이 보인다.
  // 다만 상대 드로우 줄에는 뽑은 카드 이름이 들어 있으므로 이름은 가린다. '_'로 시작하는 키는 호스트 화면의 진행 기록이라 뺀다.
  const hide = (m) => String(m).replace(/^(p[12]) 드로우 (\d+)장: .*$/, (all, who, n) => (who === forSeat ? all : `${who} 드로우 ${n}장`));
  const cleanEntry = (e) => ({ ...e, msg: hide(e.msg) });
  const cleanRec = (r) => { const o = {}; for (const k of Object.keys(r)) if (k[0] !== '_') o[k] = r[k]; o.entries = (r.entries || []).map(cleanEntry); return o; };
  out.log = (state.log || []).slice(0, 200).map(cleanEntry);
  out.fxHistory = (state.fxHistory || []).slice(0, 20).map(cleanRec);
  out._fxRec = state._fxRec ? cleanRec(state._fxRec) : null;
  const uc = state.uiChoice;
  out.uiChoice = uc ? { kind: uc.kind, payload: uc.payload, by: uc.by || Cpu.deciderFor(state, uc.kind, uc.payload, {}) } : null;
  return out;
}

// sel.pendingAttack travels separately (it isn't part of `state` at all — see design doc). Strips the two
// function fields (fireDeclare/terminate) explicitly since this object is sent as-is, not through SN.stringify's
// top-level dataOf-style pass — JSON.stringify would drop them too, but being explicit documents the intent.
export function buildPa(pa) {
  if (!pa) return null;
  const { fireDeclare, terminate, ...rest } = pa;
  return rest;
}

// Host: call once per render() while connected. No-op if not connected yet (guest simply gets the next one).
// `extra` carries small bits of main.js-local (not-part-of-`state`) bookkeeping the guest also needs to render
// correctly — currently just `mulliganDecided` (see design doc: the mulligan screen, like the attack panel, is
// driven by plain main.js module variables rather than `state`).
export function broadcastState(state, pa, extra) {
  if (NET.role !== 'host' || !NET.connected) return;
  send({ t: 'state', state: buildSnapshot(state, 'p2'), pa: buildPa(pa), ...extra });
}

// Guest: turn a received {t:'state', state, pa, ...extra} message into a live state object ready for main.js's
// render() — patches a resolve() back onto uiChoice (see design doc) that sends the value back to the host
// instead of resolving a real Promise (there is none on the guest side: it never runs ctxChoose/the engine
// itself).
export function reviveIncoming(msg) {
  const state = msg.state;
  if (state.uiChoice) {
    const { kind, payload, by } = state.uiChoice;
    state.uiChoice = { kind, payload, by, resolve: (val) => sendIntent('answer', [val]) };
  }
  return { state, pa: msg.pa || null, mulliganDecided: msg.mulliganDecided || null, jogressModal: msg.jogressModal || null };
}
