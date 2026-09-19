// Builds data/parallels.json: alternate-art (parallel) variants per card number.
// Run with: node scripts/build-parallels.mjs
// Parallels are the SAME card as their base (rulebook 2-12-1) — game logic never sees variant keys, only art urls.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../data/dgchub_cards_raw.json', import.meta.url), 'utf-8'));
const cards = JSON.parse(readFileSync(new URL('../data/cards_full.json', import.meta.url), 'utf-8'));
const bySet = {};
const list = raw.filter(c => c.isParallel && cards[c.cardNo]).sort((a, b) => a.cardId - b.cardId);
const baseImg = {};
for (const id of Object.keys(cards)) baseImg[id] = cards[id].imgUrl;
const out = {};
for (const c of list) {
  const l = c.localeCardData?.find(x => x.locale === 'KOR') || c.localeCardData?.find(x => x.locale === 'ENG') || c.localeCardData?.[0];
  const img = l?.smallImgUrl || l?.imgUrl;
  if (!img || img === baseImg[c.cardNo]) continue;
  const arr = (out[c.cardNo] ||= []);
  if (arr.some(v => v.imgUrl === img)) continue;
  const v = { key: `${c.cardNo}_P${arr.length + 1}`, cardId: c.cardId, imgUrl: img, rarity: c.rarity || null };
  if (c.noteName) v.setName = c.noteName;
  if (c.releaseDate) v.releaseDate = c.releaseDate;
  arr.push(v);
}
writeFileSync(new URL('../data/parallels.json', import.meta.url), JSON.stringify(out));
console.log(`parallels.json: ${Object.keys(out).length} cards, ${Object.values(out).reduce((a, b) => a + b.length, 0)} variants`);
