// Build data/human-decks.json from the cached public Limitless standings (scratch/human/st) + local DCGO deck files.
// Stores ONLY {src, date, place, event-size, main:{id:n}, digitama:{id:n}}. node scripts/build-human-corpus.mjs < /dev/null
import * as fs from 'fs';
import * as path from 'path';
import * as S from '../src/state.js';
import { parseDeckText } from '../src/deckimport.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(String(url).replace(/^\.\//, ''), 'utf8')) });
await S.loadData();
const dir = 'scratch/human/st';
const stat = { tournaments: 0, players: 0, withList: 0, cardsTotal: 0, cardsMissing: 0, illegal: 0, dupe: 0, sizeBad: 0, ok: 0, missingIds: {}, illegalWhy: {} };
const out = []; const seen = new Set();
const hash = (d) => Object.keys(d.main).sort().map((k) => k + ':' + d.main[k]).join(',') + '|' + Object.keys(d.digitama).sort().map((k) => k + ':' + d.digitama[k]).join(',');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
function tryId(set, number) {
  for (const n of [number, String(number).replace(/^0+(?=\d)/, ''), String(number).padStart(3, '0'), String(number).padStart(2, '0')]) { const id = `${set}-${n}`; if (S.CARDS[id]) return id; }
  return `${set}-${number}`;
}
function push(deckMain, deckEgg, meta) {
  stat.withList++;
  const d = { main: {}, digitama: {} };
  for (const [z, src] of [['main', deckMain], ['digitama', deckEgg]]) for (const [id, n] of Object.entries(src)) { stat.cardsTotal += n; if (!S.CARDS[id]) { stat.cardsMissing += n; stat.missingIds[id] = (stat.missingIds[id] || 0) + n; d._miss = true; } else d[z][id] = (d[z][id] || 0) + n; }
  if (d._miss) { stat.illegal++; stat.illegalWhy.unknownCard = (stat.illegalWhy.unknownCard || 0) + 1; return; }
  if (sum(d.main) !== 50) { stat.sizeBad++; stat.illegalWhy.size = (stat.illegalWhy.size || 0) + 1; return; }
  const lg = S.deckLegality(d); if (!lg.ok) { stat.illegal++; const k = String(lg.errors[0]).slice(0, 40); stat.illegalWhy[k] = (stat.illegalWhy[k] || 0) + 1; return; }
  const h = hash(d) + '@' + meta.ev; if (seen.has(h)) { stat.dupe++; return; } seen.add(h);
  out.push({ ...meta, ev: undefined, main: d.main, digitama: d.digitama }); stat.ok++;
}
for (const f of fs.readdirSync(dir)) {
  const { t, s } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); stat.tournaments++;
  for (const p of s) {
    stat.players++; const dl = p.decklist; if (!dl) continue;
    const main = {}, egg = {};
    for (const k of ['digimon', 'tamer', 'option']) for (const c of dl[k] || []) { const id = tryId(c.set, c.number); main[id] = (main[id] || 0) + c.count; }
    for (const c of dl.egg || []) { const id = tryId(c.set, c.number); egg[id] = (egg[id] || 0) + c.count; }
    push(main, egg, { src: 'limitless', date: t.date.slice(0, 10), place: p.placing || null, size: t.players, ev: t.id });
  }
}
// local DCGO decks
const lroot = 'D:/DCGO_Beta_Version (1)/Assets/Decks'; let local = 0;
if (fs.existsSync(lroot)) for (const f of fs.readdirSync(lroot)) if (/\.txt$/.test(f) && !/Deck lists/.test(f)) {
  const r = parseDeckText(fs.readFileSync(path.join(lroot, f), 'utf8'), S); const dk = r.deck || r;
  if (dk && dk.main) { local++; const before = out.length; push(dk.main, dk.digitama || {}, { src: 'local-dcgo', date: fs.statSync(path.join(lroot, f)).mtime.toISOString().slice(0, 10), place: null, size: null, ev: 'local' + f }); console.log('local', f, out.length > before ? 'ok' : 'REJECTED'); }
}
stat.local = local; stat.dropRate = +(stat.cardsMissing / Math.max(1, stat.cardsTotal)).toFixed(4);
stat.missingTop = Object.entries(stat.missingIds).sort((a, b) => b[1] - a[1]).slice(0, 15); delete stat.missingIds;
fs.writeFileSync('scratch/human/corpus-stat.json', JSON.stringify(stat, null, 1));
const json = { version: 1, note: 'facts only: card ids + counts from public tournament decklists (Limitless public API) and local DCGO deck files; parallel suffixes stripped', decks: out };
fs.writeFileSync('scratch/human/human-decks.json', JSON.stringify(json));
console.log(JSON.stringify(stat), out.length, (JSON.stringify(json).length / 1e6).toFixed(2) + 'MB');
