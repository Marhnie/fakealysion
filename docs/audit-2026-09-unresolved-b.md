# Unresolved items, batch B (2026-09)

Regression scripts: `scripts/qa/qa-unres-b-{once,delay,ex6006,ex2056,scripted}.mjs`.

## 1. BT24-098 《딜레이》 (Q5710) - fixed
- `src/main.js` (delay branch of runPendingScript): a failed bullet gate no longer aborts before the confirm. The option can still be discarded; only the bullet script is skipped ("조건 불충족 - 파기만 함").
- Extra bug found on the way: "메모리가 상대**측**의 5 이상이라면" was not parsed (only "상대 쪽의"), so the gate could never pass automatically. `src/effects.js` now accepts 쪽/측.
- `main.js` is browser-only, so the script checks the plan/gate through `Fx.delayGateOk` plus a source assertion on the branch.

## 2. Manual-cost effects - fixed (EX11-038, EX5-013, EX8-028, BT8-040); EX6-063 was never broken
- New `src/cards/shard97.js` (registered in `cards/index.js`):
  - EX11-038: discard a 광물형/광석형 card from hand or from any own digimon's sources (Q5865), then draw 1.
  - EX5-013: destroy a DP<=6000 or 데바 digimon of either side as the cost (Q3550), then S-attack +1 only if it was actually destroyed.
  - EX8-028: put a sourceless digimon of either side under its owner's security (Q3897), then unsuspend this digimon. `@`-keyed script, the free-play 【진화 시】 segment stays generic.
  - BT8-040: discard 1 from hand; the discarded card's colours are added for the turn (`stack.baseOv[].addColors`, read by `S.stackColors`, purged at end of turn by `refreshBaseInfo`); 2+ colours then draw 2 (Q1728/1729).
- EX6-063 (Q3808): the generic watcher already does the rest-cost + memory +1 correctly; only the static compile view showed a manualCost. Test added, no code change.

## 3. Once-per-turn consumed without activation - fixed generically
- `Effects.onceGuard(ctx)` (effects.js): wraps `ctx.choose`, fingerprints game state. If a choice was cancelled and the state is unchanged after the script, the effect never activated and the 〔턴에 N회〕 use is given back (15-7-1 / 15-14-1). Wired into main.js `runPendingScript`, `cpusim.js` and `scripts/qa/lib-s1.mjs` (all three copies of the once-bookkeeping); covers bespoke `*_fn` scripts, hook watchers (queue-time consumption via `refundOnceUse`) and every s8/s4/s2 op with a cancellable pick.
- `s8_if` as the sole leading op (ST23-04/08 `s8_if > s8_costThen`, etc.) is now treated as sole like `s8_costThen`: an unmet condition or unpayable/declined cost refunds the use (`shard8.js`).
- Limits: an effect with no legal target that never asks a question (no choice cancelled) still consumes the use; a partial effect (state changed) keeps it. Cancelling a pick after a cost was already paid keeps it (the effect did activate).

## 4. EX2-056 (Q3348) - fixed
- The "진화할 때" grant is now `S2.evolveAttempt` (shard2), called from `S.digivolve` BEFORE the cost check and from main.js before the unaffordable-evolution rejection (`S.evolveAttempt`). A failed evolution keeps the 《진격》 grant for the turn. Successful evolution still grants exactly once (existing timing test passes).

## 5. EX6-006 (Q3699) - fixed
- New `S.effectPlayHookDiscount` (state.js) offers the hook play-cost options (`hookPlayCostOptions`, includes EX6-006's -3/-4) for PAID effect-driven plays from the hand in `s8_playOrUse`, shard5 `playDiscounted`, shard2 `s2_playDiscounted`, shard4 `s4_play`. Free plays are unaffected (no cost paid).

## Still unresolved / notes
- Effect plays implemented in other bespoke ops with their own cost arithmetic (e.g. remaining shard-specific play helpers) do not yet offer hook play-cost options; only the four common paths above do.
- The CPU path does not resolve 《딜레이》 event bullets (unchanged, out of scope).
