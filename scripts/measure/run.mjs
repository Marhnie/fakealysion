// node scripts/measure/run.mjs <exp> [N|-] [workers=11] [--out=dir]   -> writes <out>/<exp>.json  (array of per-game records)
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const [, , expName, nArg, wArg] = process.argv;
const W = Number(wArg || 11);
const outArg = process.argv.find((a) => a.startsWith('--out='));
const outDir = outArg ? outArg.slice(6) : process.env.MEASURE_OUT || 'D:/measure-out';
fs.mkdirSync(outDir, { recursive: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const results = []; let done = 0; const prog = new Array(W).fill(0);
await new Promise((res, rej) => {
  for (let w = 0; w < W; w++) {
    const wk = new Worker(path.join(here, 'worker.mjs'), { workerData: { exp: expName, N: nArg && nArg !== '-' ? Number(nArg) : 0, idx: w, W } });
    wk.on('message', (m) => { if (m.progress) prog[w] = m.progress; if (m.done) { results.push(...m.out); if (++done === W) res(); } });
    wk.on('error', rej);
  }
  const iv = setInterval(() => { if (done < W) process.stderr.write(`[${expName}] ${prog.reduce((a, b) => a + b, 0)} games, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); else clearInterval(iv); }, 30000);
});
results.sort((a, b) => a.i - b.i);
fs.writeFileSync(path.join(outDir, expName + '.json'), JSON.stringify(results));
const errs = results.filter((r) => r.err).length, stalls = results.filter((r) => r.stall).length;
console.log(`${expName}: ${results.length} games, errs ${errs}, stalls ${stalls}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
