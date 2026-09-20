// On-field effect annotations — PRESENTATION ONLY (the engine never reads this).
// Instead of one collected "resolution card", every resolved effect (state.fxHistory record) is drawn AT the objects it touches:
//   - a SOURCE label pinned to the source card (tile / trash chip / option centre-line): 「X」【등장 시】 발동 + 1-line gist of the printed text
//   - a small BADGE at each affected tile / pile chip / memory gauge / hand ('+2000 DP', '레스트', '소멸 ← P2 「X」', '드로우 +2', '메모리 -3')
//   - a thin animated arrow from the source label to each target (SVG, pointer-events none)
// Everything lives in a body-level fixed layer (#fxf-root, above the board, below modals). Anchors are re-resolved from data attributes
// (data-fxp/-fxu/-fxn/-fxc on tiles, data-fxpile, data-fxhand, .mem-track) after every render(), scroll and resize, so main.js rebuilding
// the DOM never breaks them. Nothing here shifts the layout.
import { card as cardOf } from './state.js';

const KEY = 'digimon_fx_field';
let on = true;
try { if (localStorage.getItem(KEY) === '0') on = false; } catch (e) { /* ignore */ }
export const fxFieldOn = () => on;
export const FIELD_LABELS = [['1', '켜기'], ['0', '끄기']];
export function fxFieldSetOn(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  if (!on) fxFieldClear();
}

const SVGNS = 'http://www.w3.org/2000/svg';
let root = null, svg = null, toastEl = null;
let groups = [];           // {id, rec, srcA, label, subs, items:[{anchor, node, path}], e, v, mem, expires}
let stateRef = null;
let uid = 0;
let timer = null, raf = 0, choiceNodes = [], choiceLabel = null, lastState = null;
const done = new WeakMap(); // rec -> group
const lastRects = new Map(); // `${p}|${name}` -> {rect, cardId, uid}
const P = (p) => String(p || '').toUpperCase();
const isSmall = () => window.innerWidth < 700;

function ensureRoot() {
  if (root && root.isConnected) return root;
  root = document.createElement('div');
  root.id = 'fxf-root';
  root.setAttribute('aria-hidden', 'true');
  svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'fxf-svg');
  const defs = document.createElementNS(SVGNS, 'defs');
  for (const o of ['p1', 'p2', 'ok']) {
    const m = document.createElementNS(SVGNS, 'marker');
    m.setAttribute('id', 'fxf-ah-' + o); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
    m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7'); m.setAttribute('orient', 'auto');
    const pth = document.createElementNS(SVGNS, 'path'); pth.setAttribute('d', 'M0 0 L10 5 L0 10 z'); pth.setAttribute('class', 'fxf-ah fxf-ah-' + o);
    m.appendChild(pth); defs.appendChild(m);
  }
  svg.appendChild(defs);
  root.appendChild(svg);
  document.body.appendChild(root);
  return root;
}
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// ---------- anchors ----------
const q1 = (s) => document.querySelector(s);
function rectOf(node) { if (!node) return null; const r = node.getBoundingClientRect(); return r.width > 3 && r.height > 3 ? r : null; }
function tileEl(p, uidv, name) {
  const all = document.querySelectorAll(`[data-fxn][data-fxp="${p}"]`);
  let byName = null;
  for (const n of all) { if (uidv != null && n.dataset.fxu === String(uidv)) return n; if (!byName && name && n.dataset.fxn === name) byName = n; }
  return byName;
}
// -> {rect, stale?, virtual?} | null
function resolve(a) {
  if (!a) return null;
  if (a.type === 'tile') {
    const n = tileEl(a.p, a.uid, a.name), r = rectOf(n);
    if (r) { lastRects.set(a.p + '|' + a.name, { rect: r, cardId: n.dataset.fxc, uid: n.dataset.fxu }); return { rect: r }; }
    const l = lastRects.get(a.p + '|' + a.name);
    return l ? { rect: l.rect, stale: true } : null;
  }
  if (a.type === 'pile') { const r = rectOf(q1(`[data-fxpile="${a.p}"] .pile-${a.pile}`)) || rectOf(q1(`[data-fxpile="${a.p}"]`)); return r ? { rect: r, pile: true } : null; }
  if (a.type === 'mem') { const r = rectOf(q1('.mem-active')) || rectOf(q1('.mem-track')); return r ? { rect: r, mem: true } : null; }
  if (a.type === 'hand') { const r = rectOf(q1(`[data-fxhand="${a.p}"]`)); return r ? { rect: r, hand: true } : null; }
  if (a.type === 'center') {
    let cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;
    const zs = document.querySelectorAll('.drop-zone'), mt = rectOf(q1('.mem-track')); // centre-line: between the two battle areas (where the memory gauge sits)
    if (zs.length >= 2) { const a1 = zs[0].getBoundingClientRect(), b1 = zs[zs.length - 1].getBoundingClientRect(); if (b1.top > a1.bottom - 4) cy = (a1.bottom + b1.top) / 2; }
    if (mt) cx = mt.left + mt.width / 2;
    const w = 60, hh = 30;
    return { rect: { left: cx - w / 2, top: cy - hh / 2, width: w, height: hh, right: cx + w / 2, bottom: cy + hh / 2 }, virtual: true };
  }
  return null;
}
function snapTiles() {
  document.querySelectorAll('[data-fxn]').forEach(n => { const r = rectOf(n); if (r) lastRects.set(n.dataset.fxp + '|' + n.dataset.fxn, { rect: r, cardId: n.dataset.fxc, uid: n.dataset.fxu }); });
}

// ---------- rec -> model ----------
function stacksOf(state, p) { const pl = state.players[p]; return [...(pl.battle || []), ...(pl.raising ? [pl.raising] : [])]; }
function srcAnchor(state, src) {
  if (!src.cardId) return { type: 'center' };
  let c = {};
  try { c = cardOf(src.cardId); } catch (e) { /* ignore */ }
  const o = src.owner;
  if (o && state.players[o]) {
    let hit = null;
    for (const s of stacksOf(state, o)) { if (s.cardId === src.cardId) { hit = s; break; } }
    if (!hit) for (const s of stacksOf(state, o)) { let j = ''; try { j = JSON.stringify(s.sources || s.under || s.evoSources || []); } catch (e) { /* ignore */ } if (j.includes(src.cardId)) { hit = s; break; } } // inherited effect: its stack
    if (hit) return { type: 'tile', p: o, uid: hit.uid, name: cardOf(hit.cardId).nameKo };
    if (c.category === 'option') return { type: 'center' };
    if ((state.players[o].trash || []).includes(src.cardId)) return { type: 'pile', p: o, pile: 'trash' };
  }
  return { type: 'center' };
}
const stripOwner = (m) => m.replace(/^(p1|p2)\s+/, '');
function tilesIn(state, o, msg) { // stacks whose card name appears in the line (longest names first)
  if (!o || !state.players[o]) return [];
  const out = [];
  for (const s of stacksOf(state, o)) { const nm = cardOf(s.cardId).nameKo; if (msg.includes(nm)) out.push({ type: 'tile', p: o, uid: s.uid, name: nm }); }
  return out.sort((a, b) => b.name.length - a.name.length).slice(0, 3);
}
function classify(state, rec, e) { // one log line -> [{anchor, icon, text, cls}] ; [] => nothing anchorable (goes to the source label sub-line)
  const msg = e.msg, m = /^(p1|p2)\s/.exec(msg), o = m ? m[1] : rec.src.owner;
  const body = stripOwner(msg), tiles = tilesIn(state, o, msg), out = [];
  let mm;
  if (/셔플|섞/.test(msg) && !tiles.length) return [{ toast: `${P(o)} ${body}` }];
  if (/시큐리티/.test(msg) && /파기/.test(msg) && !/시큐리티 디지몬/.test(msg)) {
    out.push({ anchor: { type: 'pile', p: o, pile: 'security' }, icon: '🛡', text: `−${(mm = /(\d+)\s*장/.exec(msg)) ? mm[1] : 1} (파기)`, cls: 'down' });
    return out;
  }
  if ((mm = /DP\s*([+-]\d+)/.exec(msg)) && !/시큐리티 디지몬/.test(msg)) {
    const n = parseInt(mm[1], 10);
    for (const t of tiles) out.push({ anchor: t, icon: n > 0 ? '▲' : '▼', text: `${n > 0 ? '+' : ''}${n} DP`, cls: n > 0 ? 'up' : 'down' });
    if (out.length) return out;
  }
  if (/패로 되돌림|핸드로/.test(msg)) {
    for (const t of tiles) out.push({ anchor: t, icon: '↩', text: '패로 되돌림', cls: 'neutral' });
    out.push({ anchor: { type: 'hand', p: o }, icon: '✋', text: '패 +1', cls: 'up' });
    return out;
  }
  if (/덱 (?:아래|위)로/.test(msg)) {
    const pos = /덱 아래로/.test(msg) ? '아래' : '위';
    for (const t of tiles) out.push({ anchor: t, icon: '⤵', text: `덱 ${pos}로`, cls: 'neutral' });
    out.push({ anchor: { type: 'pile', p: o, pile: 'deck' }, icon: '📚', text: `+1 (${pos})`, cls: 'neutral' });
    return out;
  }
  if (/시큐리티 아래에 놓음/.test(msg)) {
    for (const t of tiles) out.push({ anchor: t, icon: '🛡', text: '시큐리티로', cls: 'neutral' });
    out.push({ anchor: { type: 'pile', p: o, pile: 'security' }, icon: '🛡', text: '+1', cls: 'up' });
    return out;
  }
  if ((mm = /드로우\s*(\d+)\s*장/.exec(msg))) {
    out.push({ anchor: { type: 'pile', p: o, pile: 'deck' }, icon: '📚', text: `드로우 −${mm[1]}`, cls: 'neutral' });
    out.push({ anchor: { type: 'hand', p: o }, icon: '✋', text: `드로우 +${mm[1]}`, cls: 'up' });
    return out;
  }
  if (/패에 추가/.test(msg)) { out.push({ anchor: { type: 'hand', p: o }, icon: '✋', text: '패에 추가 +1', cls: 'up' }); return out; }
  if (tiles.length && (mm = /진화원.*?(\d+)\s*장?.*?(?:파기|트래시|제거)|(?:파기|트래시|제거).*?진화원.*?(\d+)/.exec(msg))) {
    for (const t of tiles) out.push({ anchor: t, icon: '⬇', text: `진화원 −${mm[1] || mm[2]}`, cls: 'down' });
    return out;
  }
  if (/트래시(?:로|에)|파기/.test(msg) && !tiles.length) {
    out.push({ anchor: { type: 'pile', p: o, pile: 'trash' }, icon: '🗑', text: `파기 +${(mm = /(\d+)\s*장/.exec(msg)) ? mm[1] : 1}`, cls: 'down' });
    return out;
  }
  if (tiles.length && /(레스트|액티브)\s*$|레스트 상태|액티브$/.test(msg) && !/불가|않음/.test(msg)) {
    const rest = /레스트/.test(msg);
    for (const t of tiles.slice(0, 2)) out.push({ anchor: t, icon: rest ? '⟳' : '⟲', text: rest ? '레스트' : '액티브', cls: 'neutral' });
    return out;
  }
  for (const t of tiles.slice(0, 2)) out.push({ anchor: t, icon: '✦', text: body.length > 26 ? body.slice(0, 25) + '…' : body, cls: 'neutral' });
  return out;
}
function srcLabelText(rec) {
  const s = rec.src;
  if (s.kind !== 'effect') return `⚙ ${s.label || '룰'}`;
  const nm = s.cardId ? cardOf(s.cardId).nameKo : '';
  return `${P(s.owner)} 「${nm}」${s.tag ? '【' + s.tag + '】' : ''}${s.inherited ? ' 상속' : ''} 발동`;
}
const shortSrc = (rec) => rec.src.kind === 'effect' ? `${P(rec.src.owner)} 「${cardOf(rec.src.cardId).nameKo}」${rec.src.tag ? '【' + rec.src.tag + '】' : ''}` : (rec.src.label || '룰');
function gist(rec) {
  const t = String(rec.text || '').replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

function makeLabel(g) {
  const s = g.rec.src, n = el('div', `fxf-label fxf-${s.owner || 'rule'}`);
  let img = '';
  if (s.cardId) { try { img = cardOf(s.cardId).imgUrl || ''; } catch (e) { /* ignore */ } }
  if (img) { const i = el('img', 'fxf-thumb'); i.src = img; i.alt = ''; n.appendChild(i); }
  const box = el('div', 'fxf-lbody');
  box.appendChild(el('b', 'fxf-ltitle', srcLabelText(g.rec)));
  const gs = gist(g.rec);
  if (gs) box.appendChild(el('span', 'fxf-lgist', gs));
  g.subBox = el('div', 'fxf-lsubs'); box.appendChild(g.subBox);
  n.appendChild(box);
  const x = el('button', 'fxf-x', '✕'); x.title = '닫기'; x.addEventListener('click', (ev) => { ev.stopPropagation(); dropGroup(g); layout(); });
  n.appendChild(x);
  ensureRoot().appendChild(n);
  return n;
}
function killItem(it) { it.node.remove(); if (it.path) it.path.remove(); if (it.ghostNode) it.ghostNode.remove(); }
function addItem(g, it) {
  const n = el('div', `fxf-badge fxf-${it.cls || 'neutral'} fxf-${g.rec.src.owner || 'rule'}`);
  n.appendChild(el('i', 'fxf-bi', it.icon || '')); n.appendChild(el('span', 'fxf-bt', it.text));
  n.title = `${shortSrc(g.rec)} → ${it.text} (눌러서 닫기)`;
  const item = { anchor: it.anchor, node: n, text: it.text, ghostUntil: Date.now() + 3000 };
  n.addEventListener('click', () => { killItem(item); g.items = g.items.filter(x => x !== item); layout(); });
  ensureRoot().appendChild(n);
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('class', `fxf-arrow fxf-arrow-${g.rec.src.owner || 'p1'}`);
  path.setAttribute('marker-end', `url(#fxf-ah-${g.rec.src.owner || 'p1'})`);
  svg.appendChild(path); item.path = path;
  if (it.ghost) {
    const gh = el('div', 'fxf-ghost');
    if (it.cardId) { try { const u = cardOf(it.cardId).imgUrl; if (u) gh.style.backgroundImage = `url("${u}")`; } catch (e) { /* ignore */ } }
    ensureRoot().appendChild(gh); item.ghostNode = gh;
  }
  g.items.push(item);
}
function dropGroup(g) { for (const it of g.items) killItem(it); g.items = []; if (g.label) g.label.remove(); groups = groups.filter(x => x !== g); }
function showToast(text, ms) {
  ensureRoot();
  if (!toastEl) toastEl = el('div', 'fxf-toast');
  toastEl.textContent = '⚡ ' + text;
  root.appendChild(toastEl);
  clearTimeout(showToast.t); showToast.t = setTimeout(() => { if (toastEl) toastEl.remove(); }, ms);
}

const isTrivial = (r) => !r.entries.length && !r.vanished.length && r.mem0 === r.mem1;
// Called from fxSync (start of render, DOM not yet rebuilt — only the model is touched here; positions are resolved in fxFieldRender)
export function fxFieldSync(state, hist, baseId, lifeFor) {
  if (!on || !state) return;
  if (stateRef !== state) { fxFieldClear(); stateRef = state; }
  for (const rec of [...hist.slice(0, 8)].reverse()) {
    if (rec.id <= baseId || isTrivial(rec)) continue;
    let g = done.get(rec);
    if (!g || !groups.includes(g)) {
      if (g) continue; // already shown and dismissed / expired
      g = { id: ++uid, rec, items: [], subs: [], srcA: srcAnchor(state, rec.src), e: 0, v: 0, mem: false, expires: 0 };
      done.set(rec, g); groups.push(g);
      g.label = makeLabel(g);
      if (groups.length > 6) dropGroup(groups[0]);
    }
    let changed = false;
    for (const v of rec.vanished.slice(g.v)) {
      addItem(g, { anchor: { type: 'tile', p: v.owner, name: v.name }, icon: '💀', text: '소멸 ← ' + (isSmall() ? shortSrc(rec).replace(/^P\d /, '').replace(/【.*?】/, '') : shortSrc(rec)), cls: 'down', ghost: true, cardId: v.cardId }); changed = true;
    }
    g.v = rec.vanished.length;
    for (const e of rec.entries.slice(g.e)) {
      if (/스택 소멸/.test(e.msg)) continue;
      const res = classify(state, rec, e);
      if (!res.length) { g.subs.push(stripOwner(e.msg)); changed = true; continue; }
      for (const r of res) { if (r.toast) showToast(r.toast, Math.max(3500, lifeFor(rec) || 4500)); else { addItem(g, r); changed = true; } }
    }
    g.e = rec.entries.length;
    if (!g.mem && rec.mem0 !== rec.mem1) { g.mem = true; const d = rec.mem1 - rec.mem0; addItem(g, { anchor: { type: 'mem' }, icon: '⚡', text: `메모리 ${d > 0 ? '+' : ''}${d} (${rec.mem0}→${rec.mem1})`, cls: d > 0 ? 'up' : 'down' }); changed = true; }
    if (changed || !g.expires) {
      const life = lifeFor(rec);
      g.expires = life > 0 ? Date.now() + Math.max(4500, life) : 0; // 0 = manual: stays until clicked
    }
    if (g.subBox) { g.subBox.textContent = ''; for (const s of g.subs.slice(0, 3)) g.subBox.appendChild(el('div', 'fxf-lsub', s.length > 44 ? s.slice(0, 43) + '…' : s)); }
  }
  scheduleExpiry();
}
function scheduleExpiry() {
  clearTimeout(timer);
  const ts = groups.filter(g => g.expires).map(g => g.expires);
  if (ts.length) timer = setTimeout(() => { if (on) layoutNow(); }, Math.max(60, Math.min(...ts) - Date.now() + 30));
}
export function fxFieldClear() {
  for (const g of [...groups]) dropGroup(g);
  groups = []; if (toastEl) toastEl.remove();
  clearChoice();
}
export const fxFieldStats = () => ({ groups: groups.length, items: groups.reduce((n, g) => n + g.items.length, 0), on });

// ---------- layout ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function placeNode(node, x, y, anchorX, anchorY) { // (x,y) = wanted point; anchorX 'c'|'l'|'r', anchorY 't'|'b'
  const w = node.offsetWidth, hh = node.offsetHeight, W = window.innerWidth, H = window.innerHeight;
  let left = anchorX === 'c' ? x - w / 2 : anchorX === 'r' ? x - w : x;
  let top = anchorY === 'b' ? y - hh : y;
  left = clamp(left, 4, Math.max(4, W - w - 4)); top = clamp(top, 4, Math.max(4, H - hh - 4));
  node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  return { left, top, width: w, height: hh, right: left + w, bottom: top + hh };
}
function edgePoint(r, tx, ty) { // point on rect r's border toward (tx,ty)
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const k = Math.min(dx ? (r.width / 2) / Math.abs(dx) : Infinity, dy ? (r.height / 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k };
}
function curve(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const off = Math.min(40, len * 0.18);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx - dy / len * off).toFixed(1)} ${(my + dx / len * off).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
export function fxFieldRender(state) {
  cancelAnimationFrame(raf); raf = 0;
  if (state) lastState = state;
  if (!on) { if (root) fxFieldClear(); return; }
  if (!groups.length && !(state && state.uiChoice) && !choiceLabel) return;
  layoutNow(state);
}
function layout() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (on) layoutNow(); }); }
function layoutNow(state) {
  if (state) lastState = state;
  snapTiles();
  const now = Date.now();
  for (const g of [...groups]) if (g.expires && now > g.expires) dropGroup(g);
  ensureRoot();
  svg.setAttribute('width', window.innerWidth); svg.setAttribute('height', window.innerHeight);
  const used = new Map();
  const stackAt = (key, hh) => { const n = used.get(key) || 0; used.set(key, n + 1); return n * (hh + 2); };
  for (const g of groups) {
    const sr = resolve(g.srcA);
    let srcBox = null;
    if (sr) {
      g.label.style.display = '';
      const r = sr.rect, lh = g.label.offsetHeight || 34, off = stackAt('L' + Math.round(r.left) + ',' + Math.round(r.top), lh);
      const above = r.top - lh - 4 - off > 40;
      srcBox = placeNode(g.label, r.left + r.width / 2, above ? r.top - 4 - off : r.bottom + 4 + off, 'c', above ? 'b' : 't');
      g.label.classList.toggle('fxf-virtual', !!sr.virtual);
    } else g.label.style.display = 'none';
    for (const it of g.items) {
      const tr = resolve(it.anchor);
      if (!tr) { it.node.style.display = 'none'; if (it.path) it.path.setAttribute('d', ''); if (it.ghostNode) it.ghostNode.style.display = 'none'; continue; }
      it.node.style.display = '';
      const r = tr.rect, W = window.innerWidth, hh = it.node.offsetHeight || 20;
      const key = it.anchor.type + (it.anchor.p || '') + (it.anchor.uid || it.anchor.name || it.anchor.pile || ''), off = stackAt(key, hh);
      let box;
      if (it.anchor.type === 'tile') {
        box = placeNode(it.node, r.left + r.width / 2, r.top + 2 + off, 'c', 't');
        if (it.ghostNode && Date.now() > it.ghostUntil) it.ghostNode.style.display = 'none'; // neighbours have reflowed by now: a stale outline would sit on the wrong card
        else if (it.ghostNode) { it.ghostNode.style.display = ''; Object.assign(it.ghostNode.style, { left: Math.round(r.left) + 'px', top: Math.round(r.top) + 'px', width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px' }); }
      } else if (it.anchor.type === 'pile') {
        const right = r.right + 4 + it.node.offsetWidth < W - 4;
        box = placeNode(it.node, right ? r.right + 4 : r.left - 4, r.top + off, right ? 'l' : 'r', 't');
      } else if (it.anchor.type === 'mem') {
        box = placeNode(it.node, r.left + r.width / 2, r.top - 4 - off, 'c', 'b');
      } else {
        box = placeNode(it.node, r.left + Math.min(r.width, 260) / 2, r.top - 4 - off, 'c', 'b');
      }
      if (it.path && srcBox) {
        const tc = { x: box.left + box.width / 2, y: box.top + box.height / 2 }, sc = { x: srcBox.left + srcBox.width / 2, y: srcBox.top + srcBox.height / 2 };
        if (Math.hypot(tc.x - sc.x, tc.y - sc.y) < 24) it.path.setAttribute('d', '');
        else it.path.setAttribute('d', curve(edgePoint(srcBox, tc.x, tc.y), edgePoint(box, sc.x, sc.y)));
      } else if (it.path) it.path.setAttribute('d', '');
    }
  }
  layoutChoice(lastState);
  scheduleExpiry();
}

// ---------- pending choice: pinned source label + legal targets highlighted on the board ----------
function clearChoice() {
  for (const n of choiceNodes) n.remove(); choiceNodes = [];
  if (choiceLabel) { choiceLabel.remove(); choiceLabel = null; }
  if (svg) svg.querySelectorAll('path.fxf-choice').forEach(p => p.remove());
}
function layoutChoice(state) {
  const uc = state && state.uiChoice, rec = state && state._fxRec;
  if (!on || !uc || uc.hold || !rec || !rec.src || rec.src.kind !== 'effect') { if (choiceNodes.length || choiceLabel) clearChoice(); return; }
  const key = uc.kind + '|' + rec.id;
  if (!choiceLabel || choiceLabel._key !== key) {
    clearChoice();
    const g = { rec, items: [], subs: [] };
    choiceLabel = makeLabel(g); choiceLabel._key = key; choiceLabel.classList.add('fxf-choice-label');
    choiceLabel._srcA = srcAnchor(state, rec.src);
    choiceLabel.querySelector('.fxf-x').style.display = 'none';
  }
  const sr = resolve(choiceLabel._srcA); let box = null;
  if (sr) { const r = sr.rect, hh = choiceLabel.offsetHeight || 34, above = r.top - hh - 4 > 40; choiceLabel.style.display = ''; box = placeNode(choiceLabel, r.left + r.width / 2, above ? r.top - 4 : r.bottom + 4, 'c', above ? 'b' : 't'); } else choiceLabel.style.display = 'none';
  const p = uc.payload || {}, targets = [];
  if (Array.isArray(p.uids)) for (const u of p.uids) targets.push({ p: p.player, uid: u });
  if (Array.isArray(p.entries)) for (const e of p.entries) if (e && e.uid != null) targets.push({ p: e.player, uid: e.uid });
  for (const n of choiceNodes) n.remove(); choiceNodes = [];
  if (svg) svg.querySelectorAll('path.fxf-choice').forEach(x => x.remove());
  for (const t of targets.slice(0, 12)) {
    const n = document.querySelector(`[data-fxn][data-fxp="${t.p}"][data-fxu="${t.uid}"]`), r = rectOf(n); if (!r) continue;
    const ring = el('div', 'fxf-ring'); Object.assign(ring.style, { left: Math.round(r.left - 3) + 'px', top: Math.round(r.top - 3) + 'px', width: Math.round(r.width + 6) + 'px', height: Math.round(r.height + 6) + 'px' });
    ensureRoot().appendChild(ring); choiceNodes.push(ring);
    if (box) {
      const path = document.createElementNS(SVGNS, 'path'); path.setAttribute('class', 'fxf-arrow fxf-choice'); path.setAttribute('marker-end', 'url(#fxf-ah-ok)');
      const tc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }, sc = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      path.setAttribute('d', curve(edgePoint(box, tc.x, tc.y), edgePoint(r, sc.x, sc.y))); svg.appendChild(path);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { if (groups.length || choiceLabel) layout(); });
  window.addEventListener('load', () => { if (groups.length || choiceLabel) layout(); }, true); // card images finishing loading shift tile geometry
  setInterval(() => { if (on && !document.hidden && document.querySelector('[data-fxn]')) snapTiles(); }, 400); // keep last-known tile rects fresh (vanished stacks are drawn where they last stood)
  setInterval(() => { if (on && (groups.length || choiceLabel)) layoutNow(); }, 250); // cheap safety net: layout settles after render (async images, scroll containers, animations)
  window.addEventListener('scroll', () => { if (groups.length || choiceLabel) layout(); }, true);
  window.__fxf = { get groups() { return groups; }, stats: fxFieldStats, layout: () => layoutNow(), clear: fxFieldClear };
}
