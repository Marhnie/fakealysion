// ESM 문법 검사: `node --check x.js`는 package.json에 type이 없으면 ESM 문법 오류를 놓치므로 .mjs로 복사해서 검사한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
for (const d of ['src', 'src/cards', 'scripts']) for (const f of fs.readdirSync(path.join(root, d))) if (/\.(m?js)$/.test(f)) files.push(path.join(root, d, f));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-'));
let bad = 0;
for (const f of files) {
  const t = path.join(tmp, path.basename(f).replace(/\.js$/, '.mjs'));
  fs.copyFileSync(f, t);
  const r = spawnSync(process.execPath, ['--check', t], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.log('SYNTAX ERROR', path.relative(root, f), '\n' + String(r.stderr).split('\n').slice(0, 6).join('\n')); }
}
console.log(bad ? `${bad} file(s) with syntax errors` : `syntax OK (${files.length} files)`);
process.exit(bad ? 1 : 0);
