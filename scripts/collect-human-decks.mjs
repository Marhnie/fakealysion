// Collect public Limitless (play.limitlesstcg.com public API, no auth) DCG decklists into scratch cache.
// node scripts/collect-human-decks.mjs [--min-players 12] [--max 400] < /dev/null   (>=2.5 s between requests, cached, resumable)
import * as fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const minP = +arg('min-players', 12), max = +arg('max', 400), dir = arg('dir', 'scratch/human');
fs.mkdirSync(dir + '/st', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(u) { const w = 6200 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
  const r = await fetch(u, { headers: { 'User-Agent': 'digimon-sim-research (offline deck statistics; contact: local)' } }); if (!r.ok) throw new Error(r.status); return r.json(); }
const list = JSON.parse(fs.readFileSync(dir + '/t1.json', 'utf8')).filter((t) => t.players >= minP && t.format !== 'CUSTOM').slice(0, max);
let n = 0;
for (const t of list) {
  const f = `${dir}/st/${t.id}.json`; if (fs.existsSync(f)) continue;
  try { const s = await get(`https://play.limitlesstcg.com/api/tournaments/${t.id}/standings`); fs.writeFileSync(f, JSON.stringify({ t, s })); n++; }
  catch (e) { console.log('ERR', t.id, e.message); if (String(e.message) === '429') await sleep(30000); }
  if (n % 20 === 0) console.log('fetched', n, '/', list.length);
}
console.log('done', n);
