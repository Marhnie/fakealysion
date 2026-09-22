// Ver.4.3 총합 룰 15-13-3 (신설) 검증: "부여된 효과가, 그 카드 자신이 소멸함으로써 유발하는 효과일 경우, 소멸로
// 트래시에 놓인 뒤에도 그 효과의 상태를 이어받는다." — 다른 효과로 【소멸 시】 효과를 부여받은 카드가 실제로
// 소멸하면, 트래시로 옮겨진 뒤에도 그 부여받은 효과가 정상적으로 발휘 대기 상태가 되어야 한다.
//
// 감사(docs/rulebook-v43-changes.md 9절): 이 엔진에는 "다른 카드에 트리거형 효과 전체를 부여"하는 케이스가
// src/cards/shard*.js에 5장 있다 (전 카드 스크립트 그렙으로 확인, "「【소멸 시】…」의 효과를 얻는다/준다" 패턴):
//   BT9-014 (grantText 컴파일러 경유), BT13-094 (수동 grantText 호출), BT15-039 (stack.s2Granted 수동 push),
//   BT10-056 (CARD_HOOKS의 events.delete 상시 감시형), BT15-057 (CARD_HOOKS의 onLeave, 진화원 조건부 자기 부여).
// 각 카드를 실제로 소멸(배틀 소멸 → 트래시 이동)시켜, 부여받은 효과가 여전히 정상 발휘되는지 확인한다.
//
// 결론(5장 전부 통과): 두 경로 다 이미 Ver.4.3과 일치하게 구현되어 있었다 — 원인은 다음과 같다.
//  - stack.s2Granted 경로(BT9-014/13-094/15-039): S.queueGranted(state, p, stack, eventKind)가 deleteStackCore에서
//    이미 배틀 에어리어 배열에서 splice된 "그 stack 객체 참조"를 그대로 받아 stack.s2Granted를 읽는다 — 트래시
//    이동 후 pl.battle에서 다시 찾지 않으므로 이동 자체는 전혀 영향이 없다. 또한 이 pending에는 topId가 설정되지
//    않아, main.js/cpusim.js의 "15-4-4-3 스테일 체크"(stackUid+topId가 있고 tags에 '소멸 시'가 없으면 카드가 그
//    자리에 그대로 있는지 재확인)가 애초에 적용되지 않는다 (topId가 falsy라 체크 자체가 스킵됨).
//  - CARD_HOOKS 경로(BT10-056/15-057): hookLeaveTriggers/dispatchHookEvents도 동일하게 이미 트래시로 옮겨진 stack
//    객체(BT15-057, holder=자기 자신) 또는 부여자 자신의 살아있는 stack(BT10-056, holder=부여자)을 대상으로 하고,
//    queueHookSegment 역시 topId를 설정하지 않는다.
// 즉 "부여된 효과 전체를 표현하는 범용 메커니즘이 없다"는 이전 감사의 전제와 달리, stack.s2Granted/grantText/
// queueGranted가 사실상 그 범용 메커니즘 역할을 이미 하고 있고, 두 경로 모두 15-13-3 요건을 충족한다.
// 별도 소스 수정 없음 — 이 파일은 회귀 방지용 고정 스냅샷이다.
import { S, Fx, C, mk, put, FILL, BIG, drain, mem, playCard, T, eq, ok, runAll } from './lib-s1.mjs';

// ---- BT9-014 (메가로그라우몬 X항체): 【진화 시】 상대 디지몬 2마리에게 「【소멸 시】 메모리-1.」의 효과를 준다 (grantText 컴파일러 경유) ----
T('v43-15-13-3-bt9-014', 'BT9-014가 부여한 「소멸 시 메모리-1」이, 부여받은 상대 디지몬이 실제로 소멸(트래시 이동)한 뒤에도 발휘됨', async () => {
  const st = mk();
  const target1 = put(st, 'p2', FILL);
  put(st, 'p2', FILL); // 두 번째 부여 대상 (n=2)
  const evolver = put(st, 'p1', FILL);
  st.players.p1.hand.push('BT9-014');
  st._qaAns = { pickStack: (o) => o.uids?.[0] ?? null };
  S.digivolve(st, 'p1', evolver.uid, 'BT9-014', 0, 'hand');
  await drain(st);
  ok('진화 시 효과로 target1이 stack.s2Granted에 delete-트리거 「메모리-1.」을 얻음', (target1.s2Granted || []).some(g => g.trigger === 'delete' && g.label.includes('메모리-1')));

  const memBefore = mem(st, 'p1');
  S.deleteStack(st, 'p2', target1.uid, 'trash', 'battle'); // 배틀 소멸 → 트래시 이동
  const granted = st.pending.find(x => !x.resolved && x.tags.some(t => t.includes('부여:')));
  ok('트래시로 옮겨진 뒤에도 부여받은 「소멸 시」 효과의 pending이 큐잉됨 (15-13-3)', !!granted);
  ok('그 pending에 topId가 없어 15-4-4-3 스테일 체크(제자리 재확인)를 건너뜀', granted && granted.topId === undefined);
  await drain(st);
  ok('QA 실행 중 예외 없음', !st._qaErr);
  ok('부여받은 「메모리-1」이 실제로 발휘되어 메모리가 변함 (p1 관점 +1)', mem(st, 'p1') === memBefore + 1);
});

// ---- BT10-056 (로터스몬): 【상대의 턴】 특징 조건을 만족하는 다른 자신의 디지몬 전부가 「【소멸 시】 메모리+2, 트래시 카드 회수」를 얻음 (CARD_HOOKS 상시 감시형) ----
T('v43-15-13-3-bt10-056', 'BT10-056(부여자)이 살아있는 동안 부여 대상이 소멸해도, 그 카드가 트래시로 옮겨진 뒤 정상적으로 메모리+2/카드 회수가 발휘됨', async () => {
  const st = mk();
  put(st, 'p1', 'BT10-056');
  const plantId = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).some(t => t.includes('식물형') || t.includes('요정형')) && c.id !== 'BT10-056')?.id;
  ok('fixture: 식물형/요정형 디지몬을 찾음', !!plantId);
  const target = put(st, 'p1', plantId);
  st.players.p1.trash.push(...Array(3).fill(FILL)); // DP 3000 이하 회수 대상
  const memBefore = mem(st, 'p1');
  const handBefore = st.players.p1.hand.length;
  st.activePlayer = 'p2'; // BT10-056은 "상대의 턴" 태그
  S.deleteStack(st, 'p1', target.uid, 'trash', 'battle');
  await drain(st);
  ok('QA 실행 중 예외 없음', !st._qaErr);
  ok('부여받은 「메모리+2」가 발휘됨', mem(st, 'p1') === memBefore + 2);
  ok('부여받은 「트래시에서 패로 회수」도 발휘됨', st.players.p1.hand.length === handBefore + 1);
});

// ---- BT13-094 (최민지): 【등장 시】 자신의 디지몬 1마리에게 「【소멸 시】 자신의 패/트래시에서 「피요몬」 무료 등장」을 부여 (수동 grantText 호출) ----
T('v43-15-13-3-bt13-094', 'BT13-094가 부여한 「소멸 시 피요몬 무료 등장」이, 부여받은 자신의 디지몬이 소멸한 뒤에도 발휘됨', async () => {
  const st = mk();
  const target = put(st, 'p1', FILL);
  const piyo = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo === '피요몬')?.id;
  ok('fixture: 「피요몬」 카드를 찾음', !!piyo);
  st.players.p1.trash.push(piyo);
  st._qaAns = { pickStack: (o) => o.uids?.[0] ?? null, pickFromZoneIndex: (o) => o.eligibleIdxs?.[0] ?? null };
  await playCard(st, 'p1', 'BT13-094');
  ok('등장 시 효과로 target이 stack.s2Granted에 delete-트리거 「피요몬」 부여를 얻음', (target.s2Granted || []).some(g => g.trigger === 'delete' && g.label.includes('피요몬')));

  S.deleteStack(st, 'p1', target.uid, 'trash', 'battle');
  await drain(st);
  ok('QA 실행 중 예외 없음', !st._qaErr);
  ok('부여받은 효과로 트래시의 「피요몬」이 코스트 없이 재등장함', st.players.p1.battle.some(s => s.cardId === piyo));
});

// ---- BT15-039 (보머몬): 【등장 시】 상대 디지몬 1마리에게 「【소멸 시】 메모리-1.」을 주고 DP-3000 (stack.s2Granted 직접 push) ----
T('v43-15-13-3-bt15-039', 'BT15-039가 부여한 「소멸 시 메모리-1」이, DP-3000과 무관하게 나중에 배틀로 소멸해도 발휘됨', async () => {
  const st = mk();
  const target = put(st, 'p2', BIG); // DP-3000을 맞아도 즉시 DP 0이 되지 않도록 고DP 카드 사용
  st._qaAns = { pickStack: (o) => o.uids?.[0] ?? null };
  await playCard(st, 'p1', 'BT15-039', { cost: false });
  ok('등장 시 효과로 target이 stack.s2Granted에 delete-트리거 「메모리 -1」 부여를 얻음', (target.s2Granted || []).some(g => g.trigger === 'delete' && g.label.includes('메모리')));
  ok('DP-3000도 함께 적용됨 (같은 대상)', S.effectiveDP(st, 'p2', target) === C(BIG).dp - 3000);

  const memBefore = mem(st, 'p1');
  S.deleteStack(st, 'p2', target.uid, 'trash', 'battle');
  await drain(st);
  ok('QA 실행 중 예외 없음', !st._qaErr);
  ok('부여받은 「메모리-1」이 실제로 발휘됨 (p1 관점 +1)', mem(st, 'p1') === memBefore + 1);
});

// ---- BT15-057 (워매몬 X항체): 진화원에 「워매몬」/「X항체」가 있으면 자기 자신에게 「【소멸 시】 트래시의 「워매몬」 무료 등장」을 부여 (CARD_HOOKS onLeave) ----
T('v43-15-13-3-bt15-057', 'BT15-057 자신에게 조건부로 부여된 「소멸 시」 효과가, 자신이 소멸해 트래시로 옮겨진 뒤에도 발휘됨', async () => {
  const st = mk();
  const wormSourceId = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo && c.nameKo.includes('워매몬') && c.id !== 'BT15-057')?.id;
  ok('fixture: 「워매몬」이 명칭에 포함된 다른 카드를 찾음', !!wormSourceId);
  const target = put(st, 'p1', 'BT15-057', { src: [wormSourceId] });
  st.players.p1.trash.push(wormSourceId);
  st._qaAns = { pickFromZoneIndex: (o) => o.eligibleIdxs?.[0] ?? null };

  S.deleteStack(st, 'p1', target.uid, 'trash', 'battle');
  await drain(st);
  ok('QA 실행 중 예외 없음', !st._qaErr);
  ok('부여받은 효과로 트래시의 「워매몬」 카드가 코스트 없이 재등장함', st.players.p1.battle.some(s => s.cardId === wormSourceId));
});

const { fail } = await runAll('qa-rulebook-v43-15-13-3');
process.exit(fail ? 1 : 0);
