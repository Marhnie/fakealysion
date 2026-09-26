// Unresolved-b (1) / Q5710: BT24-098 《딜레이》 — the bullet's condition (memory >= 5 on the opponent's side) is read when the effect RESOLVES; when it fails the option
// can still be discarded (no digimon is played). main.js (browser-only) must therefore still offer the discard when delayGateOk() is false.
import * as fs from 'fs';
import { S, Fx, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
T(5710, 'BT24-098 delay plan has a memory gate; gate fails at memory <5 (opp side) and passes at >=5; main.js discards anyway when the gate fails', async () => {
  const st = mk(); const seg = S.parseEffectSegments(S.card('BT24-098').effectKo).segments.find(s => s.tags.includes('자신의 턴'));
  const plan = Fx.delayBulletPlan(S, 'BT24-098', seg.tags, '《딜레이》.');
  ok('plan', !!plan && !!plan.gate);
  const ctx = { state: st, S, E: null, self: 'p1', opp: 'p2', sourceCardId: 'BT24-098', choose: async () => null };
  st.memory = -1; eq('gate fails at opp-side 1', await Fx.delayGateOk(plan, ctx), false);
  st.memory = -5; eq('gate passes at opp-side 5', await Fx.delayGateOk(plan, ctx), true);
  const src = fs.readFileSync('src/main.js', 'utf8');
  const i = src.indexOf('const delayPlan ='); const blk = src.slice(i, i + 3200);
  ok('failed gate no longer aborts before the confirm', /gateFailed = true/.test(blk) && !/조건을 만족하지 않아';\s*\r?\n\s*if \(stale/.test(blk));
  ok('failed gate skips the bullet script', /if \(gateFailed\)[^\n]*\r?\n\s*else if \(delayPlan\.script\.length\)/.test(blk));
});
runAll('qa-unres-b-delay');
