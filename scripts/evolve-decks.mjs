// Offline evolutionary trainer for the CPU deck-building AI (src/cpudeck.js).  Node only; results ship as data/cpu-decks.json.
//
//   node scripts/evolve-decks.mjs --mode evolve --minutes 28 --pop 36 --seed 1 [--state f.json] [--resume] [--workers 11] [--reps 2] [--out data/cpu-decks.json] < /dev/null
//   node scripts/evolve-decks.mjs --mode finalize --state f.json --out data/cpu-decks.json     (re-evaluate archive finalists on the FULL gauntlet, export best N per colour pair)
//   node scripts/evolve-decks.mjs --mode verify --n 400 [--out-json f.json]                    (fresh-seed head-to-head: evolved vs starters / baselines / generation-0 decks, Wilson CI)
//
// Fitness = win rate (draw = 1/2) in headless CPU-vs-CPU games (src/cpusim.js, real engine) against a gauntlet (starters + hand-made-style baselines + hall of fame),
// every pairing played once as first and once as second player; 'normal' CPU level in the first 30% of the run, 'hard' afterwards.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(url).replace(/^\.\//, '')), 'utf8')) });
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
import { createSim } from '../src/cpusim.js';
import * as D from '../src/cpudeck.js';
await S.loadData();

// manual-fallback cards (docs/manual-effects.md) are never used by the generator
function manualIds() {
  try { const t = fs.readFileSync(path.join(ROOT, 'docs/manual-effects.md'), 'utf8'); return [...new Set([...t.matchAll(/^\|\s*([A-Z0-9]+-\d+)\s/gm)].map((m) => m[1]))]; } catch (e) { return []; }
}
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const AVOID = manualIds();
D.setAvoid(AVOID);

// ------------------------------------------------------------------------------------------------ worker: plays games
const turnCap = 60, timeCap = 12000;
function seedAll(s) {
  let RS = (s >>> 0) || 1;
  Math.random = function () { RS = (RS + 0x6D2B79F5) >>> 0; let t = RS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Cpu.setRng(() => Math.random());
}
async function playGame(a, b, first, level, seed) { // a = p1, b = p2; `first` = the seat that goes first. -> 'a' | 'b' | 'draw' | 'stall' | 'err'
  seedAll(seed);
  const cfgs = { p1: { level, search: false, banned: new Set() }, p2: { level, search: false, banned: new Set() } };
  const state = S.newGame(a, b);
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: () => { cfgs.err = true; } });
  const t0 = Date.now();
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, level)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
  } catch (e) { return 'err'; }
  for (let t = 0; t < turnCap && !state.winner; t++) {
    if (Date.now() - t0 > timeCap) return 'stall';
    try {
      const p = state.activePlayer, cfg = cfgs[p]; cfg.banned = new Set();
      await sim.beginTurn(p); if (state.winner) break;
      await sim.mainLoop(p, async () => Cpu.planMain(state, p, cfg));
    } catch (e) { return 'err'; }
  }
  if (!state.winner) return 'stall';
  if (state.winner === 'draw') return 'draw';
  return state.winner === 'p1' ? 'a' : 'b';
}
async function runJob(j) { // reps x (a first, a second)
  const r = { aw: 0, bw: 0, draw: 0, stall: 0, err: 0, n: 0 };
  for (let i = 0; i < j.reps; i++) for (let k = 0; k < 2; k++) {
    const res = await playGame(j.a, j.b, k === 0 ? 'p1' : 'p2', j.level, (j.seed * 7919 + i * 131 + k * 17 + 1) >>> 0);
    r.n++;
    if (res === 'a') r.aw++; else if (res === 'b') r.bw++; else if (res === 'draw') r.draw++; else if (res === 'stall') r.stall++; else r.err++;
  }
  return r;
}
if (!isMainThread) {
  parentPort.on('message', async (j) => { let r; try { r = await runJob(j); } catch (e) { r = { aw: 0, bw: 0, draw: 0, stall: 0, err: j.reps * 2, n: j.reps * 2 }; } parentPort.postMessage({ jid: j.jid, ...r }); });
} else await main();

// ------------------------------------------------------------------------------------------------ main thread
async function main() {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]) : d; };
  const MODE = String(flag('mode', 'evolve'));
  const SCRATCH = String(flag('scratch', process.env.EVOLVE_SCRATCH || path.join(ROOT, '.evolve')));
  fs.mkdirSync(SCRATCH, { recursive: true });
  const STATE = String(flag('state', path.join(SCRATCH, 'evolve-state.json')));
  const OUT = String(flag('out', path.join(ROOT, 'data/cpu-decks.json')));
  const NW = Number(flag('workers', Math.max(1, os.cpus().length - 1)));
  const SEED = Number(flag('seed', 1));
  const LOGF = path.join(SCRATCH, 'evolve-log.txt');
  const log = (...a) => { const s = a.join(' '); console.log(s); try { fs.appendFileSync(LOGF, s + '\n'); } catch (e) { /* ignore */ } };

  // ---- worker pool
  const workers = []; const idle = []; const queue = []; const waiting = new Map(); let jid = 0;
  const dispatch = () => { while (idle.length && queue.length) { const w = idle.pop(); const j = queue.shift(); w._job = j; w.postMessage(j); } };
  for (let i = 0; i < NW; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: {} });
    w.on('message', (m) => { const cb = waiting.get(m.jid); waiting.delete(m.jid); idle.push(w); if (cb) cb(m); dispatch(); });
    w.on('error', (e) => { console.error('worker error', e); });
    workers.push(w); idle.push(w);
  }
  const runJobs = (jobs) => Promise.all(jobs.map((j) => new Promise((res) => { j.jid = ++jid; waiting.set(j.jid, res); queue.push(j); dispatch(); })));
  const shutdown = () => { for (const w of workers) w.terminate(); };

  // ---- deterministic opponents: starters + "human-style" baselines
  const starters = buildStarters();
  const baselines = buildBaselines(12, 777);
  log(`starters ${starters.length} baselines ${baselines.length} avoid ${AVOID.length} workers ${NW}`);
  // ---- optional human decklist corpus (--human f.json [--human-stats f2.json]): train split seeds the population + joins the gauntlet, holdout split is only used by verify
  const HUMAN_F = flag('human', null); let humanTrain = [], humanHold = [], humanHashes = new Set();
  if (HUMAN_F && HUMAN_F !== true) {
    if (flag('human-stats', null)) log('human stats priors: ' + D.setHumanStats(JSON.parse(fs.readFileSync(String(flag('human-stats')), 'utf8'))));
    const all = JSON.parse(fs.readFileSync(String(HUMAN_F), 'utf8')).decks.filter((d) => d.src !== 'local-dcgo' || true);
    const av = new Set(AVOID); const hr = D.mulberry32(20260921); const seenH = new Set(); const pool = [];
    for (const d of all) { const dk = { main: d.main, digitama: d.digitama }; const h = D.deckHash(dk); humanHashes.add(h); if (seenH.has(h)) continue; seenH.add(h); if (Object.keys(d.main).some((i) => av.has(i))) continue; pool.push({ name: 'H' + pool.length + (d.place ? 'p' + d.place : ''), colors: D.deckColors(dk), main: d.main, digitama: d.digitama, place: d.place, hash: h }); }
    pool.sort(() => hr() - 0.5); const sc = (d) => (d.place && d.place <= 8 ? 1 : 0);
    const half = Math.floor(pool.length / 2); humanTrain = pool.slice(0, half).sort((a, b) => sc(b) - sc(a)); humanHold = pool.slice(half);
    log(`human corpus ${all.length} decks -> ${pool.length} unique w/o avoid cards -> train ${humanTrain.length} / holdout ${humanHold.length}`);
  }
  const HUMAN_SEED = Number(flag('human-seed', 0.5)), HUMAN_OPPS = Number(flag('human-opps', 3));


  // ============================================================ opponents
  function buildStarters() {
    const rng = D.mulberry32(4242);
    const all = Object.values(S.CARDS).filter((c) => !c.isToken);
    const isEgg = (c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2);
    const ids = [...new Set(all.map((c) => (c.id.match(/^(ST\d+)-/) || [])[1]).filter(Boolean))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    const total = (m) => sum(m);
    const out = [];
    for (const st of ids) {
      const cs = all.filter((c) => c.id.startsWith(st + '-'));
      const main = {}, eggs = {};
      const add = (m, id, n) => { const cur = m[id] || 0; const k = Math.min(n, Math.max(1, S.maxCopiesFor(id)) - cur); if (k > 0) m[id] = cur + k; };
      for (const c of cs) { if (c.category === 'digitama') eggs[c.id] = 4; else if (c.category === 'digimon' && c.level === 2) eggs[c.id] = 2; }
      const body = cs.filter((c) => !isEgg(c));
      let g = 0; while (total(main) < 50 && body.length && g++ < 500) add(main, body[Math.floor(rng() * body.length)].id, rng() < 0.5 ? 2 : 1);
      if (total(main) < 50) {
        const cols = [...new Set(cs.flatMap((c) => c.colors || []))];
        const pool = all.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category) && !isEgg(c) && !c.isParallel && (c.colors || []).length && c.colors.every((x) => cols.includes(x)));
        g = 0; while (total(main) < 50 && pool.length && g++ < 3000) add(main, pool[Math.floor(rng() * pool.length)].id, 1);
      }
      while (total(eggs) > 5) { const k = Object.keys(eggs).pop(); eggs[k]--; if (!eggs[k]) delete eggs[k]; }
      if (!total(eggs)) continue;
      const d = { name: st, main, digitama: eggs };
      if (total(main) === 50 && S.deckLegality(d).ok) out.push(d);
    }
    return out;
  }
  function buildBaselines(n, seed) { // random colour-coherent decks made "by hand"-style: random cards per level (test-cpu coherentDeck) / chain-following theme decks (cpu-hunt genTheme)
    const rng = D.mulberry32(seed); const pick = (a) => a[Math.floor(rng() * a.length)];
    const cards = Object.values(S.CARDS).filter((c) => !c.isToken && !c.isParallel);
    const COL = D.COLORS; const out = []; let guard = 0;
    while (out.length < n && guard++ < 400) {
      const cols = rng() < 0.5 ? [pick(COL)] : [...new Set([pick(COL), pick(COL)])];
      const ok = (c) => (c.colors || []).length && c.colors.every((x) => cols.includes(x));
      const byLv = (lv) => cards.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
      const eggs = cards.filter((c) => c.category === 'digitama' && ok(c));
      const tamers = cards.filter((c) => c.category === 'tamer' && ok(c)), opts = cards.filter((c) => c.category === 'option' && ok(c));
      if (!eggs.length || byLv(3).length < 4 || byLv(4).length < 4) continue;
      const main = {}, dig = {};
      const add = (t, c, max) => { const cur = t[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; t[c.id] = cur + 1; return true; };
      const theme = out.length % 2 === 1;
      const fill = (pool, k) => { let t = 0, g = 0; while (g < k && pool.length && t++ < 400) if (add(main, pick(pool), 4)) g++; };
      for (let i = 0; i < 5; i++) add(dig, pick(eggs), 4);
      if (theme) { // follow a chain of legal evolutions
        let cur = pick(byLv(3)); let g = 0;
        while (sum(main) < 34 && g++ < 60 && cur) { for (let i = 0; i < 1 + Math.floor(rng() * 3); i++) add(main, cur, 4); const nx = byLv(cur.level + 1).filter((d) => { try { return E.canEvolveAny(cur.id, d.id, [], null).ok; } catch (e) { return false; } }); cur = nx.length ? pick(nx) : pick(byLv(3)); }
        fill(tamers, 4); fill(opts, 6);
      } else { fill(byLv(3), 14); fill(byLv(4), 11); fill(byLv(5), 8); fill(byLv(6), 3); fill(tamers, 4); fill(opts, 6); }
      const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts]; let g2 = 0; while (sum(main) < 50 && any.length && g2++ < 2000) add(main, pick(any), 4);
      const d = { name: 'baseline' + (out.length + 1) + (theme ? 't' : 'r'), main, digitama: dig };
      if (sum(main) === 50 && S.deckLegality(d).ok) out.push(d);
    }
    return out;
  }

  // ============================================================ evolutionary search
  const pairKey = (deck) => (deck.colors || D.deckColors(deck)).join('+');
  const slim = (deck) => ({ name: deck.name, colors: deck.colors, main: deck.main, digitama: deck.digitama });
  const wilson = (w, n, z = 1.96) => { if (!n) return [0, 1]; const p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };

  async function evalAgainst(cands, opps, reps, level, seedBase) { // -> per candidate {w (win points), n, stall, err}
    const jobs = []; const meta = [];
    cands.forEach((c, ci) => opps.forEach((o, oi) => { if (o.hash && o.hash === c.hash) return; jobs.push({ a: slim(c.deck), b: slim(o.deck), reps, level, seed: (seedBase * 1000003 + ci * 7919 + oi * 104729) >>> 0 }); meta.push(ci); }));
    const res = await runJobs(jobs);
    const out = cands.map(() => ({ w: 0, n: 0, stall: 0, err: 0, wins: 0, draw: 0 }));
    res.forEach((r, i) => { const o = out[meta[i]]; o.w += r.aw + 0.5 * r.draw; o.wins += r.aw; o.draw += r.draw; o.n += r.n; o.stall += r.stall; o.err += r.err; });
    return out;
  }
  const asOpp = (deck, extra = {}) => ({ deck, hash: D.deckHash(deck), ...extra });

  async function evolve() {
    const POP = Number(flag('pop', 36)), MINUTES = Number(flag('minutes', 28)), MAXGEN = Number(flag('gens', 999)), REPS = Number(flag('reps', 2));
    const NORMAL_FRAC = Number(flag('normalfrac', 0.3)); const FORCE_LEVEL = flag('level', null);
    const T0 = Date.now();
    let st;
    if (flag('resume', false) && fs.existsSync(STATE)) { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); log(`RESUME gen ${st.gen}, elapsed ${(st.elapsedMs / 60000).toFixed(1)} min`); }
    else {
      st = { gen: 0, elapsedMs: 0, pop: [], hof: [], archive: {}, curve: [], cfg: { POP, SEED, REPS }, gen0: [] };
      const rng = D.mulberry32(SEED * 31 + 7); const combos = D.colorCombos(); let g = 0; const seen = new Set();
      while (st.pop.length < POP && g++ < POP * 20) {
        const cols = combos[st.pop.length % combos.length]; // cover mono + pair colour sets round-robin
        const ge = D.genGenome(rng, { colors: cols }); if (!ge) continue;
        const deck = D.compile(ge, rng); if (!deck) continue; const h = D.deckHash(deck); if (seen.has(h)) continue; seen.add(h);
        st.pop.push({ g: D.syncGenome(ge, deck), deck: slim(deck), hash: h, fit: null, games: 0, born: 0 });
      }
      if (humanTrain.length && HUMAN_SEED > 0) { // replace part of the population with human decks (exact, converted to genomes) and mutants of them
        const want = Math.round(POP * HUMAN_SEED); const hr2 = D.mulberry32(SEED * 55 + 3); const hs = new Set(st.pop.map((x) => x.hash)); const seeds = []; let k = 0;
        for (const hd of humanTrain) { if (seeds.length >= Math.ceil(want / 2)) break; const r = D.genomeFromDeck({ main: hd.main, digitama: hd.digitama }, hr2); if (!r) continue; seeds.push(r); }
        const made = []; const addP = (g, deck) => { const h = D.deckHash(deck); if (hs.has(h)) return false; hs.add(h); made.push({ g: D.syncGenome(g, deck), deck: slim(deck), hash: h, fit: null, games: 0, born: 0, human: true }); return true; };
        for (const r of seeds) addP(r.g, r.deck);
        let gg = 0; while (made.length < want && seeds.length && gg++ < want * 40) { const r = seeds[Math.floor(hr2() * seeds.length)]; const ge = D.mutate(r.g, hr2); if (!ge) continue; const deck = D.compile(ge, hr2); if (deck) addP(ge, deck); }
        st.pop = [...made.slice(0, want), ...st.pop.slice(0, POP - Math.min(want, made.length))];
        log(`HUMAN SEED: ${seeds.length} human genomes convertible, ${Math.min(want, made.length)} human-derived individuals in the initial population`);
      }
      st.gen0 = st.pop.map((x) => slim(x.deck));
      log(`INIT population ${st.pop.length} (colour sets: ${[...new Set(st.pop.map((x) => pairKey(x.deck)))].length})`);
    }
    const budgetMs = MINUTES * 60000; const base0 = st.elapsedMs; const elapsed = () => base0 + (Date.now() - T0);
    while (st.gen < MAXGEN && elapsed() < budgetMs) {
      const tg = Date.now(); const gen = st.gen;
      const frac = elapsed() / budgetMs;
      const level = FORCE_LEVEL || (frac < NORMAL_FRAC ? 'normal' : 'hard');
      // gauntlet for this generation (same opponents for everyone -> paired comparison)
      const gr = D.mulberry32(SEED * 977 + gen * 13 + 5); const shuffled = (a) => a.map((x) => [gr(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
      const opps = [...shuffled(starters).slice(0, 6).map((d) => asOpp(d, { tag: 'st' })), ...shuffled(baselines).slice(0, 4).map((d) => asOpp(d, { tag: 'bl' })), ...shuffled(st.hof).slice(0, 5).map((h) => asOpp(h.deck, { tag: 'hof' })), ...shuffled(humanTrain).slice(0, HUMAN_OPPS).map((h) => asOpp({ name: h.name, main: h.main, digitama: h.digitama }, { tag: 'human' }))];
      const ev = await evalAgainst(st.pop, opps, REPS, level, SEED * 100 + gen);
      st.pop.forEach((ind, i) => { const e = ev[i]; if (!e.n) return; const wr = e.w / e.n; ind.cur = wr; ind.fit = ind.fit == null ? wr : 0.5 * wr + 0.5 * ind.fit; ind.games += e.n; ind.stall = (ind.stall || 0) + e.stall; ind.err = (ind.err || 0) + e.err; ind.lastLevel = level; });
      const ranked = st.pop.slice().sort((a, b) => b.fit - a.fit);
      const best = ranked[0]; const curs = st.pop.map((x) => x.cur).filter((x) => x != null);
      const mean = curs.reduce((a, b) => a + b, 0) / curs.length;
      const pairs = {}; for (const ind of st.pop) pairs[pairKey(ind.deck)] = (pairs[pairKey(ind.deck)] || 0) + 1;
      // archive: top 8 per colour pair (by smoothed fitness)
      for (const ind of st.pop) { const k = pairKey(ind.deck); const arr = (st.archive[k] = st.archive[k] || []); const ex = arr.find((x) => x.hash === ind.hash); if (ex) { ex.fit = ind.fit; ex.games = ind.games; } else arr.push({ hash: ind.hash, deck: ind.deck, g: ind.g, fit: ind.fit, games: ind.games, gen }); arr.sort((a, b) => b.fit - a.fit); st.archive[k] = arr.slice(0, 8); }
      // hall of fame: generation champion (+ best per pair every 4 gens), cap 12
      const addHof = (ind) => { if (!st.hof.some((h) => h.hash === ind.hash)) st.hof.push({ hash: ind.hash, deck: ind.deck, g: ind.g, fit: ind.fit, gen, name: ind.deck.name }); };
      addHof(best);
      if (gen % 4 === 3) { const seenP = new Set(); for (const ind of ranked) { const k = pairKey(ind.deck); if (!seenP.has(k) && seenP.size < 4) { seenP.add(k); addHof(ind); } } }
      while (st.hof.length > 12) { let wi = 0; st.hof.forEach((h, i) => { if (h.fit < st.hof[wi].fit) wi = i; }); st.hof.splice(wi, 1); }
      // ---- breed
      const rng = D.mulberry32(SEED * 4099 + gen * 31 + 11);
      const rankInPair = new Map(); { const cnt = {}; for (const ind of ranked) { const k = pairKey(ind.deck); rankInPair.set(ind, cnt[k] || 0); cnt[k] = (cnt[k] || 0) + 1; } }
      const adj = (ind) => ind.fit - 0.02 * rankInPair.get(ind); // diversity pressure: crowding inside a colour pair costs fitness
      const tourn = () => { let b = null; for (let i = 0; i < 3; i++) { const c = st.pop[Math.floor(rng() * st.pop.length)]; if (!b || adj(c) > adj(b)) b = c; } return b; };
      const elites = []; const eset = new Set();
      const addE = (ind) => { if (!eset.has(ind.hash)) { eset.add(ind.hash); elites.push(ind); } };
      ranked.slice(0, 4).forEach(addE);
      { const seenP = new Set(); for (const ind of ranked) { const k = pairKey(ind.deck); if (!seenP.has(k) && elites.length < Math.floor(POP / 3)) { seenP.add(k); addE(ind); } } }
      const next = elites.map((x) => ({ ...x }));
      const seen = new Set(next.map((x) => x.hash));
      const nImm = Math.max(2, Math.round(POP * 0.12));
      const combos = D.colorCombos(); const cnt = {}; for (const x of next) cnt[pairKey(x.deck)] = (cnt[pairKey(x.deck)] || 0) + 1;
      let guard = 0;
      while (next.length < POP && guard++ < POP * 30) {
        let ge;
        if (next.length >= POP - nImm) { const under = combos.slice().sort((a, b) => (cnt[a.join('+')] || 0) - (cnt[b.join('+')] || 0)); ge = D.genGenome(rng, { colors: under[Math.floor(rng() * Math.min(10, under.length))] }); }
        else {
          const A = tourn(); ge = A.g;
          if (rng() < 0.6) { const B = tourn(); ge = D.crossover(A.g, B.g, rng); }
          if (rng() < 0.9 || ge === A.g) ge = D.mutate(ge, rng);
        }
        if (!ge) continue;
        const deck = D.compile(ge, rng); if (!deck) continue; const h = D.deckHash(deck); if (seen.has(h)) continue; seen.add(h);
        next.push({ g: D.syncGenome(ge, deck), deck: slim(deck), hash: h, fit: null, games: 0, born: gen + 1 }); cnt[pairKey(deck)] = (cnt[pairKey(deck)] || 0) + 1;
      }
      st.pop = next; st.gen = gen + 1; const dt = Date.now() - tg; st.elapsedMs = elapsed();
      const nGames = ev.reduce((a, b) => a + b.n, 0);
      const rec = { gen, level, best: +best.fit.toFixed(3), bestCur: +best.cur.toFixed(3), mean: +mean.toFixed(3), top5: +(ranked.slice(0, 5).reduce((a, b) => a + b.fit, 0) / 5).toFixed(3), pairs: Object.keys(pairs).length, opps: opps.length, games: nGames, sec: +(dt / 1000).toFixed(1), bestName: best.deck.name, bestPair: pairKey(best.deck), stallRate: +(ev.reduce((a, b) => a + b.stall, 0) / Math.max(1, nGames)).toFixed(4), errRate: +(ev.reduce((a, b) => a + b.err, 0) / Math.max(1, nGames)).toFixed(4) };
      st.curve.push(rec);
      log(`gen ${String(gen).padStart(3)} [${level}] best ${rec.best} (cur ${rec.bestCur}) top5 ${rec.top5} mean ${rec.mean} pairs ${rec.pairs} games ${nGames} ${rec.sec}s  ${rec.bestPair} ${rec.bestName}`);
      fs.writeFileSync(STATE + '.tmp', JSON.stringify(st)); fs.renameSync(STATE + '.tmp', STATE);
    }
    log('evolution finished: gens ' + st.gen + ', ' + (st.elapsedMs / 60000).toFixed(1) + ' min');
    await finalize(st);
  }

  // ============================================================ finalize: full-gauntlet re-evaluation + export
  async function finalize(stIn) {
    const st = stIn || JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const PER_PAIR_EVAL = Number(flag('evalper', 3)), PER_PAIR_EXPORT = Number(flag('nper', 3)), REPS = Number(flag('freps', 2)); // stage-2 reps
    const fin = [];
    for (const [k, arr] of Object.entries(st.archive)) for (const a of arr.slice(0, PER_PAIR_EVAL)) fin.push({ deck: a.deck, hash: a.hash, gen: a.gen, g: a.g, evolvedFit: a.fit });
    for (const h of st.hof) if (!fin.some((f) => f.hash === h.hash)) fin.push({ deck: h.deck, hash: h.hash, gen: h.gen, g: h.g, evolvedFit: h.fit });
    for (const p of st.pop) if (!fin.some((f) => f.hash === p.hash)) fin.push({ deck: p.deck, hash: p.hash, gen: p.born, g: p.g, evolvedFit: p.fit });
    // full gauntlet: every starter + every baseline + hall of fame + the champions of every colour pair
    const opps = [...starters.map((d) => asOpp(d, { tag: 'st' })), ...baselines.map((d) => asOpp(d, { tag: 'bl' })), ...st.hof.map((h) => asOpp(h.deck, { tag: 'hof' })), ...humanTrain.slice(0, Number(flag('human-final', 12))).map((h) => asOpp({ name: h.name, main: h.main, digitama: h.digitama }, { tag: 'human' }))];
    log(`FINALIZE: ${fin.length} finalists x ${opps.length} opponents x 2 games (hard), then stage 2`);
    const ev = await evalAgainst(fin, opps, 1, 'hard', 90210 + SEED);
    fin.forEach((f, i) => { f.w = ev[i].w; f.games = ev[i].n; f.stall = ev[i].stall; f.err = ev[i].err; f.wr = f.w / Math.max(1, f.games); });
    { // stage 2: the best few per colour set play more games (fresh seeds) -> tighter estimate
      const g2 = {}; for (const f of fin) (g2[f.deck.colors.join('+')] = g2[f.deck.colors.join('+')] || []).push(f);
      const top = []; for (const arr of Object.values(g2)) { arr.sort((x, y) => y.wr - x.wr); top.push(...arr.slice(0, 4)); }
      log('stage 2: ' + top.length + ' decks x ' + opps.length + ' opponents x ' + REPS * 2 + ' more games');
      const ev2 = await evalAgainst(top, opps, REPS, 'hard', 31337 + SEED);
      top.forEach((f, i) => { f.w += ev2[i].w; f.games += ev2[i].n; f.stall += ev2[i].stall; f.err += ev2[i].err; f.wr = f.w / f.games; f.stage2 = true; });
    }
    const decks = []; const by = {};
    for (const f of fin) { const k = f.deck.colors.join('+'); (by[k] = by[k] || []).push(f); }
    for (const [k, arr] of Object.entries(by)) {
      arr.sort((a, b) => b.wr - a.wr);
      let n = 0;
      for (const f of arr.filter((x) => x.stage2)) {
        if (n >= PER_PAIR_EXPORT) break;
        if (f.wr < 0.5) continue;
        if (humanHashes.has(D.deckHash(f.deck))) { log('  drop (identical to a human deck): ' + f.deck.name); continue; }
        const chk = D.checkDeck(f.deck); if (!chk.ok) { log('  drop (checkup): ' + f.deck.name + ' ' + chk.errors.join('; ')); continue; }
        n++;
        decks.push({ name: `${f.deck.name} #${n}`, colors: f.deck.colors, main: f.deck.main, digitama: f.deck.digitama, winrate: +f.wr.toFixed(4), games: f.games, generation: f.gen });
      }
    }
    decks.sort((a, b) => b.winrate - a.winrate);
    const out = { version: 1, ...(humanTrain.length ? { source: 'human-seeded' } : {}), note: 'evolved by scripts/evolve-decks.mjs; winrate = win rate vs the full gauntlet (starters + baselines + hall of fame), CPU hard, both seats', generations: st.gen, avoid: AVOID, decks };
    fs.writeFileSync(OUT, JSON.stringify(out));
    fs.writeFileSync(path.join(SCRATCH, 'finalists.json'), JSON.stringify(fin.map((f) => ({ name: f.deck.name, colors: f.deck.colors, wr: f.wr, games: f.games, gen: f.gen, evolvedFit: f.evolvedFit }))));
    log(`EXPORT ${decks.length} decks in ${Object.keys(by).length} colour sets -> ${OUT}`);
    for (const d of decks.slice(0, 12)) log(`  ${(d.winrate * 100).toFixed(1)}%  ${d.colors.join('+')}  ${d.name}  (gen ${d.generation}, ${d.games} games)`);
  }

  // ============================================================ verify: fresh-seed head to head
  async function verify() {
    const N = Number(flag('n', 400)); const LEVEL = String(flag('level', 'hard'));
    const file = JSON.parse(fs.readFileSync(OUT, 'utf8')); const decks = (Array.isArray(file) ? file : file.decks);
    const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
    const gen0 = (st && st.gen0) || [];
    const top = decks.slice(0, Number(flag('top', 12)));
    const rows = []; const seed0 = 5551212 + SEED;
    const suites = [['starters', starters], ['baselines', baselines], ['gen0-random', gen0.slice(0, 12)]];
    // evolved decks
    for (const s of top.map((d) => ({ label: d.name, deck: { name: d.name, main: d.main, digitama: d.digitama } }))) {
      const row = { name: s.label, colors: (decks.find((d) => d.name === s.label) || {}).colors, exported: (decks.find((d) => d.name === s.label) || {}).winrate };
      for (const [sn, opps] of suites) {
        if (!opps.length) continue;
        const reps = Math.ceil(N / (opps.length * 2)); const jobs = opps.map((o, oi) => ({ a: s.deck, b: o, reps, level: LEVEL, seed: (seed0 + oi * 101 + rows.length * 9973) >>> 0 }));
        const rs = await runJobs(jobs); const w = rs.reduce((a, r) => a + r.aw + 0.5 * r.draw, 0), n = rs.reduce((a, r) => a + r.n, 0), stall = rs.reduce((a, r) => a + r.stall + r.err, 0);
        const [lo, hi] = wilson(w, n); row[sn] = { wr: w / n, lo, hi, n, stall };
      }
      rows.push(row); log(`verify ${row.name}: ` + suites.map(([sn]) => row[sn] ? `${sn} ${(row[sn].wr * 100).toFixed(1)}% [${(row[sn].lo * 100).toFixed(1)}-${(row[sn].hi * 100).toFixed(1)}] n=${row[sn].n}` : '').join('  '));
    }
    // controls: what the same numbers look like for non-evolved decks (baselines, generation-0 random) vs the starters
    const controls = [];
    for (const [label, list] of [['baseline decks (hand-style)', baselines], ['generation-0 random-generator decks', gen0.slice(0, 12)]]) {
      if (!list.length) continue;
      const row = { name: label };
      const opps = starters; const per = Math.ceil(N / (list.length * 2));
      const jobs = []; list.forEach((d, di) => { const o = opps[di % opps.length]; for (let k = 0; k < 1; k++) jobs.push({ a: { name: d.name, main: d.main, digitama: d.digitama }, b: o, reps: per, level: LEVEL, seed: (seed0 + 700 + di * 17) >>> 0 }); });
      const rs = await runJobs(jobs); const w = rs.reduce((a, r) => a + r.aw + 0.5 * r.draw, 0), n = rs.reduce((a, r) => a + r.n, 0);
      const [lo, hi] = wilson(w, n); row.starters = { wr: w / n, lo, hi, n }; controls.push(row); log(`control ${label}: vs starters ${(w / n * 100).toFixed(1)}% [${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}] n=${n}`);
    }
    // aggregate over all shipped decks
    const agg = {};
    for (const [sn] of suites) { let w = 0, n = 0; for (const r of rows) if (r[sn]) { w += r[sn].wr * r[sn].n; n += r[sn].n; } if (n) { const [lo, hi] = wilson(w, n); agg[sn] = { wr: w / n, lo, hi, n }; } }
    log('AGG ' + JSON.stringify(agg));
    const outJ = String(flag('out-json', path.join(SCRATCH, 'verify.json')));
    fs.writeFileSync(outJ, JSON.stringify({ N, level: LEVEL, rows, controls, agg }, null, 1)); log('verify written ' + outJ);
  }
  // ============================================================ h2h: group-vs-group head to head (fresh seeds, both seats), Wilson CIs
  async function h2h() {
    const N = Number(flag('n', 600)); const LEVEL = String(flag('level', 'hard')); const TOP = Number(flag('top', 12));
    const dk = (d) => ({ name: d.name, main: d.main, digitama: d.digitama });
    const newF = JSON.parse(fs.readFileSync(OUT, 'utf8')); const oldF = JSON.parse(fs.readFileSync(String(flag('old', path.join(SCRATCH, 'cpu-decks-old.json'))), 'utf8'));
    const groups = { 'evolved-from-human': newF.decks.slice(0, TOP).map(dk), 'human-holdout': humanHold.slice(0, 40).map(dk), 'old-cpu-decks': oldF.decks.slice(0, TOP).map(dk), starters: starters.slice(0, 21), baselines: baselines.slice(0, 12) };
    const names = Object.keys(groups); const res = []; let seedI = 0; const r = D.mulberry32(SEED + 99);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const A = groups[names[i]], B = groups[names[j]]; if (!A.length || !B.length) continue;
      const jobs = []; for (let k = 0; k < Math.ceil(N / 2); k++) jobs.push({ a: A[k % A.length], b: B[Math.floor(r() * B.length)], reps: 1, level: LEVEL, seed: (7770000 + SEED * 131 + (seedI++) * 7919) >>> 0 });
      const rs = await runJobs(jobs); const w = rs.reduce((x, q) => x + q.aw + 0.5 * q.draw, 0), n = rs.reduce((x, q) => x + q.n, 0), bad = rs.reduce((x, q) => x + q.stall + q.err, 0);
      const [lo, hi] = wilson(w, n); res.push({ a: names[i], b: names[j], wr: w / n, lo, hi, n, bad }); log(`h2h ${names[i]} vs ${names[j]}: ${(w / n * 100).toFixed(1)}% [${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}] n=${n} stall/err ${bad}`);
    }
    // each individual evolved deck vs the human holdout
    const per = []; for (const d of groups['evolved-from-human']) { const jobs = groups['human-holdout'].map((o, oi) => ({ a: d, b: o, reps: Math.max(1, Math.ceil(N / groups['human-holdout'].length / 2)), level: LEVEL, seed: (8880000 + oi * 31 + per.length * 977) >>> 0 })); const rs = await runJobs(jobs); const w = rs.reduce((x, q) => x + q.aw + 0.5 * q.draw, 0), n = rs.reduce((x, q) => x + q.n, 0); const [lo, hi] = wilson(w, n); per.push({ name: d.name, vsHumanHoldout: { wr: w / n, lo, hi, n } }); log(`  ${d.name} vs human holdout ${(w / n * 100).toFixed(1)}% [${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}] n=${n}`); }
    fs.writeFileSync(String(flag('out-json', path.join(SCRATCH, 'h2h.json'))), JSON.stringify({ N, level: LEVEL, res, per }, null, 1));
  }
  try {
    if (MODE === 'evolve') await evolve();
    else if (MODE === 'finalize') await finalize();
    else if (MODE === 'verify') await verify();
    else if (MODE === 'h2h') await h2h();
    else console.log('unknown mode');
  } finally { shutdown(); }
}
