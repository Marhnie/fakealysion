// Slice3 Q&A conformance part E: EX2 cards.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);

// Q3289/Q3290: EX2-008 on play: adds BOTH the Grow/Duke-name card and the Yuu-name tamer when both opened; one alone is added too.
await sc('Q3289', 'EX2-008 on play: only one of the two categories opened -> still added', async () => {
  const st = newState(); const duke = findC(c => c.category === 'digimon' && /듀크몬/.test(c.nameKo))[0];
  st.players.p1.deck = [duke, FILL[0], FILL[1], FILL[2], ...FILL.slice(3, 9)];
  await playCard(st, 'p1', 'EX2-008'); return eq('added', st.players.p1.hand.includes(duke), true);
});
await sc('Q3290', 'EX2-008 on play: both opened -> both added (cannot skip one)', async () => {
  const st = newState(); const duke = findC(c => c.category === 'digimon' && /듀크몬/.test(c.nameKo))[0]; const yu = findC(c => c.category === 'tamer' && c.nameKo === '오유민')[0];
  st.players.p1.deck = [duke, yu, FILL[0], FILL[1], ...FILL.slice(2, 9)];
  await playCard(st, 'p1', 'EX2-008'); return all(eq('duke', st.players.p1.hand.includes(duke), true), eq('tamer', st.players.p1.hand.includes(yu), true));
});
// Q3293/Q3297: DP-delete cap bonus applies to every DP-delete effect of the owner (source effect of EX2-010; EX2-011 own-turn with red tamer)
await sc('Q3293', 'EX2-010 source: +1000 cap for own DP-delete effects of any digimon', async () => {
  const st = newState(); const h = put(st, 'p1', [FILL[0], 'EX2-010']); return eq('cap', S.dpDestroyCapBoost(st, 'p1', h.uid), 1000);
});
await sc('Q3297', 'EX2-011: +2000 cap requires a red own tamer', async () => {
  const red = findC(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === 'red')[0];
  let st = newState(); let h = put(st, 'p1', ['EX2-011']); const a = S.dpDestroyCapBoost(st, 'p1', h.uid);
  st = newState(); h = put(st, 'p1', ['EX2-011']); put(st, 'p1', [red]); const b = S.dpDestroyCapBoost(st, 'p1', h.uid);
  return all(eq('no tamer', a, 0), eq('red tamer', b, 2000));
});
// Q3298/Q3299: EX2-012 on evolve: no <=10000 target -> both decks trash 5; with a legal target the deletion is mandatory (no draw of the discard)
await sc('Q3298', 'EX2-012 on evolve: no valid target -> both decks lose 5', async () => {
  const st = newState(); const big = findC(c => c.category === 'digimon' && c.dp >= 12000)[0]; put(st, 'p2', [big]); const me = put(st, 'p1', ['EX2-012']);
  const a = st.players.p1.deck.length, b = st.players.p2.deck.length; await trig(st, 'p1', me, 'digivolve');
  return all(eq('own', a - st.players.p1.deck.length, 5), eq('opp', b - st.players.p2.deck.length, 5));
});
await sc('Q3299', 'EX2-012 on evolve: legal target exists -> it is deleted, no discard', async () => {
  const st = newState(); put(st, 'p2', [FILL[0]]); const me = put(st, 'p1', ['EX2-012']);
  const a = st.players.p1.deck.length; await trig(st, 'p1', me, 'digivolve');
  return all(eq('deleted', st.players.p2.battle.length, 0), eq('no discard', a - st.players.p1.deck.length, 0));
});
// Q3304: EX2-018 on play: recover per opp no-source digimon but security never exceeds 5
await sc('Q3304', 'EX2-018 on play: security capped at 5', async () => {
  const st = newState(); for (let i = 0; i < 4; i++) put(st, 'p2', [FILL[i]]); st.players.p1.security = FILL.slice(0, 4);
  const me = put(st, 'p1', ['EX2-018']); await trig(st, 'p1', me, 'play'); return eq('security', st.players.p1.security.length, 5);
});
// Q3320/Q3323: EX2-028 on attack end: goes under ANOTHER own digimon (own sources trashed); cannot target itself
await sc('Q3320', 'EX2-028 attack end: placed at bottom of another digimon, its sources trashed', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX2-028', FILL[1], FILL[2]]); const oth = put(st, 'p1', [FILL[3]]);
  await trig(st, 'p1', me, 'attackEnd');
  const o = st.players.p1.battle.find(s => s.uid === oth.uid);
  return all(eq('under other', o && o.sources[o.sources.length - 1] === 'EX2-028' || (o && o.sources[0] === 'EX2-028'), true), eq('trash gets its sources', st.players.p1.trash.includes(FILL[1]) && st.players.p1.trash.includes(FILL[2]), true), eq('gone', st.players.p1.battle.some(s => s.uid === me.uid), false));
});
await sc('Q3323', 'EX2-028 attack end: alone -> stays (cannot place under itself)', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX2-028', FILL[1]]); await trig(st, 'p1', me, 'attackEnd');
  return eq('still there', st.players.p1.battle.some(s => s.uid === me.uid), true);
});
// Q3324: EX2-032 source: 4 black tamers -> memory +1 only
await sc('Q3324', 'EX2-032 source: memory +1 regardless of tamer count', async () => {
  const st = newState(); const bl = findC(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === 'black', 4); for (const t of bl) put(st, 'p1', [t]);
  const me = put(st, 'p1', [FILL[0], 'EX2-032']); st.memory = 0; await trig(st, 'p1', me, 'attack'); return eq('memory', st.memory, 1);
});
// Q3337/Q3339: EX2-043 on evolve: both players discard to 5; <=5 nothing
await sc('Q3337', 'EX2-043 on evolve: both discard down to 5; hand<=5 keeps all', async () => {
  const st = newState(); st.players.p1.hand = FILL.slice(0, 8); st.players.p2.hand = FILL.slice(0, 3); const me = put(st, 'p1', ['EX2-043']);
  await trig(st, 'p1', me, 'digivolve'); return all(eq('p1', st.players.p1.hand.length, 5), eq('p2', st.players.p2.hand.length, 3));
});
// Q3281/Q3284: an egg-type card (EX2-007) sent to hand/deck/security ends up at the bottom of the digitama deck instead (rule sweep)
await sc('Q3281', 'EX2-007 in hand/security/deck -> digitama deck bottom (rule sweep)', async () => {
  const st = newState(); const pl = st.players.p1; pl.hand.push('EX2-007'); pl.security.push('EX2-007'); pl.deck.push('EX2-007'); const d0 = pl.digitamaDeck.length;
  S.normalizeDigitamaZones(st);
  return all(eq('hand', pl.hand.includes('EX2-007'), false), eq('security', pl.security.includes('EX2-007'), false), eq('deck', pl.deck.includes('EX2-007'), false), eq('egg deck +3', pl.digitamaDeck.length - d0, 3));
});
finish('slice3-e');
