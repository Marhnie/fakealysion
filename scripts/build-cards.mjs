// One-off transform: dgchub raw card export -> our normalized cards database.
// Run with: node scripts/build-cards.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const RAW_PATH = new URL('../data/dgchub_cards_raw.json', import.meta.url);
const OUT_PATH = new URL('../data/cards_full.json', import.meta.url);

const COLOR_BITS = { 1: 'red', 2: 'blue', 4: 'green', 8: 'black', 16: 'purple', 32: 'yellow', 64: 'white' };
function decodeColorMask(mask) {
  if (mask == null) return null;
  const out = [];
  for (const bit of Object.keys(COLOR_BITS)) if (mask & Number(bit)) out.push(COLOR_BITS[bit]);
  return out;
}

const CATEGORY_MAP = {
  DIGIMON: 'digimon', DIGITAMA: 'digitama', TAMER: 'tamer', OPTION: 'option', DUAL: 'dual',
};

function parseLevelFromCondition(text) {
  if (!text) return null;
  const m = String(text).match(/Lv\.(\d+)/);
  return m ? Number(m[1]) : null;
}

const raw = JSON.parse(readFileSync(RAW_PATH, 'utf-8'));
const out = {};

for (const c of raw) {
  const kor = c.localeCardData?.find(l => l.locale === 'KOR');
  const eng = c.localeCardData?.find(l => l.locale === 'ENG');
  const colors = [c.color1, c.color2].filter(Boolean).map(x => x.toLowerCase());
  const entry = {
    id: c.cardNo,
    cardId: c.cardId,
    nameKo: kor?.name || c.cardNo,
    nameEn: eng?.name || null,
    category: CATEGORY_MAP[c.cardType] || c.cardType?.toLowerCase() || 'unknown',
    level: c.lv ?? null,
    colors,
    cost: c.playCost ?? null,
    dp: c.dp ?? null,
    form: c.form || null,
    attribute: c.attribute || null,
    types: c.types || [],
    rarity: c.rarity || null,
    isParallel: !!c.isParallel,
    releaseDate: c.releaseDate || null,
    setName: c.noteName || null,
    evoNormal: (c.digivolveCost1 != null) ? {
      cost: c.digivolveCost1,
      level: parseLevelFromCondition(c.digivolveCondition1),
      colors: decodeColorMask(c.digivolveColor1),
      conditionText: c.digivolveCondition1 || null,
    } : null,
    effectKo: kor?.effect || '',
    effectEn: eng?.effect || '',
    inheritedKo: kor?.sourceEffect || '',
    inheritedEn: eng?.sourceEffect || '',
    imgUrl: kor?.smallImgUrl || null,
  };
  // Keep the highest-cardId (latest reprint metadata) entry when duplicate
  // cardNo variants exist (parallels); prefer non-parallel as canonical.
  if (!out[entry.id] || (out[entry.id].isParallel && !entry.isParallel)) {
    out[entry.id] = entry;
  }
}

// official-list trait fill for cards whose dgchub `types` are empty (see scripts/fill-missing-traits.mjs)
try {
  const ov = JSON.parse(readFileSync(new URL('../data/trait-overrides.json', import.meta.url), 'utf-8'));
  for (const [no, t] of Object.entries(ov)) if (out[no] && !out[no].types.length) out[no].types = [...t];
} catch { /* no overrides file */ }

writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} cards to ${OUT_PATH.pathname}`);
