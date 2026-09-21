// Slice3 Q&A conformance part F: EX2-EX3 cards (evolution-cost mods, options, mandatory searches).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);

// Q3408/Q3409, Q3403/3404, Q3413/3414: multi-category "one of each to hand" searches: both categories present -> both taken; only one present -> that one taken
const dragonYellow = findC(c => c.category === 'digimon' && c.colors.includes('yellow') && /드라몬/.test(c.nameKo) && (c.types || []).includes('4대용'))[0];
const fourDragon = findC(c => (c.types || []).includes('4대용') && c.category === 'digimon' && c.id !== dragonYellow)[0];
const yellowDrName = findC(c => c.category === 'digimon' && c.colors.includes('yellow') && /드라몬/.test(c.nameKo) && !(c.types || []).includes('4대용'))[0];
await sc('Q3409', 'EX3-031 on evolve: both categories opened -> both added', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX3-031']); st.players.p1.deck = [yellowDrName, fourDragon, FILL[0], FILL[1], ...FILL.slice(2, 9)];
  await trig(st, 'p1', me, 'digivolve'); return all(eq('a', st.players.p1.hand.includes(yellowDrName), true), eq('b', st.players.p1.hand.includes(fourDragon), true));
});
await sc('Q3408', 'EX3-031 on evolve: only one category opened -> still added', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX3-031']); st.players.p1.deck = [yellowDrName, FILL[0], FILL[1], FILL[2], ...FILL.slice(3, 9)];
  await trig(st, 'p1', me, 'digivolve'); return eq('a', st.players.p1.hand.includes(yellowDrName), true);
});
// Q3373/3372: EX3-007 on play
await sc('Q3373', 'EX3-007 on play: dragon-type card and Hina tamer both opened -> both added', async () => {
  const dr = findC(c => c.category === 'digimon' && (c.types || []).some(t => /암룡형|지룡형|조룡형|기룡형|천룡형/.test(t)))[0]; const hina = findC(c => c.category === 'tamer' && c.nameKo === '쿠리하라 히나')[0];
  if (!hina) return 'no hina card';
  const st = newState(); st.players.p1.deck = [dr, hina, FILL[0], FILL[1], ...FILL.slice(2, 9)]; await playCard(st, 'p1', 'EX3-007');
  return all(eq('dr', st.players.p1.hand.includes(dr), true), eq('hina', st.players.p1.hand.includes(hina), true));
});
// Q3379/Q3380/Q3381/Q3383/Q3384: EX3-016 source: opp digimon WITHOUT sources pay +1 evo cost during opp turn; one holder = +1, two holders = +2; jogress counts once
const tgtLv4 = findC(c => c.category === 'digimon' && c.level === 4)[0];
await sc('Q3379', 'EX3-016 source: two holders -> +2, sources present -> 0 (opp turn)', async () => {
  const st = newState(); put(st, 'p1', [FILL[0], 'EX3-016']); const bare = put(st, 'p2', [FILL[1]]); const withSrc = put(st, 'p2', [FILL[2], FILL[3]]);
  st.activePlayer = 'p2'; const one = S.previewEvoCostDelta(st, 'p2', bare, tgtLv4); const nos = S.previewEvoCostDelta(st, 'p2', withSrc, tgtLv4);
  put(st, 'p1', [FILL[4], 'EX3-016']); const two = S.previewEvoCostDelta(st, 'p2', bare, tgtLv4);
  return all(eq('one holder', one, 1), eq('with sources', nos, 0), eq('two holders', two, 2));
});
// Q3402/Q3410: EX3-025 on delete places the Trial option from hand into the battle area WITHOUT resolving its [Main] (no draw)
await sc('Q3402', 'EX3-025 on delete: Trial placed from hand, no draw', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX3-025']); st.players.p1.hand = ['EX3-069']; const d0 = st.players.p1.deck.length;
  S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st);
  const placed = !st.players.p1.hand.includes('EX3-069'); return all(eq('left hand', placed, true), eq('no draw', d0 - st.players.p1.deck.length, 0));
});
// Q3419: EX3-051 source: opened Commandramon not played is trashed (remaining cards are discarded)
await sc('Q3419', 'EX3-051 source: declined Commandramon is trashed', async () => {
  const cm = findC(c => c.category === 'digimon' && c.nameKo === '코만드라몬')[0]; const brig = findC(c => c.category === 'digimon' && (c.types || []).includes('D-브리가드') || (c.traits || []).includes('D-브리가드'))[0];
  const st = newState(); const me = put(st, 'p1', [brig || FILL[0], 'EX3-051']); st.players.p1.deck = [cm, FILL[1], ...FILL.slice(2, 9)];
  S.declareAttack(st, 'p1', me.uid); S.queueTriggersForStack(st, 'p1', me, 'attack'); S.emitGameEvent(st, 'attack', { owner: 'p1', stack: me, cause: null }); await drain(st, (k) => (k === 'pickFromRevealed' ? [] : (k === 'confirmEffect' ? false : undefined)));
  return eq('trash has cm', st.players.p1.trash.includes(cm), true);
});
// Q3353 / Q3070: mandatory target: option EX2-067 with a legal target must delete it (no draw)
await sc('Q3353', 'EX2-067 main: legal target present -> deleted, no draw', async () => {
  const st = newState(); const low = findC(c => c.category === 'digimon' && c.dp <= 3000)[0]; put(st, 'p2', [low]); st.players.p1.hand = ['EX2-067'];
  put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('red') && c.level === 3)[0]]); st.memory = 5; const d0 = st.players.p1.deck.length; S.useOptionCard(st, 'p1', 0); await drain(st);
  return all(eq('deleted', st.players.p2.battle.length, 0), eq('no draw', d0 - st.players.p1.deck.length, 0));
});
// Q3357/Q3360: EX2-070 main: evolution condition cannot be ignored; only evo-cost<=3 routes are usable
await sc('Q3357', 'EX2-070 main: hand digimon whose evo condition is unmet is not evolved into', async () => {
  const st = newState(); st.players.p1.hand = ['EX2-070']; put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('green') && c.level === 3)[0]]); put(st, 'p1', [findC(c => c.category === 'tamer')[0]]);
  const lv6 = findC(c => c.category === 'digimon' && c.level === 6 && c.evoNormal && c.evoNormal.cost <= 3)[0]; st.players.p1.hand.push(lv6); st.memory = 5;
  const before = st.players.p1.battle[0].cardId; S.useOptionCard(st, 'p1', 0); await drain(st); return eq('unchanged (Lv3 cannot evolve into Lv6)', st.players.p1.battle[0].cardId, before);
});
finish('slice3-f');
