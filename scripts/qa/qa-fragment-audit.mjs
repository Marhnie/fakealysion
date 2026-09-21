// 프래그먼트 (16-37) 와 소멸 대체 계열(아머 퍼지/회피/방벽/스케이프고트/불굴) 감사 — docs/investigate-fragment-save.md 참고.
// Run: node scripts/qa/qa-fragment-audit.mjs < /dev/null
import { S, FILL, mk, put, dp, T, eq, ok, runAll, drain, setSec } from './lib-s1.mjs';
import * as SN from '../../src/snapshot.js';
const MAG = 'EX10-036', ICE = 'P-215', PYR = 'EX10-033';
const alive = (st, p, s) => st.players[p].battle.includes(s);
const kill = (st, p, s, cause = 'effect') => { S.deleteStack(st, p, s.uid, 'trash', cause); };
T(1, '프래그먼트: 이펙트 소멸 -> 진화원 3장 파기, 소멸하지 않음 (16-37-1)', async () => {
  const st = mk(); const a = put(st, 'p1', MAG, { src: [FILL, FILL, FILL, FILL] });
  kill(st, 'p1', a, 'effect'); ok('생존', alive(st, 'p1', a)); eq('진화원 1장 남음', a.sources.length, 1); eq('트래시 3장', st.players.p1.trash.length, 3);
});
T(2, '프래그먼트: 배틀 소멸도 대체', async () => {
  const st = mk(); const a = put(st, 'p1', MAG, { src: [FILL, FILL, FILL] });
  kill(st, 'p1', a, 'battle'); ok('생존', alive(st, 'p1', a)); eq('진화원 0', a.sources.length, 0);
});
T(3, '프래그먼트: 진화원이 N장 미만이면 사용 불가 (16-37-1/-3)', async () => {
  const st = mk(); const a = put(st, 'p1', MAG, { src: [FILL, FILL] });
  kill(st, 'p1', a, 'effect'); ok('소멸', !alive(st, 'p1', a)); eq('스택 3장 트래시', st.players.p1.trash.length, 3);
});
T(4, '프래그먼트 + DP 0 룰체크: 진화원 5장 -> 1회 사용 후 DP 0 여전 -> 다시 룰체크 -> 소멸 (17-1-3-1 반복)', async () => {
  const st = mk(); st.activePlayer = 'p2'; const a = put(st, 'p1', MAG, { src: [FILL, FILL, FILL, FILL, FILL] });
  S.modifyDP(st, 'p1', a.uid, -20000, 'turn'); await drain(st);
  ok('소멸', !alive(st, 'p1', a)); eq('전체 6장 트래시', st.players.p1.trash.length, 6);
});
T(5, '프래그먼트: 뒷면 진화원(4-7-9)도 진화원이며 파기 시 s5fd 동기화', async () => {
  const st = mk(); const a = put(st, 'p1', MAG, { src: [FILL, FILL, FILL, FILL] }); a.s5fd = 2;
  kill(st, 'p1', a, 'effect'); ok('생존', alive(st, 'p1', a));
  eq('남은 진화원 1장', a.sources.length, 1); ok('s5fd <= 남은 장수', (a.s5fd || 0) <= a.sources.length);
  eq('뒷면 수 1 (idx0 가 남음)', S.fdCount(a), 1);
});
T(6, '프래그먼트: 동시에 2체 소멸 시 각각 대체', async () => {
  const st = mk(); const a = put(st, 'p1', MAG, { src: [FILL, FILL, FILL] }); const b = put(st, 'p1', MAG, { src: [FILL, FILL, FILL] });
  kill(st, 'p1', a); kill(st, 'p1', b); ok('둘 다 생존', alive(st, 'p1', a) && alive(st, 'p1', b));
});
T(7, '프래그먼트는 자신의 (본) 효과: 진화원의 프래그먼트 카드(EX10-033)는 위 카드에 프래그먼트를 주지 않는다 (진화원 효과는 「진화원 효과」만 계승, 4-8/13-x)', async () => {
  const st = mk(); const a = put(st, 'p1', ICE, { src: [FILL, FILL, PYR, FILL] });
  ok('프래그먼트 없음', !(a.inheritedKeywords?.['프래그먼트'] > 0) && !(a.keywords?.['프래그먼트'] > 0));
  kill(st, 'p1', a); ok('소멸', !alive(st, 'p1', a));
});
T(8, '퇴화는 소멸이 아니므로 프래그먼트를 소비하지 않고 진화원만 1장 파기 (16-12)', async () => {
  const st = mk(); const a = put(st, 'p1', MAG, { src: [FILL, FILL, ICE] });
  const r = S.retreat(st, 'p1', a.uid, 1); eq('1장 파기', r.length, 1); ok('생존', alive(st, 'p1', a)); eq('최상단 아이스몬', a.cardId, ICE);
  eq('진화원 2', a.sources.length, 2); eq('프래그먼트 소모 없음(로그 없음)', st.log.some(l => /프래그먼트/.test(l.msg)), false);
});
T(9, '퇴화 후에도 턴 종료까지의 DP 감소는 같은 디지몬에 남고, DP 0 이하면 룰체크', async () => {
  const st = mk(); st.activePlayer = 'p2'; const a = put(st, 'p1', MAG, { src: [FILL, FILL, ICE] });
  S.modifyDP(st, 'p1', a.uid, -13000, 'turn'); ok('DP 1000 생존', alive(st, 'p1', a));
  S.retreat(st, 'p1', a.uid, 1);
  await drain(st); ok('아이스몬 6000-13000 <= 0 이고 진화원 2장 < 3 이므로 소멸', !alive(st, 'p1', a));
});
T(10, '아머 퍼지: 최상단 카드 파기, 다음 카드가 디지몬이 됨 (진화원 없으면 사용 불가)', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT8-012', { src: [FILL] });
  kill(st, 'p1', a, 'effect'); ok('생존', alive(st, 'p1', a)); eq('최상단이 FILL', a.cardId, FILL); eq('트래시 BT8-012', st.players.p1.trash[0], 'BT8-012');
  const b = put(st, 'p1', 'BT8-012', { src: [] }); kill(st, 'p1', b, 'effect'); ok('진화원 없으면 소멸', !alive(st, 'p1', b));
});
T(11, '회피: 레스트하여 소멸하지 않음, 이미 레스트면 사용 불가', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX3-018'); kill(st, 'p1', a, 'battle'); ok('생존+레스트', alive(st, 'p1', a) && a.suspended);
  const b = put(st, 'p1', 'EX3-018', { susp: true }); kill(st, 'p1', b, 'battle'); ok('레스트면 소멸', !alive(st, 'p1', b));
});
T(12, '방벽: 배틀 소멸만, 시큐리티 위 1장 파기', async () => {
  const st = mk(); setSec(st, 'p1', [FILL, FILL]); const a = put(st, 'p1', 'BT13-041');
  kill(st, 'p1', a, 'effect'); ok('효과 소멸은 방벽 불가', !alive(st, 'p1', a));
  const b = put(st, 'p1', 'BT13-041'); kill(st, 'p1', b, 'battle'); ok('배틀 소멸은 방벽', alive(st, 'p1', b)); eq('시큐리티 1장', st.players.p1.security.length, 1);
  const c = put(st, 'p1', 'BT13-041'); setSec(st, 'p1', []); kill(st, 'p1', c, 'battle'); ok('시큐리티 0 이면 불가', !alive(st, 'p1', c));
});
T(13, '스케이프고트: 자신의 효과로는 불가, 다른 디지몬 소멸 필요', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX6-052'); const o = put(st, 'p1', FILL);
  kill(st, 'p1', a, 'ownEffect'); ok('자신의 효과로 소멸은 그대로 소멸', !alive(st, 'p1', a));
  const b = put(st, 'p1', 'EX6-052'); kill(st, 'p1', b, 'effect'); ok('상대 효과: 생존 + 다른 디지몬 소멸', alive(st, 'p1', b) && !alive(st, 'p1', o));
  st.players.p1.battle.splice(st.players.p1.battle.indexOf(b), 1);
  const c = put(st, 'p1', 'EX6-052'); kill(st, 'p1', c, 'effect'); ok('다른 디지몬 없으면 소멸', !alive(st, 'p1', c));
});
T(14, '불굴: 진화원이 있으면 소멸 후 코스트 없이 재등장, 없으면 불가', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX5-032', { src: [FILL] }); kill(st, 'p1', a, 'effect');
  ok('원래 스택 소멸', !alive(st, 'p1', a)); ok('같은 카드 재등장', st.players.p1.battle.some(s => s.cardId === 'EX5-032'));
  const st2 = mk(); const b = put(st2, 'p1', 'EX5-032'); kill(st2, 'p1', b, 'effect'); ok('진화원 없으면 재등장 없음', st2.players.p1.battle.length === 0);
});
T(15, '스냅샷/불러오기: 누수된 _rcDepth/_fxSrc 는 복원되지 않음 (세이브 c8f45ab9 회귀)', async () => {
  const st = mk(); st._rcDepth = 1; st._fxSrc = { player: 'p2', cardId: 'BT23-101' }; st._caster = 'p2';
  const snap = SN.snapshotState(st, 't'); SN.restoreState(st, snap);
  eq('_rcDepth 0', st._rcDepth, 0); eq('_fxSrc null', st._fxSrc, null);
  const a = put(st, 'p1', MAG, { src: [FILL, FILL] }); st.activePlayer = 'p2';
  S.modifyDP(st, 'p1', a.uid, -15000, 'turn'); await drain(st); ok('DP<=0 즉시 소멸', !alive(st, 'p1', a));
});
await runAll('qa-fragment-audit');
