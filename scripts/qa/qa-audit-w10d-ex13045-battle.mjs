// Wave10/sliceD audit — Q7356 (idx6546): EX13-045 엑자몬 【진화 시】 효과.
// 공식 룰링: "조그레스 진화하고 있었다면," 조건(어택+DP상승)을 만족하지 못해도,
// "그 후, 이 디지몬과 상대의 디지몬 1마리로 배틀할 수 있다"는 별개로 처리 가능해야 한다.
// Run: node scripts/qa/qa-audit-w10d-ex13045-battle.mjs < /dev/null
import { S, mk, put, drain, runSeg, T, eq, ok, runAll, errs, cur } from './lib-ex13.mjs';

T('7356', 'EX13-045: 조그레스 진화가 아니어도 진화 시 효과의 "그 후" 배틀은 처리 가능', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX13-045', {}); // plain put: viaFusion is NOT set (not jogress evolved)
  ok('조그레스 아님 확인', !a.viaFusion);
  const weakId = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.dp && c.dp < 15000 && !c.effectKo && !c.inheritedKo)?.id;
  const b = put(st, 'p2', weakId, {});
  await runSeg(st, 'p1', a, 'EX13-045', '진화 시');
  eq('오류 없음', errs(st), []);
  ok('배틀이 일어나 상대 디지몬이 소멸함 (조그레스 여부와 무관하게 "그 후" 처리)', !st.players.p2.battle.some((s) => s.uid === b.uid));
  ok('자신의 디지몬은 살아있음 (DP 우위)', !!cur(st, 'p1', a));
});
await runAll('qa-audit-w10d-ex13045-battle');
