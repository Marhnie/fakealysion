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
await runAll('qa-magnetdramon-once');
