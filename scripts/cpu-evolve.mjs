// Offline self-play optimiser for the CPU params vector (src/cpu.js TUNE / PARAM_RANGES): separable CMA-ES (diagonal covariance, CSA step size),
// common random numbers (all candidates of a generation play the SAME seeds / decks, both seat orders), a gauntlet (baseline + hall of fame + normal),
// finalists re-evaluated with a larger N on fresh seeds, then confirmed on the held-out validation deck pool.  Runs in Node child processes only.
//
//   node scripts/cpu-evolve.mjs --keys policy|search|all --search none|cheap|'{"nodes":40,"depth":3,"samples":1}' --pop 20 --pairs 20 --gens 40 --minutes 25
//        [--init data-or-json.json] [--seed 1] [--out scratch/run.json] [--workers 11] < /dev/null
// Output JSON: { config, generations:[{gen, best, mean, sigma, meanVsBase, ...}], hof:[…], finalists:[…], best:{params,…} }
import * as fs from 'fs';
import { Pool, summarize } from './arena-pool.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const KEYSET = flag('keys', 'policy');
const POP = Number(flag('pop', 20)), PAIRS = Number(flag('pairs', 20)), GENS = Number(flag('gens', 40)), MINUTES = Number(flag('minutes', 25));
const SEED = Number(flag('seed', 1)), OUT = flag('out', 'evolve-run.json');
const SIGMA0 = Number(flag('sigma', 0.18));
const FINAL_PAIRS = Number(flag('finalPairs', 150));
const sflag = flag('search', 'none');
const SEARCH = sflag === 'none' ? null : sflag === 'cheap' ? { nodes: 40, depth: 3, samples: 1 } : JSON.parse(sflag);

// ranges (duplicated from src/cpu.js PARAM_RANGES / TUNE so that the master needs no game data)
const { PARAM_RANGES, TUNE } = await import('../src/cpu.js');
const POLICY = ['hardReserve', 'hardThrA', 'hardThreshold', 'hardLimit', 'hardGw', 'secDpMid', 'pSecDig', 'hardGain2', 'hardChump', 'gainBase', 'pBlockHi', 'pBlockLo', 'cThr', 'baitBonus', 'dangerLim', 'tieBlockSec', 'chumpVal', 'mullCost', 'mullHiCost'];
const SRCH = ['evSec', 'evBoard', 'evHand', 'evMem', 'evDev', 'evTempo', 'lethalW', 'threatW', 'priorW'];
const KEYS = KEYSET === 'policy' ? POLICY : KEYSET === 'search' ? SRCH : [...POLICY, ...SRCH];
const D = KEYS.length;
const toParams = (x, base) => { const p = { ...(base || {}) }; KEYS.forEach((k, i) => { const [lo, hi] = PARAM_RANGES[k]; p[k] = +(lo + Math.min(1, Math.max(0, x[i])) * (hi - lo)).toFixed(4); }); return p; };
const fromParams = (p) => KEYS.map((k) => { const [lo, hi] = PARAM_RANGES[k]; return Math.min(1, Math.max(0, ((p[k] != null ? p[k] : TUNE[k]) - lo) / (hi - lo))); });
let BASE_PARAMS = {}; // fixed params of the keys NOT evolved in this run (e.g. the stage-1 result while evolving the search params)
const initFile = flag('init', null);
if (initFile) { const j = JSON.parse(fs.readFileSync(initFile, 'utf8')); BASE_PARAMS = j.params || j.best?.params || j; }
const spec = (params) => ({ level: 'hard', search: SEARCH, params });
const baselineSpec = spec(BASE_PARAMS && Object.keys(BASE_PARAMS).length ? { ...BASE_PARAMS, ...Object.fromEntries(KEYS.map((k) => [k, TUNE[k]])) } : null); // baseline = defaults on the evolved keys
const normalSpec = { level: 'normal' };

// ---------- gaussian rng (own seeded) ----------
let gs = (SEED * 2246822519) >>> 0;
const urand = () => { gs = (gs + 0x6D2B79F5) >>> 0; let t = gs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = urand(); v = urand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------- sep-CMA-ES ----------
const n = D, lambda = POP, mu = Math.floor(lambda / 2);
let w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1)); const ws = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / ws);
const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
const cs = (mueff + 2) / (n + mueff + 5), ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs, chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
const cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n), fac = (n + 2) / 3;
const c1 = fac * 2 / ((n + 1.3) ** 2 + mueff), cmu = Math.min(1 - c1, fac * 2 * (mueff - 2 + 1 / mueff) / ((n + 2) ** 2 + mueff));
let m = fromParams(BASE_PARAMS), sigma = SIGMA0, C = new Array(n).fill(1), ps = new Array(n).fill(0), pc = new Array(n).fill(0);

const pool = new Pool(Number(flag('workers', 0)) || undefined);
const T0 = Date.now();
const elapsedMin = () => (Date.now() - T0) / 60000;
const log = [];
const hof = []; // param objects of previous generation means / bests
const say = (s) => { process.stderr.write(s + '\n'); };

// evaluate specs vs an opponent over `pairs` pairs with the given seed base; returns rate per candidate
async function evalVs(candSpecs, oppSpec, pairs, seedBase, poolName = 'train') {
  const tasks = [];
  candSpecs.forEach((cs_, ci) => { for (let i = 0; i < pairs; i++) tasks.push({ pair: i, seed: seedBase + i, pool: poolName, a: cs_, b: oppSpec, ci }); });
  const res = await pool.run(tasks);
  const per = candSpecs.map(() => []);
  res.forEach((r, i) => per[tasks[i].ci].push(r));
  return per.map((rs) => summarize(rs));
}

async function fitness(xs, gen) {
  const cands = xs.map((x) => spec(toParams(x, BASE_PARAMS)));
  const seedBase = SEED * 1000003 + gen * 7919;
  const opps = [{ name: 'base', w: 0.5, spec: baselineSpec }];
  if (hof.length) opps.push({ name: 'hof', w: 0.3, spec: spec(hof[(gen * 7) % hof.length]) });
  opps.push({ name: 'normal', w: hof.length ? 0.2 : 0.5, spec: normalSpec });
  const tot = opps.reduce((a, o) => a + o.w, 0);
  const score = xs.map(() => 0), parts = xs.map(() => ({}));
  for (const o of opps) {
    const ss = await evalVs(cands, o.spec, PAIRS, seedBase + (o.name === 'hof' ? 313 : o.name === 'normal' ? 717 : 0));
    ss.forEach((s, i) => { score[i] += (o.w / tot) * s.rate; parts[i][o.name] = +s.rate.toFixed(3); });
  }
  return { score, parts };
}

say(`sep-CMA-ES keys=${KEYSET}(${D}) pop=${POP} pairs=${PAIRS} search=${JSON.stringify(SEARCH)} sigma0=${SIGMA0} seed=${SEED}`);
let bestEver = null;
for (let g = 0; g < GENS && elapsedMin() < MINUTES; g++) {
  const zs = [], ys = [], xs = [];
  for (let k = 0; k < lambda; k++) {
    const z = Array.from({ length: n }, gauss);
    const x = m.map((mi, i) => Math.min(1, Math.max(0, mi + sigma * Math.sqrt(C[i]) * z[i])));
    if (g === 0 && k === 0) x.splice(0, n, ...m); // the incumbent itself is always in generation 0
    xs.push(x); ys.push(x.map((xi, i) => (xi - m[i]) / sigma));
  }
  const tg = Date.now();
  const { score, parts } = await fitness(xs, g);
  const idx = xs.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  const top = idx[0];
  // update
  const yw = new Array(n).fill(0);
  for (let r = 0; r < mu; r++) for (let i = 0; i < n; i++) yw[i] += w[r] * ys[idx[r]][i];
  m = m.map((mi, i) => Math.min(1, Math.max(0, mi + sigma * yw[i])));
  ps = ps.map((p, i) => (1 - cs) * p + Math.sqrt(cs * (2 - cs) * mueff) * yw[i] / Math.sqrt(C[i]));
  const psn = Math.sqrt(ps.reduce((a, b) => a + b * b, 0));
  const hsig = psn / Math.sqrt(1 - (1 - cs) ** (2 * (g + 1))) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
  pc = pc.map((p, i) => (1 - cc) * p + hsig * Math.sqrt(cc * (2 - cc) * mueff) * yw[i]);
  C = C.map((c, i) => { let s = 0; for (let r = 0; r < mu; r++) s += w[r] * ys[idx[r]][i] ** 2; return Math.max(1e-4, (1 - c1 - cmu) * c + c1 * (pc[i] ** 2 + (1 - hsig) * cc * (2 - cc) * c) + cmu * s); });
  sigma = Math.min(0.5, sigma * Math.exp((cs / ds) * (psn / chiN - 1)));
  const meanScore = score.reduce((a, b) => a + b, 0) / lambda;
  const rec = { gen: g, best: +score[top].toFixed(3), mean: +meanScore.toFixed(3), sigma: +sigma.toFixed(3), parts: parts[top], sec: Math.round((Date.now() - tg) / 1000), min: +elapsedMin().toFixed(1), bestParams: toParams(xs[top], BASE_PARAMS), meanParams: toParams(m, BASE_PARAMS) };
  log.push(rec);
  hof.push(toParams(xs[top], BASE_PARAMS)); if (hof.length > 4) hof.shift();
  if (!bestEver || score[top] > bestEver.score) bestEver = { score: score[top], params: toParams(xs[top], BASE_PARAMS), gen: g };
  say(`gen ${g} best ${rec.best} mean ${rec.mean} sigma ${rec.sigma} parts ${JSON.stringify(rec.parts)} (${rec.sec}s, ${rec.min}min)`);
  fs.writeFileSync(OUT, JSON.stringify({ config: { KEYSET, POP, PAIRS, GENS, SEARCH, SEED, SIGMA0, KEYS }, generations: log, bestEver }, null, 1));
}

// ---------- finalists: last 3 generation bests + the final mean + best-ever, fresh seeds, bigger N, vs the baseline and vs normal ----------
const finalists = [];
const last = log.slice(-3).map((r) => r.bestParams);
const cand = [{ name: 'mean', params: toParams(m, BASE_PARAMS) }, { name: 'bestEver', params: bestEver.params }, ...last.map((p, i) => ({ name: 'lastBest' + i, params: p }))];
say(`finalists: ${cand.length} candidates x ${FINAL_PAIRS * 2} games vs baseline (fresh seeds)`);
const fs0 = 9000000 + SEED * 131;
const ss = await evalVs(cand.map((c) => spec(c.params)), baselineSpec, FINAL_PAIRS, fs0);
ss.forEach((s, i) => finalists.push({ name: cand[i].name, params: cand[i].params, vsBase: +s.rate.toFixed(3), lo: +s.lo.toFixed(3), hi: +s.hi.toFixed(3), games: s.games }));
finalists.sort((a, b) => b.vsBase - a.vsBase);
const win = finalists[0];
// validation on held-out decks (fresh seeds), winner only
const [vs] = await evalVs([spec(win.params)], baselineSpec, FINAL_PAIRS, 8000000 + SEED * 71, 'val');
win.valVsBase = +vs.rate.toFixed(3); win.valLo = +vs.lo.toFixed(3); win.valHi = +vs.hi.toFixed(3); win.valGames = vs.games;
say('finalists: ' + finalists.map((f) => `${f.name} ${f.vsBase} [${f.lo}-${f.hi}]`).join(' | ') + ` ; winner val ${win.valVsBase} [${win.valLo}-${win.valHi}]`);
fs.writeFileSync(OUT, JSON.stringify({ config: { KEYSET, POP, PAIRS, GENS, SEARCH, SEED, SIGMA0, KEYS }, generations: log, bestEver, finalists, best: win, totalGames: null, minutes: +elapsedMin().toFixed(1) }, null, 1));
pool.stop();
process.exit(0);
