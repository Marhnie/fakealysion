import * as fs from 'fs';
const qa = JSON.parse(fs.readFileSync('data/rulings/slice3.json', 'utf8'));
const pats = process.argv.slice(2);
for (const p of pats) { const l = qa.filter(q => q.q.replace(/\s+/g, '').includes(p)); console.log(p.slice(0, 20), l.length, JSON.stringify(l.map(q => [q.id, q.card.split(' ')[0]]))); }
