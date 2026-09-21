import { parentPort, workerData } from 'worker_threads';
import * as L from './lib.mjs';
import { EXPS, POOL_N } from './exp.mjs';
await L.init();
L.seedMath(L.hashSeed('pool-v1'));
const pool = []; let g = 0; while (pool.length < POOL_N && g++ < 400) { const d = L.genDeck('P' + pool.length); if (d) pool.push(d); }
const starters = L.starterDecks();
const ctx = { pool, starters };
const exp = EXPS[workerData.exp];
const N = workerData.N || exp.N;
const out = [];
for (let i = workerData.idx; i < N; i += workerData.W) {
  const spec = exp.gen(i, ctx);
  if (!spec) continue;
  const rec = await L.playGame(spec);
  rec.meta = spec.meta; rec.i = i;
  if (spec.saveDecks) { const enc = (d) => Object.entries(d.main).map(([k, q]) => k + ':' + q).join(',') + '|' + Object.entries(d.digitama).map(([k, q]) => k + ':' + q).join(','); rec.deckStr = { p1: enc(spec.deck.p1), p2: enc(spec.deck.p2) }; rec.cols = { p1: spec.deck.p1.cols.join('+'), p2: spec.deck.p2.cols.join('+') }; }
  out.push(rec);
  if (out.length % 500 === 0) parentPort.postMessage({ progress: out.length });
}
parentPort.postMessage({ done: true, out });
