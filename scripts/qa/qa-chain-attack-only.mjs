// ≪연계≫ (룰 16-24-1/-4/-5): DP 플러스와 S 어택 +1은 "그 어택의 종료까지"만 유효. 레스트 시점의 DP를 더한다. Run: node scripts/qa/qa-chain-attack-only.mjs < /dev/null
import { S, FILL, mk, put, dp, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, '연계: DP·S 어택은 어택 동안만', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', 'EX4-025'); const o = put(st, 'p1', FILL);
  const base = dp(st, 'p1', a), oDp = dp(st, 'p1', o);
  ok('연계 가능', S.chainOptions(st, 'p1', a.uid).includes(o.uid));
  ok('사용됨', S.useChain(st, 'p1', a.uid, o.uid));
  eq('DP + 레스트 시점 DP', dp(st, 'p1', a), base + oDp); ok('레스트됨', o.suspended);
  eq('S 어택 +1', Number(a.keywords['시큐리티어택']) || 0, 1);
  S.s8AttackEnded(st, 'p1', a.uid);
  eq('어택 종료 후 DP 원복', dp(st, 'p1', a), base); eq('S 어택 원복', Number(a.keywords['시큐리티어택']) || 0, 0);
});
T(2, '연계: 레스트된 디지몬은 대상이 될 수 없다', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', 'EX4-025'); const o = put(st, 'p1', FILL, { susp: true });
  eq('후보 없음', S.chainOptions(st, 'p1', a.uid).length, 0); ok('사용 불가', !S.useChain(st, 'p1', a.uid, o.uid));
});
await runAll('qa-chain-attack-only');
