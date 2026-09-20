// Effect-trigger CENSUS. Runs CPU-vs-CPU games (src/cpusim.js, the same executor test-cpu.mjs uses) with decks built AROUND one card at a
// time and records, per (card, trigger tags, source): queued / resolved / manual(no script) / silent (script ran, nothing changed, no log) /
// errored / DOUBLE queues / DEAD (printed self-trigger event occurred on a stack that holds the segment, yet nothing queued).
// The engine is instrumented only through `globalThis.__CENSUS` (checked once per drain() in src/cpusim.js) + S.EVENT_HOOKS; both are
// absent in normal play.
//
// node scripts/census.mjs --from 0 --to 400 --games 3 --minutes 8 --out <file.json> [--seed N] [--level normal|hard] < /dev/null
// node scripts/census.mjs --merge a.json b.json ... --out merged.json
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
import { createSim } from '../src/cpusim.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

// ---------- merge mode ----------
if (argv.includes('--merge')) {
  const files = argv.slice(argv.indexOf('--merge') + 1).filter(a => !a.startsWith('--') && a !== flag('out'));
  const M = { segs: {}, present: {}, presentInh: {}, hand: {}, played: {}, wopp: {}, games: 0, gamesByCard: {}, dead: {}, errors: {}, meta: {} };
  const addNum = (a, b) => { for (const k of Object.keys(b)) a[k] = (a[k] || 0) + b[k]; };
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    M.games += j.games; addNum(M.gamesByCard, j.gamesByCard || {});
    for (const k of ['present', 'presentInh', 'hand', 'played', 'wopp']) addNum(M[k], j[k] || {});
    for (const [k, v] of Object.entries(j.segs)) { const m = (M.segs[k] ||= { card: v.card, tags: v.tags, src: v.src, text: v.text, queued: 0, resolved: 0, manual: 0, silent: 0, err: 0, dbl: 0, once: 0, perTurnMax: 0, silentEx: null, dblEx: null, errEx: null, manualEx: null, onceEx: null }); for (const c of ['queued', 'resolved', 'manual', 'silent', 'err', 'dbl', 'once']) m[c] += (v[c] || 0); m.perTurnMax = Math.max(m.perTurnMax, v.perTurnMax || 0); for (const x of ['silentEx', 'dblEx', 'errEx', 'manualEx', 'onceEx']) m[x] ||= v[x]; }
    for (const [k, v] of Object.entries(j.dead)) { const m = (M.dead[k] ||= { card: v.card, tag: v.tag, src: v.src, text: v.text, events: 0, missed: 0, ex: null }); m.events += v.events; m.missed += v.missed; m.ex ||= v.ex; }
    for (const [k, v] of Object.entries(j.errors || {})) { const m = (M.errors[k] ||= { n: 0, stack: v.stack }); m.n += v.n; }
  }
  fs.writeFileSync(flag('out', 'merged.json'), JSON.stringify(M));
  console.log('merged', files.length, 'files,', M.games, 'games,', Object.keys(M.segs).length, 'segments');
  process.exit(0);
}

await S.loadData();
const SEED = Number(flag('seed', Date.now() % 1e9));
let RS = SEED >>> 0 || 1;
Math.random = function () { RS = (RS + 0x6D2B79F5) >>> 0; let t = RS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- store ----------
const ST = { segs: {}, present: {}, presentInh: {}, hand: {}, played: {}, wopp: {}, games: 0, gamesByCard: {}, dead: {}, errors: {} };
const cardOf = (id) => S.card(id);
const trunc = (s, n = 70) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
function segOf(t) {
  const src = t.linked ? 'link' : t.watcher ? (t.inherited ? 'watch-inh' : 'watch') : t.inherited ? 'inherited' : (t.evt || t.tags?.[0]?.startsWith('__')) ? 'own' : 'own';
  const key = `${t.cardId}|${(t.tags || []).join('/')}|${src}|${trunc(t.text, 24)}`;
  return ST.segs[key] ||= { card: t.cardId, tags: (t.tags || []).join('/'), src, text: trunc(t.text, 90), queued: 0, resolved: 0, manual: 0, silent: 0, err: 0, dbl: 0, once: 0, perTurnMax: 0, silentEx: null, dblEx: null, errEx: null, manualEx: null, onceEx: null };
}
const COND_OPP_DIGI = /^([〔\[]턴\s*에?\s*\d+\s*회[〕\]]\s*)?상대의\s*디지몬에게?\s*어택했을\s*때/, COND_PLAYER = /^([〔\[]턴\s*에?\s*\d+\s*회[〕\]]\s*)?플레이어에게\s*어택했을\s*때/, COND_NONBATTLE = /배틀\s*이외로\s*소멸하고\s*있었다면/; // queue-time conditions the engine evaluates itself (resolveBattleCondition)
const SELF = { play: ['등장 시'], digivolve: ['진화 시'], delete: ['소멸 시'], attack: ['어택 시', '공격 시'] };

// ---------- census object ----------
let G = null; // per-game context
const DBG = flag('dbg', ''); let DBGN = Number(flag('dbgn', 3)); // --dbg CARDID prints the first pending items of that card
const CX = {
  sync(state) {
    if (!G || G.state !== state) return;
    // 1. newly-queued pending items
    const fresh = [];
    for (const t of state.pending) if (!G.seen.has(t.uid)) { G.seen.add(t.uid); fresh.push(t); }
    // new log lines since last sync
    const lines = []; const L = state.log;
    for (let i = 0; i < L.length && L[i] !== G.logHead; i++) lines.push(L[i].msg);
    if (L.length) G.logHead = L[0];
    for (const t of fresh) {
      if (t.schedFn) continue;
      const sg = segOf(t); sg.queued++;
      if (DBG && t.cardId === DBG && DBGN-- > 0) console.log('DBG pending', JSON.stringify({ ...t, schedFn: !!t.schedFn, evtSnap: undefined, delStack: undefined }), '| log:', lines.slice(0, 4).reverse().join(' / '), '| events:', JSON.stringify(G.events.map(e => e.kind + ':' + e.cardId)));
      const k = `${t.cardId}|${t.stackUid}|${(t.tags || []).join('/')}|${t.text}|${state.turnNumber}`;
      const n = G.perTurn[k] = (G.perTurn[k] || 0) + 1;
      if (n > sg.perTurnMax) sg.perTurnMax = n;
    }
    // 2. DOUBLE: same (card, stack, tags, text) queued >1x within ONE event batch and there was <2 matching events
    const groups = {};
    for (const t of fresh) { if (t.schedFn) continue; const k = `${t.cardId}|${t.stackUid}|${(t.tags || []).join('/')}|${t.text}`; (groups[k] ||= []).push(t); }
    for (const [k, arr] of Object.entries(groups)) {
      if (arr.length < 2) continue;
      const t = arr[0], tag = (t.tags || [])[0] || '';
      const kinds = Object.keys(SELF).filter(x => SELF[x].some(w => tag.includes(w)));
      const evs = kinds.length ? G.events.filter(e => kinds.includes(e.kind) && (e.uid === t.stackUid)) : []; const copies = evs.length ? Math.max(1, evs[0].sources.filter(x => x === t.cardId).length + (evs[0].cardId === t.cardId ? 1 : 0)) : 1; const nEv = kinds.length ? evs.length * copies : arr.length; // each COPY of a card in the stack triggers separately; watcher-type: can't count the events -> no DOUBLE claim
      if (arr.length > Math.max(1, nEv)) { const sg = segOf(t); sg.dbl++; sg.dblEx ||= { turn: state.turnNumber, n: arr.length, events: nEv, gid: G.id, lines: lines.slice(0, 6).reverse() }; }
    }
    // 3. DEAD detection for self-trigger events
    for (const ev of G.events) {
      const want = SELF[ev.kind]; if (!want) continue;
      const exp = [];
      const c = cardOf(ev.cardId);
      const scan = (cid, text, inh) => {
        if (!text) return;
        for (const seg of S.parseEffectSegments(text).segments) {
          if (!seg.tags.some(tg => want.some(w => tg.includes(w)))) continue;
          if (seg.zoneMarker) continue;
          if (/^[≪《]\s*딜레이\s*[≫》]/.test(seg.body.trim())) continue;
          exp.push({ cid, seg, inh });
        }
      };
      scan(ev.cardId, c.effectKo, false);
      if (c.category !== 'tamer') for (const sid of ev.sources) scan(sid, cardOf(sid).inheritedKo, true);
      for (const x of exp) {
        const tagKey = x.seg.tags.join('/');
        const dk = `${x.cid}|${tagKey}|${x.inh ? 'inh' : 'own'}|${trunc(x.seg.body, 24)}`;
        const d = ST.dead[dk] ||= { card: x.cid, tag: tagKey, src: x.inh ? 'inh' : 'own', text: trunc(x.seg.body, 90), events: 0, missed: 0, ex: null };
        d.events++;
        { const b = x.seg.body.trim(); if (COND_OPP_DIGI.test(b) && ev.tk !== 'digimon') { d.events--; continue; } if (COND_PLAYER.test(b) && ev.tk !== 'player') { d.events--; continue; } if (COND_NONBATTLE.test(b) && ev.cause === 'battle') { d.events--; continue; } }
        try { if (S.hookDescriptorFor(x.cid, x.seg.tags, x.seg.body)?.skipTrigger) { d.events--; continue; } } catch (e) { /* ignore */ } // queued by its own bespoke event hook (different event kind)
        const strict = fresh.some(t => t.cardId === x.cid && t.stackUid === ev.uid && (t.tags || []).join('/') === tagKey);
        if (strict) continue;
        const lenient = fresh.some(t => t.cardId === x.cid && t.stackUid === ev.uid);
        const nm = cardOf(x.cid).nameKo;
        const nm2 = cardOf(ev.cardId).nameKo; const logged = lines.some(m => (m.includes(nm) || m.includes(nm2)) && /자동 처리|발휘하지 않|무효/.test(m));
        if (lenient || logged) { d.events--; continue; } // handled (auto-applied / suppressed / another segment of same card queued)
        d.missed++; d.ex ||= { turn: ev.turn, kind: ev.kind, inSources: ev.sources.length, gid: G.id, lines: lines.slice(0, 5).reverse() };
      }
    }
    G.events.length = 0;
  },
  manual(state, t, why) { if (!G || G.state !== state) return; const s = segOf(t); s.manual++; s.manualEx ||= why; },
  before(state, t, script) {
    if (!G) return null;
    if (!script || !script.length) { const s = segOf(t); s.manual++; s.manualEx ||= 'no script: ' + trunc(t.text, 60); return { noScript: true }; }
    return { sig: sigOf(state), head: state.log[0] };
  },
  after(state, t, script, cxs) {
    if (!G || !cxs || cxs.noScript) return;
    const s = segOf(t); s.resolved++;
    if (t.stackUid && cxs.sig !== sigOf(state)) { // an EFFECTIVE resolution: check the printed [턴에 N회] cap (each COPY of the card in the stack has its own cap)
      const om = String(t.text || '').match(/^\s*[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
      if (om) {
        let copies = 1; for (const q of ['p1', 'p2']) for (const st of [state.players[q].raising, ...state.players[q].battle]) if (st && st.uid === t.stackUid) copies = Math.max(1, (st.cardId === t.cardId ? 1 : 0) + st.sources.filter(x => x === t.cardId).length + (st.linkCards || []).filter(l => l.cardId === t.cardId).length);
        const k = `${t.cardId}|${t.stackUid}|${(t.tags || []).join('/')}|${t.text}|${state.turnNumber}`;
        const n = G.onceCnt[k] = (G.onceCnt[k] || 0) + 1; if (n === 1) G.onceLast[k] = { uid: t.uid, evt: t.evt && t.evt.kind };
        if (n > Number(om[1]) * copies) { s.once = (s.once || 0) + 1; s.onceEx ||= { gid: G.id, turn: state.turnNumber, n, cap: Number(om[1]) * copies, ops: script.map(o => o.op).join(','), uid: t.uid, active: state.activePlayer, owner: t.player, evt: t.evt && t.evt.kind, prev: G.onceLast[k] }; G.onceLast[k] = { uid: t.uid, evt: t.evt && t.evt.kind }; }
      }
    }
    if (cxs.sig === sigOf(state) && cxs.head === state.log[0]) { s.silent++; s.silentEx ||= { gid: G.id, turn: state.turnNumber, ops: script.map(o => o.op).join(',') }; }
  },
  error(state, t, e) { if (!G) return; const s = segOf(t); s.err++; s.errEx ||= String(e && e.message).slice(0, 120); const k = t.cardId + ': ' + String(e && e.message).slice(0, 100); (ST.errors[k] ||= { n: 0, stack: String(e && e.stack).split('\n').slice(0, 4).join(' | ') }).n++; },
};
function sigOf(state) {
  let s = state.memory + '|' + state.pending.length + '|' + (state.winner || '');
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    s += `#${pl.hand.length},${pl.deck.length},${pl.trash.length},${pl.security.length},${pl.digitamaDeck.length}`;
    for (const st of [pl.raising, ...pl.battle]) if (st) s += `;${st.uid}:${st.cardId}:${st.sources.length}:${+st.suspended}:${st.tempDP}:${st.inheritedDP || 0}:${Object.keys(st.keywords || {}).join('.')}:${Object.keys(st.inheritedKeywords || {}).join('.')}:${(st.linkCards || []).length}:${(st.dpMods || []).length}`;
  }
  return s;
}
globalThis.__CENSUS = CX;
const WCACHE = new Map();
function watchersOf(cardId, inh) { // printed turn-scoped watcher segments of a card + the engine event kinds they listen for (the engine's own parsers)
  const key = cardId + (inh ? '#i' : '#o'); let r = WCACHE.get(key); if (r) return r; r = [];
  const c = S.card(cardId), text = inh ? c.inheritedKo : c.effectKo;
  if (text) for (const seg of S.parseEffectSegments(text).segments) {
    if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
    let kinds = null; try { const ab = S.parseWatcherTrigger(seg.body); kinds = ab ? (ab.kinds || [ab.kind]) : null; if (!kinds) { const ew = S.parseEventWatcher(seg.body); kinds = ew ? ew.kinds : null; } } catch (e) { kinds = null; }
    if (kinds) r.push({ tag: seg.tags[0], kinds, k: `${cardId}|${seg.tags[0]}|${inh ? 'inh' : 'own'}` });
  }
  WCACHE.set(key, r); return r;
}
S.EVENT_HOOKS.push((state, kind, info) => {
  if (!G || G.state !== state) return;
  for (const hp of ['p1', 'p2']) { // watcher OPPORTUNITIES: an event of a kind some on-board watcher listens for happened while it was active
    const hpl = state.players[hp];
    for (const h of [hpl.raising, ...hpl.battle]) {
      if (!h) continue;
      const lists = [[watchersOf(h.cardId, false)]];
      if (S.card(h.cardId).category !== 'tamer') for (const sid of h.sources.slice(S.fdCount(h))) lists.push([watchersOf(sid, true)]);
      for (const [l] of lists) for (const w of l) {
        if (!w.kinds.includes(kind)) continue;
        if (w.tag === '자신의 턴' && state.activePlayer !== hp) continue;
        if (w.tag === '상대의 턴' && state.activePlayer === hp) continue;
        ST.wopp[w.k] = (ST.wopp[w.k] || 0) + 1;
      }
    }
  }
  if (SELF[kind] && info && info.stack) G.events.push({ kind, uid: info.stack.uid, cardId: info.stack.cardId, sources: info.stack.sources.slice(S.fdCount(info.stack)), turn: state.turnNumber, tk: state.attackCtx ? state.attackCtx.targetKind : null, cause: info.cause });
  if (kind === 'play' && info && info.stack) ST.played[info.stack.cardId] = (ST.played[info.stack.cardId] || 0) + 1;
  if (kind === 'optionUsed' && info) { const id = info.cardId || (info.stack && info.stack.cardId); if (id) ST.played[id] = (ST.played[id] || 0) + 1; }
});

// ---------- deck builder around a card ----------
const ALL = Object.values(S.CARDS).filter(c => !c.isToken && !c.isParallel);
const POOL_D = ALL.filter(c => c.category === 'digimon' && c.level >= 3 && c.cost != null);
const EGGS = ALL.filter(c => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
const TAMERS = ALL.filter(c => c.category === 'tamer'), OPTS = ALL.filter(c => c.category === 'option');
const colOk = (c, cols) => (c.colors || []).length > 0 && c.colors.every(x => cols.includes(x));
const canEvo = (a, b) => { try { return E.canEvolveAny(a.id, b.id, [], null).ok; } catch (e) { return false; } };
function addTo(m, c, n) { const cur = m[c.id] || 0; const mx = Math.min(4, S.maxCopiesFor(c.id) || 4); const add = Math.min(n, mx - cur); if (add > 0) m[c.id] = cur + add; return add > 0; }
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
function deckAround(X) {
  const cols = (X.colors && X.colors.length ? X.colors : ['red']).slice();
  const main = {}, dig = {};
  const isEgg = X.category === 'digitama' || (X.category === 'digimon' && X.level === 2);
  let bottom = X;
  if (isEgg) addTo(dig, X, 4); else addTo(main, X, 4);
  if (X.category === 'digimon' && X.level >= 3) {
    let cur = X;
    for (let l = X.level - 1; l >= 3; l--) {
      const cands = POOL_D.filter(c => c.level === l && colOk(c, cols) && canEvo(c, cur));
      const ch = shuffled(cands).slice(0, 2);
      if (!ch.length) break;
      for (const c of ch) addTo(main, c, 3 + rnd(2));
      cur = ch[0];
    }
    bottom = cur;
    const ups = shuffled(POOL_D.filter(c => c.level === X.level + 1 && colOk(c, cols) && canEvo(X, c))).slice(0, 2);
    for (const c of ups) addTo(main, c, 2);
  } else if (isEgg) {
    const l3 = shuffled(POOL_D.filter(c => c.level === 3 && colOk(c, cols) && canEvo(X, c))).slice(0, 3);
    for (const c of l3) { addTo(main, c, 4); const l4 = shuffled(POOL_D.filter(d => d.level === 4 && colOk(d, cols) && canEvo(c, d))).slice(0, 1); for (const d of l4) addTo(main, d, 3); }
  }
  // eggs
  if (!isEgg) { const eg = shuffled(EGGS.filter(e => colOk(e, cols) && canEvo(e, bottom))).slice(0, 3); for (const e of eg) addTo(dig, e, 2); }
  { let g = 0; const cand = EGGS.filter(e => colOk(e, cols)); while (total(dig) < 5 && cand.length && g++ < 100) addTo(dig, pick(cand), 1); }
  if (!total(dig)) addTo(dig, pick(EGGS), 5);
  // supporters
  const tam = TAMERS.filter(c => colOk(c, cols)), opt = OPTS.filter(c => colOk(c, cols));
  if (X.category !== 'tamer') for (let i = 0; i < 3 && tam.length; i++) addTo(main, pick(tam), 1 + rnd(2));
  if (X.category !== 'option') for (let i = 0; i < 4 && opt.length; i++) addTo(main, pick(opt), 1 + rnd(2));
  const dg = POOL_D.filter(c => colOk(c, cols) && c.level <= 5);
  let g = 0; while (total(main) < 50 && g++ < 800) { const p = dg.length ? pick(dg) : pick(POOL_D); addTo(main, p, 1 + rnd(3)); }
  let d = { name: 'census:' + X.id, main, digitama: dig };
  if (total(main) > 50) { for (const k of Object.keys(main)) { if (total(main) <= 50) break; if (k !== X.id) { main[k]--; if (!main[k]) delete main[k]; } } }
  return d;
}
function randomOpp() {
  const cols = [pick(['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'])];
  const main = {}, dig = {};
  const dg = POOL_D.filter(c => colOk(c, cols) && c.level <= 6), eg = EGGS.filter(c => colOk(c, cols));
  let g = 0; while (total(main) < 50 && g++ < 800) addTo(main, pick(dg), 1 + rnd(3));
  g = 0; while (total(dig) < 5 && g++ < 100) addTo(dig, pick(eg.length ? eg : EGGS), 1);
  return { name: 'opp', main, digitama: dig };
}

// ---------- game ----------
const TURN_CAP = Number(flag('turncap', 40)), TIME_CAP = Number(flag('cap', 20000));
const LEVEL = flag('level', 'mixed');
let gidSeq = 0;
function scanPresence(state, seenBoard, seenInh, seenHand) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const id of pl.hand) seenHand.add(id);
    for (const st of [pl.raising, ...pl.battle]) if (st) { seenBoard.add(st.cardId); for (const s of st.sources) seenInh.add(s); }
  }
}
// FOCUS driver: the plain CPU never uses expensive / low-value options (134 option cards were held 90+ times and never cast), so their effects were never exercised.
// With probability FORCE the focus card is played / cast / evolved into whenever a legal action for it exists (the rest of the turn is the normal CPU).
const FORCE = Number(flag('force', 0.6));
function chooseAct(state, p, cfg, focus) {
  if (focus && Math.random() < FORCE) {
    try {
      const banned = cfg.banned || new Set();
      const acts = Cpu.enumerateActions(state, p).filter(a => !banned.has(a.key));
      const f = acts.filter(a => a.cardId === focus && ['play', 'option', 'evolve', 'jogress'].includes(a.type));
      if (f.length) return pick(f);
      const m = acts.filter(a => a.type === 'main' && (() => { const st = [state.players[p].raising, ...state.players[p].battle].find(x => x && x.uid === a.uid); return st && st.cardId === focus; })());
      if (m.length) return pick(m);
    } catch (e) { /* fall through to the normal CPU */ }
  }
  return Cpu.planMain(state, p, cfg);
}
async function playGame(dA, dB, tag, focus) {
  const state = S.newGame(dA, dB);
  const lv = (LEVEL === 'mixed' ? pick(['normal', 'hard']) : LEVEL);
  const cfgs = { p1: { level: lv, search: false, banned: new Set() }, p2: { level: LEVEL === 'mixed' ? pick(['normal', 'hard']) : LEVEL, search: false, banned: new Set() } };
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0 };
  G = { id: tag + '#' + (++gidSeq) + '@' + SEED, state, seen: new Set(), perTurn: {}, onceCnt: {}, onceLast: {}, events: [], logHead: null };
  const seenBoard = new Set(), seenInh = new Set(), seenHand = new Set();
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: (w, e) => { const k = w + ': ' + String(e && e.message).slice(0, 100); (ST.errors[k] ||= { n: 0, stack: String(e && e.stack).split('\n').slice(0, 4).join(' | ') }).n++; }, stats });
  const t0 = Date.now();
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
    for (let t = 0; t < TURN_CAP && !state.winner; t++) {
      if (Date.now() - t0 > TIME_CAP) break;
      const p = state.activePlayer;
      await sim.beginTurn(p);
      if (state.winner) break;
      scanPresence(state, seenBoard, seenInh, seenHand);
      await sim.mainLoop(p, async () => chooseAct(state, p, cfgs[p], focus));
      scanPresence(state, seenBoard, seenInh, seenHand);
    }
  } catch (e) { const k = 'game: ' + String(e && e.message).slice(0, 100); (ST.errors[k] ||= { n: 0, stack: String(e && e.stack).split('\n').slice(0, 4).join(' | ') }).n++; }
  for (const id of seenBoard) ST.present[id] = (ST.present[id] || 0) + 1;
  for (const id of seenInh) ST.presentInh[id] = (ST.presentInh[id] || 0) + 1;
  for (const id of seenHand) ST.hand[id] = (ST.hand[id] || 0) + 1;
  ST.games++;
  G = null;
}

const FROM = Number(flag('from', 0)), TO = Number(flag('to', 1e9)), NG = Number(flag('games', 3)), MINUTES = Number(flag('minutes', 8));
const MIRROR = Number(flag('mirror', 0.34));
const ids = flag('ids', '') ? flag('ids').split(',') : ALL.map(c => c.id).sort().slice(FROM, TO);
const deadline = Date.now() + MINUTES * 60000;
const outFile = flag('out', 'census-out.json');
const save = () => fs.writeFileSync(outFile, JSON.stringify(ST));
let done = 0;
outer: for (let round = 0; round < Number(flag('rounds', 1)); round++) {
  for (const id of ids) {
    if (Date.now() > deadline) break outer;
    const X = S.CARDS[id];
    for (let k = 0; k < NG; k++) {
      if (Date.now() > deadline) break outer;
      let dA, dB;
      try { dA = deckAround(X); dB = Math.random() < MIRROR ? deckAround(X) : randomOpp(); } catch (e) { const kk = 'deck ' + id + ': ' + String(e && e.message).slice(0, 80); (ST.errors[kk] ||= { n: 0, stack: '' }).n++; continue; }
      await playGame(dA, dB, id, id);
      ST.gamesByCard[id] = (ST.gamesByCard[id] || 0) + 1;
    }
    done++;
    if (done % 20 === 0) save();
  }
}
save();
console.log(`census: ${ST.games} games, ${done} cards, ${Object.keys(ST.segs).length} segments, ${Object.keys(ST.dead).length} dead-candidates keys -> ${outFile}`);
process.exit(0);
