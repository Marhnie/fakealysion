// Slice-4 round 2, batch B: 「효과를 받지 않는다」 family (same official answers repeated on 7 cards; shared-rule templates).
import { S, E, Fx, newBoard, F3, scenario, report, stk, mkChoose, ctxFor } from './lib5.mjs';
const F0 = { player: 'p2', category: 'digimon' };
const boardImm = () => { const st = newBoard({ p1: { battle: [F3[0], F3[1]] }, p2: { battle: [F3[2]] } }); return { st, a: stk(st, 'p1', F3[0]), b: stk(st, 'p1', F3[1]) }; };
const shield = (st, a) => S.grantShield(st, 'p1', a.uid, { kinds: ['all'], until: st.turnNumber });
const asOpp = (st, fn) => { const prev = st._fxSrc; st._fxSrc = F0; try { return fn(); } finally { st._fxSrc = prev; } };
const fam = (...qs) => qs.join('/');
await scenario(fam(4305, 4394, 4460, 4770, 4952, 5022, 5068), 'a keyword can be granted to an immune digimon but it does not count as having it', async (chk) => {
  const { st, a } = boardImm(); shield(st, a);
  asOpp(st, () => S.grantKeyword(st, 'p1', a.uid, '재밍', true, 'turn'));
  chk(!S.hasKeyword(a, '재밍'), 'immune digimon has the keyword'); chk((a.deferred || []).some(d => d.keyword === '재밍'), 'grant not recorded');
});
await scenario(fam(4306, 4395, 4461, 4771, 4953, 5023, 5069), 'a digimon that becomes immune after being granted a keyword stops being affected', async (chk) => {
  const { st, a } = boardImm();
  asOpp(st, () => S.grantKeyword(st, 'p1', a.uid, '재밍', true, 'turn')); chk(S.hasKeyword(a, '재밍'), 'not granted first');
  shield(st, a); S.settleDeferred(st, a, 'p1'); chk(!S.hasKeyword(a, '재밍'), 'still affected after gaining immunity');
});
await scenario(fam(4307, 4396, 4462, 4772, 4954, 5024, 5070), 'when the immunity ends the recorded grant applies again', async (chk) => {
  const { st, a } = boardImm();
  asOpp(st, () => S.grantKeyword(st, 'p1', a.uid, '재밍', true, 'turn')); shield(st, a); S.settleDeferred(st, a, 'p1'); chk(!S.hasKeyword(a, '재밍'), 'setup');
  a.shields = []; S.settleDeferred(st, a, 'p1'); chk(S.hasKeyword(a, '재밍'), 'grant did not resume after immunity ended');
});
await scenario(fam(4392, 4458, 4768, 4950, 5020, 5066), 'immunity: opponent rest / DP-3000 effects have no influence', async (chk) => {
  const { st, a } = boardImm(); shield(st, a); const dp0 = S.effectiveDP(st, 'p1', a);
  asOpp(st, () => { S.restStack(st, 'p1', a.uid, 'effect'); S.modifyDP(st, 'p1', a.uid, -3000, 'turn'); });
  chk(!a.suspended, 'rested'); chk(S.effectiveDP(st, 'p1', a) === dp0, 'DP changed ' + dp0 + ' -> ' + S.effectiveDP(st, 'p1', a));
});
await scenario(fam(4393, 4951, 4459, 4769, 5021, 5067), 'an immune digimon can still be chosen as the target of an opponent effect', async (chk) => {
  const { st, a } = boardImm(); shield(st, a); let offered = null;
  const ch = mkChoose(st, { answer: (k, o) => { if (k === 'pickStack' || k === 'pickStackAnySide') offered = JSON.stringify(o); return undefined; } });
  const sc = Fx.compileToScript('상대의 디지몬 1마리를 레스트시킨다.');
  st.activePlayer = 'p2';
  await Fx.runScript(sc, { state: st, S, E, self: 'p2', opp: 'p1', sourceCardId: F3[2], sourceStackUid: stk(st, 'p2', F3[2]).uid, choose: ch, trigger: { player: 'p2', cardId: F3[2], tags: ['등장 시'] }, startAttack() {} });
  chk(offered && offered.includes(a.uid), 'immune digimon not offered: ' + offered); chk(!a.suspended, 'immune digimon got rested');
});
report();
