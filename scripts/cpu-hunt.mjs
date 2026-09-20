// CPU-vs-CPU mass bug hunt (headless).  Plays full games with the src/cpu.js decision layer controlling BOTH seats through the real
// engine (state.js/engine.js/effects.js via src/cpusim.js) and runs detectors after every action:
//   EXC (exceptions), CONS (card conservation), NAN/LOG (bad numbers/text), MEM (memory range/turn-end), STALL (livelock / turn cap),
//   REPEAT (same CPU action repeated), REJECT (CPU action had no effect), PEND (pending never resolves), SUSP (suspicious outcomes),
//   DP0 (digimon DP<=0 alive), MANUAL (effects that fell back to a manual/no-script pending).
// Also collects per-card exposure (top / source / hand / trigger) -> blind-spot list.
//
// Usage: node scripts/cpu-hunt.mjs --mode starters|focus|theme|mech|random|mix [--minutes 8] [--seed N] [--shard i/n] [--games N]
//          [--levels easy,normal,hard,hard4] [--per 2] [--out file.json] [--from IDX] < /dev/null
// Replay one game: node scripts/cpu-hunt.mjs --spec '<json spec printed in a finding>' --verbose < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
import * as Cpu from '../src/cpu.js';
import * as CpuSearch from '../src/cpusearch.js';
import { createSim } from '../src/cpusim.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]) : d; };
const MODE = String(flag('mode', 'mix'));
const MINUTES = Number(flag('minutes', 8));
const BASE_SEED = Number(flag('seed', 1));
const [SH_I, SH_N] = String(flag('shard', '0/1')).split('/').map(Number);
const MAXG = Number(flag('games', 1e9));
const PER = Number(flag('per', 2));
const LEVELS = String(flag('levels', 'easy,normal,hard,hard4')).split(',');
const OUT = flag('out', null);
const FROM = Number(flag('from', 0));
const VERBOSE = !!flag('verbose', false);
const SPEC = flag('spec', null);
const TURN_CAP = Number(flag('turncap', 80));
const GAME_MS = Number(flag('gamems', 60000));
const NODES = Number(flag('nodes', 30));
const T0 = Date.now();
const SOPTS = { budgetMs: 1e9, hardCapMs: 1e9, maxNodes: NODES, depth: 3, samples: 1, sliceMs: 1e9 };

// ---------- seeded rng ----------
let RS = 1;
function seedRng(s) { RS = (s >>> 0) || 1; }
Math.random = function () { RS = (RS + 0x6D2B79F5) >>> 0; let t = RS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Cpu.setRng(() => Math.random());
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const chance = (p) => Math.random() < p;
const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- decks ----------
const CARDS = S.CARDS;
const all = Object.values(CARDS).filter((c) => !c.isToken);
const cardOf = (id) => S.card(id);
const isEgg = (c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2);
const mainPool = all.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category) && !isEgg(c));
const eggPool = all.filter(isEgg);
const colorsOf = (c) => c.colors || [];
const maxCopies = (id) => { try { return S.maxCopiesFor(id) || 4; } catch (e) { return 4; } };
const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
function addCard(m, id, n = 1) { const lim = Math.max(1, maxCopies(id)); const cur = m[id] || 0; if (cur >= lim) return 0; m[id] = Math.min(cur + n, lim); return m[id] - cur; }
function fill(main, pool, target = 50) { let g = 0; while (total(main) < target && g++ < 3000) addCard(main, pick(pool).id); }
function eggsFor(colors, n = 5, prefer = []) {
  const cand = eggPool.filter((c) => colorsOf(c).some((x) => colors.includes(x)));
  const dig = {}; for (const id of prefer) if (total(dig) < n) addCard(dig, id, 2);
  let g = 0; while (total(dig) < n && g++ < 300) { const c = pick(cand.length ? cand : eggPool); addCard(dig, c.id); }
  return dig;
}
function genRandom() {
  const main = {}; for (let i = 0; i < 50; i++) addCard(main, pick(mainPool).id);
  fill(main, mainPool);
  return { name: 'random', main, digitama: eggsFor(['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white']) };
}
const COLS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
function genTheme() {
  const cols = shuffled(COLS).slice(0, chance(0.35) ? 2 : 1);
  const inCol = (c) => colorsOf(c).length && colorsOf(c).every((x) => cols.includes(x));
  const pool = mainPool.filter(inCol);
  const digs = pool.filter((c) => c.category === 'digimon' && c.level >= 3);
  if (!digs.length) return genRandom();
  const tc = {}; for (const c of digs) for (const t of c.types || []) tc[t] = (tc[t] || 0) + 1;
  const trait = pick(Object.keys(tc).length ? Object.keys(tc) : ['x']);
  const themed = digs.filter((c) => (c.types || []).includes(trait));
  const main = {}; const lvl = (l) => digs.filter((c) => c.level === l);
  let cur = pick(themed.length ? themed.filter((c) => c.level <= 4).concat(lvl(3)) : lvl(3));
  let g = 0;
  while (total(main) < 34 && g++ < 200 && cur) {
    addCard(main, cur.id, 1 + rnd(3));
    const nexts = digs.filter((d) => d.level === cur.level + 1 && E.canEvolveAny(cur.id, d.id, [], null).ok);
    const cand = nexts.filter((d) => (d.types || []).includes(trait));
    cur = cand.length && chance(0.7) ? pick(cand) : nexts.length ? pick(nexts) : pick(lvl(3).length ? lvl(3) : digs);
  }
  const tamers = pool.filter((c) => c.category === 'tamer'), opts = pool.filter((c) => c.category === 'option');
  for (let i = 0; i < 4 && tamers.length; i++) addCard(main, pick(tamers).id);
  for (let i = 0; i < 6 && opts.length; i++) addCard(main, pick(opts).id);
  fill(main, pool);
  return { name: 'theme:' + cols.join('+') + '/' + trait, main, digitama: eggsFor(cols) };
}
const MECH = { jogress: /조그레스/, xros: /디지크로스/, burst: /버스트 진화|디지버스트/, app: /어플 합체/, link: /링크/, assembly: /어셈블리/, blast: /블래스트/, ace: /ACE|에이스/, tamerUnder: /테이머.*아래|세이브/, security: /【시큐리티】/, delay: /딜레이/, reveal: /오픈/, training: /트레이닝/, raid: /진격|급습/, decode: /디코드/, fragment: /프래그먼트/, overflow: /오버플로우/, partition: /파티션/, free: /코스트를 지불하지 않고/ };
function genMech() {
  const kind = pick(Object.keys(MECH)); const re = MECH[kind];
  const pool = mainPool.filter((c) => re.test(c.effectKo || '') || re.test(c.inheritedKo || ''));
  if (!pool.length) return genRandom();
  const cols = new Set(colorsOf(pick(pool)));
  const same = pool.filter((c) => colorsOf(c).some((x) => cols.has(x)));
  const main = {};
  for (let i = 0; i < 30; i++) addCard(main, (chance(0.75) && same.length ? pick(same) : pick(pool)).id);
  const back = mainPool.filter((c) => c.category === 'digimon' && colorsOf(c).some((x) => cols.has(x)));
  fill(main, back.length ? back : mainPool);
  return { name: 'mech:' + kind, main, digitama: eggsFor([...cols]) };
}
const STARTERS = [...new Set(all.map((c) => (c.id.match(/^(ST\d+)-/) || [])[1]).filter(Boolean))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
function genStarter(st) {
  const cs = all.filter((c) => c.id.startsWith(st + '-'));
  const main = {}, eggs = {};
  for (const c of cs) { if (c.category === 'digitama') eggs[c.id] = 4; else if (c.level === 2 && c.category === 'digimon') eggs[c.id] = 2; }
  const body = cs.filter((c) => !isEgg(c));
  let g = 0; while (total(main) < 50 && body.length && g++ < 500) addCard(main, pick(body).id, chance(0.5) ? 2 : 1);
  if (!total(eggs)) Object.assign(eggs, eggsFor(colorsOf(cs[0] || {})));
  while (total(eggs) > 5) { const k = Object.keys(eggs).pop(); eggs[k]--; if (!eggs[k]) delete eggs[k]; }
  return { name: st, main, digitama: eggs };
}
// card-focused deck: 4x focus + its evolution line (predecessors/successors via canEvolveAny) + same-colour support
const predCache = new Map(), succCache = new Map();
const digimonAll = all.filter((c) => c.category === 'digimon');
function sameCol(a, b) { const ca = colorsOf(a), cb = colorsOf(b); return !ca.length || !cb.length || ca.some((x) => cb.includes(x)); }
function preds(id) { if (predCache.has(id)) return predCache.get(id); const c = cardOf(id); const r = digimonAll.filter((p) => p.level === c.level - 1 && !p.isParallel && sameCol(p, c) && E.canEvolveAny(p.id, id, [], null).ok); predCache.set(id, r); return r; }
function succs(id) { if (succCache.has(id)) return succCache.get(id); const c = cardOf(id); const r = digimonAll.filter((p) => p.level === c.level + 1 && !p.isParallel && sameCol(p, c) && E.canEvolveAny(id, p.id, [], null).ok); succCache.set(id, r); return r; }
function genFocus(fid) {
  const F = cardOf(fid); const cols = colorsOf(F).length ? colorsOf(F) : [pick(COLS)];
  const main = {}; let dig = {}; const prefer = [];
  const support = () => mainPool.filter((c) => c.category !== 'digimon' || c.level >= 3).filter((c) => colorsOf(c).length && colorsOf(c).every((x) => cols.includes(x) || colorsOf(F).includes(x)));
  if (isEgg(F)) {
    prefer.push(fid);
    let cur = [F]; for (let lv = 0; lv < 3; lv++) { const nx = [...new Set(cur.flatMap((c) => succs(c.id)))].filter((c) => !isEgg(c)); const chosen = shuffled(nx).slice(0, 3); for (const c of chosen) addCard(main, c.id, 3); cur = chosen; if (!cur.length) break; }
  } else if (F.category === 'digimon') {
    addCard(main, fid, 4);
    let cur = [F]; // predecessors chain
    for (let d = 0; d < 4; d++) { const pr = [...new Set(cur.flatMap((c) => preds(c.id)))]; const nonEgg = pr.filter((c) => !isEgg(c)); const eg = pr.filter(isEgg); for (const e of eg.slice(0, 2)) prefer.push(e.id); const chosen = shuffled(nonEgg).slice(0, 3); for (const c of chosen) addCard(main, c.id, d === 0 ? 4 : 3); cur = chosen; if (!cur.length) break; }
    const nx = shuffled(succs(fid)).slice(0, 2); for (const c of nx) addCard(main, c.id, 3);
  } else addCard(main, fid, 4);
  const sup = support();
  const tam = sup.filter((c) => c.category === 'tamer'), opt = sup.filter((c) => c.category === 'option');
  for (let i = 0; i < 3 && tam.length; i++) addCard(main, pick(tam).id);
  for (let i = 0; i < 5 && opt.length; i++) addCard(main, pick(opt).id);
  const bodies = sup.filter((c) => c.category === 'digimon');
  const mb = bodies.length ? bodies : mainPool;
  while (total(main) > 50) { const k = Object.keys(main).filter((x) => x !== fid).pop(); if (!k) break; main[k]--; if (!main[k]) delete main[k]; }
  fill(main, mb.length ? mb : mainPool);
  if (total(main) > 50) for (const k of Object.keys(main)) { if (total(main) <= 50) break; if (k !== fid) { main[k]--; if (!main[k]) delete main[k]; } }
  dig = eggsFor(cols, 5, prefer);
  return { name: 'focus:' + fid, main, digitama: dig };
}

// ---------- specs ----------
function makeDeck(kindSpec) {
  const [k, arg] = String(kindSpec).split('=');
  if (k === 'starter') return genStarter(arg);
  if (k === 'focus') return genFocus(arg);
  if (k === 'theme') return genTheme();
  if (k === 'mech') return genMech();
  return genRandom();
}
let GS = (BASE_SEED * 2654435761) >>> 0;
const grnd = () => { GS = (GS + 0x6D2B79F5) >>> 0; let t = GS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gpick = (a) => a[Math.floor(grnd() * a.length)]; // spec generation uses its own rng so shards / reruns see identical specs
function randOppKind() { return gpick(['theme', 'theme', 'mech', 'random', 'starter=' + gpick(STARTERS), 'focus=' + gpick(mainPool).id]); }
function* specs() {
  const lv = (i) => { const a = LEVELS[i % LEVELS.length], b = LEVELS[(Math.floor(i / LEVELS.length) + i) % LEVELS.length]; return [a, b]; };
  let idx = 0;
  const mk = (a, b, i) => { const [la, lb] = lv(i); return { seed: BASE_SEED * 1000003 + idx * 7919 + i, a, b, la, lb }; };
  const ids = all.map((c) => c.id);
  const starterSpec = (n) => { const x = n % STARTERS.length, y = Math.floor(n / STARTERS.length) % STARTERS.length; return mk('starter=' + STARTERS[x], 'starter=' + STARTERS[y], n + Math.floor(n / (STARTERS.length ** 2))); };
  if (MODE === 'starters') { for (let n = 0; ; n++) { idx = n; yield starterSpec(n); } }
  if (MODE === 'focus') { for (let r = 0; r < PER; r++) for (let i = 0; i < ids.length; i++) { idx++; yield mk('focus=' + ids[i], r === 0 ? randOppKind() : 'focus=' + gpick(ids), i + r); } return; }
  if (MODE === 'mix') { for (let n = 0; ; n++) { idx = n; const k = n % 8; if (k < 2) yield starterSpec(Math.floor(grnd() * STARTERS.length * STARTERS.length)); else if (k < 4) yield mk('focus=' + gpick(ids), randOppKind(), n); else if (k < 6) yield mk('theme', 'theme', n); else if (k === 6) yield mk('mech', 'mech', n); else yield mk('random', 'theme', n); } }
  for (let n = 0; ; n++) { idx = n; yield mk(MODE, MODE, n); }
}

// ---------- findings ----------
const found = {};
let CUR = null;
function report(cls, key, detail) {
  const k = cls + ': ' + key;
  const f = (found[k] ||= { n: 0, cls, ex: null });
  f.n++;
  if (!f.ex && CUR) f.ex = { spec: CUR.spec, turn: CUR.state.turnNumber, lastAct: CUR.lastAct, detail: String(detail || '').slice(0, 400), log: CUR.state.log.slice(0, 40).map((e) => e.msg).reverse() };
}
function noteErr(where, e) {
  const top = String(e && e.stack).split('\n').slice(1, 3).map((s) => s.trim().replace(/^at /, '').replace(/\(?file:\/\/\/.*[\\/]([^\\/]+:\d+):\d+\)?/, '$1')).join(' < ');
  report('EXC', where + ' ' + String(e && e.message).slice(0, 80) + ' @ ' + top, String(e && e.stack).split('\n').slice(0, 5).join(' | '));
}

// ---------- exposure ----------
const EXPO = {}; // id -> {top, src, hand, trig, played}
const ex = (id) => (EXPO[id] ||= { top: 0, src: 0, hand: 0, trig: 0, manual: 0, hatch: 0 });
const MANUAL = {}; // "cardId|tag" -> n

// ---------- census ----------
const isTok = (id) => !!(CARDS[id] && CARDS[id].isToken);
function census(state) {
  const res = { p1: new Map(), p2: new Map() };
  const add = (m, id) => { if (!isTok(id)) m.set(id, (m.get(id) || 0) + 1); };
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p], m = res[p];
    for (const z of ['hand', 'deck', 'trash', 'security', 'digitamaDeck']) for (const id of pl[z]) add(m, id);
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) { if (st.foreignCardId === st.cardId && st.foreignTop && res[st.foreignTop]) add(res[st.foreignTop], st.cardId); else add(m, st.cardId); for (const id of st.sources || []) if (typeof id === 'string') add(m, id); for (const l of st.linkCards || []) if (l) add(m, l.cardId); }
  }
  return res;
}
const diff = (cur, init) => { const d = {}; for (const [id, n] of cur) { const x = n - (init.get(id) || 0); if (x) d[id] = x; } for (const [id, n] of init) if (!cur.has(id)) d[id] = -n; return d; };

// ---------- per-action checks ----------
function checkState(g, phaseTag) {
  const state = g.state;
  if (!Number.isFinite(state.memory) || Math.abs(state.memory) > 10) report('MEM', 'out of range', 'memory=' + state.memory);
  // conservation
  const c = census(state); const d1 = diff(c.p1, g.init.p1), d2 = diff(c.p2, g.init.p2);
  const sig = JSON.stringify([d1, d2]);
  if (sig !== g.consSig) {
    g.consSig = sig;
    if (sig !== '[{},{}]') {
      const ids = [...new Set([...Object.keys(d1), ...Object.keys(d2)])];
      const cls = new Set();
      for (const id of ids) { const a = d1[id] || 0, b = d2[id] || 0; if ((a < 0 && b > 0) || (a > 0 && b < 0)) cls.add('OWNER'); else if (a + b < 0) cls.add('LOST'); else cls.add('DUP'); }
      const trig = g.recentTrig.slice(-3).join(',') || String(g.lastAct).split(' ')[0];
      report('CONS', [...cls].join('+') + ' | ' + trig, ids.slice(0, 4).map((id) => `${id}:${d1[id] || 0}/${d2[id] || 0}`).join(' '));
      g.init = { p1: c.p1, p2: c.p2 }; g.consSig = '[{},{}]';
    }
  }
  const seen = new Set();
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) {
      if (seen.has(st.uid)) report('STRUCT', 'duplicate stack uid', st.uid); seen.add(st.uid);
      const cd = CARDS[st.cardId]; if (!cd) { report('STRUCT', 'unknown stack card', String(st.cardId)); continue; }
      if (st !== pl.raising && !['digimon', 'tamer', 'option'].includes(cd.category) && !(cd.category === 'digitama' && cd.dp != null)) report('STRUCT', 'battle top category ' + cd.category, st.cardId);
      if (typeof st.suspended !== 'boolean') report('STRUCT', 'suspended not boolean', st.cardId);
      let dp = NaN; try { dp = S.effectiveDP(state, p, st); } catch (e) { noteErr('effectiveDP ' + st.cardId, e); }
      if (!Number.isFinite(dp)) report('NAN', 'effectiveDP', st.cardId + '=' + dp);
      else if (dp <= 0 && st !== pl.raising && cd.category === 'digimon' && cd.dp != null && !state.turnEnding && !state.pending.some((t) => !t.resolved) && state.phase === 'main') report('DP0', 'digimon DP<=0 alive ' + st.cardId, st.cardId + ' dp=' + dp + ' carddp=' + cd.dp + ' temp=' + st.tempDP + ' src=' + (st.sources || []).length + ' placed=' + st.placedTurn + ' turn=' + state.turnNumber + ' trig=' + g.recentTrig.slice(-5).join(',') + ' rc=' + state._rcDepth + '/' + (state._rcPending || []).length + ' log=' + state.log.slice(0, 6).map((e) => e.msg).join(' / '));
      const e = ex(st.cardId); if (!st._seenTop) { st._seenTop = 1; e.top++; for (const s of st.sources || []) if (typeof s === 'string') ex(s).src++; }
    }
    for (const id of pl.hand) { const k = 'h' + id; if (!g.seenHand.has(p + k)) { g.seenHand.add(p + k); ex(id).hand++; } }
  }
  if (state.pending.length > 1500) report('PEND', 'array > 1500', String(state.pending.length));
  if (state.uiChoice) report('PEND', 'uiChoice left set', JSON.stringify(state.uiChoice).slice(0, 100));
  // log scan
  const L = state.log; const fresh = Math.min(L.length >= 300 ? 60 : L.length - g.logMark, L.length);
  for (let i = 0; i < fresh; i++) {
    const m = String(L[i].msg);
    if (m.startsWith('(확인)')) { const k = (g.recentTrig[g.recentTrig.length - 1] || '?') + '|noop|' + m.slice(5, 100); MANUAL[k] = (MANUAL[k] || 0) + 1; }
    if (/undefined|NaN|\[object|\bnull\b/.test(m)) { const mm = m.match(/.{0,18}(undefined|NaN|\[object Object\]|\bnull\b).{0,12}/); report('LOG', (mm ? mm[0] : m).replace(/\d+/g, '#').replace(/\b(p1|p2)\b/g, 'P'), m); }
    if (/찾을 수 없|대상이 없|target not found/.test(m)) { const key = m.replace(/\d+/g, '#').slice(0, 50); g.tnf[key] = (g.tnf[key] || 0) + 1; if (g.tnf[key] === 12) report('LOG', 'repeated "not found": ' + key, m); }
  }
  g.logMark = L.length >= 300 ? 300 : L.length;
}
function wrapPending(g) {
  const state = g.state;
  const hook = (arr) => {
    if (arr.__h) return arr; arr.__h = true;
    const push = arr.push.bind(arr);
    arr.push = (...ts) => { for (const t of ts) { try { onTrigger(g, t); } catch (e) {} } return push(...ts); };
    return arr;
  };
  let cur = hook(state.pending);
  Object.defineProperty(state, 'pending', { get: () => cur, set: (v) => { cur = hook(v); }, configurable: true, enumerable: true });
}
function onTrigger(g, t) {
  if (!t || t.schedFn || !t.cardId) return;
  const tag = (t.tags || [])[0] || '';
  ex(t.cardId).trig++; g.recentTrig.push(t.cardId + '::' + tag); if (g.recentTrig.length > 8) g.recentTrig.shift();
  let has = !t.manualOnly;
  if (has) { let sc = null; try { sc = Fx.lookupCardSpecific(t.cardId, t.tags, t.text); if (!sc) sc = Fx.compileToScript(t.text); } catch (e) { noteErr('compile ' + t.cardId, e); } has = !!(sc && sc.length); }
  if (!has) { ex(t.cardId).manual++; const k = t.cardId + '|' + tag + '|' + String(t.text || '').slice(0, 50); MANUAL[k] = (MANUAL[k] || 0) + 1; }
}

// ---------- game ----------
const parseLv = (name) => (name === 'hard4' ? { level: 'hard', search: true } : { level: name, search: false });
const actKey = (a) => a ? [a.type, a.cardId, a.uid, a.target, a.idx].join('|') : 'none';
async function playGame(spec) {
  seedRng(spec.seed);
  const dA = makeDeck(spec.a), dB = makeDeck(spec.b);
  const decksOk = S.deckLegality(dA).ok && S.deckLegality(dB).ok;
  const cfgs = { p1: { ...parseLv(spec.la), banned: new Set() }, p2: { ...parseLv(spec.lb), banned: new Set() } };
  const state = S.newGame(dA, dB);
  const g = { spec, state, lastAct: '', init: null, consSig: '[{},{}]', logMark: 0, recentTrig: [], seenHand: new Set(), tnf: {}, actions: 0, rejects: {} };
  CUR = g;
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0 };
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: (w, e) => noteErr(w, e), stats });
  wrapPending(g);
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
  } catch (e) { noteErr('setup', e); return { err: true, decksOk }; }
  g.init = census(state);
  const t0 = Date.now();
  let lastTurn = -1, sameTurnActs = 0, repeat = 0, lastKey = '', attacked = false, lastBanned = { p1: 0, p2: 0 };
  for (let t = 0; t < TURN_CAP + 5 && !state.winner; t++) {
    if (Date.now() - t0 > GAME_MS) { report('STALL', 'game exceeded wall clock ' + GAME_MS + 'ms', 'turn ' + state.turnNumber); return { stall: true, decksOk, turns: state.turnNumber }; }
    if (state.turnNumber > TURN_CAP) { report('STALL', 'turn cap ' + TURN_CAP + ' (mem ' + state.memory + ')', ''); return { stall: true, decksOk, turns: state.turnNumber }; }
    try {
      const p = state.activePlayer, cfg = cfgs[p];
      cfg.banned = new Set(); lastBanned[p] = 0;
      await sim.beginTurn(p);
      checkState(g, 'begin');
      if (state.winner) break;
      let acts = 0;
      await sim.mainLoop(p, async () => {
        checkState(g, 'choose');
        if (state.winner) return { type: 'pass' };
        g.actions++; acts++;
        const persp = p === 'p1' ? state.memory : -state.memory;
        if (state.phase === 'main' && !state.turnEnding && persp < 0 && S.isTurnAutoEnding(state)) report('MEM', 'auto-end condition true in main phase', 'memory=' + state.memory + ' p=' + p + ' ph=' + state.phase + ' pend=' + state.pending.length + ' th=' + S.hookTurnEndThreshold(state, p) + ' prev=' + g.lastAct);
        if (state.pending.some((x) => !x.resolved)) report('PEND', 'unresolved pending at choose', state.pending.filter((x) => !x.resolved).map((x) => x.cardId + '::' + (x.tags || [])[0]).join(','));
        let act;
        if (cfg.search) { try { act = await Cpu.HOOKS.search(state, p, cfg, SOPTS); } catch (e) { noteErr('search', e); } }
        if (!act) act = Cpu.planMain(state, p, cfg);
        if (cfg.banned.size > lastBanned[p]) { const pk = g.prevAct ? g.prevAct.type + (g.prevAct.type === 'main' ? ' ' + String(g.lastAct).split('@')[1] : '') : '?'; g.rejects[pk] = (g.rejects[pk] || 0) + 1; report('REJECT', 'CPU action had no effect: ' + pk, actKey(g.prevAct) + ' ' + (g.prevAct && g.prevAct.cardId) + ' :: ' + (g.prevAct && g.prevAct.type === 'attack' ? g.atkInfo + ' :: ' : '') + state.log.slice(0, 3).map((e) => e.msg).join(' / ')); }
        lastBanned[p] = cfg.banned.size;
        g.prevAct = act; g.lastAct = actKey(act) + (act.type === 'main' ? ' @' + ((sim.find(p, act.uid) || {}).cardId || '?') : '');
        if (!act || !act.type) { report('REJECT', 'CPU returned no action', JSON.stringify(act)); return { type: 'pass' }; }
        // pre-checks on the chosen action
        const pl = state.players[p];
        if (act.type === 'attack') {
          attacked = true;
          const st = sim.find(p, act.uid);
          g.atkInfo = st ? JSON.stringify({ card: st.cardId, susp: st.suspended, elig: st.attackEligibleTurn, turn: state.turnNumber, cau: st.cannotAttackUntil, noAtk: S.hookNoAttack(state, p, st), s1: S.s1CannotAttack(state, p, st), rest: S.canRestByRule(state, p, st), tgt: act.target }) : 'nostack';
          if (!st) report('SUSP', 'attack action with missing stack', act.uid);
          else { if (st.suspended) report('SUSP', 'attack by suspended stack ' + st.cardId, ''); if (S.card(st.cardId).category !== 'digimon') report('SUSP', 'attack by non-digimon ' + st.cardId, ''); }
        }
        if (act.type === 'play' && act.cost != null && act.cost > 0 && !S.canPayCost(state, act.cost)) report('SUSP', 'CPU plays unpayable card', act.cardId);
        if (act.type === 'play' && pl.hand.indexOf(act.cardId) < 0) report('SUSP', 'CPU plays card not in hand', act.cardId);
        if (act.type === 'evolve') { const st = sim.find(p, act.uid); if (!st) report('SUSP', 'evolve missing stack', act.uid); else { const ms = E.evolutionMethods(st.cardId, act.cardId, S.evoExtraArg(state, p, st), S.evolveTargetRestriction(state, p, st), { state, p, stack: st }); if (!ms.length) report('SUSP', 'CPU evolves illegally ' + st.cardId + '->' + act.cardId, JSON.stringify(E.canEvolveAny(st.cardId, act.cardId, st.extraColors || [], null)).slice(0, 100)); } }
        const key = actKey(act) + (act.type === 'main' ? ' @' + ((sim.find(p, act.uid) || {}).cardId || '?') : '');
        if (state.turnNumber === lastTurn) { sameTurnActs++; } else { lastTurn = state.turnNumber; sameTurnActs = 1; }
        if (key === lastKey && act.type !== 'pass') { repeat++; if (repeat === 8) report('REPEAT', 'same CPU action x8: ' + act.type + ' ' + (act.cardId || ''), key); } else { repeat = 0; lastKey = key; }
        if (acts > 40) report('STALL', '>40 actions in one turn', key);
        const secBefore = state.players[S.opponentOf(p)].security.length;
        g.secBefore = secBefore; g.actType = act.type; g.actTarget = act.target;
        return act;
      });
      checkState(g, 'turnEnd');
    } catch (e) { noteErr('turn', e); return { err: true, decksOk, turns: state.turnNumber }; }
  }
  checkState(g, 'end');
  if (!state.winner) { report('STALL', 'no winner after loop', 'turn ' + state.turnNumber); return { stall: true, decksOk, turns: state.turnNumber }; }
  // suspicious outcomes
  if (state.winner !== 'draw') {
    const loser = S.opponentOf(state.winner), lp = state.players[loser], wp = state.players[state.winner];
    const tail = state.log.slice(0, 6).map((e) => e.msg).join(' / ');
    const deckOut = lp.deck.length === 0 && wp.deck.length > 0;
    const wDeckOut = wp.deck.length === 0;
    if (deckOut && state.turnNumber < 10) report('SUSP', 'early deck-out win (turn<10)', tail);
    if (wDeckOut && !deckOut && state.turnNumber < 10) report('SUSP', 'winner deck empty at end (turn<10)', tail);
    if (lp.security.length > 0 && lp.deck.length > 0 && !/덱|승리|패배|시큐리티|승|게임/.test(tail)) report('SUSP', 'won with loser security>0', tail);
    if (lp.security.length > 0 && lp.deck.length > 0 && !attacked) report('SUSP', 'win with sec>0 & no attack', tail);
  }
  return { winner: state.winner, turns: state.turnNumber, decksOk, actions: g.actions };
}

// ---------- main ----------
const stats = { games: 0, ok: 0, stall: 0, err: 0, illegalDecks: 0, turns: 0, byLevel: {}, wins: { p1: 0, p2: 0, draw: 0 } };
async function main() {
  if (SPEC) { const spec = JSON.parse(SPEC); const r = await playGame(spec); console.log('result', JSON.stringify(r)); if (VERBOSE && CUR) console.log(CUR.state.log.slice(0, 300).map((e) => e.msg).reverse().join('\n')); dump(); return; }
  let i = 0;
  for (const spec of specs()) {
    if (i++ % SH_N !== SH_I) continue;
    if (i < FROM) continue;
    if (Date.now() - T0 > MINUTES * 60000 || stats.games >= MAXG) break;
    let r;
    try { r = await playGame(spec); } catch (e) { noteErr('playGame', e); r = { err: true }; }
    stats.games++; if (r.err) stats.err++; else if (r.stall) stats.stall++; else { stats.ok++; stats.turns += r.turns || 0; stats.wins[r.winner]++; }
    if (r.decksOk === false) stats.illegalDecks++;
    const lk = spec.la + '-' + spec.lb; stats.byLevel[lk] = (stats.byLevel[lk] || 0) + 1;
    if (VERBOSE && stats.games % 50 === 0) console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] games ${stats.games} findings ${Object.keys(found).length}`);
  }
  dump();
}
function dump() {
  const ks = Object.keys(found).sort((a, b) => found[b].n - found[a].n);
  console.log(`cpu-hunt mode=${MODE} shard=${SH_I}/${SH_N} seed=${BASE_SEED}: ${JSON.stringify(stats)} in ${((Date.now() - T0) / 1000).toFixed(0)}s`);
  console.log('distinct findings:', ks.length);
  for (const k of ks.slice(0, 60)) { const f = found[k]; console.log(`\n[${f.n}x] ${k}\n   spec=${JSON.stringify(f.ex && f.ex.spec)} turn=${f.ex && f.ex.turn} last=${f.ex && f.ex.lastAct}\n   detail=${f.ex && f.ex.detail}`); }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, stats, found, expo: EXPO, manual: MANUAL }, null, 1));
}
await main();
process.exit(0);
