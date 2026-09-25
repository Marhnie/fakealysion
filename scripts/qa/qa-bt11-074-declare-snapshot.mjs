// BT11-074 블랙워그레이몬X항체 【상대의 턴】[턴에 1회] "가장 DP가 높은 상대의 디지몬이 어택했을 때, 어택의 대상을 이 디지몬으로 변경할 수 있다."
// Official ruling (id2102): the "highest DP" comparison is a snapshot taken AT ATTACK DECLARATION. If the attacker
// was NOT the highest-DP Digimon on its side when it declared, a later 【어택 시】 effect that raises its own DP to
// become the highest does NOT retroactively satisfy this redirect condition.
// Regression: src/cards/shard2.js's hk('BT11-074', ...) used to compare S.effectiveDP() live, at redirect-options
// time — which the generic attack flow (main.js settleRedirectTiming / state.js's own hookRedirectOptions caller)
// only computes AFTER all 【어택 시】 triggers have resolved, so a same-attack DP boost wrongly unlocked the redirect.
// Fix: src/state.js's declareAttack() now freezes stack.s1.wasHighestDPAtDeclare BEFORE any 【어택 시】 effect can run,
// and the hook reads that frozen flag instead of live DP.
// Run: node scripts/qa/qa-bt11-074-declare-snapshot.mjs < /dev/null
import { S, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

const LOW = 'ST1-02';  // 피요몬 DP 3000
const HIGH = 'ST1-04'; // 드라코몬 DP 4000

T('BT11-074-a', '어택 선언 시 가장 DP가 높지 않았던 디지몬이, 【어택 시】 효과로 DP가 올라 최고 DP가 되어도 이 카드로 대상 변경할 수 없다', async () => {
  const st = mk();
  const def = put(st, 'p2', 'BT11-074');
  const a = put(st, 'p1', LOW);   // 3000 — NOT the highest on declaration
  const b = put(st, 'p1', HIGH);  // 4000 — the highest on declaration
  st.activePlayer = 'p1';
  const dec = S.declareAttack(st, 'p1', a.uid);
  ok('어택 선언 성공', dec.ok);
  eq('선언 시점엔 최고 DP 아니었음이 기록됨', a.s1?.wasHighestDPAtDeclare, false);
  // simulate an 【어택 시】 effect boosting the attacker's own DP past everything else on the board
  S.modifyDP(st, 'p1', a.uid, 9000, 'turn');
  ok('부스트 후 현재는 실제로 최고 DP', S.effectiveDP(st, 'p1', a) > S.effectiveDP(st, 'p1', b));
  const opts = S.hookRedirectOptions(st, 'p2', 'p1', a);
  eq('선언 시점 스냅샷 기준으로 대상 변경 불가', opts.filter(o => o.cardId === 'BT11-074').length, 0);
});

T('BT11-074-b', '어택 선언 시점에 이미 가장 DP가 높았던 디지몬이 어택하면, 이 카드로 대상을 변경할 수 있다', async () => {
  const st = mk();
  const def = put(st, 'p2', 'BT11-074');
  const a = put(st, 'p1', HIGH);  // 4000 — the highest on declaration
  const b = put(st, 'p1', LOW);   // 3000
  st.activePlayer = 'p1';
  const dec = S.declareAttack(st, 'p1', a.uid);
  ok('어택 선언 성공', dec.ok);
  eq('선언 시점에 최고 DP였음이 기록됨', a.s1?.wasHighestDPAtDeclare, true);
  const opts = S.hookRedirectOptions(st, 'p2', 'p1', a);
  ok('대상 변경 가능', opts.some(o => o.cardId === 'BT11-074'));
});

await runAll('qa-bt11-074-declare-snapshot');
