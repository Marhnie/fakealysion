// Runs every scripts/qa/qa-slice5-*.mjs and prints a summary line: node scripts/qa/run-slice5.mjs < /dev/null
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, total = 0, bad = 0;
for (const f of fs.readdirSync(dir).filter(f => /^qa-slice5-.*\.mjs$/.test(f)).sort()) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = String(r.stdout) + String(r.stderr); const m = out.match(/(\d+)\/(\d+) passed/);
  if (!m) { console.log(`CRASH ${f}\n${out.slice(-400)}`); bad++; continue; }
  pass += +m[1]; total += +m[2]; if (m[1] !== m[2]) { bad++; console.log(out.split('\n').filter(l => /^FAIL/.test(l)).join('\n')); }
  console.log(`${f}: ${m[1]}/${m[2]}`);
}
console.log(`TOTAL ${pass}/${total} scenarios passed, ${bad} failing files`); process.exitCode = bad ? 1 : 0;
