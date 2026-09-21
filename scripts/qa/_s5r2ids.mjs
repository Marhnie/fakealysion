// helper (slice 5 round 2): node scripts/qa/_s5r2ids.mjs <regex on whitespace-stripped Q text> [1 = show]  -> uncovered T ids of slice 5
import fs from 'fs';
const [re, showQ] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync('docs/qa-slice5-classification.json', 'utf8'));
const r = JSON.parse(fs.readFileSync('data/rulings/slice5.json', 'utf8'));
let src = ''; for (const f of fs.readdirSync('scripts/qa').filter(f => /slice5/.test(f) && !/^_/.test(f))) src += fs.readFileSync('scripts/qa/' + f, 'utf8');
const nums = new Set([...src.matchAll(/\b(\d{4})\b/g)].map(m => m[1]));
const U = r.filter(x => c[x.id] == 'T' && !nums.has(String(x.id)) && new RegExp(re).test(x.q.replace(/\s/g, '')));
console.log(U.length + ' ids: [' + U.map(x => x.id).join(',') + ']');
console.log([...new Set(U.map(x => x.card.split(' ')[0]))].join(' '));
if (showQ) for (const x of U) console.log(`#${x.id} ${x.card}\nQ:${x.q.replace(/\n/g, ' ')}\nA:${x.a.replace(/\n/g, ' ')}\n`);
