// usage: node _s2_cls.mjs <fromQid> <toQid> "T:1751-1753,1755" "N:..."   (unspecified ids in range => R)
import * as fs from 'fs';
const f = 'scripts/qa/_s2_cls.json'; const cls = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
const [a, b] = [+process.argv[2], +process.argv[3]];
const a2 = JSON.parse(fs.readFileSync('data/rulings/slice2.json', 'utf8')).map(e => e.id);
for (const id of a2) if (id >= a && id <= b) cls[id] = 'R';
for (const arg of process.argv.slice(4)) { const [k, list] = arg.split(':'); for (const part of list.split(',').filter(Boolean)) { const [x, y] = part.split('-').map(Number); for (let i = x; i <= (y || x); i++) if (a2.includes(i)) cls[i] = k; } }
fs.writeFileSync(f, JSON.stringify(cls));
const v = Object.values(cls); console.log('classified', v.length, 'T', v.filter(x => x === 'T').length, 'R', v.filter(x => x === 'R').length, 'N', v.filter(x => x === 'N').length);
