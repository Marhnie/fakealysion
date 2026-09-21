// Slice-4 round 2, batch A: face-up security family, security-check trigger order. Q ids reference data/rulings/slice4.json (text not copied).
import { S, E, Fx, newBoard, F3, scenario, report, stk, mkChoose, drain, pend } from './lib5.mjs';
const secOpt = Object.values(S.CARDS).find(c => c.category === 'option' && /【시큐리티】/.test(c.effectKo || '') && /드로우|1장 뽑/.test(c.effectKo))?.id;
// [card -> [placeQ, checkQ, triggerQ, shuffleQ]] (identical official answers repeated on 14 cards; one shared-rule template per Q)
const FAM = { 'BT20-050': [4371, 4372, 4373, 4374], 'BT20-052': [4376, 4377, 4378, 4379], 'BT20-055': [4383, 4384, 4385, 4386], 'BT20-086': [4424, 4425, 4426, 4427], 'ST20-15': [4466, 4467, 4468, 4469], 'ST21-15': [4486, 4487, 4488, 4489], 'BT21-095': [4611, 4612, 4613, 4614], 'EX9-072': [4837, 4838, 4839, 4840], 'P-181': [4851, 4852, 4853, 4854], 'BT22-100': [4972, 4973, 4974, 4975], 'EX10-012': [5031, 5032, 5033, 5034], 'EX10-020': [5058, 5059, 5060, 5061], 'EX10-035': [5105, 5106, 5107, 5108], 'EX10-057': [5150, 5151, 5152, 5153] };
for (const [id, [qp, qc, qt, qs]] of Object.entries(FAM)) {
  await scenario(qp, `${id}: a card put into security face-up stays a normal security card that is public`, async (chk) => {
    const st = newBoard({ p2: { security: F3.slice(1, 4) } });
    S.secAddFaceUp(st, 'p2', F3[6], 'top');
    chk(S.secFaceUpCount(st.players.p2) === 1 && st.players.p2.security.length === 4 && st.players.p2.security[0] === F3[6], 'face-up count / position');
  });
  await scenario(qc, `${id}: a face-up security card is checked normally (revealed flag only)`, async (chk) => {
    const st = newBoard({ p1: { battle: [F3[0]] }, p2: { security: F3.slice(1, 4) } });
    S.secAddFaceUp(st, 'p2', F3[6], 'top'); const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0;
    const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); S.stepSecurityCheck(ctl);
    chk(st.secReveal && st.secReveal.up === true && st.secReveal.cardId === F3[6] && st.players.p2.security.length === 3 && st.players.p2.trash.includes(F3[6]) && S.secFaceUpCount(st.players.p2) === 0, JSON.stringify(st.secReveal));
  });
  await scenario(qt, `${id}: the 【시큐리티】 effect of a checked face-up card triggers`, async (chk) => {
    if (!secOpt) { chk(true); return; }
    const st = newBoard({ p1: { battle: [F3[0]] }, p2: { security: F3.slice(1, 4) } });
    st.players.p2.security.unshift(secOpt); (st.players.p2.secUp ||= {})[secOpt] = 1; const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0;
    const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true; S.stepSecurityCheck(ctl);
    chk(st.pending.some(t => !t.resolved && t.cardId === secOpt && t.tags.includes('시큐리티')), 'not queued');
  });
  await scenario(qs, `${id}: shuffling security turns face-up cards back face-down and does not re-flip`, async (chk) => {
    const st = newBoard({ p1: { battle: [F3[0]] }, p2: { security: F3.slice(1, 5) } });
    S.secAddFaceUp(st, 'p2', F3[6], 'top'); S.secAddFaceUp(st, 'p2', F3[7], 'bottom');
    await Fx.runScript([{ op: 'shuffleSecurity', who: 'self' }], { state: st, S, E, self: 'p2', opp: 'p1', sourceCardId: F3[0], choose: mkChoose(st), trigger: {}, startAttack() {} });
    chk(S.secFaceUpCount(st.players.p2) === 0 && st.players.p2.security.length === 6, 'still face-up after shuffle');
  });
}
// 4370/4375/4382/4423: with only the top card face-up, the flip effect turns the 2nd card (BT20-050/052/055/086 flip effects)
for (const [q, id] of [[4370, 'BT20-050'], [4375, 'BT20-052'], [4382, 'BT20-055'], [4423, 'BT20-086']]) {
  await scenario(q, `${id}: top card already face-up -> next (2nd) card is flipped`, async (chk) => {
    const st = newBoard({ p2: { security: F3.slice(1, 5) } });
    (st.players.p2.secUp ||= {})[F3[1]] = 1;
    const r = S.secFlipTopFaceUp(st, 'p2');
    chk(r === F3[2] && S.secFaceUpCount(st.players.p2) === 2, 'flipped ' + r);
  });
}
// 4284 family (21 cards): checked card's 【시큐리티】 effect first; other triggers turn-player first
const ORDER = [4284, 4301, 4309, 4315, 4344, 4380, 4387, 4390, 4399, 4410, 4437, 4516, 4520, 4526, 4535, 4537, 4596, 4608, 4786, 4946, 4979];
await scenario(ORDER.join('/'), 'security check: 【시큐리티】 effect is queued before "security decreased / checked" watchers', async (chk) => {
  if (!secOpt) { chk(true); return; }
  const st = newBoard({ p1: { battle: [{ id: F3[0], src: ['BT21-001'] }] }, p2: { battle: [F3[1]], security: F3.slice(2, 5) } });
  st.players.p2.security.unshift(secOpt); const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0;
  const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true; S.stepSecurityCheck(ctl);
  const pe = st.pending.filter(t => !t.resolved); const i = pe.findIndex(t => t.cardId === secOpt && t.tags.includes('시큐리티'));
  chk(i === 0, 'security effect index ' + i + ' of ' + JSON.stringify(pend(st)));
});
report();
