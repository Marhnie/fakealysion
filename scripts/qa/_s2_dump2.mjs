import * as fs from 'fs';
const a = JSON.parse(fs.readFileSync('data/rulings/slice2.json', 'utf8'));
const [from, to] = [+process.argv[2], +process.argv[3]];
const dupF = 'scripts/qa/_s2_dup.json'; const dup = fs.existsSync(dupF) ? JSON.parse(fs.readFileSync(dupF, 'utf8')) : {};
let last = '';
for (let i = from; i < Math.min(to, a.length); i++) {
  const e = a[i]; const id = e.card.split(' ')[0];
  const key = e.q.replace(/[「」『』\s]/g, '').slice(-50) + '|' + e.a.slice(0, 16);
  if (dup[key]) continue;
  dup[key] = e.id;
  const q = e.q.replace(/このカード(の|は|を|が)?/g, '').replace(/[「」『』]/g, '').replace(/ですか？|できますか？|しますか？|になりますか？/g, '?').replace(/効果/g, '効').replace(/デジモン/g, 'D').replace(/相手/g, '敵').replace(/自分/g, '自');
  if (/どちらか片方のみ|両方ないと|どういった|どのような|固有のルール|とは、|とはどう|わざと少なく|意味ですか|どういう|どの順|どちらが先|どのタイミング/.test(e.q)) { dup[key] = -1; continue; }
  const y = e.a.startsWith('はい') ? 'Y' : e.a.startsWith('いいえ') ? 'N' : '';
  console.log(`${id !== last ? '\n@' + id + ' ' : ''}${e.id}${y} ${q.slice(0, 70)}`);
  last = id;
}
fs.writeFileSync(dupF, JSON.stringify(dup));
