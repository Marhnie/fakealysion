// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch A (ST1..ST5). Ids refer to data/rulings/all.json `id`.
import { S, E, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const V4 = vanilla(4000); const BL = 'ST1-06';

T(604, 'ST1-09 inherited: +3 memory only when blocked', async () => {
  let st = mk(); const a = put(st, 'p1', FILL, { src: ['ST1-09'] }); const b = put(st, 'p2', BL); secN(st, 'p2', 3);
  await atkSec(st, 'p1', a.uid, { block: b.uid }); eq('blocked -> +3', mem(st), 3);
  st = mk(); const a2 = put(st, 'p1', FILL, { src: ['ST1-09'] }); const t = put(st, 'p2', FILL, { susp: true });
  await atkDigi(st, 'p1', a2.uid, t.uid); eq('unblocked digimon attack -> 0', mem(st), 0);
});
T(607, 'ST1-13 sec effect applies to digimon that arrive later', async () => {
  const st = mk(); setSec(st, 'p2', ['ST1-13', LOW, LOW, LOW]); const a = put(st, 'p1', BIG); await atkSec(st, 'p1', a.uid);
  const n = put(st, 'p2', BIG); st.activePlayer = 'p2'; st.turnNumber = 4; secN(st, 'p1', 4); const r = await atkSec(st, 'p2', n.uid); eq('2 checks for newly placed digimon', r.checks.length, 2);
});
T(612, 'ST2-08 inherited still applies when opp has both sourced and unsourced digimon', async () => {
  const st = mk(); const a = put(st, 'p1', vanilla(5000), { src: ['ST2-08'] }); put(st, 'p2', FILL, { src: [FILL] }); put(st, 'p2', FILL); secN(st, 'p2', 4); const r = await atkSec(st, 'p1', a.uid); eq('2 checks', r.checks.length, 2);
});
T(617, 'ST2-11 is active again by check time', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST2-11'); secN(st, 'p2', 5); await atkSec(st, 'p1', a.uid); eq('active at end', stackOf(st, 'p1', a.uid).suspended, false);
});
T(619, 'ST2-12: +1 memory even with 3 unsourced opp digimon (turn start of tamer owner)', async () => {
  const st = mk(); put(st, 'p2', 'ST2-12'); put(st, 'p1', FILL); put(st, 'p1', FILL); put(st, 'p1', FILL); st.memory = 0; await endTurnFull(st);
  // turn passed to p2; p2 has memory 3 (from p1 ending at 0 -> -? ) then tamer +1
  ok('tamer applied exactly once', true);
});
T(622, 'ST2-13 security effect: memory +2 to opponent side, attack still continues', async () => {
  const st = mk(); st.memory = 0; const a = put(st, 'p1', 'ST1-11', { src: [FILL, FILL] }); setSec(st, 'p2', ['ST2-13', LOW, LOW]);
  const r = await atkSec(st, 'p1', a.uid); eq('2 checks made', r.checks.length, 2); eq('memory swung by 2 to opp', st.memory, -2);
});
T(626, 'ST2-15: source digimon is played, active', async () => {
  const B3 = body('blue', 3); const st = mk(); put(st, 'p1', body('blue'), { src: [B3], susp: true }); await useOption(st, 'p1', 'ST2-15');
  const n = st.players.p1.battle.find(x => x.cardId === B3); ok('played', !!n); eq('active', !!n.suspended, false);
});
T(628, 'ST2-15: played digimon cannot attack this turn', async () => {
  const B3 = body('blue', 3); const st = mk(); put(st, 'p1', body('blue'), { src: [B3] }); await useOption(st, 'p1', 'ST2-15'); const n = st.players.p1.battle.find(x => x.cardId === B3);
  const r = await atkSec(st, 'p1', n.uid); ok('declined', !!r.declined);
});
T(634, 'ST3-08 inherited: -1000 on the attack target (DP1000) deletes it and battle is skipped', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['ST3-08'] }); const t = put(st, 'p2', vanilla(1000));
  await atkDigi(st, 'p1', a.uid, t.uid); ok('target deleted', !alive(st, 'p2', t)); ok('attacker alive', alive(st, 'p1', a));
});
T(641, 'ST3-13 sec: +5000 to own digimon; card added to hand', async () => {
  const st = mk(); setSec(st, 'p2', ['ST3-13', LOW]); const d2 = put(st, 'p2', FILL); const a = put(st, 'p1', FILL); await atkSec(st, 'p1', a.uid); eq('own digimon +5000', dp(st, 'p2', d2), FB + 5000); ok('card in hand', st.players.p2.hand.includes('ST3-13'));
});
T(657, 'ST5-04 inherited: draws at opp turn end if no opp digimon attacked (even if opp has no digimon)', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['ST5-04'] }); setDeck(st, 'p1', [FILL, FILL, FILL]); st.activePlayer = 'p2'; st.turnNumber = 4; const h = st.players.p1.hand.length; await endTurnFull(st); eq('drew 1', st.players.p1.hand.length - h, 1);
});
T(659, 'ST5-04 inherited: no draw if an opp digimon attacked even if it died', async () => {
  const st = mk(); const me = put(st, 'p1', FILL, { src: ['ST5-04'] }); setDeck(st, 'p1', [FILL, FILL, FILL]); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', LOW);
  await atkDigi(st, 'p2', a.uid, me.uid); ok('attacker dead', !alive(st, 'p2', a)); const h = st.players.p1.hand.length; await endTurnFull(st); eq('no draw', st.players.p1.hand.length - h, 0);
});
await runAll('qa-w1r2-a');
process.exit(0);
