// Audit batch g5/tier1_batch1 — BT20-013 (바오헉몬) official ruling Q4295: while a "서로는 지불하는 등장 코스트를
// 마이너스할 수 없다" effect (e.g. ST12-03) is active, BT20-013's 【메인】 "…지불하는 등장 코스트 -2" can still be
// activated and still summons the chosen card, but the discount itself is nullified (full printed cost is paid).
// Bug found: the shared playDiscounted() helper in src/cards/shard5.js (used by BT20-013 and 4 other cards:
// the "엑셀"/"크로스 하트"/"네가몬" hand-play discounts) unconditionally applied its discount, ignoring
// S.isPlayCostLocked() entirely — unlike every other bespoke discount path in the codebase (shard3.js, shard8.js),
// which already gate on it. Fixed by nulling the discount to 0 whenever S.isPlayCostLocked(state) is true.
// Run: node scripts/qa/qa-audit-g5-t1b1-bt20013-costlock.mjs < /dev/null
import { S, mk, put, T, eq, ok, runAll, drain } from './lib-s1.mjs';

T('4295', 'BT20-013: ST12-03 cost-lock present, effect still fires but discount is nullified', async () => {
  const st = mk();
  st.memory = 10; // own-side max, so paying 12 vs 10 lands at different (non-clamped) values
  const bao = put(st, 'p1', 'BT20-013');
  put(st, 'p1', 'ST12-03'); // all-turns: neither player can reduce play cost
  st.players.p1.hand.push('BT20-057'); // Gankoomon, cost 12, name matches BT20-013's filter
  st._qaAns = { pickFromZoneIndex: () => 0 }; // pick the only eligible hand card
  S.queueTriggersForStack(st, 'p1', bao, 'use');
  await drain(st);
  ok('played card entered battle area', st.players.p1.battle.some((s) => s.cardId === 'BT20-057'));
  eq('paid full cost 12 (no discount)', st.memory, -2);
});

T('4295b', 'BT20-013: no cost-lock -> normal -2 discount applies', async () => {
  const st = mk();
  st.memory = 10;
  const bao = put(st, 'p1', 'BT20-013');
  st.players.p1.hand.push('BT20-057');
  st._qaAns = { pickFromZoneIndex: () => 0 };
  S.queueTriggersForStack(st, 'p1', bao, 'use');
  await drain(st);
  ok('played card entered battle area', st.players.p1.battle.some((s) => s.cardId === 'BT20-057'));
  eq('paid discounted cost 10 (12 - 2)', st.memory, 0);
});

await runAll('qa-audit-g5-t1b1-bt20013-costlock');
