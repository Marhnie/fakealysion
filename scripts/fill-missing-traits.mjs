// Fill the Digimon whose `types` (특징/타입) are empty in the dgchub export.
//   node scripts/fill-missing-traits.mjs            -> apply data/trait-overrides.json to data/cards_full.json (idempotent)
//   node scripts/fill-missing-traits.mjs --scrape   -> re-scrape the official JP card list (digimoncard.com, タイプ only),
//                                                       translate via data/trait-map-ja-ko.json, rewrite trait-overrides.json, then apply
// Only trait names are stored (no card text). Sequential requests, >= 2.5 s apart, HTML cached in $TRAIT_CACHE (default: os tmp dir).
// build-cards.mjs applies the same overrides, so a rebuild from the raw export keeps them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const D = (f) => new URL('../data/' + f, import.meta.url);
const readJson = (f) => JSON.parse(fs.readFileSync(D(f), 'utf8'));

export function applyOverrides(cards, overrides) {
  let changed = 0;
  for (const [no, traits] of Object.entries(overrides)) {
    const c = cards[no];
    if (!c || (c.types && c.types.length)) continue; // never touch cards that already have traits
    c.types = [...traits]; changed++;
  }
  return changed;
}

async function scrape() {
  const cache = process.env.TRAIT_CACHE || path.join(os.tmpdir(), 'digimon-official-cards');
  fs.mkdirSync(cache, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (url, file) => {
    const p = path.join(cache, file);
    if (fs.existsSync(p) && fs.statSync(p).size > 1000) return fs.readFileSync(p, 'utf8');
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    const t = await res.text(); fs.writeFileSync(p, t); await sleep(2600); return t;
  };
  const rule = await get('https://digimoncard.com/rule/', 'rule.html');
  const sel = rule.slice(rule.indexOf('name="prodid"'));
  const ids = [...sel.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
  const ja = {};
  for (const id of ids) {
    const h = await get(`https://digimoncard.com/cards/?search=true&category=${id}`, id + '.html');
    for (const p of h.split('<div class="popupCol" id="').slice(1)) {
      const no = p.slice(0, p.indexOf('"'));
      if (/_P\d+$/.test(no)) continue;
      const m = /<dt class="cardInfoTit">タイプ<\/dt>\s*<dd class="cardInfoData">([\s\S]*?)<\/dd>/.exec(p);
      const t = m ? m[1].replace(/<[^>]+>/g, '').trim().split('/').map((s) => s.trim()).filter(Boolean) : [];
      if (!ja[no] || (!ja[no].length && t.length)) ja[no] = t;
    }
  }
  const map = readJson('trait-map-ja-ko.json');
  const raw = readJson('dgchub_cards_raw.json');
  const out = {}; const unmapped = new Set();
  for (const c of raw) {
    if (c.isParallel || (c.types && c.types.length)) continue;
    const j = ja[c.cardNo]; if (!j || !j.length) continue;
    out[c.cardNo] = j.map((t) => { if (!map[t]) unmapped.add(t); return map[t] || t; });
  }
  if (unmapped.size) console.warn('unmapped JA traits (kept as Japanese):', [...unmapped].join(' '));
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(D('trait-overrides.json'), JSON.stringify(sorted, null, 1) + '\n');
  console.log(`trait-overrides.json: ${Object.keys(sorted).length} cards`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  if (process.argv.includes('--scrape')) await scrape();
  const cards = readJson('cards_full.json');
  const n = applyOverrides(cards, readJson('trait-overrides.json'));
  if (n) fs.writeFileSync(D('cards_full.json'), JSON.stringify(cards));
  console.log(`cards_full.json: ${n} cards filled`);
}
