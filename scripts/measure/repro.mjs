// reproducibility check: replays games of an experiment by index and compares with the stored raw record (winner, turnNumber, actions, turn table)
import * as fs from 'fs';
import * as L from './lib.mjs';
import { EXPS, POOL_N } from './exp.mjs';
const exp = process.argv[2] || 'base', n = Number(process.argv[3] || 20);
const dir = process.env.MEASURE_OUT || 'D:/measure-out';
await L.init();
L.seedMath(L.hashSeed('pool-v1'));
const pool = []; let g = 0; while (pool.length < POOL_N && g++ < 400) { const d = L.genDeck('P' + pool.length); if (d) pool.push(d); }
const ctx = { pool, starters: L.starterDecks() };
const stored = JSON.parse(fs.readFileSync(`${dir}/${exp}.json`, 'utf8'));
let same = 0, tot = 0;
for (const s of stored.slice(0, n)) {
  const spec = EXPS[exp].gen(s.i, ctx); const r = await L.playGame(spec);
  tot++; if (r.winner === s.winner && r.turnNumber === s.turnNumber && r.actions === s.actions && JSON.stringify(r.turns) === JSON.stringify(s.turns)) same++;
}
console.log(`repro ${exp}: ${same}/${tot} identical replays`);
