import * as fs from 'fs';
const qa = JSON.parse(fs.readFileSync('data/rulings/slice3.json', 'utf8'));
for (const id of process.argv.slice(2).map(Number)) { const q = qa.find(x => x.id === id); console.log('Q' + id, q.card, '\n Q:', q.q.replace(/\s+/g, ' '), '\n A:', q.a.replace(/\s+/g, ' ')); }
