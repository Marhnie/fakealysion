import * as S from './state.js';

const STORAGE_KEY = 'digimon_saved_decks_v1';

export function loadSavedDecks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

export function saveSavedDecks(decks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

export function newDraft() {
  return { name: '', main: {}, digitama: {}, art: {} };
}

export function totalCount(zoneObj) {
  return Object.values(zoneObj).reduce((a, b) => a + b, 0);
}

export function copiesInDeck(draft, cardId) {
  // 2-3-4-5/6: cards treated as another card number count toward the same limit group.
  return S.copiesTowardLimit(draft, cardId);
}

export const maxCopiesFor = S.maxCopiesFor;

export function addCard(draft, cardId) {
  const c = S.card(cardId);
  const zone = c.category === 'digitama' ? 'digitama' : 'main';
  const zoneLimit = zone === 'digitama' ? 5 : 50;
  if (totalCount(draft[zone]) >= zoneLimit) return { ok: false, reason: `${zone === 'digitama' ? '디지타마덱' : '메인덱'} 최대 ${zoneLimit}장` };
  const have = copiesInDeck(draft, cardId);
  if (have >= maxCopiesFor(cardId)) return { ok: false, reason: `같은 카드 넘버(별칭 포함) 최대 ${maxCopiesFor(cardId)}장` };
  draft[zone][cardId] = (draft[zone][cardId] || 0) + 1;
  return { ok: true };
}

export function removeCard(draft, cardId) {
  const c = S.card(cardId);
  const zone = c.category === 'digitama' ? 'digitama' : 'main';
  if (!draft[zone][cardId]) return;
  draft[zone][cardId] -= 1;
  if (draft[zone][cardId] <= 0) delete draft[zone][cardId];
}

export function validate(draft) { return S.deckLegality(draft); }

// Convert a draft into the {name, main, digitama} shape state.js/DECKS expects.
// Art choices only matter (and are only kept) for card numbers actually in the deck; unknown / stale keys are dropped.
export function cleanArt(draft) {
  const out = {};
  for (const [id, key] of Object.entries(draft.art || {})) {
    if (!(draft.main?.[id] || draft.digitama?.[id])) continue;
    const v = S.parallelOf(key);
    if (v && key.startsWith(id + '_P') && (S.PARALLELS[id] || []).includes(v)) out[id] = key;
  }
  return out;
}
export function setArt(draft, cardId, key) {
  draft.art = { ...(draft.art || {}) };
  if (key && key.startsWith(cardId + '_P')) draft.art[cardId] = key; else delete draft.art[cardId];
}
// Convert a draft into the {name, main, digitama, art?} shape state.js/DECKS expects.
export function toDeckDefRecord(draft) {
  const rec = { name: draft.name || '이름 없는 덱', main: { ...draft.main }, digitama: { ...draft.digitama } };
  const art = cleanArt(draft);
  if (Object.keys(art).length) rec.art = art;
  return rec;
}
