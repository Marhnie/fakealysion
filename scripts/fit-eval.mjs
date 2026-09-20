// Fits the leaf evaluation of the lookahead search (src/cpueval.js) by logistic regression on heuristic-vs-heuristic self-play.
//   gen:  node scripts/fit-eval.mjs gen <games> <outFile> < /dev/null      (positions = start of a main phase, label = eventual winner)
//   fit:  node scripts/fit-eval.mjs fit <file> [<file>…] < /dev/null      (prints EVAL_WEIGHTS for src/cpueval.js)
import * as fs from 'fs';
const mode = process.argv[2];
if (mode === 'fit') {
  const { FEATURE_NAMES } = await import('../src/cpueval.js').catch(() => ({ FEATURE_NAMES: null }));
  const rows = [];
  const dropArg = (process.argv.find((a) => a.startsWith('--drop=')) || '').slice(7).split(',').filter(Boolean);
  const dropIdx = new Set(dropArg.map((nm) => (FEATURE_NAMES || []).indexOf(nm)).filter((i) => i >= 0));
  for (const f of process.argv.slice(3).filter((a) => !a.startsWith('--'))) for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line) rows.push(JSON.parse(line));
  const n = rows.length, d = rows[0].x.length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(1);
  for (const r of rows) for (let i = 0; i < d; i++) mean[i] += r.x[i] / n;
  for (let i = 0; i < d; i++) { let v = 0; for (const r of rows) v += (r.x[i] - mean[i]) ** 2; sd[i] = Math.sqrt(v / n) || 1; }
  mean[0] = 0; sd[0] = 1;
  const X = rows.map((r) => r.x.map((v, i) => (dropIdx.has(i) ? 0 : (v - mean[i]) / sd[i]))), Y = rows.map((r) => r.y);
  // hold out 15% for a sanity check
  const idx = rows.map((_, i) => i).sort(() => Math.random() - 0.5), cut = Math.floor(n * 0.85), tr = idx.slice(0, cut), te = idx.slice(cut);
  const w = new Array(d).fill(0), lam = 1e-3;
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const loss = (set) => { let l = 0, acc = 0; for (const i of set) { let z = 0; for (let k = 0; k < d; k++) z += w[k] * X[i][k]; const p = sig(z); l -= Y[i] * Math.log(p + 1e-12) + (1 - Y[i]) * Math.log(1 - p + 1e-12); if ((p > 0.5) === (Y[i] === 1)) acc++; } return [l / set.length, acc / set.length]; };
  let lr = 0.5;
  for (let it = 0; it < 3000; it++) {
    const g = new Array(d).fill(0);
    for (const i of tr) { let z = 0; for (let k = 0; k < d; k++) z += w[k] * X[i][k]; const e = sig(z) - Y[i]; for (let k = 0; k < d; k++) g[k] += e * X[i][k]; }
    for (let k = 0; k < d; k++) w[k] -= lr * (g[k] / tr.length + lam * w[k]);
    if (it % 500 === 0) console.log('iter', it, 'train', loss(tr).map((v) => v.toFixed(4)).join(' acc '), 'test', loss(te).map((v) => v.toFixed(4)).join(' acc '));
  }
  console.log('final train', loss(tr), 'test', loss(te), 'samples', n);
  // fold the standardisation back into raw-feature weights: z = sum w_k (x_k - mean_k)/sd_k
  const raw = w.map((wk, k) => wk / sd[k]);
  raw[0] = w[0] - w.reduce((a, wk, k) => (k === 0 ? a : a + wk * mean[k] / sd[k]), 0);
  console.log('EVAL_WEIGHTS =', JSON.stringify(raw.map((v) => Number(v.toFixed(4)))));
  if (FEATURE_NAMES) console.log(FEATURE_NAMES.map((nm, i) => nm + ':' + raw[i].toFixed(3)).join('  '));
  process.exit(0);
}
// ---------- gen ----------
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
import { features } from '../src/cpueval.js';
import { createSim } from '../src/cpusim.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const G = Number(process.argv[3] || 100), OUT = process.argv[4] || 'fit.jsonl';
const rnd = (n) => Math.floor(Math.random() * n), pick = (a) => a[rnd(a.length)];
const cards = Object.values(S.CARDS);
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
function coherentDeck(name) {
  const cols = Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])];
  const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel;
  const byLv = (lv) => cards.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
  const eggs = cards.filter((c) => c.category === 'digitama' && ok(c));
  const tamers = cards.filter((c) => c.category === 'tamer' && ok(c));
  const opts = cards.filter((c) => c.category === 'option' && ok(c));
  const main = {}, dig = {};
  const add = (target, c, max) => { const cur = target[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; target[c.id] = cur + 1; return true; };
  const fill = (pool, n) => { let tries = 0, got = 0; while (got < n && pool.length && tries++ < 400) if (add(main, pick(pool), 4)) got++; };
  if (!eggs.length) return null;
  for (let i = 0; i < 5; i++) add(dig, pick(eggs), 4);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  fill(byLv(3), 14); fill(byLv(4), 11); fill(byLv(5), 8); fill(byLv(6), 3); fill(tamers, 4); fill(opts, 6);
  const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts];
  let guard = 0; while (total(main) < 50 && any.length && guard++ < 2000) add(main, pick(any), 4);
  if (total(main) !== 50 || total(dig) < 1) return null;
  const d = { name, main, digitama: dig };
  return S.deckLegality(d).ok ? d : null;
}
const makeDeck = (name) => { let d = null, g = 0; while (!d && g++ < 50) d = coherentDeck(name); return d; };
const LV = [['hard', 'hard'], ['hard', 'normal'], ['normal', 'hard'], ['hard', 'hard']];
const out = [];
let done = 0;
for (let g = 0; g < G; g++) {
  const dA = makeDeck('A'), dB = makeDeck('B'); if (!dA || !dB) continue;
  const lv = pick(LV);
  const cfgs = { p1: { level: lv[0], banned: new Set() }, p2: { level: lv[1], banned: new Set() } };
  const state = S.newGame(dA, dB);
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: () => {} });
  const samples = [];
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
    for (let t = 0; t < 90 && !state.winner; t++) {
      const p = state.activePlayer; const cfg = cfgs[p]; cfg.banned = new Set();
      await sim.beginTurn(p);
      if (state.winner) break;
      if (state.phase === 'main' && state.turnNumber >= 2) samples.push({ p, x: features(state, p) });
      await sim.mainLoop(p, async () => Cpu.planMain(state, p, cfg));
    }
  } catch (e) { continue; }
  if (!state.winner || state.winner === 'draw') continue;
  for (const s of samples) out.push(JSON.stringify({ x: s.x, y: s.p === state.winner ? 1 : 0 }));
  done++;
}
fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log('games', done, 'samples', out.length);
