// list unbuilt T questions matching a regex (Japanese), compact
import * as fs from 'fs';
const qa = JSON.parse(fs.readFileSync('data/rulings/slice3.json', 'utf8')); const c = JSON.parse(fs.readFileSync('docs/qa-slice3-classification.json', 'utf8'));
let src = ''; for (const f of fs.readdirSync('scripts/qa')) if (/^qa-slice3/.test(f)) src += fs.readFileSync('scripts/qa/' + f, 'utf8');
import { builtSet } from './s3r2-built.mjs';
const built = builtSet();
const re = new RegExp(process.argv[2]); const ql = Number(process.argv[3] || 110), al = Number(process.argv[4] || 90);
let n = 0; for (const q of qa) { if (c[q.id] !== 'T' || built.has(String(q.id))) continue; if (!re.test(q.q + q.a)) continue; n++; console.log('Q' + q.id, q.card.split(' ')[0], '|', q.q.replace(/\s+/g, ' ').slice(0, ql), '\n   A:', q.a.replace(/\s+/g, ' ').slice(0, al)); }
console.log(n);
