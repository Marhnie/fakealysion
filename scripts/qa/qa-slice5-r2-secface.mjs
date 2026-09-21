// Slice-5 round 2: face-up security rulings that repeat across BT23-015/034/045/086, BT24-090/094, EX11-025/030/034/037/041/043/063/064 (48 Q ids).
// Q5231-family: a face-up card placed into security stays face-up/revealed (other rules unchanged).
// Q5232-family: a face-up security card is checked as normal, staying revealed.
// Q5291-family: a checked face-up card's 【시큐리티】 effect still triggers.
// Q5292-family: shuffling the security stack first turns face-up cards face-down and does not turn them up again.
import { S, E, Fx, newBoard, stk, mkChoose, drain, scenario, report, F3 } from './lib5.mjs';
const sec = 'ST22-10';
const fam = {
  '5231': [5231,5289,5307,5358,5681,5696,5812,5833,5852,5861,5868,5880,5923,5928],
  '5232': [5232,5290,5308,5359,5813,5834,5853,5862,5869,5881,5924,5929],
  '5291': [5291,5309,5360,5814,5835,5854,5863,5870,5882,5925,5930],
  '5292': [5292,5310,5361,5815,5836,5855,5864,5871,5883,5926,5931],
};
await scenario(fam['5231'].join(','), 'face-up card placed into security stays face-up, also after another card is put on top; count tracked', async (chk) => {
  const st = newBoard({ p1: { battle: [F3[0]], security: F3.slice(1, 4) } });
  S.secAddFaceUp(st, 'p1', F3[8], 'top'); chk(S.secFaceUpCount(st.players.p1) === 1, 'face-up 1');
  S.addToSecurity(st, 'p1', F3[9], 'top'); chk(S.secFaceUpCount(st.players.p1) === 1, 'still 1 after plain add on top');
  S.secAddFaceUp(st, 'p1', F3[10], 'bottom'); chk(S.secFaceUpCount(st.players.p1) === 2, '2 face-up');
});
await scenario(fam['5232'].join(','), 'checking a face-up security card resolves as a normal check; the face-up mark is consumed with the card', async (chk) => {
  const st = newBoard({ p1: { battle: [F3[0]] }, p2: { battle: [], security: [F3[1], F3[2]] } });
  S.secAddFaceUp(st, 'p2', F3[7], 'top'); chk(S.secFaceUpCount(st.players.p2) === 1, 'face-up set');
  const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0; chk(S.declareAttack(st, 'p1', a.uid).ok, 'declare');
  const n0 = st.players.p2.security.length; S.resolveSecurityCheck(st, 'p1', a.uid, 'p2');
  chk(st.players.p2.security.length === n0 - 1, 'one security card checked'); chk(S.secFaceUpCount(st.players.p2) === 0, 'face-up mark gone');
});
await scenario(fam['5291'].join(','), 'checked face-up security card: its 【시큐리티】 effect triggers', async (chk) => {
  const st = newBoard({ p1: { battle: [F3[0]] }, p2: { battle: [], security: [F3[1], F3[2]] } });
  S.secAddFaceUp(st, 'p2', sec, 'top');
  const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0; S.declareAttack(st, 'p1', a.uid);
  S.resolveSecurityCheck(st, 'p1', a.uid, 'p2');
  chk(st.pending.some(t => !t.resolved && t.cardId === sec), 'security effect queued');
});
await scenario(fam['5292'].join(','), 'shuffling security turns face-up cards face-down and leaves them face-down', async (chk) => {
  const st = newBoard({ p1: { battle: [F3[0]], security: F3.slice(1, 5) } });
  S.secAddFaceUp(st, 'p1', F3[8], 'top'); S.secAddFaceUp(st, 'p1', F3[9], 'bottom');
  await Fx.runScript([{ op: 'shuffleSecurity', who: 'self' }], { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: F3[0], sourceStackUid: st.players.p1.battle[0].uid, choose: mkChoose(st), trigger: {}, startAttack() {} });
  chk(S.secFaceUpCount(st.players.p1) === 0, 'all face-down after shuffle');
});
report();
