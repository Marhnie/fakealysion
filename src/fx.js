// Activation VFX layer — PRESENTATION ONLY. The engine never imports or reads this.
// main.js feeds it through fxEmit(kind, payload):
//   'effect' {rec, state}  a resolved-effect record (state.fxHistory) — banner, source burst, per-result hit animations
//   'render' {state}       end of every render() — snapshot tile rects, watch state.log for battle lines, flush queued events
// Everything is drawn in a body-level overlay (#vfx-root, pointer-events:none, z-index 55: above the board, below modals)
// so it survives main.js rebuilding #app on every render. CSS keyframes (transform/opacity) only; DOM nodes are pooled.
import { card as cardOf } from './state.js';

const KEY = 'digimon_fx_vfx';
const MODES = ['full', 'normal', 'off'];
let mode = 'full';
try {
  const v = localStorage.getItem(KEY);
  if (v && MODES.includes(v)) mode = v;
  else if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) mode = 'off';
} catch (e) { /* ignore */ }
export const fxGetMode = () => mode;
export function fxSetMode(m) {
  if (!MODES.includes(m)) return;
  mode = m;
  try { localStorage.setItem(KEY, m); } catch (e) { /* ignore */ }
  if (m === 'off') clearAll();
}
export const FX_MODE_LABELS = [['full', '화려하게'], ['normal', '보통'], ['off', '끄기']];

let dbgHold = false;
const stats = { spawned: 0, active: 0, banners: 0, events: 0, maxActive: 0 };
let root = null;
const pool = [];
const timers = new Set();
const isSmall = () => Math.min(window.innerWidth, window.innerHeight * 1.2) < 700;
const maxActive = () => (isSmall() ? 45 : 90);
const scale = (n) => Math.max(1, Math.round(n * (mode === 'normal' ? 0.5 : 1) * (isSmall() ? 0.55 : 1)));

function ensureRoot() {
  if (root && root.isConnected) return root;
  root = document.createElement('div');
  root.id = 'vfx-root';
  root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);
  return root;
}
function later(fn, ms) {
  const t = setTimeout(() => { timers.delete(t); try { fn(); } catch (e) { console.warn('fx', e); } }, ms);
  timers.add(t);
}
function clearAll() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  if (root) while (root.firstChild) root.removeChild(root.firstChild);
  stats.active = 0; queue.length = 0; bannerPending = 0;
}
// spawn(cls, {style, text, life, parent}) — pooled div; removed (and returned to the pool) after `life` ms
function spawn(cls, o = {}) {
  if (stats.active >= maxActive() && !o.force) return null;
  const el = pool.pop() || document.createElement('div');
  el.className = cls;
  if (o.style) for (const k in o.style) { if (k.startsWith('--')) el.style.setProperty(k, o.style[k]); else el.style[k] = o.style[k]; }
  if (o.text != null) el.textContent = o.text;
  ensureRoot().appendChild(el);
  stats.active++; stats.spawned++; if (stats.active > stats.maxActive) stats.maxActive = stats.active;
  const t = setTimeout(function done() {
    timers.delete(t);
    if (dbgHold) { const t2 = setTimeout(done, 250); timers.add(t2); return; } // debugging aid (__fx.hold = true): keep nodes so paused animations can be inspected
    if (el.parentNode) el.parentNode.removeChild(el);
    el.className = ''; el.style.cssText = ''; el.textContent = '';
    if (pool.length < 80) pool.push(el);
    stats.active = Math.max(0, stats.active - 1);
  }, (o.life || 900) + 80);
  timers.add(t);
  return el;
}
const px = (n) => Math.round(n) + 'px';
const at = (r, extra = {}) => ({ left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height), ...extra });
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- palette by trigger ----------
const PAL = {
  gold: ['#ffd23f', 'rgba(70,48,0,.88)'], cyan: ['#3fd0ff', 'rgba(0,40,72,.88)'], red: ['#ff4d4d', 'rgba(72,8,8,.88)'],
  purple: ['#b06bff', 'rgba(40,10,72,.88)'], orange: ['#ff9a2f', 'rgba(72,34,0,.88)'], white: ['#ffffff', 'rgba(30,34,44,.88)'],
  green: ['#4dff88', 'rgba(0,56,24,.88)'], teal: ['#2fe0c8', 'rgba(0,52,48,.88)'], magenta: ['#ff4fd8', 'rgba(64,0,52,.88)'], silver: ['#cfd6e4', 'rgba(38,42,52,.88)'],
};
function paletteOf(src) {
  const t = String(src.tag || ''), kw = String(src.kw || '');
  let k = 'white';
  if (src.inherited) k = 'silver';
  else if (kw) k = 'green';
  else if (/시큐리티/.test(t)) k = 'orange';
  else if (/딜레이/.test(t + kw)) k = 'magenta';
  else if (/소멸/.test(t)) k = 'purple';
  else if (/어택/.test(t)) k = 'red';
  else if (/진화/.test(t)) k = 'cyan';
  else if (/등장/.test(t)) k = 'gold';
  else if (/턴/.test(t)) k = 'teal';
  else if (/메인|옵션/.test(t)) k = 'white';
  return { key: k, c: PAL[k][0], bg: PAL[k][1] };
}

// ---------- tile geometry (snapshot after each render; stale entries survive so vanished/bounced stacks can still be located) ----------
const known = new Map(); // `${p}|${uid}` -> {p, uid, name, cardId, rect, ts, seen}
function snapshot() {
  const now = Date.now();
  for (const k of known.keys()) { const e = known.get(k); e.seen = false; if (now - e.ts > 20000) known.delete(k); }
  document.querySelectorAll('[data-fxn]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 4) return;
    const k = el.dataset.fxp + '|' + el.dataset.fxu;
    known.set(k, { p: el.dataset.fxp, uid: el.dataset.fxu, name: el.dataset.fxn, cardId: el.dataset.fxc, rect: r, ts: now, seen: true });
  });
}
function findTiles(p, msgOrName, exact) {
  const out = [];
  for (const e of known.values()) {
    if (p && e.p !== p) continue;
    if (exact ? e.name === msgOrName : msgOrName.includes(e.name)) out.push(e);
  }
  out.sort((a, b) => (b.seen - a.seen) || (b.name.length - a.name.length));
  const best = out.filter(x => x.seen);
  return best.length ? best : out.slice(0, 1);
}
const q = (sel) => document.querySelector(sel);
function fixedRect(sel) { const el = q(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? r : null; }
const cardImg = (cardId) => { try { return cardOf(cardId).imgUrl || ''; } catch (e) { return ''; } };
function cardEl(cardId, r, cls, extra = {}) {
  const img = cardImg(cardId);
  const st = at(r, extra.style || {});
  if (img) st.backgroundImage = `url("${img}")`;
  return spawn('vfx-card ' + cls + (img ? '' : ' vfx-noimg'), { style: st, life: extra.life || 900, text: img ? '' : (extra.name || ''), force: extra.force });
}

// ---------- effect pieces ----------
function burst(r, pal, big) {
  const c = center(r), s = Math.max(r.width, r.height);
  const st = { left: px(c.x), top: px(c.y), '--c': pal.c };
  spawn('vfx-ring', { style: { ...st, width: px(s * 1.1), height: px(s * 1.1) }, life: 800 });
  if (mode === 'full') {
    spawn('vfx-ring vfx-ring2', { style: { ...st, width: px(s * 1.1), height: px(s * 1.1) }, life: 1000 });
    spawn('vfx-rays', { style: { ...st, width: px(s * 3), height: px(s * 3) }, life: 1000 });
    const n = scale(big ? 22 : 16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2), d = rnd(s * 0.6, s * 1.4);
      spawn('vfx-spark', { style: { ...st, '--dx': px(Math.cos(a) * d), '--dy': px(Math.sin(a) * d), '--sz': px(rnd(3, 7))}, life: 800 });
    }
  }
}
function sourceBurst(rec, p) {
  const src = rec.src, pal = paletteOf(src);
  const tiles = src.cardId ? findTiles(src.owner, cardOf(src.cardId).nameKo, true) : [];
  if (tiles.length && !src.inherited) {
    const r = tiles[0].rect;
    cardEl(src.cardId, r, 'vfx-lift', { style: { '--c': pal.c }, life: 900 });
    burst(r, pal, false);
  } else if (src.cardId) { // off-board source (option/tamer in hand/inherited): centered flip-in
    const w = isSmall() ? 96 : 130, h = w * 1.4, cx = window.innerWidth / 2, top = window.innerHeight * 0.42 - h - 8;
    const r = { left: cx - w / 2, top: Math.max(56, top), width: w, height: h };
    cardEl(src.cardId, r, 'vfx-flip', { style: { '--c': pal.c }, life: 1250, name: cardOf(src.cardId).nameKo });
    burst(r, pal, true);
  }
}
function banner(rec, pal, delay) {
  if (bannerPending >= 4) return;
  bannerPending++;
  const src = rec.src;
  const nm = src.cardId ? cardOf(src.cardId).nameKo : '';
  const tag = src.tag ? `【${src.tag}】` : (src.kw ? `《${src.kw}》` : '효과');
  later(() => {
    bannerPending = Math.max(0, bannerPending - 1);
    stats.banners++;
    const b = spawn('vfx-banner', { style: { '--c': pal.c, '--cbg': pal.bg }, life: 1150, force: true });
    if (!b) return;
    const own = document.createElement('span'); own.className = 'vfx-b-own vfx-' + src.owner; own.textContent = String(src.owner || '').toUpperCase();
    const t1 = document.createElement('b'); t1.className = 'vfx-b-tag'; t1.textContent = (src.inherited ? '진화원 ' : '') + tag + ' 발동!';
    const t2 = document.createElement('span'); t2.className = 'vfx-b-name'; t2.textContent = nm ? `「${nm}」` : '';
    b.append(own, t1, t2);
    if (mode === 'full') spawn('vfx-flashscreen', { style: { '--c': pal.c }, life: 500 });
    sourceBurst(rec, pal);
  }, delay);
}

function floatText(r, text, cls, delay = 0, dy = 0) {
  const c = center(r);
  later(() => spawn('vfx-float ' + cls, { style: { left: px(c.x), top: px(r.top + dy) }, text, life: 1100 }), delay);
}
function hitBuff(t, n, delay) {
  const up = n > 0, r = t.rect, cls = up ? 'vfx-up' : 'vfx-down';
  later(() => {
    spawn('vfx-pulse ' + cls, { style: at(r), life: 900 });
    const k = mode === 'full' ? scale(5) : 2;
    for (let i = 0; i < k; i++) spawn('vfx-arrow ' + cls, { style: { left: px(r.left + (r.width * (i + 0.5)) / k), top: px(up ? r.top + r.height * 0.8 : r.top + r.height * 0.1), animationDelay: i * 90 + 'ms' }, text: up ? '▲' : '▼', life: 1000 });
  }, delay);
  floatText(r, (up ? '+' : '') + n, cls, delay + 80, -6);
}
function hitDestroy(cardId, r, name, delay) {
  later(() => {
    spawn('vfx-flashbox', { style: at(r), life: 500 });
    cardEl(cardId, r, 'vfx-shake', { life: 700, name });
    later(() => {
      if (mode === 'full') { // shatter into 6 shards
        const img = cardImg(cardId), cw = r.width / 3, ch = r.height / 2;
        for (let i = 0; i < 6; i++) {
          const cx = i % 3, cy = (i / 3) | 0;
          const st = { left: px(r.left + cx * cw), top: px(r.top + cy * ch), width: px(cw), height: px(ch), '--dx': px((cx - 1) * rnd(20, 50) + rnd(-10, 10)), '--dy': px((cy ? 1 : -0.6) * rnd(30, 80)), '--r': rnd(-90, 90).toFixed(0) + 'deg' };
          if (img) { st.backgroundImage = `url("${img}")`; st.backgroundSize = `${px(r.width)} ${px(r.height)}`; st.backgroundPosition = `${px(-cx * cw)} ${px(-cy * ch)}`; }
          spawn('vfx-shard', { style: st, life: 800 });
        }
      } else cardEl(cardId, r, 'vfx-fade', { life: 600, name });
    }, 380);
    const c = center(r);
    spawn('vfx-skull', { style: { left: px(c.x), top: px(c.y) }, text: '💥', life: 900 });
  }, delay);
}
function hitBounce(cardId, r, name, delay) {
  later(() => { cardEl(cardId, r, 'vfx-swoosh', { life: 800, name }); if (mode === 'full') for (let i = 0; i < scale(4); i++) spawn('vfx-arrow vfx-up vfx-white', { style: { left: px(r.left + r.width * (i + 0.5) / scale(4)), top: px(r.top + r.height * 0.6), animationDelay: i * 70 + 'ms' }, text: '▲', life: 800 }); }, delay);
}
function hitDraw(p, n, delay) {
  const hand = fixedRect(`[data-fxhand="${p}"]`), deck = fixedRect(`[data-fxpile="${p}"] .pile-deck`) || fixedRect(`[data-fxpile="${p}"]`);
  if (!hand) return;
  const from = deck ? center(deck) : { x: hand.left + hand.width / 2, y: hand.top - 80 }, to = { x: hand.left + Math.min(hand.width, 220) / 2, y: hand.top + hand.height / 2 };
  const k = Math.min(n, isSmall() ? 3 : 5);
  for (let i = 0; i < k; i++) {
    later(() => {
      spawn('vfx-fly', { style: { left: px(from.x - 20), top: px(from.y - 28), '--dx': px(to.x + i * 26 - from.x), '--dy': px(to.y - from.y) }, life: 700 });
      later(() => { const x = to.x + i * 26; spawn('vfx-star', { style: { left: px(x), top: px(to.y) }, text: '✦', life: 600 }); }, 560);
    }, delay + i * 110);
  }
  floatText({ left: hand.left, top: hand.top, width: Math.min(hand.width, 220), height: hand.height }, `+${n}장`, 'vfx-up', delay + 500, -18);
}
function hitMemory(m0, m1, delay) {
  const tr = fixedRect('.mem-track'); if (!tr) return;
  const d = m1 - m0;
  later(() => {
    spawn('vfx-pulse vfx-mem', { style: at(tr), life: 900 });
    const act = fixedRect('.mem-active') || tr;
    const c = center(act);
    spawn('vfx-float ' + (d > 0 ? 'vfx-up' : 'vfx-down') + ' vfx-big', { style: { left: px(c.x), top: px(act.top - 6) }, text: (d > 0 ? '+' : '') + d, life: 1200 });
  }, delay);
}
function hitSecurity(p, delay, checkOnly) {
  const pile = fixedRect(`[data-fxpile="${p}"] .pile-security`); if (!pile) return;
  later(() => {
    spawn('vfx-flashbox vfx-sec', { style: at(pile), life: 600 });
    if (!checkOnly) {
      const r = { left: pile.left, top: pile.top - 4, width: Math.max(pile.width, 44), height: Math.max(pile.height * 1.2, 60) };
      spawn('vfx-cardback', { style: at(r), life: 900 });
      if (mode === 'full') { const c = center(pile); for (let i = 0; i < scale(8); i++) { const a = rnd(0, 6.28), d = rnd(20, 50); spawn('vfx-spark', { style: { left: px(c.x), top: px(c.y), '--c': '#ffb04a', '--dx': px(Math.cos(a) * d), '--dy': px(Math.sin(a) * d), '--sz': px(rnd(3, 6)) }, life: 700 }); } }
    }
  }, delay);
}
function hitKeyword(t, delay) {
  const r = t.rect;
  later(() => spawn('vfx-pop', { style: { left: px(r.left + r.width - 12), top: px(r.top + 10) }, text: '🛡', life: 900 }), delay);
}
function hitRest(t, delay) {
  const r = t.rect;
  later(() => { cardEl(t.cardId, r, 'vfx-spin', { life: 600 }); spawn('vfx-pulse vfx-up', { style: at(r), life: 700 }); }, delay);
}

// ---------- rec -> animations ----------
const queue = [];
let bannerPending = 0;
const doneRec = new WeakMap(); // rec -> {b, v, e} progress
function playRec(rec) {
  const prog = doneRec.get(rec) || { b: false, v: 0, e: 0 };
  doneRec.set(rec, prog);
  const src = rec.src, pal = src.kind === 'effect' ? paletteOf(src) : null;
  let d = 0;
  if (src.kind === 'effect' && !prog.b) { prog.b = true; banner(rec, pal, bannerPending * 650); d = 500 + bannerPending * 650; }
  else if (src.kind === 'effect') d = 0;
  const seenName = new Set();
  // destroyed stacks
  for (const v of rec.vanished.slice(prog.v)) {
    const t = findTiles(v.owner, v.name, true)[0];
    if (t) hitDestroy(t.cardId || v.cardId, t.rect, v.name, d);
    seenName.add(v.owner + v.name);
  }
  prog.v = rec.vanished.length;
  for (const e of rec.entries.slice(prog.e)) {
    const msg = e.msg, m = /^(p1|p2)\s/.exec(msg), o = m ? m[1] : null;
    if (/스택 소멸/.test(msg)) continue;
    let mm;
    if (/시큐리티/.test(msg) && /파기/.test(msg) && o) hitSecurity(o, d, false);
    else if ((mm = /DP\s*([+-]\d+)/.exec(msg)) && !/시큐리티 디지몬/.test(msg)) { for (const t of findTiles(o, msg).slice(0, 3)) hitBuff(t, parseInt(mm[1], 10), d); }
    else if (/패로 되돌림|핸드로|덱 아래로|덱 위로|시큐리티 아래에 놓음/.test(msg)) { for (const t of findTiles(o, msg).slice(0, 3)) { hitBounce(t.cardId, t.rect, t.name, d); } if (/패로|핸드로/.test(msg) && o) hitDraw(o, 1, d + 300); }
    else if ((mm = /드로우\s*(\d+)장/.exec(msg)) && o) hitDraw(o, parseInt(mm[1], 10), d);
    else if (/패에 추가/.test(msg) && o) hitDraw(o, 1, d);
    else if (/효과 부여|보호 부여|키워드|제약 부여/.test(msg)) { for (const t of findTiles(o, msg).slice(0, 2)) hitKeyword(t, d); }
    else if (/(레스트|액티브)\s*$|레스트 상태|액티브$/.test(msg) && !/불가|않음/.test(msg)) { for (const t of findTiles(o, msg).slice(0, 2)) hitRest(t, d); }
  }
  prog.e = rec.entries.length;
  if (!prog.mem && rec.mem0 !== rec.mem1) { prog.mem = true; hitMemory(rec.mem0, rec.mem1, d + 200); }
}

// ---------- attack / battle / security via state.log ----------
let logState = null, logSeen = null;
function watchLog(state) {
  if (!state) return;
  if (logState !== state) { logState = state; logSeen = state.log[0] || null; return; }
  const fresh = [];
  for (let i = 0; i < Math.min(state.log.length, 15); i++) { if (state.log[i] === logSeen) break; fresh.push(state.log[i]); }
  if (state.log[0]) logSeen = state.log[0];
  for (const e of fresh.reverse()) { if (e.src) continue; try { playLog(e.msg); } catch (err) { console.warn('fx log', err); } }
}
function lunge(r, cardId, dx, dy, name, delay = 0) {
  const n = mode === 'full' ? 3 : 0;
  for (let i = n; i >= 0; i--) later(() => cardEl(cardId, r, i ? 'vfx-trail' : 'vfx-lunge', { style: { '--dx': px(dx), '--dy': px(dy), '--o': i ? (0.5 / i).toFixed(2) : 1 }, life: 700, name }), delay + (n - i) * 45);
}
function playLog(msg) {
  let m;
  if ((m = /^(p1|p2)\s+(.+?)\(DP\d+\)\s+공격 선언/.exec(msg))) {
    const t = findTiles(m[1], m[2], true)[0]; if (!t) return;
    lunge(t.rect, t.cardId, 0, m[1] === 'p1' ? -46 : 46, t.name);
  } else if ((m = /^(p1|p2)\s+(.+?)\(DP(\d+)\)\s+vs\s+(p1|p2)\s+(.+?)\(DP(\d+)\)\s+→\s+(\w+)/.exec(msg))) {
    const a = findTiles(m[1], m[2], true)[0], dd = findTiles(m[4], m[5], true)[0]; if (!a || !dd) return;
    const ca = center(a.rect), cd = center(dd.rect), mid = { x: (ca.x + cd.x) / 2, y: (ca.y + cd.y) / 2 };
    lunge(a.rect, a.cardId, (cd.x - ca.x) * 0.55, (cd.y - ca.y) * 0.55, a.name);
    later(() => {
      spawn('vfx-clash', { style: { left: px(mid.x), top: px(mid.y) }, life: 700 });
      if (mode === 'full') for (let i = 0; i < scale(12); i++) { const ang = rnd(0, 6.28), dist = rnd(30, 80); spawn('vfx-spark', { style: { left: px(mid.x), top: px(mid.y), '--c': '#ffe27a', '--dx': px(Math.cos(ang) * dist), '--dy': px(Math.sin(ang) * dist), '--sz': px(rnd(3, 6)) }, life: 700 }); }
      spawn('vfx-dpnum ' + (+m[3] >= +m[6] ? 'vfx-win' : 'vfx-lose'), { style: { left: px(ca.x), top: px(a.rect.top - 8) }, text: m[3], life: 1300 });
      spawn('vfx-dpnum ' + (+m[6] >= +m[3] ? 'vfx-win' : 'vfx-lose'), { style: { left: px(cd.x), top: px(dd.rect.top - 8) }, text: m[6], life: 1300 });
      if (mode === 'full' && m[7] !== 'tie') { const w = m[7] === 'attackerWins' ? a : dd; spawn('vfx-pulse vfx-up vfx-flare', { style: at(w.rect), life: 900 }); }
    }, 320);
  } else if ((m = /^(p1|p2)\s+시큐리티 체크\(/.exec(msg))) hitSecurity(m[1], 0, true);
  else if ((m = /^(p1|p2)\s+시큐리티 (?:맨 위|맨 밑) 카드가 효과로 파기|^(p1|p2)\s+시큐리티의 .+ 파기/.exec(msg))) hitSecurity(m[1] || m[2], 0, false);
}

// ---------- public bus ----------
let flushScheduled = false;
export function fxEmit(kind, payload) {
  if (mode === 'off') return;
  try {
    if (kind === 'effect') { queue.push(payload.rec); stats.events++; }
    else if (kind === 'render') {
      if (payload && payload.state) watchLogLater = payload.state;
    }
    if (!flushScheduled) { flushScheduled = true; requestAnimationFrame(flush); setTimeout(flush, 80); } // rAF normally; the timer covers a throttled/hidden pane
  } catch (e) { console.warn('fxEmit', e); }
}
let watchLogLater = null;
function flush() {
  if (!flushScheduled) return; // already run by the other trigger
  flushScheduled = false;
  if (mode === 'off') { queue.length = 0; return; }
  try {
    ensureRoot();
    const st = watchLogLater; watchLogLater = null;
    const recs = queue.splice(0, queue.length).slice(-6);
    snapshot(); // adds/refreshes present tiles; tiles gone since the last render keep their old rect (unseen)
    for (const r of recs) playRec(r);
    if (st) watchLog(st);
  } catch (e) { console.warn('fx flush', e); }
}
if (typeof window !== 'undefined') window.__fx = { set hold(v) { dbgHold = !!v; }, stats, emit: fxEmit, get mode() { return mode; }, set mode(v) { fxSetMode(v); }, known, playLog, clear: clearAll };
