// Official Q&A ids 3589 (EX5-026), 3796 (EX6-058) and the general rule (2596/2807/2929/4242): a Lv.-less digimon (Lv.0 in the DB) / tamer / option never satisfies a Lv.-based condition.
import { S, E, Fx, C, mk, put, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const lv4 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 4 && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
async function cands(text) {
  const st = mk(); const me = put(st, 'p1', lv4); const lvless = put(st, 'p2', 'EX2-045'); const l4 = put(st, 'p2', lv4); let seen = null; const base = makeChoose(st);
  await Fx.runScript(Fx.compileToScript(text), { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'X', sourceStackUid: me.uid, trigger: {}, choose: async (k, o) => { if (k === 'pickStack' && !seen) seen = o.uids.slice(); return base(k, o); } });
  return { seen, lvless: lvless.uid, l4: l4.uid };
}
T(3589, 'Lv.-less 디지몬은 「Lv.N 이하」 / 「가장 Lv.이 낮은」 대상이 아니다', async () => {
  let r = await cands('Lv.4 이하의 상대의 디지몬 1마리를 소멸시킨다.'); eq('Lv.4 이하: Lv.4만', JSON.stringify(r.seen), JSON.stringify([r.l4]));
  r = await cands('가장 Lv.이 낮은 상대의 디지몬 1마리를 소멸시킨다.'); eq('가장 낮은 Lv.: Lv.4', JSON.stringify(r.seen), JSON.stringify([r.l4]));
  r = await cands('Lv.3 이하의 상대의 디지몬 1마리를 패로 되돌린다.'); eq('Lv.3 이하: 후보 없음', r.seen, null);
});
await runAll('qa-w5r2-lvless-filter');
