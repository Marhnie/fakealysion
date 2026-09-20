// Invariant fuzzer: plays many games with smarter-than-random drivers (evolve / jogress / burst / app fusion / link / xros / assembly /
// options / attacks with counters + blockers + full security checks) over diverse deck generators, and checks after EVERY action:
//   - CARD CONSERVATION: the multiset of card ids each player owns (deck+hand+trash+security+digitama+raising+battle stacks(top,sources,link)+
//     any other card-id array found on the player/state) equals the initial multiset (tokens excluded). Reports lost / duplicated /
//     wrong-owner / two-zone cards with the action and the effect cards that ran.
//   - structural: unique stack uids, unknown card ids, sources are strings, keywords keys known, NaN/Infinity anywhere, negative expiry,
//     memory range, pending growth/stuck, turn progress (stall), winner consistency, 'undefined'/'NaN' in log lines.
//
// Usage: node scripts/fuzz.mjs [games=200] [--gen random|theme|mech|starter|mix] [--seed N] [--verbose] [--maxTurns 60] [--minutes M]
// Reproduce one game: node scripts/fuzz.mjs 1 --seed <seed printed in the report> --gen <gen>
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]) : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));
const G = Number(positional[0] || 200);
const GEN = String(flag('gen', 'mix'));
const BASE_SEED = Number(flag('seed', Date.now() % 1e9));
const VERBOSE = !!flag('verbose', false);
const MAX_TURNS = Number(flag('maxTurns', 60));
const MAX_MIN = Number(flag('minutes', 0));
const JSON_OUT = flag('json', null);
const LOGN = Number(flag('logn', 8));
const SELFTEST = !!flag('selftest', false);
const T0 = Date.now();

// ---------- seeded RNG (engine shuffles use Math.random too) ----------
let RS = 1;
function seedRng(s) { RS = (s >>> 0) || 1; }
Math.random = function () { RS = (RS + 0x6D2B79F5) >>> 0; let t = RS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const chance = (p) => Math.random() < p;
const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- deck generators ----------
const CARDS = S.CARDS;
const all = Object.values(CARDS).filter(c => !c.isToken);
const mainPool = all.filter(c => ['digimon', 'tamer', 'option'].includes(c.category) && !(c.category === 'digimon' && c.level === 2 && /^(?:.*)$/.test('') ));
const eggPool = all.filter(c => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
const digimonPool = all.filter(c => c.category === 'digimon' && c.level >= 3);
const colorsOf = (c) => c.colors || [];
const maxCopies = (id) => { try { return S.maxCopiesFor(id) || 4; } catch (e) { return 4; } };
function addCard(main, id, n = 1) { main[id] = Math.min((main[id] || 0) + n, Math.max(1, maxCopies(id))); }
const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
function fill(main, pool, target = 50) { let guard = 0; while (total(main) < target && guard++ < 2000) addCard(main, pick(pool).id); }
function eggsFor(colors, n = 5) {
  const cand = eggPool.filter(c => colorsOf(c).some(x => colors.includes(x)));
  const dig = {}; let g = 0;
  while (total(dig) < n && g++ < 200) { const c = pick(cand.length ? cand : eggPool); dig[c.id] = Math.min((dig[c.id] || 0) + 1, 4); }
  return dig;
}
function genRandom() {
  const main = {}; for (let i = 0; i < 50; i++) addCard(main, pick(mainPool).id);
  return { name: 'random', main, digitama: eggsFor(['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white']) };
}
// evolution-graph walk: build lines seed -> evolutions (canEvolveAny) so decks actually evolve and reach big stacks
function genTheme() {
  const cols = shuffled(['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white']).slice(0, chance(0.35) ? 2 : 1);
  const inCol = (c) => colorsOf(c).some(x => cols.includes(x));
  const pool = mainPool.filter(inCol);
  const digs = pool.filter(c => c.category === 'digimon' && c.level >= 3);
  const traitCount = {}; for (const c of digs) for (const t of c.types || []) traitCount[t] = (traitCount[t] || 0) + 1;
  const trait = pick(Object.keys(traitCount).length ? Object.keys(traitCount) : ['x']);
  const themed = digs.filter(c => (c.types || []).includes(trait));
  const main = {};
  const lvl = (l) => digs.filter(c => c.level === l);
  let cur = pick(themed.length ? themed.filter(c => c.level <= 4).concat(lvl(3)) : lvl(3));
  let guard = 0;
  while (total(main) < 34 && guard++ < 200 && cur) {
    addCard(main, cur.id, 1 + rnd(3));
    const nexts = digs.filter(d => d.level === cur.level + 1 && E.canEvolveAny(cur.id, d.id, [], null).ok);
    const cand = nexts.filter(d => (d.types || []).includes(trait));
    cur = cand.length && chance(0.7) ? pick(cand) : nexts.length ? pick(nexts) : (chance(0.5) ? pick(lvl(3).length ? lvl(3) : digs) : pick(digs));
  }
  const tamers = pool.filter(c => c.category === 'tamer'), opts = pool.filter(c => c.category === 'option');
  for (let i = 0; i < 4 && tamers.length; i++) addCard(main, pick(tamers).id);
  for (let i = 0; i < 6 && opts.length; i++) addCard(main, pick(opts).id);
  fill(main, pool.length ? pool : mainPool);
  return { name: 'theme:' + cols.join('+') + '/' + trait, main, digitama: eggsFor(cols) };
}
const MECH = {
  jogress: /조그레스/, xros: /디지크로스/, burst: /버스트 진화|디지버스트/, app: /어플 합체/, link: /링크/, assembly: /어셈블리/, blast: /블래스트/,
  ace: /ACE|에이스/, tamerUnder: /테이머.*아래|세이브/, security: /【시큐리티】/, option: null, delay: /딜레이/, reveal: /오픈/, training: /트레이닝/,
  digiburst: /디지버스트/, raid: /진격|급습/, decode: /디코드/, fragment: /프래그먼트/, overflow: /오버플로우/, partition: /파티션/, digivolveFree: /코스트를 지불하지 않고 진화/,
};
function genMech(kind) {
  kind = kind || pick(Object.keys(MECH));
  const re = MECH[kind];
  const pool = re ? mainPool.filter(c => re.test(c.effectKo || '') || re.test(c.inheritedKo || '')) : mainPool.filter(c => c.category === 'option');
  const main = {};
  const n = Math.min(30, pool.length);
  const cols = new Set(); const seedC = pool.length ? pick(pool) : pick(mainPool);
  for (const c of colorsOf(seedC)) cols.add(c);
  const same = pool.filter(c => colorsOf(c).some(x => cols.has(x)));
  for (let i = 0; i < n; i++) addCard(main, (chance(0.75) && same.length ? pick(same) : pick(pool.length ? pool : mainPool)).id);
  // backbone of same-colour digimon so things can be played
  const back = mainPool.filter(c => c.category === 'digimon' && colorsOf(c).some(x => cols.has(x)));
  fill(main, back.length ? back : mainPool);
  return { name: 'mech:' + kind, main, digitama: eggsFor([...cols]) };
}
const STARTERS = [...new Set(all.map(c => (c.id.match(/^(ST\d+)-/) || [])[1]).filter(Boolean))];
function genStarter(st) {
  st = st || pick(STARTERS);
  const cs = all.filter(c => c.id.startsWith(st + '-'));
  const main = {}; const eggs = {};
  for (const c of cs) { if (c.category === 'digitama') eggs[c.id] = 4; else if (c.category === 'digimon' && c.level === 2) eggs[c.id] = 2; }
  const body = cs.filter(c => c.category !== 'digitama' && !(c.category === 'digimon' && c.level === 2));
  let g = 0; while (total(main) < 50 && body.length && g++ < 500) addCard(main, pick(body).id, chance(0.5) ? 2 : 1);
  if (!total(eggs)) Object.assign(eggs, eggsFor(colorsOf(cs[0] || {})));
  return { name: st, main, digitama: eggs };
}
function makeDecks(g) {
  const kind = GEN === 'mix' ? ['random', 'theme', 'theme', 'mech', 'mech', 'starter'][g % 6] : GEN;
  const one = () => kind === 'random' ? genRandom() : kind === 'theme' ? genTheme() : kind === 'mech' ? genMech() : genStarter();
  return { kind, a: one(), b: kind === 'mech' && chance(0.5) ? genTheme() : one() };
}

// ---------- findings ----------
const found = {}; // key -> { n, cls, example }
let CURG = null, LASTACT = '', RAN = [], LOGMARK = 0;
function report(cls, key, detail) {
  const k = cls + ': ' + key;
  if (!found[k]) found[k] = { n: 0, cls, ex: null };
  found[k].n++;
  if (!found[k].ex) found[k].ex = { seed: CURG && CURG.seed, gen: CURG && CURG.kind, decks: CURG && CURG.decks, turn: CURG && CURG.state.turnNumber, action: LASTACT, trace: (CURG && CURG.trace || []).slice(-8), ran: RAN.slice(-6), detail, logTail: CURG ? CURG.state.log.slice(0, Math.max(0, CURG.state.log.length - LOGMARK)).slice(0, LOGN).map(e => e.msg).reverse() : [] };
}
function noteErr(where, e) {
  const top = String(e && e.stack).split('\n').slice(1, 3).map(s => s.trim().replace(/^at /, '').replace(/\(?file:\/\/\/.*[\\/]([^\\/]+:\d+):\d+\)?/, '$1')).join(' < ');
  report('EXC', where + ' ' + String(e && e.message).slice(0, 80) + ' @ ' + top, String(e && e.stack).split('\n').slice(0, 5).join(' | '));
}

// ---------- census / conservation ----------
const isTok = (id) => !!(CARDS[id] && CARDS[id].isToken);
const KNOWN_PL = new Set(['hand', 'deck', 'trash', 'security', 'digitamaDeck', 'raising', 'battle', 'deckName', 'art', 'memoryLocks', 'secUp']);
const unknownHolders = new Set();
function stackCards(st, out, zone) {
  if (!isTok(st.cardId)) out.push([st.cardId, zone + ':top', st.foreignCardId === st.cardId ? st.foreignTop : undefined]);
  for (const id of st.sources || []) if (typeof id === 'string' && !isTok(id)) out.push([id, zone + ':src']);
  for (const l of st.linkCards || []) if (l && !isTok(l.cardId)) out.push([l.cardId, zone + ':link']);
}
function census(state) {
  const res = { p1: new Map(), p2: new Map(), where: {} };
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p]; const list = [];
    for (const z of ['hand', 'deck', 'trash', 'security', 'digitamaDeck']) for (const id of pl[z]) if (!isTok(id)) list.push([id, z]);
    if (pl.raising) stackCards(pl.raising, list, 'raising');
    for (const st of pl.battle) stackCards(st, list, 'battle');
    for (const k of Object.keys(pl)) {
      if (KNOWN_PL.has(k)) continue;
      const v = pl[k];
      if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && CARDS[x])) { unknownHolders.add('players.' + k); for (const id of v) if (!isTok(id)) list.push([id, 'X:' + k]); }
    }
    for (const [id, z, own] of list) { const q = own || p; res[q].set(id, (res[q].get(id) || 0) + 1); ((res.where[id] ||= {})[q] ||= []).push(z + (own ? "(foreign)" : "")); }
  }
  for (const k of Object.keys(state)) {
    if (['players', 'log', 'pending', 'fxHistory', 'pendingVanishFlash', 'pendingVanishSrc', 'deletedInfo'].includes(k)) continue;
    const v = state[k];
    if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && CARDS[x])) { unknownHolders.add('state.' + k); for (const id of v) if (!isTok(id)) { (res.where[id] ||= {})['state.' + k] = [k]; res.extra = (res.extra || 0) + 1; } }
  }
  return res;
}
function multisetOf(state) { const c = census(state); return { p1: c.p1, p2: c.p2 }; }
function diffMaps(cur, init) {
  const d = {};
  for (const [id, n] of cur) { const x = n - (init.get(id) || 0); if (x) d[id] = x; }
  for (const [id, n] of init) if (!cur.has(id)) d[id] = -n;
  return d;
}
function checkConservation(g) {
  const st = g.state, c = census(st);
  const d1 = diffMaps(c.p1, g.init.p1), d2 = diffMaps(c.p2, g.init.p2);
  const sig = JSON.stringify([d1, d2, c.extra || 0]);
  if (sig === g.lastConsSig) return;
  g.lastConsSig = sig;
  if (sig === JSON.stringify([{}, {}, 0])) return; // healed
  const ids = new Set([...Object.keys(d1), ...Object.keys(d2)]);
  const cls = new Set();
  for (const id of ids) {
    const a = d1[id] || 0, b = d2[id] || 0;
    if (a < 0 && b > 0 || a > 0 && b < 0) cls.add('WRONG-OWNER');
    else if (a + b < 0) cls.add('LOST');
    else if (a + b > 0) cls.add('DUP/CREATED');
  }
  if (c.extra) cls.add('HELD-IN-STATE-ARRAY');
  const desc = [...ids].slice(0, 4).map(id => `${id}(${(CARDS[id] || {}).nameKo}) p1:${d1[id] || 0} p2:${d2[id] || 0} where=${JSON.stringify(c.where[id] || {})}`).join('; ');
  const trig = [...new Set(RAN)].slice(-3).join(',') || LASTACT.split(' ')[0];
  report('CONSERVATION', [...cls].join('+') + ' | ' + trig + ' | ' + LASTACT.split(' ')[0], desc);
  g.init = { p1: c.p1, p2: c.p2 }; g.lastConsSig = '[{},{},0]'; // re-baseline so one bug reports once, not on every later action
}

// ---------- structural invariants ----------
const nk = (x) => String(x).replace(/s+/g, '');
const KEYWORDS = new Set([...JSON.parse(fs.readFileSync('./data/dgchub_keywords.json', 'utf8')).categories.map(x => nk(x.name)), '시큐리티어택', '급습', 'S어택', '링크+', '아머퍼지']);
const kwSeen = {};
function walkNaN(state, tag) {
  const seen = new WeakSet(); let budget = 30000;
  const walk = (v, path, depth) => {
    if (budget-- <= 0 || depth > 7) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) report('NaN', path.replace(/\d+/g, '#').replace(/uid[^.]*/g, 'uid'), path + '=' + v); return; }
    if (typeof v === 'function') return;
    if (v && typeof v === 'object') {
      if (seen.has(v)) return; seen.add(v);
      for (const k of Object.keys(v)) {
        if (depth === 0 && ['log', 'fxHistory', '_fxRec', 'uiChoice'].includes(k)) continue;
        if (k === 'evtSnap' || k === 'delStack' || k === 'attackCtx') continue;
        const x = v[k];
        if (/(until|expire|expiresAfter|expiry)/i.test(k) && typeof x === 'number' && x < 0) report('EXPIRY', path.replace(/\d+/g, '#') + '.' + k, path + '.' + k + '=' + x);
        walk(x, path + '.' + k, depth + 1);
      }
    }
  };
  walk(state, 'state', 0);
}
function structural(g, tag) {
  const state = g.state;
  if (!Number.isFinite(state.memory) || state.memory < -10 || state.memory > 10) report('MEMORY', 'range ' + state.memory, 'memory=' + state.memory);
  const seen = new Set(); const objs = new Set();
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const z of ['hand', 'deck', 'trash', 'security', 'digitamaDeck']) {
      if (!Array.isArray(pl[z])) { report('STRUCT', 'zone not array ' + z, z); continue; }
      for (const id of pl[z]) if (!CARDS[id]) report('STRUCT', 'unknown card in ' + z, String(id));
    }
    if (pl.secUp) for (const [id, n] of Object.entries(pl.secUp)) if (!(n >= 0)) report('STRUCT', 'secUp negative/NaN', id + '=' + n);
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) {
      if (objs.has(st)) report('STRUCT', 'same stack object twice', st.cardId); objs.add(st);
      if (seen.has(st.uid)) report('STRUCT', 'duplicate stack uid', st.uid); seen.add(st.uid);
      if (!CARDS[st.cardId]) report('STRUCT', 'unknown stack card', String(st.cardId));
      if (!Array.isArray(st.sources)) { report('STRUCT', 'sources not array', st.cardId); continue; }
      for (const id of st.sources) { if (typeof id !== 'string') report('STRUCT', 'source not string', typeof id); else if (!CARDS[id]) report('STRUCT', 'unknown source card', id); }
      for (const l of st.linkCards || []) if (!l || !CARDS[l.cardId]) report('STRUCT', 'bad link card', JSON.stringify(l));
      if (typeof st.suspended !== 'boolean') report('STRUCT', 'suspended not boolean', st.cardId + ':' + st.suspended);
      if (st.suspended && st === pl.raising && false) report('STRUCT', 'raising suspended', st.cardId);
      if (!st.keywords || !st.inheritedKeywords || !Number.isFinite(st.tempDP)) report('STRUCT', 'malformed stack', st.cardId);
      for (const m of [st.keywords, st.inheritedKeywords]) for (const [k, v] of Object.entries(m || {})) {
        if (!KEYWORDS.has(nk(k))) { (kwSeen[k] ||= []).push(st.cardId); }
        if (!(v === 'permanent' || v === true || (typeof v === 'number' && Number.isFinite(v)) || v === 1 || Array.isArray(v))) report('STRUCT', 'keyword value odd ' + k, JSON.stringify(v));
      }
      if (Number.isNaN(st.inheritedDP) || Number.isNaN(st.attackEligibleTurn)) report('NaN', 'stack dp/eligible', st.cardId);
      try { const dp = S.effectiveDP(state, p, st); if (!Number.isFinite(dp)) report('NaN', 'effectiveDP', st.cardId + '=' + dp); } catch (e) { noteErr('effectiveDP', e); }
    }
  }
  const un = state.pending.filter(t => !t.resolved).length;
  if (un > 500) report('PENDING', 'unresolved > 500', String(un));
  if (state.pending.length > 3000) report('PENDING', 'array > 3000 (resolved never removed)', String(state.pending.length));
  if (state.winner && !['p1', 'p2'].includes(state.winner)) report('WINNER', 'invalid winner value', String(state.winner));
  walkNaN(state, tag);
  // new log lines
  const L = state.log; const fresh = L.length - LOGMARK;
  const bump = fresh > 0 && L.length < 300 ? fresh : (L.length >= 300 ? 60 : 0); // log is capped at 300 -> look at head only
  for (let i = 0; i < Math.min(bump, L.length); i++) {
    const m = String(L[i].msg);
    if (/undefined|NaN|\[object|null\b/.test(m)) { const mm = m.match(/.{0,18}(undefined|NaN|\[object Object\]|\bnull\b).{0,12}/); report('LOG', (mm ? mm[0] : m).replace(/\d+/g, '#').replace(/\b(p1|p2)\b/g, 'P'), m); }
  }
  LOGMARK = L.length >= 300 ? 300 : L.length;
}

// ---------- realistic chooser (respects required / n like the UI) ----------
function makeChoose(g, self) {
  const st = g.state;
  const cancelP = 0.18;
  return async (kind, o) => {
    o = o || {};
    switch (kind) {
      case 'pickStack': { const u = o.uids || []; if (!u.length) return null; if (!o.required && chance(cancelP)) return null; return pick(u); }
      case 'pickStackAnySide': { const e = o.entries || []; if (!e.length) return null; if (!o.required && chance(cancelP)) return null; const x = pick(e); return { player: x.player, uid: x.uid }; }
      case 'pickFromHand': { const h = st.players[o.player || self].hand; if (!h.length || (!o.required && chance(cancelP))) return null; return pick(h); }
      case 'pickFromZoneIndex': { const el = o.eligibleIdxs || []; if (!el.length || (!o.required && chance(cancelP))) return null; return pick(el); }
      case 'pickFromHandIndexes': { const el = shuffled(o.eligibleIdxs || []); const n = Math.min(o.n || 1, el.length); return el.slice(0, chance(0.1) ? 0 : n); }
      case 'pickFromRevealed': {
        const el = shuffled(o.eligible || []); const min = Math.min(o.min || 0, el.length); const max = Math.min(o.max ?? 1, el.length);
        let k = min + rnd(Math.max(0, max - min) + 1); if (o.required && el.length && k < 1) k = 1;
        return el.slice(0, k).map(x => x.i);
      }
      case 'pickSourcesMulti': { const n = Math.min(o.n || 1, (o.ids || []).length); return shuffled((o.ids || []).map((_, i) => i)).slice(0, n).sort((a, b) => a - b); }
      case 'pickLinkCard': return rnd((o.ids || [1]).length);
      case 'orderCards': return shuffled((o.ids || []).map((_, i) => i));
      case 'confirmEffect': return chance(0.7);
      case 'multipleChoice': { const n = (o.options || []).length; return n ? (chance(0.12) ? n - 1 : rnd(n)) : null; }
      case 'pickPendingOrder': return (o.items && o.items.length) ? pick(o.items).uid : null;
      default: RAN.push('?choose:' + kind); return null;
    }
  };
}

// ---------- pending resolution (mirrors main.js runPendingScript's gating, without UI) ----------
async function drainPending(g, ceiling = 250) {
  const state = g.state; let guard = 0;
  while (guard++ < ceiling) {
    const t = state.pending.find(x => !x.resolved);
    if (!t) return;
    const age = (g.pendAge[t.uid] ??= g.actions);
    if (g.actions - age > 40) { report('PENDING', 'unresolved for >40 actions ' + t.cardId, t.cardId + ' ' + (t.tags || []).join(',')); S.resolvePending(state, t.uid); continue; }
    RAN.push(t.cardId + '::' + (t.tags || [])[0]);
    try {
      if (t.schedFn) { await t.schedFn(); S.resolvePending(state, t.uid); continue; }
      if (t.manualOnly) { S.resolvePending(state, t.uid); continue; }
      if (t.stackUid && t.topId && !(t.evt && t.evt.leaving) && !(t.tags || []).some(x => x.includes('소멸 시'))) {
        const pl = state.players[t.player]; const stNow = pl.raising?.uid === t.stackUid ? pl.raising : pl.battle.find(s => s.uid === t.stackUid);
        if (!stNow || stNow.cardId !== t.topId) { S.resolvePending(state, t.uid); continue; }
      }
      const specific = Fx.lookupCardSpecific(t.cardId, t.tags, t.text);
      const script = specific || Fx.compileToScript(t.text);
      const ctx = { state, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack: (pp, uid, dt, ao) => { (g.attackQueue ||= []).push({ p: pp, uid, dt, ao }); }, attack: () => state.attackCtx || null, endAttack: () => { if (state.attackCtx && state.attackCtx.terminate) state.attackCtx.terminate(); }, choose: makeChoose(g, t.player) };
      await Fx.runScript(script, ctx);
    } catch (e) { noteErr('pending ' + t.cardId, e); }
    S.resolvePending(state, t.uid);
  }
  report('PENDING', 'drain ceiling hit (possible infinite trigger chain)', RAN.slice(-4).join(','));
  for (const t of state.pending) t.resolved = true;
}
async function flushAttacks(g) {
  let n = 0;
  while (g.attackQueue && g.attackQueue.length && n++ < 6 && !g.state.winner) { const a = g.attackQueue.shift(); if (a.p !== g.state.activePlayer) continue; RAN.push('queuedAttack'); try { await doAttack(g, a.p, a.uid, a.dt, a.ao); } catch (e) { noteErr('queuedAttack', e); } await drainPending(g); }
  g.attackQueue = [];
}
async function finishTurn(g) {
  const state = g.state; let guard = 0;
  while (state.turnEnding && !state.winner && guard++ < 12) { await drainPending(g); E.settleTurnEnd(state); }
  if (state.turnEnding && !state.winner) report('TURN', 'turn end never settles', '');
}

// ---------- action helpers (mirror main.js) ----------
const cardOf = (id) => S.card(id);
const stacksOf = (pl) => [pl.raising, ...pl.battle].filter(Boolean);
function eligibleBlockers(state, p, colliding) {
  return state.players[p].battle.filter(s => cardOf(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(state, p, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, p, s) && (colliding || S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(state, p, s).includes('블로커')));
}
function tryPlay(g, p) {
  const st = g.state, pl = st.players[p];
  const idxs = pl.hand.map((_, i) => i).filter(i => ['digimon', 'tamer'].includes(cardOf(pl.hand[i]).category));
  if (!idxs.length) return null;
  const i = pick(idxs), id = pl.hand[i], c = cardOf(id);
  if (c.category === 'digimon' && S.isPlayRestricted(st, p, id)) return 'play-restricted';
  let discount = c.category === 'digimon' ? S.tamerPlayCostDiscount(st, p, id) + S.traitPlayCostDiscount(st, p, id) : 0;
  let materials = [], restTamers = [], assembly = [];
  if (c.category === 'digimon') {
    const xo = S.digiXrosOptions(st, p, i);
    if (xo.length && chance(0.7)) { const keys = new Set(xo.filter(() => chance(0.6)).map(o => o.key)); if (!keys.size) keys.add(xo[0].key); const xr = S.planDigiXrosPicked(st, p, i, keys); if (xr) { materials = xr.materials; discount -= xr.discount; restTamers = xr.restTamers || []; } }
    const ap = S.planAssembly(st, p, i);
    if (ap && chance(0.7)) { assembly = ap.materials; discount -= ap.discount; }
    discount += S.s1PlayDiscount(st, p, id) + S.handSelfPlayDiscount(st, p, id);
    if (discount < 0 && S.isPlayCostLocked(st)) discount = 0;
  }
  const cost = Math.max(0, (c.cost || 0) + discount);
  if (!S.canPayCost(st, cost)) return 'cant-pay';
  if (cost > 0) S.spendMemory(st, cost);
  S.playDigimonFresh(st, p, i, { materials, restTamers, assembly });
  return (c.category === 'digimon' ? 'play' : 'playTamer') + (materials.length ? '+xros' : '') + (assembly.length ? '+asm' : '') + ' ' + id;
}
function tryOption(g, p) {
  const st = g.state, pl = st.players[p];
  const idxs = pl.hand.map((_, i) => i).filter(i => cardOf(pl.hand[i]).category === 'option');
  if (!idxs.length) return null;
  const i = pick(idxs); const id = pl.hand[i];
  const r = S.useOptionCard(st, p, i, { costDelta: 0 });
  return 'option ' + id;
}
function tryEvolve(g, p) {
  const st = g.state, pl = st.players[p];
  const targets = stacksOf(pl).filter(s => ['digimon', 'digitama', 'tamer'].includes(cardOf(s.cardId).category));
  if (!targets.length) return null;
  const stack = pick(targets);
  const hand = shuffled(pl.hand.map((id, i) => i).filter(i => cardOf(pl.hand[i]).category === 'digimon'));
  for (const hi of hand.slice(0, 6)) {
    const id = pl.hand[hi];
    const restr = S.evolveTargetRestriction(st, p, stack);
    const methods = E.evolutionMethods(stack.cardId, id, S.evoExtraArg(st, p, stack), restr, { state: st, p, stack });
    if (!methods.length) continue;
    const m = pick(methods);
    const mDelta = S.consumeEvoCostMod(st, p, id) + S.continuousEvoCostDiscount(st, p, stack, id) + S.hookEvoCostDiscount(st, p, stack, id);
    const cost = Math.max(0, m.baseCost + mDelta);
    if (m.kind === 'burst' || m.kind === 'app') {
      const snap = S.snapshotEvoCostMods(st, p);
      const res = m.kind === 'burst' ? S.burstEvolve(st, p, stack.uid, id, cost, (m.tamerUids || [])[0] || null) : S.appFusion(st, p, stack.uid, id, cost);
      if (!res) S.restoreEvoCostMods(snap);
      return m.kind + ' ' + id + (res ? '' : ' (rejected)');
    }
    if (m.id === 'tamer10') continue;
    const snap = S.snapshotEvoCostMods(st, p);
    let extra = 0;
    const absorb = S.absorbEvolveOption(st, p, stack, id);
    if (absorb && absorb.candidates && absorb.candidates.length && chance(0.5)) { S.restStack(st, p, pick(absorb.candidates)); extra += absorb.delta; }
    if (!S.digivolve(st, p, stack.uid, id, Math.max(0, cost + extra), 'hand')) S.restoreEvoCostMods(snap);
    return 'evolve ' + stack.cardId + '->' + id;
  }
  return null;
}
function tryJogress(g, p) {
  const st = g.state, pl = st.players[p];
  const hand = shuffled(pl.hand.map((id, i) => id).filter(id => cardOf(id).category === 'digimon' && S.parseJogress(id)));
  const bat = pl.battle.filter(s => cardOf(s.cardId).category === 'digimon');
  if (!hand.length || bat.length < 2) return null;
  for (const id of hand.slice(0, 3)) {
    for (const a of shuffled(bat)) for (const b of shuffled(bat)) {
      if (a === b) continue;
      const jr = S.canJogress(a, b, id);
      if (!jr.ok) continue;
      if ([a, b].some(s => !E.evoRestrictionCheck(id, S.evolveTargetRestriction(st, p, s)).ok)) continue;
      const snap = S.snapshotEvoCostMods(st, p);
      let jcost = jr.cost != null ? jr.cost : 0;
      if (jr.cost != null) jcost = Math.max(0, jcost + S.consumeEvoCostMod(st, p, id) + S.continuousEvoCostDiscount(st, p, b, id) + S.hookEvoCostDiscount(st, p, b, id));
      const res = S.fuseStacks(st, p, a.uid, b.uid, id, jcost, 'hand');
      if (!res) S.restoreEvoCostMods(snap);
      return 'jogress ' + id + (res ? '' : ' (rejected)');
    }
  }
  return null;
}
async function tryLink(g, p) {
  const st = g.state, pl = st.players[p];
  const bat = pl.battle.filter(s => cardOf(s.cardId).category === 'digimon');
  if (!bat.length) return null;
  const host = pick(bat);
  if (chance(0.3)) { // battle -> battle link
    const srcs = pl.battle.filter(s => s !== host && S.linkCheck(st, p, host, s.cardId).ok);
    if (srcs.length) { const s = pick(srcs); const lk = S.linkCheck(st, p, host, s.cardId); S.linkFromBattle(st, p, s.uid, host.uid, Math.max(0, lk.cost + S.s7LinkCostDelta(st, p, host, s.cardId))); return 'linkFromBattle ' + s.cardId; }
  }
  const hs = shuffled(pl.hand.filter(id => cardOf(id).category !== 'option'));
  for (const id of hs.slice(0, 8)) {
    const lk = S.linkCheck(st, p, host, id);
    if (!lk.ok) continue;
    const cost = Math.max(0, lk.cost + S.s7LinkCostDelta(st, p, host, id));
    const dIdx = await S.linkDiscardIdx(st, p, host.uid, makeChoose(g, p));
    S.linkCardTo(st, p, host.uid, id, id, cost, 'hand', dIdx);
    return 'link ' + id;
  }
  return null;
}
async function tryAbility(g, p) {
  const st = g.state, pl = st.players[p];
  if (chance(0.3)) { // [패]/[트래시]【메인】 (zoneMainAbilities)
    const abs = [...S.zoneMainAbilities(st, p, 'hand').map(x => ({ ...x, zone: 'hand' })), ...S.zoneMainAbilities(st, p, 'trash').map(x => ({ ...x, zone: 'trash' }))];
    if (abs.length) { const x = pick(abs); st.pending.push({ uid: 'fzm' + Math.random().toString(36).slice(2), player: p, cardId: x.cardId, stackUid: null, tags: x.tags, text: x.text, resolved: false, zoneMain: x.zone, zoneIdx: x.idx }); return 'zoneMain ' + x.cardId; }
  }
  const stack = pick(stacksOf(pl));
  if (!stack) return null;
  const r = Math.random();
  const zone = pl.raising === stack ? 'raising' : 'battle';
  if (r < 0.25 && S.hasKeyword(stack, '트레이닝') && !stack.suspended && pl.deck.length) { S.useTraining(st, p, stack.uid); return 'training'; }
  if (r < 0.5) { const bodyD = S.parseDelayEffect(cardOf(stack.cardId).effectKo); if (bodyD && st.turnNumber > stack.placedTurn) { const cid = S.discardForDelay(st, p, stack.uid); if (cid) st.pending.push({ uid: 'fz' + Math.random().toString(36).slice(2), player: p, cardId: cid, stackUid: null, tags: ['메인'], text: bodyD, resolved: false }); return 'delay ' + cid; } }
  const ab = S.activatableMainAbilities(st, p, stack, zone);
  if (!ab.length) return null;
  const a = pick(ab);
  let ok = true; try { ok = Fx.mainAbilityPayable(st, S, p, stack.uid, a.cardId, a.tags, a.text); } catch (e) { noteErr('mainAbilityPayable', e); ok = false; }
  if (!ok) return null;
  st.pending.push({ uid: 'fm' + Math.random().toString(36).slice(2), player: p, cardId: a.cardId, stackUid: stack.uid, tags: a.tags, text: a.text, resolved: false });
  return 'main ' + a.cardId;
}
async function doAttack(g, p, forcedUid, directTarget, atkOpts) {
  const st = g.state, pl = st.players[p], opp = S.opponentOf(p);
  const atts = pl.battle.filter(s => !s.suspended && cardOf(s.cardId).category === 'digimon');
  const att = forcedUid ? pl.battle.find(s => s.uid === forcedUid) : (atts.length ? pick(atts) : null);
  if (!att) return null;
  const dec = S.declareAttack(st, p, att.uid, atkOpts || {});
  if (!dec.ok) return 'attack-rejected';
  const uid = att.uid;
  if (atkOpts && atkOpts.anyActive) dec.stack.anyActiveOnce = true;
  const targets = S.legalDigimonTargets(st, p, uid);
  if (dec.stack.anyActiveOnce) delete dec.stack.anyActiveOnce;
  const canPlayer = !(atkOpts && atkOpts.digimonOnly) && S.canAttackPlayer(st, p, uid);
  const pa = { attacker: p, uid, dp: S.effectiveDP(st, p, dec.stack), opp, digimonTargets: targets, canHitPlayer: canPlayer, attackerCardId: dec.stack.cardId, targetKind: null, targetUid: null, stage: 'targetChoice', counterUsed: false };
  pa.terminate = () => { pa.ended = true; };
  st.attackCtx = pa;
  const ended = () => pa.ended || !S.findStackByUid && false;
  const find = (pp, u) => { const q = st.players[pp]; return q.raising?.uid === u ? q.raising : q.battle.find(s => s.uid === u); };
  try {
    if (directTarget === 'PLAYER' && canPlayer) pa.targetKind = 'player'; else if (directTarget && targets.includes(directTarget)) { pa.targetKind = 'digimon'; pa.targetUid = directTarget; } else if (targets.length && (!canPlayer || chance(0.4))) { pa.targetKind = 'digimon'; pa.targetUid = pick(targets); } else if (canPlayer) pa.targetKind = 'player'; else { st.attackCtx = null; return 'attack-no-target'; }
    const aSt = find(p, uid);
    S.queueTriggersForStack(st, p, aSt, 'attack'); S.emitGameEvent(st, 'attack', { owner: p, stack: aSt, cause: null });
    await drainPending(g);
    if (pa.targetKind === 'digimon') { const d0 = find(opp, pa.targetUid); if (aSt && d0) S.emitGameEvent(st, 'attackOnDigimon', { owner: p, stack: aSt, cause: null, target: d0 }); await drainPending(g); }
    if (st.winner || pa.ended || !find(p, uid)) return 'attack (fizzled)';
    // counter timing
    const counters = S.findCounterOptions(st, opp);
    if (counters.length && chance(0.5)) {
      const opt = pick(counters);
      const r = S.activateCounter(st, opp, opt, pa);
      if (r.ok) { st.pending.push({ uid: 'ct' + Math.random().toString(36).slice(2), player: opp, cardId: opt.cardId, stackUid: opt.stackUid, tags: opt.tags, text: opt.body, resolved: false }); await drainPending(g); }
    }
    if (st.winner || pa.ended) return 'attack (ended by effect)';
    const aNow = find(p, uid);
    if (!aNow || (pa.targetKind === 'digimon' && !find(opp, pa.targetUid))) return 'attack (target gone)';
    // block timing
    const colliding = S.hasKeyword(aNow, '충돌') || S.hasContinuousKeyword(st, p, aNow, '충돌');
    const blockers = eligibleBlockers(st, opp, colliding).filter(s => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(st, p, uid, s));
    if (blockers.length && (colliding || chance(0.6))) {
      const b = pick(blockers);
      S.restStack(st, opp, b.uid, 'block');
      pa.targetKind = 'digimon'; pa.targetUid = b.uid;
      S.emitGameEvent(st, 'redirect', { owner: p, stack: aNow, cause: null, targetUid: b.uid });
      S.emitGameEvent(st, 'blocked', { owner: p, stack: aNow, blocker: b, cause: null });
      await drainPending(g);
    }
    if (st.winner || pa.ended) return 'attack (ended)';
    if (!find(p, uid) || (pa.targetKind === 'digimon' && !find(opp, pa.targetUid))) return 'attack (target gone 2)';
    const runSec = async () => {
      const ctl = S.beginSecurityCheck(st, p, uid, opp); ctl.deferBattle = true;
      let n = 0;
      while (!ctl.done && n++ < 30 && !st.winner) {
        if (ctl.awaiting) { await drainPending(g); if (st.winner) break; S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
        await drainPending(g);
      }
      if (n >= 30) report('LOOP', 'security check never finishes', '');
      if (!ctl.gameOver && ctl.results.length) { const last = ctl.results[ctl.results.length - 1]; if (last && (last.result === 'defenderWins' || last.result === 'tie') && find(p, uid)) S.deleteStack(st, p, uid, 'trash', 'battle'); }
      if (ctl.gameOver && st.winner !== p) report('WINNER', 'security gameOver but winner != attacker', String(st.winner));
    };
    if (pa.targetKind === 'player') await runSec();
    else {
      const res = S.resolveDigimonBattle(st, p, uid, pa.targetUid);
      await drainPending(g);
      if (res && res.piercing && !st.winner) { pa.targetKind = 'player'; await runSec(); }
    }
    return 'attack ' + pa.targetKind;
  } finally {
    if (st.attackCtx === pa) st.attackCtx = null;
    try { const s2 = find(p, uid); if (s2) { S.s8AttackEnded(st, p, uid); S.queueTriggersForStack(st, p, s2, 'attackEnd'); S.emitGameEvent(st, 'attackEnd', { owner: p, stack: s2, cause: null }); } } catch (e) { noteErr('attackEnd', e); }
  }
}
function breeding(g, p) {
  const st = g.state, pl = st.players[p];
  if (!pl.raising && pl.digitamaDeck.length && chance(0.9)) return S.hatchDigitama(st, p), 'hatch';
  if (pl.raising && chance(0.55)) return S.moveRaisingToBattle(st, p), 'move';
  return null;
}

// ---------- game loop ----------
const ACTIONS = [
  ['play', 0.22, tryPlay], ['option', 0.10, tryOption], ['evolve', 0.25, tryEvolve], ['jogress', 0.05, tryJogress], ['link', 0.06, tryLink],
  ['ability', 0.08, tryAbility], ['attack', 0.24, doAttack],
];
function chooseAction() { let r = Math.random() * ACTIONS.reduce((a, x) => a + x[1], 0); for (const x of ACTIONS) { if ((r -= x[1]) < 0) return x; } return ACTIONS[0]; }
const gstat = { games: 0, turns: 0, actions: 0, wins: 0, maxTurn: 0, byKind: {}, actionKinds: {}, deepGames: 0 };

async function playGame(gi) {
  const seed = BASE_SEED + gi * 7919;
  seedRng(seed);
  const { kind, a, b } = makeDecks(gi);
  let state;
  try { state = S.newGame(a, b); } catch (e) { report('EXC', 'newGame ' + e.message, e.stack); return; }
  const g = { state, seed, kind, decks: [a.name, b.name], actions: 0, pendAge: {}, lastConsSig: '[{},{},0]' };
  CURG = g; RAN = []; LASTACT = 'setup'; LOGMARK = state.log.length;
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2'); E.setSecurityStacks(state); E.beginGame(state, E.coinFlip());
  } catch (e) { noteErr('setup', e); return; }
  // initial multiset = everything each player owns right now
  g.init = multisetOf(state);
  gstat.games++; gstat.byKind[kind] = (gstat.byKind[kind] || 0) + 1;
  let stall = 0, lastTurn = -1;
  for (let t = 0; t < MAX_TURNS * 3 && !state.winner; t++) {
    gstat.turns++;
    if (state.turnNumber === lastTurn) { if (++stall > 6) { report('TURN', 'turn number does not progress (same-turn loop)', 'turn ' + state.turnNumber + ' phase ' + state.phase); break; } } else { stall = 0; lastTurn = state.turnNumber; }
    if (state.turnNumber > MAX_TURNS) break;
    try {
      let g2 = 0;
      while (state.phase !== 'main' && !state.winner && g2++ < 14) { LASTACT = 'phase ' + state.phase; E.nextPhase(state); await drainPending(g); post(g); }
      if (state.winner) break;
      if (state.phase !== 'main') { report('TURN', 'cannot reach main phase from ' + state.phase, ''); break; }
      const p = state.activePlayer, pl = state.players[p];
      LASTACT = 'breeding'; try { const r = breeding(g, p); if (r) LASTACT = r; } catch (e) { noteErr('breeding', e); }
      await drainPending(g); post(g);
      let n = 0;
      for (; n < 30 && !state.winner && state.activePlayer === p && state.phase === 'main'; n++) {
        g.actions++; gstat.actions++;
        const [name, , fn] = chooseAction();
        RAN = [];
        LASTACT = name;
        const before = state.log.length;
        try {
          const r = await fn(g, p);
          if (r) { LASTACT = String(r); const k = String(r).split(' ')[0].replace(/\+.*/, ''); gstat.actionKinds[k] = (gstat.actionKinds[k] || 0) + 1; }
        } catch (e) { noteErr(name + ' [' + LASTACT + ']', e); }
        (g.trace ||= []).push(p + ':' + LASTACT); if (g.trace.length > 12) g.trace.shift();
        try { await drainPending(g); await flushAttacks(g); } catch (e) { noteErr('drain', e); }
        post(g);
        try { if (E.checkAutoEndTurn(state)) { await finishTurn(g); post(g); break; } } catch (e) { noteErr('autoEnd', e); break; }
      }
      if (!state.winner && state.activePlayer === p && state.phase === 'main') { LASTACT = 'endTurn'; try { E.endTurn(state, false); await finishTurn(g); } catch (e) { noteErr('endTurn', e); break; } post(g); }
    } catch (e) { noteErr('turn', e); break; }
  }
  gstat.maxTurn = Math.max(gstat.maxTurn, state.turnNumber);
  if (state.turnNumber >= 8) gstat.deepGames++;
  if (state.winner) { gstat.wins++; winnerCheck(g); }
}
function winnerCheck(g) {
  const st = g.state; const w = st.winner, l = S.opponentOf(w);
  const recent = st.log.slice(0, Math.max(12, LOGN)).map(e => e.msg).join(' | ');
  const ok = /승리|패배|투항|덱아웃/.test(recent);
  if (!ok) report('WINNER', 'winner set without a logged win/lose reason', recent.slice(0, LOGN > 12 ? 5000 : 160));
  const sec0 = st.players[l].security.length === 0, deck0 = st.players[l].deck.length === 0;
  if (!sec0 && !deck0 && !/투항|승리!/.test(recent)) report('WINNER', 'winner set but loser has security and deck', recent.slice(0, 160));
}
function post(g) {
  RAN = RAN.slice(-12);
  if (SELFTEST && g.actions === 6 && !g.selfDone) { g.selfDone = true; const pl = g.state.players.p1; pl.hand.pop(); pl.trash.push(pl.deck[0]); g.state.players.p2.hand.push(g.state.players.p1.deck.pop()); LASTACT = 'SELFTEST'; }
  try { checkConservation(g); } catch (e) { noteErr('checkConservation', e); }
  try { structural(g, ''); } catch (e) { noteErr('structural', e); }
}

// ---------- main ----------
console.log(`fuzz: games=${G} gen=${GEN} seed=${BASE_SEED} maxTurns=${MAX_TURNS}`);
for (let gi = 0; gi < G; gi++) {
  if (MAX_MIN && (Date.now() - T0) / 60000 > MAX_MIN) { console.log('time box reached after', gi, 'games'); break; }
  if (VERBOSE) console.log('game', gi, 'seed', BASE_SEED + gi * 7919);
  await playGame(gi);
}
if (Object.keys(kwSeen).length) console.log('info: non-catalogued keyword-map keys (engine flags):', Object.keys(kwSeen).join(','));
const keys = Object.keys(found).sort((a, b) => found[b].n - found[a].n);
console.log(`\ngames ${gstat.games} turns ${gstat.turns} actions ${gstat.actions} wins ${gstat.wins} maxTurn ${gstat.maxTurn} games>=turn8 ${gstat.deepGames} kinds ${JSON.stringify(gstat.byKind)}`);
console.log('action kinds:', JSON.stringify(gstat.actionKinds));
if (unknownHolders.size) console.log('extra card-id holders seen:', [...unknownHolders].join(','));
console.log('distinct findings:', keys.length, `(${((Date.now() - T0) / 1000).toFixed(0)}s)`);
for (const k of keys.slice(0, 60)) {
  const f = found[k], e = f.ex;
  console.log(`\n[${f.n}x] ${k}\n   seed=${e.seed} gen=${e.gen} decks=${(e.decks || []).join(' vs ')} turn=${e.turn} action="${e.action}" ran=${e.ran.join(',')}\n   ${String(e.detail).slice(0, 400)}\n   trace: ${(e.trace||[]).join(" > ")}
   log: ${e.logTail.slice(-(LOGN > 8 ? LOGN : 5)).join(' / ').slice(0, LOGN > 8 ? 6000 : 400)}`);
}
if (JSON_OUT) fs.writeFileSync(String(JSON_OUT), JSON.stringify({ gstat, found }, null, 1));
process.exit(keys.length ? 1 : 0);
