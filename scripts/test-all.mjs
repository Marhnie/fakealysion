// One-command regression run: syntax check, every scripts/test-*.mjs, effect coverage audit (expects 100%), soak 60, fuzz 200.
// Prints a one-page summary and exits non-zero if anything failed.   Run: node scripts/test-all.mjs [--quick]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const rows = [];
function run(name, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: opts.timeout || 600000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = String(r.stdout || '') + String(r.stderr || '');
  let ok = r.status === 0 && !r.error, note = '';
  if (r.error) note = String(r.error.message).slice(0, 60);
  if (opts.judge) { const j = opts.judge(out, r.status); ok = j.ok; note = j.note || note; }
  rows.push({ name, ok, note, secs: ((Date.now() - t0) / 1000).toFixed(1), out });
}
run('check-syntax', ['scripts/check-syntax.mjs'], { judge: (o, s) => ({ ok: s === 0, note: (o.trim().split('\n').pop() || '').slice(0, 70) }) });
for (const f of fs.readdirSync(path.join(root, 'scripts')).filter(f => /^test-.*\.mjs$/.test(f) && f !== 'test-all.mjs').sort()) {
  run(f, ['scripts/' + f], { judge: (o, s) => ({ ok: s === 0, note: (o.trim().split('\n').pop() || '').slice(0, 70) }) });
}
run('audit-effects', ['scripts/audit-effects.mjs'], { judge: (o) => { const m = o.match(/"coveragePct":\s*"([\d.]+)%"/); return { ok: !!m && Number(m[1]) >= 100, note: m ? m[1] + '%' : 'no coverage output' }; } });
run('soak 60', ['scripts/soak.mjs', quick ? '15' : '60'], { judge: (o) => { const m = o.match(/distinct errors:\s*(\d+)/); return { ok: !!m && Number(m[1]) === 0, note: m ? m[1] + ' distinct errors' : 'no summary' }; } });
run('fuzz 200', ['scripts/fuzz.mjs', quick ? '40' : '200', '--seed', '424242', '--minutes', quick ? '1' : '5'], { judge: (o, s) => { const m = o.match(/distinct findings:\s*(\d+)/); const g = o.match(/games (\d+) turns (\d+) actions (\d+)/); return { ok: s === 0 && !!m && Number(m[1]) === 0, note: (m ? m[1] + ' findings' : 'no summary') + (g ? `, ${g[1]} games/${g[3]} actions` : '') }; } });
console.log('\n=== test-all summary ===');
let bad = 0;
for (const r of rows) { if (!r.ok) bad++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(24)} ${String(r.secs).padStart(6)}s  ${r.note}`); }
if (bad) { console.log('\n--- failure output (tail) ---'); for (const r of rows.filter(x => !x.ok)) console.log(`\n[${r.name}]\n` + r.out.split('\n').slice(-25).join('\n')); }
console.log(`\n${bad ? bad + ' FAILED' : 'ALL PASSED'} (${rows.length} steps)`);
process.exit(bad ? 1 : 0);
