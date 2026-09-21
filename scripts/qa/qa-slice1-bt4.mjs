// Official card Q&A scenarios, slice1 part 6 (BT4 tamer-evolution group, BT6..BT8 selected). Q ids refer to data/rulings/slice1.json (gitignored). Run: node scripts/qa/qa-slice1-bt4.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp;

// Q1434-1439 (BT4-011 group): a Tamer can evolve as if it were a Lv.3 digimon; evolution draw still happens; a tamer played this turn => the result cannot attack this turn; the tamer stays under it as an evolution source
T(1434, 'BT4-011 evolves from a tamer', async () => { const st = mk(); const tm = put(st, 'p1', 'ST1-12'); ok('evolution from the red tamer is legal', E.evolutionMethods('ST1-12', 'BT4-011', [], null, { state: st, p: 'p1', stack: tm }).some(m => m.id === 'tamer-as-digimon')); });
T(1435, 'BT4-011 from tamer: draws, cannot attack the turn the tamer was played, tamer becomes a source', async () => {
  const st = mk(); const tm = await playCard(st, 'p1', 'ST1-12'); setHand(st, 'p1', ['BT4-011']); const d = st.players.p1.deck.length; await evolve(st, 'p1', tm.uid, 'BT4-011', 0); const s = stackOf(st, 'p1', tm.uid);
  eq('is the digimon now', s.cardId, 'BT4-011'); eq('evolution draw', st.players.p1.deck.length, d - 1); ok('tamer is now a source', s.sources.includes('ST1-12')); ok('cannot attack this turn (Q1436)', s.attackEligibleTurn > st.turnNumber);
});
// Q1423/Q1424: BT6-033 trashes security only down to 3, +1 memory per card trashed
T(1423, 'BT6-033 security 3 or fewer: nothing', async () => { const st = mk(); secN(st, 'p1', 3); await playCard(st, 'p1', 'BT6-033'); eq('security kept', st.players.p1.security.length, 3); eq('no memory', st.memory, 0); });
T(1424, 'BT6-033 security 5 => 3, memory +2', async () => { const st = mk(); secN(st, 'p1', 5); await playCard(st, 'p1', 'BT6-033'); eq('security 3', st.players.p1.security.length, 3); eq('+2 memory', mem(st), 2); });
// Q1427/Q1429: security-discard costs cannot be paid at 0 security
T(1427, 'BT6-041 no security: no DP-5000', async () => { const st = mk(); const a = put(st, 'p1', 'BT6-041'); const t = put(st, 'p2', BIG); setSec(st, 'p1', []); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('DP untouched', dp(st, 'p2', t), C(BIG).dp); });
T(1429, 'BT6-044 no security: effect not activated', async () => { const st = mk(); const m = put(st, 'p1', FILL); setSec(st, 'p1', []); const h = st.players.p1.hand.length; setDeck(st, 'p1', Array(10).fill(FILL)); await evolve(st, 'p1', m.uid, 'BT6-044'); eq('hand only +evolution draw', st.players.p1.hand.length - h, 1); });
// Q1694: BT8-003 stays +1000 at 6 security
T(1694, 'BT8-003 3+ security => +1000 only', async () => { const st = mk(); const s = put(st, 'p1', FILL, { src: ['BT8-003'] }); secN(st, 'p1', 6); eq('+1000', dp(st, 'p1', s), FB + 1000); });
// Q1488: BT6-102 grants an on-deletion memory -2 to the opponent's digimon
T(1488, 'BT6-102 granted on-deletion memory -2', async () => { const st = mk(); put(st, 'p1', body('green')); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT6-102'); S.deleteStack(st, 'p2', t.uid, 'trash', 'battle'); await drain(st); eq('p2 lost 2 memory', mem(st, 'p2'), -2); });
// Q1717/Q1718: BT8-028 triggers on PLAY of a Lv5+ opposing digimon, not on evolution / raising->battle move
T(1717, 'BT8-028 play triggers, evolution does not', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT8-028'); const h = st.players.p1.hand.length; await playCard(st, 'p2', body('red', 5)); eq('p1 memory +1', mem(st, 'p1'), 1); eq('draw', st.players.p1.hand.length - h, 1);
  const st2 = mk({ me: 'p2' }); put(st2, 'p1', 'BT8-028'); const m = put(st2, 'p2', FILL); await evolve(st2, 'p2', m.uid, body('red', 5)); eq('evolution: no memory', mem(st2, 'p1'), 0);
});
const { fail } = await runAll('qa-slice1-bt4'); process.exit(fail ? 1 : 0);
