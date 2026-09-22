// BT6-111 알파몬 【어택 시】: "코스트를 5까지 지불하는 것으로, 이 턴 동안 이 효과로 지불한 코스트 1마다 이 디지몬의 DP를 +1000 한다."
// The generic compiler had no support for "pay up to N, effect scales by how much was actually paid" — it fell back to a flat
// manualCost confirm + a hardcoded +1000 regardless of the amount paid. Fixed via a shard1 SCRIPTS override (src/cards/shard1.js).
// Run: node scripts/qa/qa-audit-g1-bt6-111.mjs < /dev/null
import { S, mk, put, dp, secN, atkSec, T, eq, ok, runAll } from './lib-s1.mjs';

T('g1-6534a', 'BT6-111: paying 3 cost gives DP +3000 (not a flat +1000)', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', 'BT6-111'); secN(st, 'p2', 3);
  const base = dp(st, 'p1', a);
  st._qaAns = { multipleChoice: 3 }; // index 3 = "3 지불 (DP +3000)"
  const memBefore = st.memory;
  await atkSec(st, 'p1', a.uid);
  eq('DP +3000 (paid 3)', dp(st, 'p1', a), base + 3000);
  // net = -3 (cost paid here) + 2 (this card's own separate 【어택 종료 시】 메모리 +2, which also fires during this same attack)
  eq('memory: -3 (cost) + 2 (attack-end gain)', st.memory, memBefore - 3 + 2);
});

T('g1-6534b', 'BT6-111: declining the cost (0) leaves DP untouched (memory only moves from the separate 어택 종료 시 effect)', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', 'BT6-111'); secN(st, 'p2', 3);
  const base = dp(st, 'p1', a);
  st._qaAns = { multipleChoice: 0 }; // index 0 = "지불 안 함"
  const memBefore = st.memory;
  await atkSec(st, 'p1', a.uid);
  eq('DP unchanged (no cost paid)', dp(st, 'p1', a), base);
  eq('memory: +2 from 어택 종료 시 only (no cost spent)', st.memory, memBefore + 2);
});

T('g1-6534c', 'BT6-111: paying the max (5) gives DP +5000', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', 'BT6-111'); secN(st, 'p2', 3);
  const base = dp(st, 'p1', a);
  st._qaAns = { multipleChoice: 5 };
  await atkSec(st, 'p1', a.uid);
  eq('DP +5000 (paid 5)', dp(st, 'p1', a), base + 5000);
});

await runAll('qa-audit-g1-bt6-111');
