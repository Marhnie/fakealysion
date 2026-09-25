// EX10-036 마그네틱드라몬: 【진화 시】【어택 시】[턴 1회] "트래시의 광물형/광석형 3장을 진화원 아래에 놓는 것으로 이 디지몬을 액티브로 한다" — 두 타이밍이 하나의 [턴 1회]를 공유한다. Run: node scripts/qa/qa-magnetdramon-once.mjs < /dev/null
import { S, FILL, mk, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';
const MIN = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).some(t => t === '광물형' || t === '광석형')).slice(0, 12).map(c => c.id);
const setup = () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const m = put(st, 'p1', 'EX10-036', { src: [FILL, FILL] }); m.suspended = true;
  st.players.p1.trash = [...MIN, ...MIN]; // plenty of 광물형/광석형 cards
  put(st, 'p2', FILL); put(st, 'p2', FILL);
  return { st, m };
};
const trashMineral = (st) => st.players.p1.trash.filter(id => MIN.includes(id)).length;
T(1, '진화 시 발동 후 같은 턴 어택 시에는 발동하지 않는다 ([턴 1회] 공유)', async () => {
  const { st, m } = setup();
  S.queueTriggersForStack(st, 'p1', m, 'digivolve'); await drain(st);
  const afterEvo = { active: !m.suspended, trash: trashMineral(st) };
  m.suspended = true; // rested again (e.g. by the attack declaration)
  S.queueTriggersForStack(st, 'p1', m, 'attack'); await drain(st);
  eq('진화 시에 1회 발동해 액티브', afterEvo.active, true);
  eq('어택 시에는 발동하지 않음(다시 레스트 상태 그대로)', m.suspended, true);
});
T(2, '어택 시 발동 후 같은 턴 진화 시에는 발동하지 않는다', async () => {
  const { st, m } = setup();
  S.queueTriggersForStack(st, 'p1', m, 'attack'); await drain(st); ok('어택 시에 발동', !m.suspended);
  m.suspended = true; S.queueTriggersForStack(st, 'p1', m, 'digivolve'); await drain(st);
  eq('진화 시에는 발동하지 않음', m.suspended, true);
});
T(3, '이미 쓴 [턴 1회] 효과는 발동 대기 목록에도 올라오지 않는다 (선택창이 뜨지 않음)', async () => {
  const { st, m } = setup();
  S.queueTriggersForStack(st, 'p1', m, 'digivolve'); await drain(st); // 첫 사용
  m.suspended = true; const before = st.pending.length;
  S.queueTriggersForStack(st, 'p1', m, 'attack');
  const onceQueued = st.pending.filter(x => !x.resolved && /^\[턴 1회\]/.test(String(x.text).trim())).length;
  eq('[턴 1회] 효과는 대기열에 없음', onceQueued, 0);
  ok('턴 제한 없는 소멸 효과는 대기열에 있음', st.pending.filter(x => !x.resolved).length >= 1);
  await drain(st);
});
T(4, '드레인 없이 같은 트리거가 연달아 큐잉돼도 [턴 1회] 사본은 하나만 대기한다 (유령 옵션 버그)', async () => {
  // 버그 재현: 같은 타이밍에 두 트리거 창이 겹쳐 드레인 전에 queueTriggersForStack이 두 번 불리면(15-4-3-2),
  // 첫 사본이 아직 turnEffectUses를 올리지 않았으므로 두 번째 사본도 큐잉을 통과해 — 첫 사본을 쓴 뒤에도
  // 화면에 선택 가능해 보이지만 실행하면 아무 일도 안 하는 유령 옵션이 남았다.
  const { st, m } = setup();
  S.queueTriggersForStack(st, 'p1', m, 'attack');
  S.queueTriggersForStack(st, 'p1', m, 'attack'); // 드레인 없이 곧바로 다시 큐잉
  const onceCopies = st.pending.filter(x => !x.resolved && /^\[턴 1회\]/.test(String(x.text).trim()));
  eq('[턴 1회] 사본은 단 하나만 대기 (유령 사본 없음)', onceCopies.length, 1);
  await drain(st);
  ok('그 하나는 정상적으로 발동해 액티브가 됨', !m.suspended);
});
T(5, '서로 다른 [턴 1회] 여부의 두 세그먼트는 같은 태그를 공유해도 둘 다 큐잉된다 (회귀 방지)', async () => {
  // T4의 수정이 오탐하지 않는지 확인: 마그네틱드라몬의 두 효과(무제한 소멸 효과 / [턴 1회] 액티브 효과)는
  // 둘 다 【진화 시】【어택 시】 태그를 쓰지만 본문이 다르므로, 하나의 진화 트리거로 둘 다 큐잉돼야 한다.
  const { st, m } = setup();
  S.queueTriggersForStack(st, 'p1', m, 'digivolve');
  eq('두 세그먼트 모두 대기열에 올라옴', st.pending.filter(x => !x.resolved).length, 2);
  await drain(st);
});
await runAll('qa-magnetdramon-once');
