// Runs N rule-oracle workers in parallel (child processes) and merges their JSON reports:
//   node scripts/run-oracle-parallel.mjs <gamesPerWorker> <workers> [baseSeed] [levels] < /dev/null
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
const G = Number(process.argv[2] || 500), W = Number(process.argv[3] || 4), BASE = Number(process.argv[4] || 1000), LEV = process.argv[5] || 'mix';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-'));
const runs = [];
for (let w = 0; w < W; w++) {
  const out = path.join(tmp, `w${w}.json`); const seed = BASE + w * 1000003;
  runs.push(new Promise((res) => { const c = spawn(process.execPath, [fileURLToPath(new URL('./rule-oracle.mjs', import.meta.url)), String(G), '--seed', String(seed), '--levels', LEV, '--json', out], { stdio: ['ignore', 'ignore', 'inherit'] }); c.on('close', () => res(out)); }));
}
const outs = await Promise.all(runs);
const agg = {}, errs = {}; let games = 0, evals = {}, viol = {};
for (const o of outs) { if (!fs.existsSync(o)) continue; const j = JSON.parse(fs.readFileSync(o, 'utf8')); games += j.games; for (const [id, c] of Object.entries(j.cat)) { evals[id] = (evals[id] || 0) + c.evals; viol[id] = (viol[id] || 0) + c.viol; } for (const [id, a] of Object.entries(j.agg)) { const x = (agg[id] ||= { n: 0, games: 0, ex: [] }); x.n += a.n; x.games += a.games; for (const e of a.ex) if (x.ex.length < 3) x.ex.push(e); } for (const [k, v] of Object.entries(j.errs)) (errs[k] ||= { n: 0, seed: v.seed }).n += v.n; }
console.log(`PARALLEL ORACLE: ${games} games in ${W} workers; checks exercised ${Object.values(evals).filter((n) => n > 0).length}/${Object.keys(evals).length}, evaluations ${Object.values(evals).reduce((a, b) => a + b, 0)}`);
console.log('never exercised:', Object.keys(evals).filter((k) => !evals[k]).join(' ') || '-');
for (const id of Object.keys(agg).sort((a, b) => agg[b].n - agg[a].n)) { const a = agg[id]; console.log(`\n[${id}] count ${a.n} in ${a.games} games`); for (const e of a.ex) console.log(`  seed ${e.seed} game ${e.game} turn ${e.turn} step ${e.step} ${e.action}: ${e.detail}\n    log: ${e.log.slice(-5).join(' | ')}`); }
console.log('\nEXCEPTIONS', Object.keys(errs).length); for (const k of Object.keys(errs).slice(0, 10)) console.log(' ', errs[k].n, k, 'seed', errs[k].seed);
fs.writeFileSync(path.join(tmp, 'merged.json'), JSON.stringify({ games, evals, viol, agg, errs }, null, 1));
console.log('merged report:', path.join(tmp, 'merged.json'));
