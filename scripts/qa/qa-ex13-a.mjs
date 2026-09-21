// EX13 (엑스트라 부스터 CHIVALROUS XIII) — evolution / cost-reduced play effects. Run: node scripts/qa/qa-ex13-a.mjs < /dev/null
import { S, mk, put, drain, T, eq, ok, runAll, playCard, evolve, useOption, atkSec, C, FILL, LOW, V, find, findAll, mention, errs, cur, logs } from './lib-ex13.mjs';
const clean = (st) => { st._qaErr = []; };
T('E13-001', 'EX13-001 기기몬: 레드 테이머 등장 시 「그라우몬」으로 -2 진화', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'ST1-03', { src: ['EX13-001'] });
  st.players.p1.hand = ['EX13-010', 'EX13-068'];
  st.memory = 3;
  S.playDigimonFresh(st, 'p1', 1); await drain(st);
  eq('진화 성공', cur(st, 'p1', a).cardId, 'EX13-010'); eq('메모리 변화 없음(코스트 2-2=0)', st.memory, 3); eq('오류 없음', errs(st), []);
});
T('E13-003', 'EX13-003 캬로몬: 시큐리티 감소 시 성수형 디지몬으로 -1 진화', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'EX13-026', { src: ['EX13-003'] });
  st.players.p1.security = [FILL, FILL, FILL]; st.players.p1.hand = ['EX13-030']; st.memory = 3;
  S.trashTopSecurityByEffect(st, 'p1'); await drain(st);
  eq('진화', cur(st, 'p1', a).cardId, 'EX13-030'); eq('진화 코스트 2-1=1', st.memory, 2); eq('오류 없음', errs(st), []);
});
T('E13-004', 'EX13-004 푸치메라몬: 어택 시 진화하면 시큐리티 1장 파기', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'EX13-025', { src: ['EX13-004'] });
  st.players.p1.security = [FILL, FILL, FILL, FILL]; st.players.p2.security = [LOW, LOW, LOW]; st.players.p1.hand = ['EX13-029']; st.memory = 5;
  await atkSec(st, 'p1', a.uid);
  eq('진화', cur(st, 'p1', a)?.cardId, 'EX13-029'); eq('자신 시큐리티 -2 (푸치메라몬 -1 + 화염위자몬 진화 시 코스트 -1)', st.players.p1.security.length, 2); eq('오류 없음', errs(st), []);
});
T('E13-004b', 'EX13-004 푸치메라몬: 진화하지 않으면 시큐리티 유지', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'EX13-025', { src: ['EX13-004'] });
  st.players.p1.security = [FILL, FILL, FILL, FILL]; st.players.p2.security = [LOW, LOW, LOW]; st.players.p1.hand = [FILL]; st.memory = 5;
  await atkSec(st, 'p1', a.uid);
  eq('시큐리티 유지', st.players.p1.security.length, 4); eq('오류 없음', errs(st), []);
});
T('E13-005', 'EX13-005 베이비드몬: 어택 시 「엑자몬」 기술 카드를 -1 로 등장', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'ST1-03', { src: ['EX13-005'] });
  st.players.p1.hand = ['EX13-018']; st.memory = 10; st.players.p2.security = [LOW, LOW];
  await atkSec(st, 'p1', a.uid);
  ok('등장', st.players.p1.battle.some((s) => s.cardId === 'EX13-018')); eq('코스트 5-1=4', st.memory, 6); eq('오류 없음', errs(st), []);
});
T('E13-012', 'EX13-012 세이버헉몬: 진화 시 「헉몬」 기술 화이트 카드 -3 등장/사용', async () => {
  const st = mk(); clean(st);
  const w = find((c) => c.category === 'digimon' && c.colors.includes('white') && mention(c, '헉몬') && c.cost >= 3);
  const a = put(st, 'p1', 'BT6-011'); st.players.p1.hand = ['EX13-012', w]; st.memory = 10;
  const before = st.memory;
  await evolve(st, 'p1', a.uid, 'EX13-012', 0, 'hand');
  ok('화이트 카드 등장', st.players.p1.battle.some((s) => s.cardId === w)); eq('코스트 -3', before - st.memory, Math.max(0, C(w).cost - 3)); eq('오류 없음', errs(st), []);
});
T('E13-014', 'EX13-014 제스몬: 진화 시 패의 「헉몬」 옵션(≤5)을 무료 사용', async () => {
  const st = mk(); clean(st);
  const opt = find((c) => c.category === 'option' && (c.cost || 0) <= 5 && mention(c, '헉몬'));
  const a = put(st, 'p1', 'BT6-015'); st.players.p1.hand = ['EX13-014', opt]; st.memory = 6;
  await evolve(st, 'p1', a.uid, 'EX13-014', 0, 'hand');
  ok('옵션이 패에서 사라짐', !st.players.p1.hand.includes(opt)); eq('메모리 그대로(0 코스트 사용)', st.memory, 6); eq('오류 없음', errs(st), []);
});
T('E13-019', 'EX13-019 브이드라몬: 어택 시 패의 브이드라몬 기술 테이머 -2 등장', async () => {
  const st = mk(); clean(st);
  const t = find((c) => c.category === 'tamer' && mention(c, '브이드라몬') && c.cost >= 2);
  const a = put(st, 'p1', 'EX13-019'); st.players.p1.hand = [t]; st.memory = 10; st.players.p2.security = [LOW, LOW];
  await atkSec(st, 'p1', a.uid);
  ok('테이머 등장', st.players.p1.battle.some((s) => s.cardId === t)); eq('코스트 -2', 10 - st.memory, Math.max(0, C(t).cost - 2)); eq('오류 없음', errs(st), []);
});
T('E13-043', 'EX13-043 두프트몬: 레스트 상태 디지몬 1마리마다 추가로 코스트 -1', async () => {
  const st = mk(); clean(st);
  put(st, 'p1', FILL, { susp: true }); put(st, 'p2', FILL, { susp: true });
  const t = find((c) => c.category === 'digimon' && (c.types || []).some((x) => ['포유류형', '짐승형', '수인형', '로얄 나이츠'].includes(x)) && c.cost >= 7);
  st.players.p1.hand = [t]; st.memory = 10; const before = st.memory;
  const d = put(st, 'p1', 'EX13-043');
  st.pending.push({ uid: 'x1', player: 'p1', cardId: 'EX13-043', stackUid: d.uid, tags: ['진화 시', '어택 시'], text: '[턴 1회] 자신의 패에서, 특징 「포유류형」/「짐승형」/「수인형」/「로얄 나이츠」를 가진 카드 1장을 지불하는 코스트 -4 하여 등장/사용할 수 있다. 레스트 상태인 디지몬 1마리마다 이 효과로 지불하는 코스트 -1.', resolved: false, topId: 'EX13-043' });
  await drain(st);
  ok('등장', st.players.p1.battle.some((s) => s.cardId === t)); eq('코스트 -4 -레스트 2', before - st.memory, Math.max(0, C(t).cost - 6)); eq('오류 없음', errs(st), []);
});
T('E13-jog', 'EX13-045 엑자몬: 윙드라몬+그라운드라몬(각각 슬레이어드라몬/브레이크드라몬 Lv.6 취급)으로 조그레스', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX13-021'), b = put(st, 'p1', 'EX13-041');
  ok('조그레스 가능', S.canJogress(a, b, 'EX13-045').ok);
  const c = put(st, 'p1', 'EX13-021');
  ok('윙드라몬 2마리는 불가', !S.canJogress(a, c, 'EX13-045').ok);
});
await runAll('qa-ex13-a');
