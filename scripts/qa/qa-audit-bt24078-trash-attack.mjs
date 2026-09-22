// BT24-078 마왕몬 X항체: [트래시]【자신의 턴】 "자신의 「마왕몬」이 어택했을 때, ..." 트리거 자체가 큐에 아예
// 올라오지 않던 문제 (queueTrashZoneEventTriggers가 'attack' 이벤트를 처리하지 않았음). Run: node scripts/qa/qa-audit-bt24078-trash-attack.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, '트래시의 BT24-078이 자신의 마왕몬 공격 선언 시 발동 대기열에 올라온다', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const host = put(st, 'p1', 'BT8-111'); // 마왕몬
  put(st, 'p2', FILL);
  st.players.p1.trash = ['BT24-078'];
  const dec = S.declareAttack(st, 'p1', host.uid, {});
  ok('공격 선언 성공', dec.ok);
  S.queueTriggersForStack(st, 'p1', dec.stack, 'attack');
  S.emitGameEvent(st, 'attack', { owner: 'p1', stack: dec.stack, cause: null });
  ok('BT24-078의 [트래시] 트리거가 대기열에 있음', st.pending.some(x => x.cardId === 'BT24-078' && /코스트를 지불하지 않고 진화/.test(x.text)));
});
T(2, '상대의 마왕몬 공격에는 반응하지 않는다(자신의 것만)', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.phase = 'main'; st.turnNumber = 5;
  const host = put(st, 'p2', 'BT8-111');
  put(st, 'p1', FILL);
  st.players.p1.trash = ['BT24-078']; // p1(비활성 플레이어)의 트래시에 있음 — p2의 마왕몬이 공격해도 p1 것과 무관
  const dec = S.declareAttack(st, 'p2', host.uid, {});
  S.queueTriggersForStack(st, 'p2', dec.stack, 'attack');
  S.emitGameEvent(st, 'attack', { owner: 'p2', stack: dec.stack, cause: null });
  ok('p1의 BT24-078은 발동하지 않음', !st.pending.some(x => x.cardId === 'BT24-078'));
});
await runAll('qa-audit-bt24078-trash-attack');
