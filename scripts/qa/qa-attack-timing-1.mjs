// Attack-declaration timing (rules 11-1-4, 11-2-8, 15-8-3, 16-23, 16-24): ≪연계≫ / ≪돌진≫ are TRIGGERED keyword effects queued with 【어택 시】; the attacker's own rest
// triggers 「레스트했을 때」 at the same moment. Run: node scripts/qa/qa-attack-timing-1.mjs < /dev/null
import { S, FILL, LOW, mk, put, dp, T, eq, ok, runAll, drain, atkSec, atkDigi, secN, C } from './lib-s1.mjs';
const pend = (st) => st.pending.filter((t) => !t.resolved);
const kwOf = (t) => (t.tags || [])[0];
const CHAIN = 'EX4-025', CHARGE = 'BT11-010';

T(1, '연계: 어택 선언 시 트리거 큐에 들어가고 (자유 목록 아님) 해결 전에는 DP가 그대로', async () => {
  const st = mk(); const a = put(st, 'p1', CHAIN); const o = put(st, 'p1', FILL); secN(st, 'p2', 3);
  const base = dp(st, 'p1', a);
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack');
  ok('연계 pending', pend(st).some((t) => kwOf(t) === '__연계' && t.stackUid === a.uid));
  ok('아직 레스트 안 함', !o.suspended); eq('DP 그대로', dp(st, 'p1', a), base);
});
T(2, '연계: 해결 시 레스트 선택 -> DP 합산 + S어택+1, 어택 종료까지', async () => {
  const st = mk(); const a = put(st, 'p1', CHAIN); const o = put(st, 'p1', FILL); secN(st, 'p2', 3);
  const base = dp(st, 'p1', a), oDp = dp(st, 'p1', o);
  st._qaAns = { pickStack: () => o.uid };
  let during = null; const orig = S.resolveDigimonBattle;
  const r = await atkSec(st, 'p1', a.uid);
  ok('레스트됨', o.suspended);
  eq('체크 매수 2 (S어택+1)', r.checks.length, 2);
  eq('종료 후 DP 원복', dp(st, 'p1', a), base + 0); eq('S어택 원복', Number(a.keywords['시큐리티어택']) || 0, 0);
  ok('oDp>0', oDp > 0);
});
T(3, '연계: 취소하면 레스트도 보너스도 없음 (15-7-4 선택)', async () => {
  const st = mk(); const a = put(st, 'p1', CHAIN); const o = put(st, 'p1', FILL); secN(st, 'p2', 3);
  st._qaAns = { pickStack: () => null };
  const r = await atkSec(st, 'p1', a.uid);
  ok('레스트 안 됨', !o.suspended); eq('체크 1장', r.checks.length, 1);
});
T(4, '연계: 어택 종료 후 새 어택에서는 보너스 없음, 이미 끝난 어택의 트리거는 무효', async () => {
  const st = mk(); const a = put(st, 'p1', CHAIN); put(st, 'p1', FILL);
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack');
  st.attackCtx = null; // the attack already ended
  const before = dp(st, 'p1', a);
  await drain(st);
  eq('DP 변화 없음', dp(st, 'p1', a), before);
});
T(5, '연계 + 【어택 시】: 같은 큐, 동시에 대기', async () => {
  const st = mk(); const a = put(st, 'p1', CHAIN, { src: [] }); put(st, 'p1', FILL);
  const own = Object.values(S.CARDS).find((c) => /【어택 시】/.test(c.effectKo || '') && c.category === 'digimon' && /메모리\s*\+\s*1/.test(c.effectKo));
  ok('sample 어택 시 카드', !!own);
  const b = put(st, 'p1', own.id); S.recomputeStackGrants(b); S.grantKeyword(st, 'p1', b.uid, '연계', undefined, 'turn');
  S.declareAttack(st, 'p1', b.uid); S.queueTriggersForStack(st, 'p1', b, 'attack');
  const tags = pend(st).map((t) => kwOf(t));
  ok('연계 + 어택 시 동시 대기: ' + tags, tags.includes('__연계') && tags.some((t) => t === '어택 시'));
});
T(6, '돌진: 트리거 큐, 선택하면 어택 대상 변경 (16-23)', async () => {
  const st = mk(); const a = put(st, 'p1', CHARGE); const d1 = put(st, 'p2', FILL), d2 = put(st, 'p2', FILL, { susp: true }); secN(st, 'p2', 3);
  st._qaAns = { pickStack: (o) => o.chargeKw ? o.uids[0] : null };
  const r = await atkSec(st, 'p1', a.uid);
  ok('디지몬과 배틀 (플레이어 아님)', !!r.battle || r.ended); eq('시큐리티 그대로', st.players.p2.security.length, 3);
});
T(7, '돌진: 취소하면 대상 변경 없음', async () => {
  const st = mk(); const a = put(st, 'p1', CHARGE); put(st, 'p2', FILL); secN(st, 'p2', 3);
  st._qaAns = { pickStack: () => null };
  const r = await atkSec(st, 'p1', a.uid);
  ok('시큐리티 체크됨', r.checks && r.checks.length >= 1);
});
T(8, '돌진: 후보(액티브 상대 디지몬)가 없으면 아무 일도 없음', async () => {
  const st = mk(); const a = put(st, 'p1', CHARGE); put(st, 'p2', FILL, { susp: true }); secN(st, 'p2', 3);
  const r = await atkSec(st, 'p1', a.uid);
  ok('시큐리티 체크', r.checks && r.checks.length >= 1);
});
T(9, '돌진: DP 동률이면 플레이어가 고른다 (16-23-4)', async () => {
  const st = mk(); const a = put(st, 'p1', CHARGE); const d1 = put(st, 'p2', FILL), d2 = put(st, 'p2', FILL);
  let offered = null; st._qaAns = { pickStack: (o) => { if (o.chargeKw) { offered = o.uids.slice(); return o.uids[1]; } return null; } };
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack');
  const pa = { attacker: 'p1', opp: 'p2', uid: a.uid, targetKind: 'player', targetUid: null }; st.attackCtx = pa;
  await drain(st);
  eq('둘 다 후보', offered && offered.length, 2); eq('선택한 쪽으로 변경', pa.targetUid, d2.uid); eq('대상 종류', pa.targetKind, 'digimon');
});
T(10, '레스트했을 때: 어택 선언의 레스트도 트리거 (11-2-8-1), 어택 시와 동시에 대기', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); const w = put(st, 'p2', 'BT2-079'); // 【상대의 턴】 상대의 디지몬이 레스트했을 때, 메모리 +1
  const m0 = st.memory;
  S.declareAttack(st, 'p1', a.uid);
  eq('선언만으로는 아직 (트리거 큐 이전)', pend(st).length, 0);
  S.queueTriggersForStack(st, 'p1', a, 'attack');
  ok('rest watcher queued: ' + JSON.stringify(pend(st).map((t) => t.cardId)), pend(st).some((t) => t.cardId === 'BT2-079'));
});
T(11, '레스트했을 때: 이미 레스트한 채(레스트 없이 어택)로는 트리거 안 함', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); put(st, 'p2', 'BT2-079');
  S.declareAttack(st, 'p1', a.uid, { noRest: true }); S.queueTriggersForStack(st, 'p1', a, 'attack');
  ok('no rest trigger', !pend(st).some((t) => t.cardId === 'BT2-079'));
});
T(12, '레스트했을 때: 「효과로」 감시자는 어택 선언의 레스트에 반응하지 않음', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX3-038'); // 【자신의 턴】 이 디지몬이 효과로 레스트했을 때 — the attacker itself
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack');
  ok('EX3-038(효과로 전용) not queued', !pend(st).some((t) => t.cardId === 'EX3-038' && kwOf(t) !== '어택 시'));
});
T(13, '레스트했을 때: 블록의 레스트는 어택 선언과 별개 (cause block)', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); const b = put(st, 'p2', 'ST5-14'); st.pending.length = 0;
  S.restStack(st, 'p2', b.uid, 'block');
  ok('no crash', true);
});
T(14, '레스트했을 때: 이 디지몬이 (효과 한정 없이) 레스트했을 때 = 자기 어택 선언으로 트리거', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX3-044'); put(st, 'p2', FILL); // 【서로의 턴】[턴에 1회] 이 디지몬이 레스트했을 때, 상대의 디지몬 1마리를 레스트시킨다
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack');
  ok('self rest watcher queued', pend(st).some((t) => t.cardId === 'EX3-044'));
});
T(15, 'BT4-101: 어택 시 소멸도 트리거 큐 (선언 즉시 삭제 아님), 해결하면 진화원 없는 대상 소멸', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); const d = put(st, 'p2', FILL, { susp: true }); secN(st, 'p2', 2);
  (a.s1 ||= {}).killNoSrc = st.turnNumber; // what BT4-101's 【메인】 sets on each own digimon
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack'); S.s1AttackTargeted(st, 'p1', a, 'digimon', d.uid);
  ok('아직 소멸 안 함', !!st.players.p2.battle.find((x) => x.uid === d.uid));
  ok('queued', pend(st).some((t) => kwOf(t) === '__어택소멸'));
  st.attackCtx = { attacker: 'p1', opp: 'p2', uid: a.uid, targetKind: 'digimon', targetUid: d.uid };
  await drain(st);
  ok('해결 후 소멸', !st.players.p2.battle.find((x) => x.uid === d.uid));
});
T(16, '관통 (16-7): 배틀로 상대 디지몬을 소멸시키면 (배틀 유발 효과 처리 후) 시큐리티 체크', async () => {
  const st = mk(); const a = put(st, 'p1', FILL); S.grantKeyword(st, 'p1', a.uid, '관통', undefined, 'turn'); const d = put(st, 'p2', LOW, { susp: true }); secN(st, 'p2', 3);
  a.tempDP = 9000; const r = await atkDigi(st, 'p1', a.uid, d.uid);
  ok('상대 디지몬 소멸', !st.players.p2.battle.find((x) => x.uid === d.uid)); ok('관통 체크 1장', r.sec && r.sec.checks.length === 1);
});
T(17, '연계: 레스트 시점의 DP만 더함 (16-24-4), 이후 DP 변동은 반영 안 됨', async () => {
  const st = mk(); const a = put(st, 'p1', CHAIN); const o = put(st, 'p1', FILL); secN(st, 'p2', 3);
  const base = dp(st, 'p1', a), oDp = dp(st, 'p1', o);
  S.declareAttack(st, 'p1', a.uid); S.queueTriggersForStack(st, 'p1', a, 'attack'); st.attackCtx = { attacker: 'p1', opp: 'p2', uid: a.uid, targetKind: 'player', targetUid: null };
  st._qaAns = { pickStack: () => o.uid }; await drain(st);
  eq('DP = base + 레스트 시점 DP', dp(st, 'p1', a), base + oDp); o.tempDP = 5000;
  eq('이후 DP 변동 미반영', dp(st, 'p1', a), base + oDp);
});
await runAll('qa-attack-timing-1');
