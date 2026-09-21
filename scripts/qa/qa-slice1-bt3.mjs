// Official card Q&A scenarios, slice1 part 5 (BT4/BT5 selected). Q ids refer to data/rulings/slice1.json (gitignored). Run: node scripts/qa/qa-slice1-bt3.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp;

// Q1205: BT4-037: security cost cannot be paid at 0 => no DP-2000
T(1205, 'BT4-037 no security: no DP reduction', async () => { const st = mk(); const t = put(st, 'p2', BIG); setSec(st, 'p1', []); await playCard(st, 'p1', 'BT4-037'); eq('DP untouched', dp(st, 'p2', t), C(BIG).dp); });
// Q1217/Q1218: BT4-060 rests Lv4- digimon only when they are PLAYED (not on evolution / raising->battle move)
T(1217, 'BT4-060 rests played Lv4-, not evolved', async () => {
  const st = mk(); put(st, 'p1', 'BT4-060'); const p = await playCard(st, 'p1', FILL); eq('played digimon rested', p.suspended, true);
  const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, body('red', 4)); eq('evolved digimon stays active', stackOf(st, 'p1', m.uid).suspended, false);
});
T(1218, 'BT4-060 raising->battle move is not a play', async () => { const st = mk(); put(st, 'p1', 'BT4-060'); st.players.p1.raising = S._s4.makeStack(FILL, 1); S.moveRaisingToBattle(st, 'p1'); await drain(st); const s = st.players.p1.battle[st.players.p1.battle.length - 1]; eq('active', s.suspended, false); });
// Q1231: BT4-086 cannot delete itself for the cost
T(1231, 'BT4-086 cannot pay with itself', async () => { const st = mk(); const s = await playCard(st, 'p1', 'BT4-086'); ok('stays', alive(st, 'p1', s)); eq('memory unchanged', st.memory, 0); });
// Q1268: BT4-104 with 0 security: discard does nothing but the memory +2 still happens
T(1268, 'BT4-104 no security still +2 memory', async () => { const st = mk(); put(st, 'p1', body('yellow')); setSec(st, 'p1', []); await useOption(st, 'p1', 'BT4-104'); eq('+2 (cost 0)', mem(st), 2); });
// Q1282: BT5-003 counts itself among "3 or more digimon"
T(1282, 'BT5-003 counts holder itself', async () => {
  let st = mk(); let a = put(st, 'p1', BIG, { src: ['BT5-003'] }); put(st, 'p1', FILL); put(st, 'p1', FILL); const t = put(st, 'p2', BIG); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('3 digimon incl. holder: -1000', dp(st, 'p2', t), C(BIG).dp - 1000);
  st = mk(); a = put(st, 'p1', BIG, { src: ['BT5-003'] }); put(st, 'p1', FILL); const t2 = put(st, 'p2', BIG); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('2 digimon: none', dp(st, 'p2', t2), C(BIG).dp);
});
// Q1317/Q1318: BT5-035: -1000 per own digimon (self counts); all applied to ONE opposing digimon
T(1317, 'BT5-035 counts itself, one target', async () => { const st = mk(); put(st, 'p1', FILL); put(st, 'p1', FILL); const t1 = put(st, 'p2', BIG), t2 = put(st, 'p2', BIG); await playCard(st, 'p1', 'BT5-035'); const d = [dp(st, 'p2', t1), dp(st, 'p2', t2)].sort(); eq('3 own digimon: one target -3000', d, [C(BIG).dp - 3000, C(BIG).dp]); });
// Q1348: BT5-071: deletion by DP 0 is not "deleted by an effect"; a delete effect is
T(1348, 'BT5-071 DP0 is not effect deletion', async () => { const st = mk(); const s = put(st, 'p1', 'BT5-071'); st.activePlayer = 'p2'; put(st, 'p2', body('yellow')); await useOption(st, 'p2', 'ST3-14'); /* -2000 on DP2000 */ await drain(st); ok('deleted by DP0', !alive(st, 'p1', s)); eq('no memory gain (only the 2 paid by the opponent)', st.memory, 2); });
T(1348, 'BT5-071 effect deletion fires', async () => { const st = mk(); const s = put(st, 'p1', 'BT5-071'); st.activePlayer = 'p2'; put(st, 'p2', body('red')); await useOption(st, 'p2', 'ST1-16'); ok('deleted', !alive(st, 'p1', s)); eq('memory +1 on top of the 8 paid by the opponent', mem(st, 'p1'), 9); });
// Q1384: BT5-110: deletes every digimon and tamer (both sides) except the returned Omegamon
T(1384, 'BT5-110 wipes digimon and tamers of both sides', async () => {
  const st = mk(); const om = put(st, 'p1', 'BT1-084', { src: [FILL] }); const tm = put(st, 'p1', 'ST1-12'); const d = put(st, 'p2', FILL), tt = put(st, 'p2', 'ST1-12'); await useOption(st, 'p1', 'BT5-110');
  eq('all gone', [alive(st, 'p1', om), alive(st, 'p1', tm), alive(st, 'p2', d), alive(st, 'p2', tt)], [false, false, false, false]); ok('omegamon in hand', st.players.p1.hand.includes('BT1-084'));
});
const { fail } = await runAll('qa-slice1-bt3'); process.exit(fail ? 1 : 0);
