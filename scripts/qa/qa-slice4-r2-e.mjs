// Slice-4 round 2, batch E: simultaneous deletion in battle (source effects), "Lv.이 같은 카드가 2장 이상 겹쳐져" condition, security-0 face-up options.
import { S, E, Fx, newBoard, F3, fillerLv, scenario, report, stk, mkChoose, drain, fire, pend, nm } from './lib5.mjs';
const L3 = fillerLv(3);
const dpOf = (id) => S.card(id).dp;
const strong = L3.find(id => dpOf(id) >= 4000), weak = L3.find(id => dpOf(id) > 0 && dpOf(id) < dpOf(strong));
// 4324 family: "이 디지몬이 배틀에서 상대의 디지몬을 소멸시켰을 때" source effects do not fire when both die at the same time
const SIM = [[4324, 'BT20-029'], [4325, 'BT20-032'], [4341, 'BT20-034'], [4360, 'BT20-042'], [4794, 'EX9-041'], [4900, 'BT22-047'], [4904, 'BT22-051'], [4928, 'BT22-068'], [4929, 'BT22-070'], [4367, 'BT20-044']];
for (const [q, id] of SIM) {
  await scenario(q, `${id}: simultaneous destruction in battle -> the source effect is not triggered (control: a real win triggers it)`, async (chk) => {
    for (const tie of [true, false]) {
      const st = newBoard({ p1: { battle: [{ id: strong, src: [id] }] }, p2: { battle: [{ id: tie ? strong : weak, rested: true }] } });
      const a = st.players.p1.battle[0], d = st.players.p2.battle[0]; a.attackEligibleTurn = 0;
      S.resolveDigimonBattle(st, 'p1', a.uid, d.uid);
      const fired = st.pending.some(t => !t.resolved && t.cardId === id);
      if (tie) chk(!fired && !st.players.p1.battle.length, `tie: fired=${fired} p1=${st.players.p1.battle.length}`);
      else if (id !== 'BT20-044') chk(fired, 'control: a normal battle win should trigger the source effect');
    }
  });
}
// 4879 family: "Lv.이 같은 카드가 2장 이상 겹쳐져 있다" counts the whole stack (top card included) — exercised through BT22-051 (returns the lowest-DP rested opponent digimon when true)
const L5 = fillerLv(5), L4 = fillerLv(4);
const LV_Q = [4879, 4898, 4901, 4903, 4908, 4921, 4930, 4932, 4941, 4977];
await scenario(LV_Q.join('/'), 'same-Lv rule via BT22-051: Lv5 top + Lv5 source -> true; Lv5 top + Lv4 source -> false', async (chk) => {
  for (const [src, want] of [[[L5[1]], true], [[L4[0]], false], [[], false]]) {
    const st = newBoard({ p1: { battle: [{ id: 'BT22-051', src }] }, p2: { battle: [{ id: L3[0], rested: true }] } });
    const ch = mkChoose(st); await fire(st, 'p1', stk(st, 'p1', 'BT22-051'), 'digivolve', ch);
    const back = !st.players.p2.battle.length; chk(back === want, 'sources ' + JSON.stringify(src.map(nm)) + ' expected ' + want + ' got ' + back);
  }
});
// 4610 family: face-up-security options' 【메인】 works with 0 security cards (no card to add to hand; the option still goes to security)
for (const [q, id] of [[4610, 'BT21-095'], [4697, 'ST20-15'], [4702, 'ST21-15'], [4836, 'EX9-072'], [4850, 'P-181']]) {
  await scenario(q, id + ': 【메인】 usable with 0 security: nothing added to hand, the card is still put into security', async (chk) => {
    const fxs = [...new Set(S.card(id).colors.map(col => F3.find(x => S.card(x).colors.length === 1 && S.card(x).colors[0] === col) || F3[0]))]; const st = newBoard({ p1: { battle: fxs, hand: [id], security: [] }, memory: 5 }); const hand0 = st.players.p1.hand.length - 1;
    S.useOptionCard(st, 'p1', 0); await drain(st, mkChoose(st));
    chk(st.players.p1.hand.length === hand0, 'hand changed ' + st.players.p1.hand.length); chk(st.players.p1.security.includes(id), 'option not placed in security: ' + JSON.stringify(st.players.p1.security));
  });
}
report();
