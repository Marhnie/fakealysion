// Official Q&A id 3697 (EX6-006 대죄의 문): 이 카드가 진화원에 여러 장 있으면 진화원 효과([턴에 1회] 등장 코스트 -3/-4)는 중복해서 사용할 수 있다 (각 카드가 자신의 1회를 가진다).
import { S, E, Fx, C, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const sin = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('7대마왕') && c.dp)?.id;
const fill = (n) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel).slice(0, n).map(c => c.id);
const raisingWith = (st, sources) => { const s = S._s4.makeStack('EX6-006', 1); s.sources = sources; st.players.p1.raising = s; S.recomputeStackGrants(s); return s; };
T(3697, 'EX6-006: 진화원에 2장이면 할인 옵션이 2번 사용 가능(합계 -6), 1장이면 1번', async () => {
  let st = mk(); const h = raisingWith(st, ['EX6-006', 'EX6-006', ...fill(3)]);
  const opts = S.hookPlayCostOptions(st, 'p1', sin).filter(o => /대죄의 문/.test(o.label)); eq('옵션 2개', opts.length, 2);
  const d1 = await opts[0].apply(); const again = S.hookPlayCostOptions(st, 'p1', sin).filter(o => /대죄의 문/.test(o.label)); const d2 = await again[0]?.apply?.();
  eq('합계 할인', (d1 || 0) + (d2 || 0) <= -6, true);
  const third = S.hookPlayCostOptions(st, 'p1', sin).filter(o => /대죄의 문/.test(o.label)); eq('3번째는 없음', third.length, 0);
  st = mk(); raisingWith(st, ['EX6-006', ...fill(3)]); const o1 = S.hookPlayCostOptions(st, 'p1', sin).filter(o => /대죄의 문/.test(o.label)); await o1[0].apply();
  eq('1장이면 1번뿐', S.hookPlayCostOptions(st, 'p1', sin).filter(o => /대죄의 문/.test(o.label)).length, 0);
});
await runAll('qa-w5r2-ex6-006');
