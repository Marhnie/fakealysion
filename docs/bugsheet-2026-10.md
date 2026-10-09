# Bug sheet 2026-10 (two player reports)

## (1) P-167 / EX8-005 / P-169 -- "진화원 파기" watchers never fired for source-trashing COSTS

Report: EX8-005 ("이 카드가 특징 광물형/광석형을 가진 디지몬의 진화원에서 효과로 파기되었을 때, 메모리 +1") and P-169 ("【서로의 턴】 광물형/광석형 디지몬의 진화원이 효과로 파기되었을 때 …") do not trigger when
P-167's 【진화 시】/【자신의 메인 페이즈 개시 시】 trashes a 광물형/광석형 card from the sources of an own Digimon.

Root cause: `OPS.r17_p167` (src/cards/shard17.js) removed the card with `sources.splice` + `trash.push` and never emitted the game event `'sourcesTrashed'`.
All of the "…진화원에서 [효과로] 파기되었을 때" machinery (generic `queueOwnDiscardTriggers` in src/state.js, 서로의 턴/자신의 턴 hooks such as P-169, BT26-002/048, EX11-044, BT14-028 …) hangs off that event.
Ruling used: paying a cost with the effect's own resources is still "효과로 파기" (the engine already treats `trashEvoSources` from a cost this way, e.g. BT10-076/BT11-087 cost groups); the official Q&A for P-169
(id 4277) only restricts the HOST (own 광물형/광석형 Digimon), not the trashed card, and there is no ruling excluding costs.

Fix: one shared helper in src/state.js
* `S.trashSourceIdxs(state, stack, idxs, {own, all, cause})` / `S.trashSourceIds(state, stack, ids, opts)` -- wraps `trashEvoSources` (which now takes an `opts.cause`), so the event, the
  face-down (`s5fd`) bookkeeping, protected-source (BT9-109) and immunity checks live in one place. `own:true` = performed with the owner's own resources (cost / replacement / keyword), `all:true` = all-or-nothing.
* P-167 now uses it (and only offers FACE-UP sources of own Digimon, 4-7-9).

Systematic scan (every `sources.splice/shift/pop` / `.sources =` in src/**/*.js, ~170 sites) -- sites that really TRASH sources and bypassed the event were converted:
shard1 (paySources / survive-by-source replacements: BT5-086, BT9-012, P-072 …), shard2 (`s2_costSource` incl. the BT10-084 redirect, `s2_pluck` RB1-016/P-089, EX3-013 replacement), shard4 (`s4_trashSourceOption`
EX7-010 family -- the inline EX7-071 memory grant was removed, the generic watcher now does it once), shard5 (어플몬/3총사 cost), shard39 (EX1-073), shard41 (EX5-073, EX6-042), shard130 (EX13-032 / EX13-071 face-down tamer cost),
state.js (《프래그먼트》, holder-cost "…진화원 N장을 파기하는 것으로", "테이머 아래의 뒷면 카드를 아래에서부터 N장 파기" cost). Sites that move sources elsewhere (hand/deck/security/under another stack/play from sources/link) are not trashes and were left alone.
Also: `securityDiscard` events now carry `cardId` for the blind-pick security trash (shard14 `trashSecAt`) and the security-zone cost trash (`s7TrashFaceUpSecurity`) so their own "시큐리티에서 효과로 파기되었을 때" watchers can fire.

Regression: `scripts/qa/qa-bugsheet-sources-trashed.mjs` (10 scenarios: P-167 + EX8-005 + P-169, face-down / non-광물형 negatives, EX7-010/EX7-071, RB1-019, EX3-013, BT5-086, EX13-032 tamer cost, RB1-016 vs an opponent's EX8-005).

## (2) ≪딜레이≫ activatable on the turn it was placed

Rule 16-17-3: the Delay effect cannot be activated in the turn the card was placed in the battle area.

Findings (all paths audited): the manual 🗑딜레이 button (`stackActionList`), `cpuApiObj.useDelay`, the CPU driver (`cpusim` 'delay') and the generic event/turn-start flow (`runPendingScript` delayPlan) were already gated by
`turnNumber > placedTurn` (verified headlessly for all 73 plain 【메인】《딜레이》 options and in the real browser with P-038). The leaks were in bespoke event-triggered options:
* **EX5-069 / BT15-098** (`delayEvent`, shard11): no placement-turn check anywhere (neither in the event hook nor in the script) -> fired in the turn the option was placed.
* EX10-070 / P-204 (shard6): relied only on the event predicate (script had no check) -- hardened.
* Several scripts ignored the return value of `S.discardForDelay` and ran the bullet anyway.

Fix:
* `S.discardForDelay` is now THE single gate: it refuses (returns null, logs) when `turnNumber <= stack.placedTurn` (`S.delayUsableNow`). All bespoke callers (shard4/6/7/8/11/12/80) now bail out when it returns null; the local copies in shard5/shard13 check the same rule.
* shard11 `delayEvent` gates both the event predicate and the script; shard6 EX10-070/P-204 scripts re-check.

Regression: `scripts/qa/qa-bugsheet-delay-same-turn.mjs` (central gate; all 73 plain Delay options used for real then CPU 🗑 action same turn vs next turn; EX5-069; BT15-098; sweep of all event-triggered Delay options;
turn-start options LM-027/P-243; EX10-070/P-204 scripts).
