import * as fs from 'fs';
const a = JSON.parse(fs.readFileSync('data/rulings/slice1.json', 'utf8'));
const [from, to, ql = 120, al = 70] = process.argv.slice(2).map(Number);
for (const e of a.filter(e => e.id >= from && e.id <= to)) console.log(e.id, e.card.replace(/ .*/, ''), '|', e.q.replace(/s+/g,' ').slice(0, ql), '=>', e.a.replace(/s+/g,' ').slice(0, al));
