// BT10-068 간쿠몬 X항체 【진화 시】: "…상대의 효과로 패, 덱으로 돌아가지 않으며, DP가 마이너스되지 않는다."
// Official ruling (rulings id 2003, ~data/rulings/all.json idx 1352): if a self Digimon's DP was already reduced by an
// OPPONENT's effect before this evolution-time effect resolves, granting "DP가 마이너스되지 않는다" restores it to its
// original DP, and this effect's own +2000 then applies on top — it is not merely a block on FUTURE decreases.
// Regression: the old implementation set an ad hoc `stack.s1.noNegDP` flag (checked only in modifyDP, before grantGate),
// which (a) never undid DP already reduced earlier, and (b) incorrectly also blocked the OWNER's own DP-reducing
// effects (the card text only protects against the OPPONENT's effects). Fixed by granting a 'dpDown' shield instead,
// which goes through grantGate/effectBlocked/settleDeferred like every other "받지 않는다" effect in this engine.
// Run: node scripts/qa/qa-bt10-068-gankoomon-dp.mjs < /dev/null
import { S, mk, put, evolve, T, eq, ok, runAll } from './lib-s1.mjs';

const GANKOOMON = 'BT6-067'; // 간쿠몬 (base) — as an evolution SOURCE of BT10-068, satisfies its own "진화원에 「간쿠몬」이 있을 때" branch
const OTHER = 'ST1-04';      // 드라코몬, vanilla DP 4000 — another own Digimon whose DP gets reduced by an "opponent" effect first

T('BT10-068-a', '진화 시 효과 발휘 전에 상대 효과로 감소된 자신 디지몬의 DP는, "DP가 마이너스되지 않는다"로 원래 DP로 복구되고, 그 후 +2000된다', async () => {
  const st = mk();
  const base = put(st, 'p1', GANKOOMON);
  const other = put(st, 'p1', OTHER);
  const baseDP = S.card(OTHER).dp;
  st._fxSrc = { player: 'p2', category: 'digimon' };
  S.modifyDP(st, 'p1', other.uid, -3000, 'turn');
  st._fxSrc = null;
  eq('사전에 상대 효과로 DP -3000 적용됨', S.effectiveDP(st, 'p1', other), baseDP - 3000);
  await evolve(st, 'p1', base.uid, 'BT10-068', 0, 'hand');
  ok('오류 없음', !(st._qaErr && st._qaErr.length));
  eq('원래 DP로 복구 + 이 효과 +2000', S.effectiveDP(st, 'p1', other), baseDP + 2000);
});

T('BT10-068-b', '진화 시 효과 발휘 이후, 상대 효과로 DP를 다시 낮추려 해도 막힌다', async () => {
  const st = mk();
  const base = put(st, 'p1', GANKOOMON);
  const other = put(st, 'p1', OTHER);
  await evolve(st, 'p1', base.uid, 'BT10-068', 0, 'hand');
  const after = S.effectiveDP(st, 'p1', other);
  st._fxSrc = { player: 'p2', category: 'digimon' };
  S.modifyDP(st, 'p1', other.uid, -5000, 'turn');
  st._fxSrc = null;
  eq('상대 효과로 인한 DP 감소가 막힘', S.effectiveDP(st, 'p1', other), after);
});

T('BT10-068-c', '진화 시 효과 발휘 이후에도, 자신의 효과로는 DP를 낮출 수 있다 (텍스트는 상대의 효과만 막는다)', async () => {
  const st = mk();
  const base = put(st, 'p1', GANKOOMON);
  const other = put(st, 'p1', OTHER);
  await evolve(st, 'p1', base.uid, 'BT10-068', 0, 'hand');
  const after = S.effectiveDP(st, 'p1', other);
  S.modifyDP(st, 'p1', other.uid, -1000, 'turn'); // no _fxSrc override -> treated as the owner's own effect
  eq('자신 효과의 DP 감소는 정상 적용됨', S.effectiveDP(st, 'p1', other), after - 1000);
});

await runAll('qa-bt10-068-gankoomon-dp');
