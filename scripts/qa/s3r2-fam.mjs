import * as fs from 'fs';
const qa = JSON.parse(fs.readFileSync('data/rulings/slice3.json', 'utf8')); const c = JSON.parse(fs.readFileSync('docs/qa-slice3-classification.json', 'utf8'));
let src = ''; for (const f of fs.readdirSync('scripts/qa')) if (/^qa-slice3/.test(f)) src += fs.readFileSync('scripts/qa/' + f, 'utf8');
import { builtSet } from './s3r2-built.mjs';
const built = builtSet();
const fam = new Map();
for (const q of qa) { if (c[q.id] !== 'T' || built.has(String(q.id))) continue; const k = q.q.replace(/「[^」]*」/g, '「」').replace(/[A-Z]{1,3}\d{1,2}-\d{3}/g, '').replace(/\s+/g, '').slice(0, 60); (fam.get(k) || fam.set(k, []).get(k)).push(q); }
const arr = [...fam.values()].sort((a, b) => b.length - a.length);
let tot = 0; for (const f of arr.slice(0, 45)) { tot += f.length; console.log(f.length, f.map(q => q.id).join(',').slice(0, 80), '|', f[0].q.replace(/\s+/g, ' ').slice(0, 90)); }
console.log('top45 total', tot, 'families', arr.length);
