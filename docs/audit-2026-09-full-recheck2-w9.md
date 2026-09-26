# Q&A re-verification round 2 — wave 9 (idx 5336-6002, ids 6085-6799)

667 entries read one by one (216 cards). Boilerplate groups (immunity, under-tamer cards, 表向き security, link rules, "ことで" all-or-nothing, DP0 batching, security-before-battle) were checked against existing slice5/slice6 scripts or re-probed; card-specific rulings were probed headlessly. Besides the ruling checks, four class scans were run (unwatched "~했을 때" segments, empty-script watchers, continuous grants with no hook, OR-descriptor parsers).

## Bugs found and fixed
| Card(s) | Ruling | Change |
|---|---|---|
| BT25-028 디아나몬 | Q6294/6295 | rest lock on "진화원 1장 이하 전부" was a snapshot; now dynamic (state.js s3RestLocked kind `maxSources`, shard7) |
| BT25-058 칼리스몬 | Q6345 | 「액티브되지 않는다」 is a separate pick (shard8); its 【서로의 턴】 (effect arrival) had no watcher (shard7 hook) |
| BT25-060 리부트몬 | — | 【서로의 턴】 링크/액티브 watcher missing (shard7) |
| BT25-059 케레스몬 | — | 【서로의 턴】 fired but compiled to an empty script; script added (shard8) |
| AD1-025 오메가몬 | Q6117/6118 | 【서로의 턴】 "벗어났을 때" had no watcher; hook on `leaveBattle` (shard8) |
| BT25-075 불카누스몬 | Q6370 | 《속공》+《링크 +1》 grant unimplemented; added, plus link-cap sweep when the source leaves (state.js hookLeaveTriggers). BT25-074 inherited 《재기동》《블로커》 grant added |
| AD1-021 | wave-2 note | rest watcher skipped by EW_UNSAFE; marked ewTrusted (shard8) |
| AD1-019 + ST21-13 | Q6098 | paid effect-play now gets tamer/trait/s1 play-cost discounts (shard8 s8_playOrUse) |
| EX11-018, EX12-035/036 | Q6515/6516/6783/6784/6788/6789 | ≪디코드≫/≪파티션≫ now also play a source when a survive ability (≪회피≫ etc.) keeps the digimon (state.js deleteStackCore) |
| EX12-014/016/017/031/032/035/036 | Q6735/6738 | ≪디코드≫ "Lv.N 이하의, A하거나 B" was parsed as A AND B (never found a source); fixed in leaveCardPred. Assembly bare 「특징 「ME」/「VB」」 alternative (EX12-016/017/035) was dropped; fixed in parseAssemblyItem |
| AD1-020/023, EX7-037, BT18-096, assembly (EX13-077) | Q6099/6113 | 「색이 다른」: multi-colour cards may count as different colours (new S.colorsAllDistinct). qa-ex13-e fixture made single-coloured |
| BT25-080 | Q6383 | waiting "이 카드가 …파기되었을 때" effects are void once the card left the trash (waitingDestroyEffectGone) |
| BT25-029, sole-op s8_costThen scripts | Q6296 | declined/unpayable optional cost no longer consumes 【턴 1회】 |
| EX8-074 | Q6721 | −4 cost option needs both digimon really rested (shard41) |

Regression scripts: `scripts/qa/qa-w9r2-{a,b,dianamon-restlock,charismon-lock,decode-evade,distinct-color}.mjs` (all pass).

## Unresolved / notes
- EX7-014/EX7-049 (Q6718/6719): ≪DigiXros≫ materials leaving the battle area do not consult the passive `preventLeaveOptions` (only `onLeave`), so their 【서로의 턴】 play is not offered on DigiXros.
- BT25-075 link-cap excess: the newest link card is discarded; ruling says the player chooses.
- Generic `evoTargetPredicate` applies "Lv.N 이하의" only to the first alternative in "…를 가지거나 옐로/블랙인" texts (BT23-023/032, BT24-037 are bespoke and correct).
- Optional pick-cancel in other s8 ops (e.g. BT25-058 restPick) still consumes 【턴 1회】; a driver-level "all prompts cancelled and no state change" refund is not done.
- Possible unwatched/unsafe watcher segments outside my range: BT11-087, BT24-020, BT26-068, BT16-021, BT21-052, BT22-041, EX10-021, EX11-028, EX3-045, BT10-011 (unsafe filter); BT19-075, BT20-071, EX10-058, BT23-059, AD1-016, BT12-041, BT13-007 (no watcher found by scan; unverified).
- cards_full.json currently has no effect-less tamer, so `plainTamer()` in lib-s6 throws (breaks qa-slice6-a/r2-a/r2-b, qa-w6-b); pre-existing/sibling. Other failing suites (qa-audit-g5-t1b3, qa-slice2-r2-m, qa-w1r2-h, qa-ko-overrides-1) do not touch my edits.

Final: check-syntax OK (160), audit-effects 100.0%, soak 30 games 0 errors.
