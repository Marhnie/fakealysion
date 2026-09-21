// Official card Q&A scenarios, slice1 (ST starter decks). Q ids refer to data/rulings/slice1.json (gitignored). Run: node scripts/qa/qa-slice1-st.mjs < /dev/null
import { S, E, C, FILL, LOW, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const F3 = [FILL, FILL, FILL]; const V4 = vanilla(4000);

// Q601: a digimon holding Koromon as a source counts Koromon itself toward the "4 or more sources" threshold
T(601, 'ST1-01 source counts itself', async () => {
  let st = mk(); let s = put(st, 'p1', FILL, { src: ['ST1-01', FILL, FILL, FILL] }); eq('4 sources incl. self -> +1000', dp(st, 'p1', s), FB + 1000);
  st = mk(); s = put(st, 'p1', FILL, { src: ['ST1-01', FILL, FILL] }); eq('3 sources -> no bonus', dp(st, 'p1', s), FB);
});
// Q602, Q610, Q633: 《Blocker》 + attack-time memory -2 digimon can still attack at low memory; turn does not pass mid-attack
for (const [q, id] of [[602, 'ST1-06'], [610, 'ST2-07'], [633, 'ST3-07']]) T(q, id + ' attacks at low memory', async () => {
  const st = mk(); const a = put(st, 'p1', id); secN(st, 'p2', 3); st.memory = 0;
  const r = await atkSec(st, 'p1', a.uid); ok('attack was declared', !r.declined);
  eq('memory shifted to opponent side', mem(st), -2); eq('turn player unchanged mid-attack', st.activePlayer, 'p1');
});
// Q603: Garudamon's on-evolve DP+3000 may target itself
T(603, 'ST1-08 self target', async () => {
  const st = mk(); const s = put(st, 'p1', FILL); await evolve(st, 'p1', s.uid, 'ST1-08'); const n = stackOf(st, 'p1', s.uid);
  eq('DP = base+3000', dp(st, 'p1', n), C('ST1-08').dp + 3000);
});
// Q605: WarGreymon: 2 sources per Security Attack +1, remainder discarded
T(605, 'ST1-11 3 sources => 2 checks', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST1-11', { src: F3 }); secN(st, 'p2', 5);
  const r = await atkSec(st, 'p1', a.uid); eq('checks', r.checks.length, 2);
});
T(605, 'ST1-11 4 sources => 3 checks', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST1-11', { src: [...F3, FILL] }); secN(st, 'p2', 5);
  const r = await atkSec(st, 'p1', a.uid); eq('checks', r.checks.length, 3);
});
// Q606, Q640: two of the same DP-boosting tamer stack
T(606, 'ST1-12 two tamers stack', async () => {
  const st = mk(); const s = put(st, 'p1', FILL); put(st, 'p1', 'ST1-12'); put(st, 'p1', 'ST1-12'); eq('+2000', dp(st, 'p1', s), FB + 2000);
});
// Q608/Q609: digimon deleted by an option effect: its sources go to trash
T(608, 'ST1-15 deleted digimon sources go to trash', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { src: ['ST1-01', FILL] }); put(st, 'p1', FILL); const before = st.players.p2.trash.length;
  await useOption(st, 'p1', 'ST1-15'); ok('deleted', !alive(st, 'p2', t)); eq('trash gained top + 2 sources (3)', st.players.p2.trash.length - before, 3);
});
T(609, 'ST1-16 deleted digimon sources go to trash', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { src: ['ST1-01', FILL] }); put(st, 'p1', FILL); const before = st.players.p2.trash.length;
  await useOption(st, 'p1', 'ST1-16'); ok('deleted', !alive(st, 'p2', t)); eq('trash +3', st.players.p2.trash.length - before, 3);
});
// Q611/Q613/Q614: WereGarurumon inherited sec attack +1 if opponent battle-area digimon has no sources; raising area ignored; no digimon -> none
T(611, 'ST2-08 inherited: opp digimon w/o sources', async () => {
  const st = mk(); const a = put(st, 'p1', V4, { src: ['ST2-08'] }); put(st, 'p2', FILL); secN(st, 'p2', 4);
  const r = await atkSec(st, 'p1', a.uid); eq('2 checks', r.checks.length, 2);
});
T(613, 'ST2-08 inherited: raising area digimon ignored', async () => {
  const st = mk(); const a = put(st, 'p1', V4, { src: ['ST2-08'] }); st.players.p2.raising = S._s4.makeStack(FILL, 1); put(st, 'p2', FILL, { src: [FILL] }); secN(st, 'p2', 4);
  const r = await atkSec(st, 'p1', a.uid); eq('1 check', r.checks.length, 1);
});
T(614, 'ST2-08 inherited: no opp digimon', async () => {
  const st = mk(); const a = put(st, 'p1', V4, { src: ['ST2-08'] }); secN(st, 'p2', 4);
  const r = await atkSec(st, 'p1', a.uid); eq('1 check', r.checks.length, 1);
});
// Q615: Zudomon on-evolve trashes the single source of an opponent digimon that has only 1
T(615, 'ST2-09 opp has 1 source', async () => {
  const st = mk(); const t = put(st, 'p2', FILL, { src: [FILL] }); const my = put(st, 'p1', FILL); await evolve(st, 'p1', my.uid, 'ST2-09'); eq('sources left', stackOf(st, 'p2', t.uid).sources.length, 0);
});
// Q616: MetalGarurumon unsuspends only on its first attack each turn
T(616, 'ST2-11 once per turn', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST2-11'); secN(st, 'p2', 5); await atkSec(st, 'p1', a.uid); eq('active after 1st attack', stackOf(st, 'p1', a.uid).suspended, false);
  await atkSec(st, 'p1', a.uid); eq('rested after 2nd attack', stackOf(st, 'p1', a.uid).suspended, true);
});
// Q630/Q631: two stacks with the same inherited source both trigger on the same opposing deletion
T(630, 'ST3-01 both trigger', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['ST3-01'] }); const b = put(st, 'p1', FILL, { src: ['ST3-01'] }); const t = put(st, 'p2', FILL);
  S.modifyDP(st, 'p2', t.uid, -99999, 'turn'); await drain(st); ok('target gone', !alive(st, 'p2', t)); eq('a +1000', dp(st, 'p1', a), FB + 1000); eq('b +1000', dp(st, 'p1', b), FB + 1000);
});
T(631, 'ST3-04 both trigger', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['ST3-04'] }); put(st, 'p1', FILL, { src: ['ST3-04'] }); const t = put(st, 'p2', FILL);
  S.modifyDP(st, 'p2', t.uid, -99999, 'turn'); await drain(st); ok('target gone', !alive(st, 'p2', t)); eq('memory +2', mem(st), 2);
});
// Q632: Angemon inherited memory +1 only once regardless of >4 security
T(632, 'ST3-05 memory +1', async () => {
  const st = mk(); const a = put(st, 'p1', V4, { src: ['ST3-05'] }); secN(st, 'p1', 8); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); eq('+1', mem(st), 1);
});
// Q637: DP -4000 on an opp digimon with DP<=4000 makes it DP 0 and it is deleted
T(637, 'ST3-11 -4000 deletes dp<=4000', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST3-11'); const t = put(st, 'p2', V4); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid);
  ok('opp digimon deleted by DP 0', !alive(st, 'p2', t));
});
// Q638: attack target deleted by the on-attack effect => no battle happens
T(638, 'ST3-11 target vanishes -> attacker survives', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST3-11'); const t = put(st, 'p2', V4, { susp: true }); secN(st, 'p2', 3);
  await atkDigi(st, 'p1', a.uid, t.uid); ok('attacker alive', alive(st, 'p1', a)); eq('security untouched', st.players.p2.security.length, 3);
});
// Q626: Kaiser Nail can't bring back a Digitama source
T(626, 'ST2-15 only digimon-card sources', async () => {
  const st = mk(); put(st, 'p1', body('blue'), { src: ['ST1-01'] }); const n = st.players.p1.battle.length; await useOption(st, 'p1', 'ST2-15'); eq('nothing played', st.players.p1.battle.length, n);
});
// Q627/Q629: card played from a source enters active and cannot attack this turn
T(627, 'ST2-15 played from source: active, no attack this turn', async () => {
  const st = mk(); put(st, 'p1', body('blue'), { src: [body('blue', 3)], susp: true }); await useOption(st, 'p1', 'ST2-15');
  eq('2 stacks', st.players.p1.battle.length, 2); const nw = st.players.p1.battle[1]; eq('active', nw.suspended, false); ok('cannot attack this turn', nw.attackEligibleTurn > st.turnNumber);
});
const { fail } = await runAll('qa-slice1-st'); process.exit(fail ? 1 : 0);
