# Q&A recheck round 2 — wave 2, idx 667-1333 (ids 1282-1971; BT5-003 .. BT10-046)

Reviewed: all 667 entries (314 cards) were read against the card text and implementation. About 200 were exercised
with headless scenarios (`scripts/qa/qa-w2r2-a.mjs`, 125 scenarios). Template families (tamer-as-digimon, "open N add A and B",
X-antibody name-vs-trait, DP-0 / security-DP rulings) were confirmed correct.
Regression suite for the fixes: `scripts/qa/qa-w2r2-fixes.mjs` (19 scenarios). check-syntax OK, audit-effects 100%, soak 30: 0 errors.
Full qa-*.mjs run: only pre-existing failures (identical at git HEAD: slice2-r2-m Q1784, slice6-a G22/G28, slice6-r2-a G114, slice6-r2-b G76; missing fixture `plainTamer`).

## Bugs found and fixed
| Ruling ids | Card(s) | Change |
|---|---|---|
| 1291, 1342, 1385 (+BT2-111 1042) | BT5-014/067/111, BT7-017/111, BT2-111 | hand-card "ignore evolution conditions" alternatives no longer apply to a breeding-area digimon (state.js evolveTargetRestriction) |
| 1430, 1431 | BT6-044 | conditional 【서로の턴】 security-decrease watcher never fired (EW_UNSAFE filter) -> `ewTrusted` hook (shard32) |
| 1481, 1489, 1493 (+BT7-110, EX1-071) | BT6-095/105/109 | "이 옵션 카드는 색 조건을 무시" wording and "있을 때" condition were unparsed / always-true (state.js optionColorOk) |
| 1600 | BT7-055 | N copies now require N discards (shard1) |
| 1623 | BT7-063 | both Skullknightmon+Deadlyaxemon or none (single combined option) |
| 1465 | BT6-075 (moveEach) | optional "A and B 1장씩": once one is chosen the rest are mandatory (effects.js pickByGroups allOrNone) |
| 1652, 1653 | BT7-085/087 | 5 hybrid cards can be placed without evolving / without the target in hand |
| 1100-1104 | BT8-059 | evolution-ignore lock now voids hand-text alternatives, Lv-ignoring evolutions (BT6-087, shard2/shard7, evoExtraArg) |
| 1660 | BT8-068 | with 0 opp digimon it still opens 3 and discards |
| 1284, 1285 | BT9-109 protection | "bottom N" positions fixed first; EX2-055 declares extra to reach 7 |
| 1180, 1431 | BT9-018 / watchers | declined / unmet-condition watcher gives back its 〔턴에 1회〕 (S.refundOnceUse; main.js, cpusim.js, lib-s1) |
| 1641 | BT7-075 (all 소멸 시 source conditions) | last-known sources used after deletion (effects.js) |
| 1328 | BT10-042 | +1/-1 S-attack cancelling still counts as having 《S 어택》 |
| 1303, 1305 | BT10-011 / duplicate sources | duplicate same-effect contributors get per-instance ids so each has its own once-per-turn (state.js) |
| 1354 (+BT8-043) | BT5-085 | hand-play sacrifice cost options (-12 / -8) were missing (shard32) |

## Unresolved
- BT8-040 (1090/1091): colour grant "discarded card's colour" + 2-draw is manual-only (no automation of temporary extra colour).
- Out-of-range candidates (same EW_UNSAFE watcher filter as BT6-044, likely never auto-firing): BT11-087, EX9-069, BT24-020 (source), AD1-021, BT26-068 — worth checking by the owner of those ranges.
- Some BT7/BT9/BT10 rulings (BT7-112 sequencing, BT9-016 order, BT10-009 etc.) verified by reading only.
