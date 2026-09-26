// Official Q&A id 3664 (EX5-062 아누비스몬 【자신의 턴】 「자신의 디지몬이 효과로 등장했을 때 …」): 하나의 효과로 자신의 디지몬이 동시에 2체 이상 등장해도 이 효과는 1번만 유발한다
// (15-5-2: 같은 유발 조건이 한 번의 처리로 여러 번 동시에 성립해도 1회). 별개의 효과로 따로 등장시키면 각각 유발한다.
import { S, E, Fx, C, mk, put, setHand, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const lv = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === n && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
const trig = (st) => st.pending.filter(x => !x.resolved && x.cardId === 'EX5-062').length;
async function runText(st, text) {
  const script = Fx.compileToScript(text); const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'X-TEST', sourceStackUid: null, trigger: {}, choose: makeChoose(st) };
  await Fx.runScript(script, ctx);
}
T(3664, 'EX5-062: 한 문장의 효과로 동시에 2체 등장 → 1번만 유발', async () => {
  const st = mk(); put(st, 'p1', 'EX5-062'); setHand(st, 'p1', [lv(3), lv(4)]);
  await runText(st, '자신의 패에서 Lv.3의 디지몬 카드 1장과 Lv.4의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킨다.');
  eq('2체 등장', st.players.p1.battle.length, 3); eq('유발 1회', trig(st), 1);
});
T('3664b', 'EX5-062: 별개의 효과 2번이면 각각 유발', async () => {
  const st = mk(); put(st, 'p1', 'EX5-062'); setHand(st, 'p1', [lv(3), lv(4)]);
  await runText(st, '자신의 패에서 Lv.3의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킨다.');
  await runText(st, '자신의 패에서 Lv.4의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킨다.');
  eq('유발 2회', trig(st), 2);
});
await runAll('qa-w5r2-simultaneous-play-once');
