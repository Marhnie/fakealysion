// Audit g5/tier2-batch3: BT20-029 펄스몬 (official ruling) — a bare 【자신의 턴】 "이 디지몬이
// ~로 진화할 때, 지불하는 진화 코스트 -1" self-discount is a continuous (unmarked) ability, so per
// rule 3-4-7-4 it must NOT apply while the Digimon is still sitting in the Raising Area (only a
// [육성]-marked line would). Verified: continuousEvoCostDiscount() already gets this right via
// stackContributors()'s existing raising-area remap (breedingContributorId), which drops any
// contributor with no [육성]-marked segment while the stack sits in the Raising Area. This is
// just previously-missing regression coverage for this specific card (no code change needed).
// Run: node scripts/qa/qa-audit-g5-t2b3-raising-evo-discount.mjs < /dev/null
import { S, mk, T, eq, ok, runAll } from './lib-s1.mjs';

T('g5t2b3-1', 'BT20-029 in the Raising Area: no self evo-cost discount', async () => {
  const st = mk();
  const r = S._s4.makeStack('BT20-029', 1);
  st.players.p1.raising = r; S.recomputeStackGrants(r);
  eq('no discount while in raising', S.continuousEvoCostDiscount(st, 'p1', r, 'BT20-029'), 0);
});
T('g5t2b3-2', 'BT20-029 in the Battle Area: self evo-cost discount applies', async () => {
  const st = mk();
  const b = S._s4.makeStack('BT20-029', 1);
  st.players.p1.battle.push(b); S.recomputeStackGrants(b);
  eq('-1 discount while in battle', S.continuousEvoCostDiscount(st, 'p1', b, 'BT20-029'), -1);
});
await runAll('qa-audit-g5-t2b3-raising-evo-discount');
