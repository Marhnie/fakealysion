# Q&A re-verification, recheck round 2, worker 1 (data/rulings/all.json idx 0-666, ids 601-1280)

Scope: ST1-ST19 and BT1-BT4 official Q&A (Japanese source, Korean card data). Every entry was read against the card text
and the implementing code path; 249 scenarios were added as headless scripts (`scripts/qa/qa-w1r2-a.mjs` ... `-m.mjs`,
test labels = ruling idx, `iN`). 282 of the 667 entries were already pinned by older id-keyed scripts
(qa-slice1-*.mjs etc.; those were re-run: all pass). The rest were checked by scenario (about 250 entries, several rulings
per scenario) or, where the ruling only restates a generic rule already exercised elsewhere (jogress explanation,
"opens 3 / must take", 「〜することで」 all-or-nothing costs, "counts itself"), by reading the code path.

## Bugs found and fixed (implementation contradicted the ruling)

1. **"전부" keyword grants ignored digimon that arrive later** (ST1-13 idx 6, BT4-098 idx 642, ST3-15 sec; same family as the existing
   `addDpAllMod`). `src/state.js`: new `addKwAllLate` / `kwAllLateFor` (hooked into `s7ContKw` and `s7ContSAttack`),
   recorded from the `grantKeyword {all}` branch in `src/effects.js` (unfiltered grants only). Test: qa-w1r2-a `607`.
2. **ST19-11 / ST19-15** (idx 255, 256, 261, 262): "디지몬이 3마리 이상 있다면" counts BOTH players' digimon; the script counted only
   the caster's. Fixed in `src/cards/shard12.js` (`dpMinus`). Tests: qa-w1r2-d `i255-256`, `i261-262`.
3. **BT3-057 (and every "레스트시킨다. …다음 액티브 페이즈에 액티브가 되지 않는다" combo)** (idx 481): an already-rested opp digimon may be
   chosen so the no-unsuspend rider still applies; the generic `rest` op filtered targets to active ones only. Fixed in `src/effects.js`
   (`case 'rest'`, only when `skipNextUnsuspend`; also de-duplicates the N-target loop). Test: qa-w1r2-g `i481`.
4. **BT4-111 ジャックレイド** (idx 664): an option is trashed only after its effect resolves, so it must not count in its own
   「자신의 트래시 10장마다」. `src/effects.js` `perCount` now subtracts the just-used option. Test: qa-w1r2-h `i664`.
5. **BT3-105 【시큐리티】 (and BT9-103 style) "상대의 디지몬 전부는 플레이어에게 어택할 수 없다"** (idx 533): digimon arriving afterwards
   are covered too. `src/state.js` `addAttackPlayerLate` / `attackPlayerLateBlocked` (checked in `canAttackPlayer`), recorded from
   `restrictAttackPlayer {all}` in `src/effects.js` (filter evaluated through a registered matcher). Test: qa-w1r2-m `i533`.

## Judged NOT a bug

- idx 283 (BT1-023), 358 (BT1-094), 377 (BT1-110 sec): the old answers say a 《블로커》 granted by an option still counts as "has 《블로커》".
  Rulebook Ver.4.3 2-3-3-3/2-3-3-4 (already implemented deliberately via `hasAlwaysKeyword`, see docs/rulebook-v43-changes.md and
  qa-rulebook-v43-2-3-3-3.mjs) supersedes this; left as is.
- Rulings that only differ by wording between sets (ST9/ST10/ST13 jogress explanations, BT4 "テイマーをデジモンとして進化", Legend-Arms
  "登場できる is optional", BT9-047 blocking effect-plays) were confirmed against existing generic code / scenarios.
- Korean data quirks (not code): Korean names differ from the Japanese ones in the rulings (e.g. Gabumon = 파피몬), BT11-063 has no
  rule-name line but its name contains 워매몬, so ST19-13's 「워매몬을 포함」 already matches it.

## Not fixed / observations

- Full `scripts/qa/qa-*.mjs` sweep after the edits: the only failures are unrelated to these changes and belong to concurrent sibling
  work or pre-existing helper drift: qa-audit-g5-t1b3-mandatory-picks (BT21-061 now HARD scripted), qa-slice2-r2-m (BT8-105 pick
  `required` flag), qa-slice6-a / r2-a / r2-b / qa-w6-b (helper `plainTamer` finds no card). Not touched.
- A handful of entries (mainly idx 75/81/91/93/96 P-103/P-104 simultaneous evolve timing, 195 EX2-065 chain, 217-219 ST15-16
  attack-lock interplay, 176/177 ST13-06 uninterruptible 진격 chain, 229 ST17-08 immunity expiry) were only verified by code reading, no
  regression script (the required interleavings cannot be driven by the headless harness).

## Checks
`node scripts/check-syntax.mjs` OK, `node scripts/audit-effects.mjs` 100.0% coverage (0 uncovered), `node scripts/soak.mjs 30` 0 errors.
