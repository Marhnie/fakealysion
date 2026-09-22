// 시큐리티에서 체크된 카드 자신의 【시큐리티】 효과(inheritedKo 필드에 인쇄된 것)는 진화원 효과가 아니다.
// 로그에 "진화원효과"라고 찍히거나 발동 대기 항목의 inherited 플래그가 true가 되면 안 된다. Run: node scripts/qa/qa-security-own-not-inherited.mjs < /dev/null
import { S, FILL, BIG, mk, put, attack, drain, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, 'ST1-13 섀도 윙 시큐리티 효과: 자동 처리 로그가 "진화원효과"가 아니다', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', BIG);
  st.players.p2.security = ['ST1-13', FILL, FILL, FILL, FILL];
  await attack(st, 'p1', a.uid, 'PLAYER');
  const badLines = st.log.filter(e => /진화원효과.*섀도 윙|섀도 윙.*진화원효과/.test(e.msg));
  eq('진화원효과로 표시된 로그 없음', badLines.length, 0);
  ok('시큐리티 효과 자체는 자동 처리됨(DP+7000 또는 자동처리 로그)', st.log.some(e => /섀도 윙|시큐리티 어택|DP.*\+7000/.test(e.msg)));
});
T(2, 'ST1-12 신태일 시큐리티 효과(수동 처리 필요): pending 항목의 inherited가 true가 아니다', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', BIG);
  st.players.p2.security = ['ST1-12', FILL, FILL, FILL, FILL];
  const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true;
  S.stepSecurityCheck(ctl); await drain(st);
  const pend = st.pending.find(t => t.cardId === 'ST1-12' && !t.resolved);
  ok('시큐리티 효과가 대기열에 있음(수동 처리 대상)', !!pend || st.log.some(e => /신태일/.test(e.msg)));
  if (pend) eq('inherited 플래그가 true 아님', !!pend.inherited, false);
});
await runAll('qa-security-own-not-inherited');
