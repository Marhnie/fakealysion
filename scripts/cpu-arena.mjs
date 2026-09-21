// CPU measurement rig: plays N games between two CPU configurations on a fixed deck pool (both seat orders, common random numbers),
// parallelised over child processes, and reports the win rate of A with a Wilson 95% CI, average game length and decision time per move.
//
//   node scripts/cpu-arena.mjs --a expert --b hard --games 300 [--seed 1] [--pool train|val|all] [--workers 11] [--json out.json] < /dev/null
//   spec:  easy | normal | hardH (hard heuristic, no search) | hard (= UI 어려움: hard + search, node budget) | expert (tuned params + deeper search)
//          | @file.json   (JSON spec { level, search, params }; params = partial TUNE overrides, see src/cpu.js PARAM_RANGES)
//          | '{"level":"hard","params":{"hardThrA":-1}}'
//   --timing N   REAL wall-clock decision time of hard / expert (single process, wall-clock budgets exactly as the browser uses them) over N decisions
import * as fs from 'fs';
import { Pool, summarize } from './arena-pool.mjs';

export function parseSpec(s) {
  if (!s) throw new Error('missing spec');
  if (s.startsWith('@')) return JSON.parse(fs.readFileSync(s.slice(1), 'utf8'));
  if (s.startsWith('{')) return JSON.parse(s);
  if (s === 'hardH') return { level: 'hard', search: null };
  if (['easy', 'normal', 'hard', 'expert'].includes(s)) return { level: s };
  throw new Error('unknown spec ' + s);
}
export function fmtResult(nameA, nameB, s) {
  return `${nameA} vs ${nameB}: ${s.aWins}-${s.bWins}${s.draws ? '-' + s.draws + 'd' : ''} (games ${s.games}, stalls ${s.stalls}, errs ${s.errs}) ${nameA} winrate ${(100 * s.rate).toFixed(1)}% [95% CI ${(100 * s.lo).toFixed(1)}-${(100 * s.hi).toFixed(1)}], avg turns ${(s.turns / Math.max(1, s.games)).toFixed(1)}, avg decision ${nameA} ${(s.msA / Math.max(1, s.nA)).toFixed(1)}ms / ${nameB} ${(s.msB / Math.max(1, s.nB)).toFixed(1)}ms (max ${s.maxA.toFixed(0)}/${s.maxB.toFixed(0)})`;
}
export async function runMatch(pool, a, b, games, seed, poolName = 'train', onDone) {
  const pairs = Math.ceil(games / 2);
  const tasks = Array.from({ length: pairs }, (_, i) => ({ pair: i, seed: seed * 100003 + i, pool: poolName, a, b }));
  return summarize(await pool.run(tasks, onDone, 1500000)); // search games take minutes: generous per-pair timeout (a hung worker is still killed)
}

// real wall-clock decision-time table: plays `decisions` search decisions of `spec` (vs normal, alternating seats) in THIS process, no contention from workers
export async function timing(spec, decisions, seed = 5) {
  const { init, deckPool, playGame } = await import('./arena-core.mjs');
  await init();
  const dp = deckPool().val, trace = [];
  for (let g = 0; trace.length < decisions && g < 400; g++) {
    const x = (g * 5 + seed) % dp.length, y = (g * 7 + 3 + seed) % dp.length;
    const aFirst = g % 2 === 0;
    await playGame(aFirst ? dp[x] : dp[y], aFirst ? dp[y] : dp[x], aFirst ? spec : { level: 'normal' }, aFirst ? { level: 'normal' } : spec, seed * 1000 + g, { trace, gameMs: 240000 });
  }
  const t = trace.map((r) => r.ms).sort((a, b) => a - b), q = (f) => t[Math.min(t.length - 1, Math.floor(t.length * f))] || 0;
  const avg = (k) => trace.reduce((a, r) => a + r[k], 0) / Math.max(1, trace.length);
  return { n: t.length, median: q(0.5), p95: q(0.95), p99: q(0.99), max: t[t.length - 1] || 0, avgMs: t.reduce((a, b) => a + b, 0) / Math.max(1, t.length), avgDepth: avg('depth'), avgNodes: avg('nodes') };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('cpu-arena.mjs')) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
  const A = flag('a', 'expert'), B = flag('b', 'hard');
  const games = Number(flag('games', 100)), seed = Number(flag('seed', 1)), poolName = flag('pool', 'train');
  const workers = Number(flag('workers', 0)) || undefined;
  if (flag('timing', null)) { const r = await timing(parseSpec(A), Number(flag('timing')), seed); console.log(`timing ${A}: ${r.n} decisions, median ${r.median.toFixed(0)}ms, p95 ${r.p95.toFixed(0)}ms, p99 ${r.p99.toFixed(0)}ms, max ${r.max.toFixed(0)}ms, mean ${r.avgMs.toFixed(0)}ms, avg depth ${r.avgDepth.toFixed(2)}, avg nodes ${r.avgNodes.toFixed(0)}`); process.exit(0); }
  const pool = new Pool(workers);
  const t0 = Date.now();
  const s = await runMatch(pool, parseSpec(A), parseSpec(B), games, seed, poolName, (d, n) => { if (d % 25 === 0) process.stderr.write(`  ${d}/${n} pairs ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); });
  console.log(fmtResult(A.length > 20 ? 'A' : A, B.length > 20 ? 'B' : B, s), ` [${((Date.now() - t0) / 1000).toFixed(0)}s, pool=${poolName}, seed=${seed}]`);
  if (s.errList.length) console.log('errors:', [...new Set(s.errList)].slice(0, 5));
  const jo = flag('json', null); if (jo) fs.writeFileSync(jo, JSON.stringify({ a: A, b: B, games, seed, poolName, ...s }, null, 1));
  pool.stop();
  process.exit(0);
}
