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
  return { name: '', main: {}, digitama: {} };
}

export function totalCount(zoneObj) {
  return Object.values(zoneObj).reduce((a, b) => a + b, 0);
}

export function copiesInDeck(draft, cardId) {
  return (draft.main[cardId] || 0) + (draft.digitama[cardId] || 0);
}

export function maxCopiesFor(cardId) {
  return 4; // default rule (2-2-2 / general_rule 1-4-1-2-2); per-card exceptions not modeled yet
}

export function addCard(draft, cardId) {
  const c = S.card(cardId);
  const zone = c.category === 'digitama' ? 'digitama' : 'main';
  const zoneLimit = zone === 'digitama' ? 5 : 50;
  if (totalCount(draft[zone]) >= zoneLimit) return { ok: false, reason: `${zone === 'digitama' ? '디지타마덱' : '메인덱'} 최대 ${zoneLimit}장` };
  const have = copiesInDeck(draft, cardId);
  if (have >= maxCopiesFor(cardId)) return { ok: false, reason: '카드당 최대 4장' };
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

export function validate(draft) {
  const mainN = totalCount(draft.main);
  const digitamaN = totalCount(draft.digitama);
  const errors = [];
  if (mainN !== 50) errors.push(`메인덱 ${mainN}/50장 (정확히 50장이어야 함)`);
  if (digitamaN > 5) errors.push(`디지타마덱 ${digitamaN}/5장 (5장 이하)`);
  return { ok: errors.length === 0, errors, mainN, digitamaN };
}

// Convert a draft into the {name, main, digitama} shape state.js/DECKS expects.
export function toDeckDefRecord(draft) {
  return { name: draft.name || '이름 없는 덱', main: { ...draft.main }, digitama: { ...draft.digitama } };
}
