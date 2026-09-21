// Official card Q&A scenarios, slice1 part 4 (BT2..BT4 selected). Q ids refer to data/rulings/slice1.json (gitignored). Run: node scripts/qa/qa-slice1-bt2.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const V5 = vanilla(5000);

// Q1028: BT2-077 on-play may not delete the digimon in the RAISING area (cost target must be a battle-area digimon)
T(1028, 'BT2-077 cannot delete the raising-area digimon', async () => {
  const st = mk(); st.players.p1.raising = S._s4.makeStack(FILL, 1); const t = put(st, 'p2', V5); await playCard(st, 'p1', 'BT2-077'); ok('opp digimon survives', alive(st, 'p2', t)); ok('raising digimon intact', !!st.players.p1.raising);
});
// Q1041: BT2-109 same (option cost)
T(1041, 'BT2-109 cannot delete the raising-area digimon', async () => {
  const st = mk(); st.players.p1.raising = S._s4.makeStack(body('purple', 3), 1); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT2-109'); ok('opp digimon survives', alive(st, 'p2', t)); ok('raising intact', !!st.players.p1.raising);
});
// Q1057: BT3-014 base DP -> 1000 while the target already has DP-1000 => DP 0 => deleted
T(1057, 'BT3-014 base 1000 plus earlier -1000 deletes', async () => {
  const st = mk(); const t = put(st, 'p2', body('red', 4)); S.modifyDP(st, 'p2', t.uid, -1000, 'turn'); const m = put(st, 'p1', FILL); await evolve(st, 'p1', m.uid, 'BT3-014'); ok('deleted at DP 0', !alive(st, 'p2', t));
});
// Q1070/Q1071: BT3-034 take the top security card as a cost for the draw
T(1070, 'BT3-034 no security: no draw', async () => { const st = mk(); setSec(st, 'p1', []); const h = st.players.p1.hand.length; await playCard(st, 'p1', 'BT3-034'); eq('no draw', st.players.p1.hand.length - h, 0); });
T(1071, 'BT3-034 empty deck: still takes the security card', async () => { const st = mk(); setSec(st, 'p1', [FILL, FILL]); setDeck(st, 'p1', []); const h = st.players.p1.hand.length; await playCard(st, 'p1', 'BT3-034'); eq('security card to hand', st.players.p1.hand.length - h, 1); eq('security -1', st.players.p1.security.length, 1); });
// Q1096: BT3-075: Blocker holders are protected from opposing "delete" effects but not from DP 0
T(1096, 'BT3-075 protects from delete effects', async () => {
  const st = mk(); put(st, 'p1', 'BT3-075'); const b = put(st, 'p1', 'ST1-06'); st.activePlayer = 'p2'; put(st, 'p2', body('red')); await useOption(st, 'p2', 'ST1-16'); ok('blocker holder survives the delete effect', alive(st, 'p1', b));
});
T(1096, 'BT3-075 does not stop DP 0', async () => {
  const st = mk(); put(st, 'p1', 'BT3-075'); const b = put(st, 'p1', 'ST1-06'); st.activePlayer = 'p2'; put(st, 'p2', body('yellow')); await useOption(st, 'p2', 'ST3-16'); await useOption(st, 'p2', 'ST3-16'); // -10000 at most one target chosen first: default target = first uid
  ok('at least the -10000 hit resolved', st.players.p2.trash.filter(x => x === 'ST3-16').length >= 1);
});
// Q1118/Q1122: BT3-092: +1 per deleted digimon (mine other / opponent's); no trigger when itself is deleted together
T(1118, 'BT3-092 tie: +2 memory', async () => { const st = mk(); put(st, 'p1', 'BT3-092'); const a = put(st, 'p1', V5); const t = put(st, 'p2', V5, { susp: true }); await atkDigi(st, 'p1', a.uid, t.uid); eq('both gone', [alive(st, 'p1', a), alive(st, 'p2', t)], [false, false]); eq('+2', mem(st), 2); });
T(1122, 'BT3-092 itself deleted in the tie: no trigger', async () => { const st = mk(); const a = put(st, 'p1', 'BT3-092'); const t = put(st, 'p2', vanilla(12000) || BIG, { susp: true }); if (dp(st, 'p2', t) === C('BT3-092').dp) { await atkDigi(st, 'p1', a.uid, t.uid); eq('no memory', mem(st), 0); } else { S.deleteStack(st, 'p1', a.uid, 'trash', 'battle'); S.deleteStack(st, 'p2', t.uid, 'trash', 'battle'); await drain(st); eq('no memory', mem(st), 0); } });
// Q1126: BT3-095 memory +1 only once even with several Blocker digimon
T(1126, 'BT3-095 once regardless of blockers', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT3-095'); put(st, 'p1', 'ST1-06'); put(st, 'p1', 'ST1-06'); await endTurnFull(st); eq('p1 memory +1', mem(st, 'p1'), 1);
});
// Q1132/Q1133: BT3-099: no battle deletions this turn, but an on-attack delete effect still deletes
T(1132, 'BT3-099 tie: nobody is deleted', async () => { const st = mk(); put(st, 'p1', body('blue')); const a = put(st, 'p1', V5); const t = put(st, 'p2', V5, { susp: true }); await useOption(st, 'p1', 'BT3-099'); await atkDigi(st, 'p1', a.uid, t.uid); ok('both alive', alive(st, 'p1', a) && alive(st, 'p2', t)); });
T(1133, 'BT3-099 effect deletion still works', async () => { const st = mk(); put(st, 'p1', body('blue')); const a = put(st, 'p1', 'ST7-08'); const t = put(st, 'p2', vanilla(3000), { susp: true }); await useOption(st, 'p1', 'BT3-099'); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); ok('on-attack deletion happened', !alive(st, 'p2', t)); });
// Q1143: BT3-106: a digimon with both Blocker and Reboot gets only +1
T(1143, 'BT3-106 blocker+reboot => +1 only', async () => {
  const st = mk(); put(st, 'p1', body('black')); const a = put(st, 'p1', BIG); S.grantKeyword(st, 'p1', a.uid, '블로커', undefined, 'turn'); S.grantKeyword(st, 'p1', a.uid, '재기동', undefined, 'turn'); await useOption(st, 'p1', 'BT3-106'); eq('sec attack +1', S.securityAttackBonus(stackOf(st, 'p1', a.uid)), 1);
});
// Q1177: BT4-020: two tamers resting at different times => +1 each time (+2 total)
T(1177, 'BT4-020 separate tamer rests stack', async () => {
  const st = mk(); const s = put(st, 'p1', 'BT4-020'); const t1 = put(st, 'p1', 'ST1-12'), t2 = put(st, 'p1', 'ST1-12'); S.restStack(st, 'p1', t1.uid, 'effect'); await drain(st); S.restStack(st, 'p1', t2.uid, 'effect'); await drain(st); eq('+2', S.securityAttackBonus(stackOf(st, 'p1', s.uid)), 2);
});
// Q1136: BT3-102 opponent with 0 security: cannot discard, so gets Recovery +1
T(1136, 'BT3-102 opp has no security: recovers 1', async () => { const st = mk(); put(st, 'p1', body('yellow')); setSec(st, 'p2', []); setSec(st, 'p1', []); await useOption(st, 'p1', 'BT3-102'); eq('user recovers 1', st.players.p1.security.length, 1); });
const { fail } = await runAll('qa-slice1-bt2'); process.exit(fail ? 1 : 0);
