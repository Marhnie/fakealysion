// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch L (leftover ST rulings). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';
const LA = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes('Legend-Arms') && c.cost <= 7 && c.level === 3 && !c.id.startsWith('ST13')).map(c => c.id)[0];

T('i104', 'ST9-01 inherited: works when the holder itself is a blue digimon', async () => {
  const st = mk(); const s = put(st, 'p1', body('blue', 4), { src: ['ST9-01'] }); eq('+1000', dp(st, 'p1', s), C(s.cardId).dp + 1000);
});
T('i107', 'ST9-04 inherited: works when the holder itself is a green digimon (on attack)', async () => {
  const st = mk(); const s = put(st, 'p1', body('green', 4), { src: ['ST9-04'] }); secN(st, 'p2', 2); await atkSec(st, 'p1', s.uid); const n = stackOf(st, 'p1', s.uid); ok('+1000 applied', !n || dp(st, 'p1', n) >= C(s.cardId).dp + 1000);
});
T('i114', 'ST9-09 inherited: works when the holder itself is a blue digimon (draw on attack)', async () => {
  const st = mk(); const s = put(st, 'p1', body('blue', 4), { src: ['ST9-09'] }); setDeck(st, 'p1', [FILL, FILL, FILL]); secN(st, 'p2', 2); const h = st.players.p1.hand.length; await atkSec(st, 'p1', s.uid); eq('drew', st.players.p1.hand.length - h, 1);
});
T('i131', 'ST10-05 inherited: works when the holder itself is a purple digimon', async () => {
  const st = mk(); const s = put(st, 'p1', body('purple', 4), { src: ['ST10-05'] }); eq('+1 SA', S.hookSecurityAttackBonus(st, 'p1', s), 1);
});
T('i165', 'ST13-01 inherited: two holders => +2 memory; simultaneous multi-play => once per holder', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['ST13-01'] }); put(st, 'p1', FILL, { src: ['ST13-01'] }); put(st, 'p1', body('red')); put(st, 'p1', body('black')); setHand(st, 'p1', [LA]); st.memory = 0; st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) }; await useOption(st, 'p1', 'ST13-16'); eq('option cost 4 paid, then +1 per holder (+2)', mem(st), -4 + 2);
});
T('i192', 'ST13-16: with no LA card in hand the card is still placed on the battle area', async () => {
  const st = mk(); put(st, 'p1', body('red')); put(st, 'p1', body('black')); setHand(st, 'p1', []); await useOption(st, 'p1', 'ST13-16'); ok('placed', st.players.p1.battle.some(s => s.cardId === 'ST13-16'));
});
T('i205', 'ST15-02: raising-only opp digimon does not give memory at own main phase start', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST15-02'); st.players.p2.raising = S._s4.makeStack(FILL, 1); st.memory = 0; S.queueTriggersForStack(st, 'p1', a, 'mainPhaseStart'); await drain(st); eq('none', st.memory, 0);
  const st2 = mk(); const a2 = put(st2, 'p1', 'ST15-02'); put(st2, 'p2', FILL); st2.memory = 0; S.queueTriggersForStack(st2, 'p1', a2, 'mainPhaseStart'); await drain(st2); eq('+1 with a battle-area digimon', st2.memory, 1);
});
T('i209', 'ST15-08 security: only exact-named 아구몬 (not 아구몬 박사) or a 신태일 tamer', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); setSec(st, 'p2', ['ST15-08', LOW]); setHand(st, 'p2', ['BT1-011']); st._qaAns = { confirmEffect: true, pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1), pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await atkSec(st, 'p1', a.uid);
  ok('아구몬 박사 not played', !st.players.p2.battle.some(s => s.cardId === 'BT1-011'));
});
await runAll('qa-w1r2-l');
process.exit(0);
