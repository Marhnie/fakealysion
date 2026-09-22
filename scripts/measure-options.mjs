// Measurement of how the CPU plays OPTION and TAMER cards (docs/cpu-option-tamer-play.md).
//
//   node scripts/measure-options.mjs --games 960 [--cpu hardH|hard|expert|normal] [--seed 1] [--workers 11] [--json scratch/mo.json] < /dev/null
//
// Paired-deck experiment: M colour-coherent base decks; each base is played in 4 VARIANTS that differ ONLY in the option / tamer slots
//   full   = 4 tamers + 6 options + 4 filler digimon      noOpt = 4 tamers + 10 filler digimon (options swapped for digimon)
//   noTam  = 6 options + 8 filler digimon (tamers out)    none  = 14 filler digimon
// (the 36 core digimon and the 14 filler digimon are identical across variants).  Every (base, variant) plays the SAME opponents (pool decks) in both
// seat orders with the SAME seeds; the CPU under test controls the base deck, the opponent is `--opp` (default normal).
// Per card of the tested deck the probe records: games with the card in hand, uses, "missed" passes (card castable with the memory on hand
// but the CPU passed), plus counter windows.  The rule engine is the real one (headless CPU-vs-CPU, scripts/arena-core.mjs).
import * as fs from 'fs';
import { fork } from 'child_process';
import * as os from 'os';
import * as S from '../src/state.js';
import * as Cpu from '../src/cpu.js';
import { init, playGame, deckPool, seedRng, srand, resolve } from './arena-core.mjs';
import { wilson } from './arena-pool.mjs';

// text classes of the main effect (measurement only; independent of the CPU's own classifier)
export function optClass(c) {
  const t = (S.optionView(c.id).effectKo || '').replace(/s+/g, ' ');
  if (!/【메인】/.test(t)) return 'other';
  if (/소멸/.test(t) && /상대(의)? ?(디지몬|테이머)/.test(t) && !/소멸하지/.test(t)) return 'removal';
  if (/(되돌린다|되돌린다)/.test(t) && /상대(의)? ?디지몬/.test(t)) return 'bounce';
  if (/(어택과 블록을 할 수 없|레스트시킨다)/.test(t) && /상대(의)? ?디지몬/.test(t)) return 'restrict';
  if (/시큐리티/.test(t) && /(위에 놓|회복|추가)/.test(t) && !/상대의 시큐리티/.test(t)) return 'recover';
  if (/(드로우|패에 추가|패로 추가)/.test(t)) return 'draw';
  if (/DP.*[+＋] ?d|[+＋] ?d+ ?DP|DP를 ?[+＋]/.test(t) && !/상대/.test(t)) return 'pump';
  if (/메모리/.test(t)) return 'memory';
  return 'other';
}
export function tamClass(c) {
  const t = (c.effectKo || '').replace(/s+/g, ' ');
  if (/【자신의 (턴|메인 페이즈) 개시 시】[^【]*메모리/.test(t)) return 'engine';
  if (/【등장 시】/.test(t) && /(드로우|패에 추가|오픈)/.test(t)) return 'draw';
  if (/이 테이머를 레스트시키는 것으로/.test(t)) return 'rest';
  return 'other';
}
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
let BASES = null;
// pick = 'random' (any colour-legal tamer / option) | 'generic' (no card-name conditions 「…」 in the text: effects that work in any deck)
export function buildBases(n, seed = 777, pick = 'random') {
  if (BASES && BASES.length >= n && BASES.pick === pick) return BASES.slice(0, n);
  const real = Math.random; seedRng(seed); Math.random = srand;
  const out = [];
  try {
    const all = Object.values(S.CARDS).filter((c) => !c.isToken);
    const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
    let guard = 0;
    while (out.length < n && guard++ < 4000) {
      const cols = Math.random() < 0.5 ? [pickOf(COLORS)] : [...new Set([pickOf(COLORS), pickOf(COLORS)])];
      const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel && !c.isToken && !S.isDual(c.id);
      const byLv = (lv) => all.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
      const eggs = all.filter((c) => c.category === 'digitama' && ok(c));
      const generic = (c) => (pick === 'random' || pick.startsWith('cls:') || pick.startsWith('tam:') || (!/[「」]/.test(c.effectKo || '') && (c.effectKo || '').length > 10)) && (pick !== 'generic' || true);
      const clsOk = (c) => !pick.startsWith('cls:') || optClass(c) === pick.slice(4);
      const tamOk = (c) => !pick.startsWith('tam:') || tamClass(c) === pick.slice(4);
      const tamers = all.filter((c) => c.category === 'tamer' && ok(c) && generic(c) && tamOk(c));
      const opts = all.filter((c) => c.category === 'option' && ok(c) && generic(c) && clsOk(c));
      if (!eggs.length || tamers.length < 4 || opts.length < 6 || byLv(3).length < 6 || byLv(4).length < 5 || byLv(5).length < 3) continue;
      const dig = {}, core = {}, F = [], T = [], O = [];
      const cnt = (m) => Object.values(m).reduce((a, b) => a + b, 0);
      const add = (m, c, max = 4) => { const cur = m[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; m[c.id] = cur + 1; return true; };
      for (let i = 0; i < 5; i++) add(dig, pickOf(eggs));
      const fill = (m, pool, k, max = 4) => { let t = 0, g = 0; while (g < k && t++ < 500) if (add(m, pickOf(pool), max)) g++; };
      fill(core, byLv(3), 14); fill(core, byLv(4), 11); fill(core, byLv(5), 8); fill(core, byLv(6), 3);
      if (cnt(core) < 36) { fill(core, byLv(4), 36 - cnt(core)); }
      // 4 distinct tamers x1, 6 options (up to 2 copies each), 14 filler digimon
      const tm = {}; { const ts = tamers.slice(); for (let i = 0; i < 4; i++) { const c = ts.splice(Math.floor(Math.random() * ts.length), 1)[0]; add(tm, c, 1); } }
      const om = {}; fill(om, opts, 6, 2);
      const fm = {}; { const pool = [...byLv(3), ...byLv(4), ...byLv(5)]; let t = 0; while (cnt(fm) < 14 && t++ < 800) { const c = pickOf(pool); const tot = (core[c.id] || 0) + (fm[c.id] || 0); if (tot < Math.min(4, S.maxCopiesFor(c.id))) fm[c.id] = (fm[c.id] || 0) + 1; } }
      if (cnt(core) !== 36 || cnt(tm) !== 4 || cnt(om) !== 6 || cnt(fm) !== 14) continue;
      const expand = (m) => Object.entries(m).flatMap(([id, k]) => Array(k).fill(id));
      const Fl = expand(fm);
      const merge = (...ms) => { const r = {}; for (const m of ms) for (const [id, k] of Object.entries(m)) r[id] = (r[id] || 0) + k; return r; };
      const fmSlice = (a, b) => { const r = {}; for (const id of Fl.slice(a, b)) r[id] = (r[id] || 0) + 1; return r; };
      const variants = {
        full: merge(core, tm, om, fmSlice(0, 4)),
        noOpt: merge(core, tm, fmSlice(0, 10)),
        noTam: merge(core, om, fmSlice(0, 8)),
        none: merge(core, fmSlice(0, 14)),
      };
      const b = { name: 'B' + out.length, cols, digitama: dig, variants };
      let legal = true; for (const v of Object.values(variants)) if (!S.deckLegality({ name: 'x', main: v, digitama: dig }).ok) legal = false;
      if (legal) out.push(b);
    }
  } finally { Math.random = real; }
  BASES = out; BASES.pick = pick; return out.slice(0, n);
}
const deckOf = (b, v) => ({ name: b.name + ':' + v, main: b.variants[v], digitama: b.digitama });

// ---- one game with the probe ----
async function runOne(task) {
  await init();
  const bases = buildBases(task.nBases, 777, task.pick || 'random');
  const base = bases[task.base];
  const dp = deckPool().all;
  const opp = dp[task.opp % dp.length];
  const mine = deckOf(base, task.variant);
  const seat = task.cpuFirst ? 'p1' : 'p2';
  const rec = { cards: {}, ctr: { win: 0, used: 0, lethalWin: 0, lethalUsed: 0, hadCounter: 0 }, passes: 0, actions: { option: 0, tamer: 0, main: 0, delay: 0, play: 0, evolve: 0, attack: 0 } };
  const cid = (id) => rec.cards[id] || (rec.cards[id] = { why: null, hand: 0, use: 0, missFree: 0, missFreeVal: 0, missOver: 0, decHeld: 0, endHeld: 0, useTurn: 0, firstSeen: null });
  const optionsIn = new Set(Object.keys(mine.main).filter((id) => { const c = S.card(id); return c && (c.category === 'option' || c.category === 'tamer'); }));
  const seen = new Set();
  let lastTurn = null, lastWhy = {};
  const commit = () => { for (const [id, w] of Object.entries(lastWhy)) { const r = cid(id); r.why = r.why || {}; r.why[w] = (r.why[w] || 0) + 1; } lastWhy = {}; };
  const onDecide = (state, p, act, cfg) => {
    if (p !== seat) return;
    const pl = state.players[p];
    const mem = p === 'p1' ? state.memory : -state.memory;
    for (const id of new Set(pl.hand)) {
      if (!optionsIn.has(id)) continue;
      const r = cid(id); if (!seen.has(id)) { seen.add(id); r.hand = 1; r.firstSeen = state.turnNumber; }
      r.decHeld++;
    }
    // per-decision status of every held option / tamer; the LAST decision of each turn is committed as the "turn-end reason" (a turn mostly ends through the memory crossing, not through a Pass)
    if (act.type === 'pass') rec.passes++;
    if (lastTurn !== null && lastTurn !== state.turnNumber) commit();
    lastTurn = state.turnNumber; lastWhy = {};
    let enums = null;
    for (const id of new Set(pl.hand)) {
      if (!optionsIn.has(id)) continue;
      const c = S.card(id);
      let cost, castable;
      if (c.category === 'option') { castable = S.optionColorOk(state, p, id) && !S.timedLocked(state, p, 'option'); cost = Math.max(0, S.optionBaseCost(state, p, id)); }
      else { castable = !S.isPlayRestricted(state, p, id); cost = c.cost || 0; }
      let w;
      if (act.cardId === id && (act.type === 'option' || act.type === 'play')) w = 'usedNow';
      else if (!castable) w = c.category === 'option' && !S.optionColorOk(state, p, id) ? 'color' : 'locked';
      else {
        enums = enums || Cpu.enumerateActions(state, p, cfg);
        const en = enums.find((a) => a.cardId === id && (a.type === 'option' || a.type === 'play'));
        if (!en) w = c.category === 'option' ? 'noValue' : 'other'; else if (cost <= mem) w = 'free'; else w = 'gift' + Math.min(4, cost - mem);
      }
      lastWhy[id] = w;
    }
    const c = act.cardId ? S.card(act.cardId) : null;
    if (act.type === 'option') { rec.actions.option++; if (optionsIn.has(act.cardId)) { cid(act.cardId).use++; cid(act.cardId).useTurn = state.turnNumber; } }
    else if (act.type === 'play' && c && c.category === 'tamer') { rec.actions.tamer++; if (optionsIn.has(act.cardId)) { cid(act.cardId).use++; cid(act.cardId).useTurn = state.turnNumber; } }
    else if (act.type === 'main') { rec.actions.main++; const st = pl.battle.find((s) => s.uid === act.uid); if (st) { const k = 'main:' + st.cardId; cid(k).use++; } }
    else if (act.type === 'delay') rec.actions.delay++;
    else if (rec.actions[act.type] != null) rec.actions[act.type]++;
  };
  const hooks = {
    attackDeclared: ({ p, op, uid, pa }) => {
      if (op !== seat) return;
      const st = state0.players[op];
      let counters = []; try { counters = S.findCounterOptions(state0, op); } catch (e) { counters = []; }
      const lethal = pa.targetKind === 'player' && st.security.length === 0;
      rec.ctr.win++; if (lethal) rec.ctr.lethalWin++;
      if (counters.length) { rec.ctr.hadCounter++; if (lethal) rec.ctr.lethalHad = (rec.ctr.lethalHad || 0) + 1; }
    },
    counter: ({ op }) => { if (op === seat) { rec.ctr.used++; } },
  };
  let state0 = null;
  const specC = task.cpu, specO = task.opp2 || { level: 'normal' };
  const optsG = { onDecide, hooks, gameMs: 120000, onState: null };
  // capture the state through the first onDecide (state0 is needed by the hooks)
  const od = onDecide; optsG.onDecide = (s, p, a, c) => { state0 = s; return od(s, p, a, c); };
  const r = await playGame(task.cpuFirst ? mine : opp, task.cpuFirst ? opp : mine, task.cpuFirst ? specC : specO, task.cpuFirst ? specO : specC, task.seed, optsG);
  commit();
  // hands at the end of the game
  if (state0) for (const id of state0.players[seat].hand) if (optionsIn.has(id)) cid(id).endHeld++;
  return { variant: task.variant, base: task.base, opp: task.opp, cpuFirst: task.cpuFirst, win: r.winner == null ? null : r.winner === 'draw' ? 'draw' : r.winner === seat ? 'W' : 'L', turns: r.turns, err: r.err, stall: r.stall, rec };
}

// ---- master / worker ----
if (process.argv.includes('--worker')) {
  await init();
  process.on('message', async (m) => {
    if (m === 'exit') process.exit(0);
    try { process.send({ id: m.id, result: await runOne(m.task) }); } catch (e) { process.send({ id: m.id, error: String(e && e.stack).slice(0, 400) }); }
  });
  process.send({ ready: true });
} else if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('measure-options.mjs')) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
  const games = Number(flag('games', 960)), seed = Number(flag('seed', 1)), nW = Number(flag('workers', Math.max(1, os.cpus().length - 1)));
  const cpuName = flag('cpu', 'hardH');
  const { parseSpec } = await import('./cpu-arena.mjs');
  const cpu = parseSpec(cpuName), oppSpec = parseSpec(flag('opp', 'normal'));
  const nOpp = 24;
  const perVariant = games; // games per arm
  const nBases = Math.max(8, Math.ceil(perVariant / 20));
  // each (base, opp) pair once per seat: 2 games; pick opponents deterministically
  const tasks = [];
  const VARS = flag('variants', 'full,noOpt,noTam,none').split(',');
  for (let b = 0; b < nBases; b++) for (let k = 0; k < 10; k++) {
    const opp = (b * 7 + k * 5 + seed) % nOpp;
    for (const cpuFirst of [true, false]) for (const v of VARS) tasks.push({ base: b, nBases, variant: v, pick: flag('pick', 'random'), opp, cpuFirst, seed: seed * 1000003 + b * 977 + k * 31 + (cpuFirst ? 0 : 1), cpu, opp2: oppSpec });
  }
  const gamesPerArm = nBases * 10 * 2;
  console.error(`arm size ${gamesPerArm} games (bases ${nBases}) x 4 variants = ${tasks.length} games, cpu=${cpuName}`);
  const spawnW = () => new Promise((res) => { const c = fork(new URL(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] }); c.once('message', () => res(c)); });
  const ws = await Promise.all(Array.from({ length: nW }, spawnW));
  const results = new Array(tasks.length); let next = 0, done = 0; const t0 = Date.now();
  const TASK_MS = Number(flag('taskms', 300000)); // a hung / crashed worker costs one game (recorded as an error), never the whole run
  await new Promise((resolveAll) => {
    const finish = (i, r) => { if (results[i] !== undefined) return; results[i] = r; done++; if (done % 200 === 0) process.stderr.write(`  ${done}/${tasks.length} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); if (done === tasks.length) resolveAll(); };
    const feed = (c) => {
      if (next >= tasks.length) return;
      const i = next++;
      let timer = null, over = false;
      const cleanup = () => { clearTimeout(timer); c.off('message', h); c.off('exit', onExit); };
      const h = (m) => { if (m.id !== i) return; cleanup(); finish(i, m.error ? { error: m.error } : m.result); feed(c); };
      const onExit = async () => { if (over) return; over = true; cleanup(); finish(i, { error: 'worker exited' }); const n = await spawnW(); ws.push(n); feed(n); };
      timer = setTimeout(() => { if (over) return; over = true; cleanup(); finish(i, { error: 'timeout' }); try { c.kill(); } catch (e) { /* */ } spawnW().then((n) => { ws.push(n); feed(n); }); }, TASK_MS);
      c.on('message', h); c.on('exit', onExit); c.send({ id: i, task: tasks[i] });
    };
    ws.slice().forEach(feed);
  });
  for (const c of ws) { try { c.send('exit'); } catch (e) { /* */ } }
  // ---- aggregate ----
  const rows = results.filter((r) => r && !r.error);
  const errs = results.filter((r) => !r || r.error).length + rows.filter((r) => r.err).length;
  const out = { cpu: cpuName, games, seed, errs, variants: {}, cards: {}, ctr: {}, actions: {} };
  for (const v of VARS) {
    const rs = rows.filter((r) => r.variant === v && !r.err && !r.stall);
    const w = rs.filter((r) => r.win === 'W').length, d = rs.filter((r) => r.win === 'draw').length, n = rs.length;
    const [p, lo, hi] = wilson(w + 0.5 * d, n);
    out.variants[v] = { n, w, rate: p, lo, hi, turns: rs.reduce((a, r) => a + r.turns, 0) / Math.max(1, n) };
    const c = { win: 0, used: 0, lethalWin: 0, hadCounter: 0, lethalHad: 0 }; const a = {};
    for (const r of rs) { for (const k of Object.keys(c)) c[k] += r.rec.ctr[k] || 0; for (const [k, x] of Object.entries(r.rec.actions)) a[k] = (a[k] || 0) + x; }
    out.ctr[v] = c; out.actions[v] = a;
  }
  // paired differences (same base/opp/seat/seed): full vs noOpt etc.
  const key = (r) => r.base + '|' + r.opp + '|' + r.cpuFirst;
  const byV = {}; for (const v of VARS) { byV[v] = new Map(); for (const r of rows.filter((x) => x.variant === v && !x.err && !x.stall)) byV[v].set(key(r), r.win === 'W' ? 1 : r.win === 'draw' ? 0.5 : 0); }
  const pair = (a, b) => { let n = 0, s = 0, s2 = 0; for (const [k, x] of byV[a]) if (byV[b].has(k)) { const d = x - byV[b].get(k); n++; s += d; s2 += d * d; } const m = s / Math.max(1, n), sd = Math.sqrt(Math.max(0, s2 / Math.max(1, n) - m * m) / Math.max(1, n)); return { n, delta: m, lo: m - 1.96 * sd, hi: m + 1.96 * sd }; };
  out.paired = {}; for (const [a, b] of [['full', 'noOpt'], ['full', 'noTam'], ['full', 'none'], ['noOpt', 'none'], ['noTam', 'none']]) if (byV[a] && byV[b]) out.paired[a + '-' + b] = pair(a, b);
  for (const r of rows) if (r.variant === 'full' && !r.err) for (const [id, x] of Object.entries(r.rec.cards)) {
    const t = out.cards[id] || (out.cards[id] = { games: 0, inHand: 0, use: 0, missFree: 0, missFreeVal: 0, missOver: 0, endHeld: 0, decHeld: 0, gWin: 0, gN: 0, uWin: 0, uN: 0, nUsedGames: 0 });
    t.games++; if (x.why) { t.why = t.why || {}; for (const [k, v] of Object.entries(x.why)) t.why[k] = (t.why[k] || 0) + v; } t.inHand += x.hand; t.use += x.use; t.missFree += x.missFree; t.missFreeVal += x.missFreeVal; t.missOver += x.missOver; t.endHeld += x.endHeld; t.decHeld += x.decHeld;
    if (x.hand) { t.gN++; if (r.win === 'W') t.gWin++; if (x.use > 0) { t.nUsedGames++; t.uN++; if (r.win === 'W') t.uWin++; } }
  }
  out.passes = rows.filter((r) => r.variant === 'full').reduce((a, r) => a + r.rec.passes, 0);
  const pct = (x) => (100 * x).toFixed(1);
  console.log(`cpu=${cpuName} arm=${gamesPerArm} errs=${errs}`);
  for (const v of VARS) { const s = out.variants[v]; console.log(`  ${v.padEnd(6)} winrate ${pct(s.rate)}% [${pct(s.lo)}-${pct(s.hi)}] n=${s.n} avg turns ${s.turns.toFixed(1)}`); }
  for (const [k, s] of Object.entries(out.paired)) console.log(`  paired ${k}: ${(100 * s.delta).toFixed(1)}pp [${(100 * s.lo).toFixed(1)}, ${(100 * s.hi).toFixed(1)}] n=${s.n}`);
  console.log('  counters (variant full):', JSON.stringify(out.ctr.full), ' actions full:', JSON.stringify(out.actions.full));
  const list = Object.entries(out.cards).map(([id, t]) => ({ id, ...t })).filter((t) => t.inHand >= 5);
  const cat = (id) => (S.card(id) ? S.card(id).category : '?');
  const agg = (cats) => { const a = { inHand: 0, use: 0, missFree: 0, missFreeVal: 0, missOver: 0, endHeld: 0 }; for (const t of list) if (cats.includes(cat(t.id))) for (const k of Object.keys(a)) a[k] += t[k]; return a; };
  console.log('  option cards:', JSON.stringify(agg(['option'])), ' tamer cards:', JSON.stringify(agg(['tamer'])));
  const jo = flag('json', null); if (jo) fs.writeFileSync(jo, JSON.stringify(out, null, 1));
  process.exit(0);
}
