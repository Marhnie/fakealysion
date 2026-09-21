// Slice3 Q&A conformance part J: EX6-EX8 cards.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);

// Q3780: EX6-047 on play: adds up to 2 cards but only ONE hand card is discarded
await sc('Q3780', 'EX6-047 on play: 2 cards added -> only 1 discarded', async () => {
  const fa = findC(c => c.category === 'digimon' && (c.types || []).some(t => /타천사형|마왕형/.test(t)))[0]; const po = findC(c => c.category === 'option' && c.colors.length === 1 && c.colors[0] === 'purple')[0];
  const st = newState(); st.players.p1.deck = [fa, po, FILL[0], FILL[1], FILL[2], ...FILL.slice(3, 9)]; await playCard(st, 'p1', 'EX6-047');
  return all(eq('hand = 2 added - 1 discarded', st.players.p1.hand.length, 1), eq('trash 1', st.players.p1.trash.length >= 1, true));
});
// Q3796: EX6-058: deleting a level-less opp digimon -> no deck discard
await sc('Q3796', 'EX6-058 on play: deleted digimon has no Lv -> own deck untouched', async () => {
  const nolv = findC(c => c.category === 'digimon' && c.level == null && c.dp)[0]; if (!nolv) return 'no level-less digimon fixture';
  const st = newState(); put(st, 'p2', [nolv]); const me = put(st, 'p1', ['EX6-058']); const d0 = st.players.p1.deck.length; await trig(st, 'p1', me, 'play');
  return all(eq('deleted', st.players.p2.battle.length, 0), eq('deck untouched', d0 - st.players.p1.deck.length, 0));
});
// Q3818: EX6-068 main: even if no card is put under the security, the option itself is still placed in the battle area
await sc('Q3818', 'EX6-068 main: nothing to place -> option still goes to the battle area, not trash', async () => {
  const st = newState(); put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('yellow') && c.level === 3)[0]]); st.players.p1.hand = ['EX6-068']; st.memory = 8;
  S.useOptionCard(st, 'p1', 0); await drain(st); return eq('not trashed', st.players.p1.trash.includes('EX6-068'), false);
});
// Q3821: EX6-071 main: opp hand < 5 -> no discard, but the following "Lv >= hand size" deletion still happens
await sc('Q3821', 'EX6-071 main: opp hand 2 -> still deletes an opp digimon with Lv >= 2', async () => {
  const st = newState(); st.players.p2.hand = FILL.slice(0, 2); put(st, 'p2', [FILL[1]]); put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('purple') && c.level === 3)[0]]); st.players.p1.hand = ['EX6-071']; st.memory = 8;
  S.useOptionCard(st, 'p1', 0); await drain(st); return all(eq('hand kept', st.players.p2.hand.length, 2), eq('opp deleted', st.players.p2.battle.length, 0));
});
// Q3833: EX7-014 on evolve: opp cannot play digimon with DP <= 6000 until end of opp turn
await sc('Q3833', 'EX7-014 on evolve: opp cannot play DP<=6000 digimon (but higher is fine)', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX7-014']); await trig(st, 'p1', me, 'digivolve');
  const lo = findC(c => c.category === 'digimon' && c.dp <= 6000)[0], hi = findC(c => c.category === 'digimon' && c.dp >= 8000)[0];
  return all(eq('low blocked', S.isPlayRestricted(st, 'p2', lo), true), eq('high allowed', S.isPlayRestricted(st, 'p2', hi), false));
});
// Q3844: EX7-023 (opp turn): opp digimon with sources <= this one's cannot rest -- evaluated live, so gaining sources frees it
await sc('Q3844', 'EX7-023: opp digimon can rest once it has more sources than EX7-023', async () => {
  const st = newState(); put(st, 'p1', ['EX7-023', FILL[0]]); const o = put(st, 'p2', [FILL[1], FILL[2]]); st.activePlayer = 'p2';
  const a = S.canRestByRule(st, 'p2', o); o.sources.push(FILL[3]); const b = S.canRestByRule(st, 'p2', o);
  return all(eq('1 source <= 1 -> cannot', a, false), eq('2 sources > 1 -> can', b, true));
});
// Q3855: EX7-049 on evolve: Lv<=4 opp digimon cannot evolve, including ones entering afterwards; raising area unaffected
await sc('Q3855', 'EX7-049 on evolve: later-entering Lv<=4 opp digimon also cannot evolve', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX7-049']); await trig(st, 'p1', me, 'digivolve'); st.activePlayer = 'p2'; st.turnNumber++;
  const late = put(st, 'p2', [FILL[0]]); const r = S.evolveTargetRestriction(st, 'p2', late); return eq('cannotEvolve', !!(r && r.cannotEvolve), true);
});
// Q3882: EX8-023 on play: the lock sticks to the chosen digimon even after it gains sources
await sc('Q3882', 'EX8-023 on play: chosen bare digimon stays unrestable after gaining a source', async () => {
  const st = newState(); const o = put(st, 'p2', [FILL[1]]); const me = put(st, 'p1', ['EX8-023']); await trig(st, 'p1', me, 'play');
  o.sources.push(FILL[2]); S.restStack(st, 'p2', o.uid, 'effect'); return eq('still not rested', o.suspended, false);
});
finish('slice3-j');
