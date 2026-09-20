// Merge cpu-hunt --out JSON files:  node scripts/cpu-hunt-agg.mjs <glob-prefix-dir> <prefix> [--top 40] [--expo out.json] < /dev/null
import * as fs from 'fs';
const [dir, prefix] = process.argv.slice(2);
const TOP = Number((process.argv.find((a) => a.startsWith('--top=')) || '=40').split('=')[1]);
const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
const found = {}, expo = {}, manual = {}, stats = { games: 0, ok: 0, stall: 0, err: 0, illegalDecks: 0, turns: 0 };
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'));
  for (const k of Object.keys(stats)) stats[k] += j.stats[k] || 0;
  for (const [k, v] of Object.entries(j.found)) { const x = (found[k] ||= { n: 0, ex: v.ex }); x.n += v.n; }
  for (const [id, e] of Object.entries(j.expo)) { const x = (expo[id] ||= {}); for (const [a, b] of Object.entries(e)) x[a] = (x[a] || 0) + b; }
  for (const [k, n] of Object.entries(j.manual)) manual[k] = (manual[k] || 0) + n;
}
console.log('files', files.length, JSON.stringify(stats));
const ks = Object.keys(found).sort((a, b) => found[b].n - found[a].n);
console.log('distinct findings', ks.length);
for (const k of ks.slice(0, TOP)) console.log(`[${found[k].n}x] ${k}\n    spec=${JSON.stringify(found[k].ex && found[k].ex.spec)} turn=${found[k].ex && found[k].ex.turn}\n    ${String(found[k].ex && found[k].ex.detail).slice(0, 220)}`);
const mk = Object.keys(manual).sort((a, b) => manual[b] - manual[a]);
console.log('\nmanual-fallback pendings:', mk.length);
for (const k of mk.slice(0, 25)) console.log(manual[k], k);
fs.writeFileSync(dir + '/' + prefix + 'AGG.expo', JSON.stringify(expo));
