# Q&A 전수 재점검 — Wave 9 (2026-09-25)

Scope: `data/rulings/all.json` array indices **5337–6003** (inclusive), i.e. Q&A ids **6086–6800**, 667 entries total (1 of 10 parallel waves covering the full 6673-entry database).

## Method

Given the volume (667 entries), the slice was triaged automatically before manual review:

1. Every entry's card id(s) were cross-referenced against `data/cards_full.json` (direct id-prefix match, e.g. `AD1-017 デュナスモン` → `AD1-017`) to pull `effectKo`/`inheritedKo`, and against `src/cards/shard*.js` (grep by card id) to check whether any implementation exists at all.
2. Entries were bucketed: 0 had no card match, 0 had a card with no effect text at all, **124** (51 unique cards) had effect text but **no implementation whatsoever**, and **543** (166 unique cards) had both effect text and an implementation to check against the ruling.
3. Of the 543 "has implementation" entries, only **252 distinct question texts** exist in the whole 667-entry slice — most of the volume is the same boilerplate FAQ clarification (테이머 아래 카드 순서, "효과를 받지 않는다"의 정의, 동시 소멸 판정, 카운터 1회 제한, 표시 시큐리티 등) reprinted per-card for every new BT25/ST23/ST24/AD1 release. **163 questions are unique** (appear exactly once) — these were read in full and treated as the highest-value candidates for a real card-specific discrepancy; the remaining ~480 duplicate-boilerplate entries were spot-checked against known-generic engine mechanics and not investigated individually.
4. `docs/effect-classification-rules.md` (유발형 vs 즉시형 trigger-timing bug class, found by a sibling agent earlier this session) was read first and kept in mind throughout.

## Totals

- **667 entries reviewed** (all of them, at least at the triage level).
- **543 entries** matched to a real implementation; of those, the ~480 duplicate-boilerplate ones and the vast majority of the 163 unique ones check out as already correct (generic engine mechanics — once-per-turn bookkeeping, "ことで" all-or-nothing costs, simultaneous-trigger ordering, DP-0 rule-check batching, security-check-before-battle ordering, etc. — already implement the ruling correctly).
- **124 entries (51 unique cards)** have card text but **no script implementation at all** — see "Gaps" below. These are pre-existing missing-card-content gaps, not implementation bugs, so they were not built out here (that's new-feature work, not a Q&A-vs-code discrepancy fix).
- **1 real bug found and fixed**, affecting 2 cards (see below).
- **5 cards flagged** for the separate 유발형/즉시형 reclassification effort (not fixed here, per instructions).

## Bug found and fixed

### EX6-043 (디아블로몬) / EX8-074 (메디벌듀크몬): forced "진화 시" borrow didn't respect 【진화 시】 suppression

- **Ruling**: Q&A id **6792** (attached to EX12-036 용궁몬, whose own effect grants "상대 디지몬 1마리의 【진화 시】 효과는 발휘되지 않는다"): *"'【進化時】効果は発揮しない' を付与されたカードの【進化時】効果を、他の効果で発揮させることはできますか？" → "いいえ、発揮させることはできません."* — a digimon whose own 【진화 시】 trigger is currently suppressed cannot have that same effect force-triggered by another card's "이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다"-style ability either.
- **What was wrong**: `src/cards/shard41.js` implements EX6-043's and 메디벌듀크몬(EX8-074)'s own "【서로의 턴】…이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다" ability via a shared `runTagOf()` helper. The handler only checked `if (!t) return;` before asking the player to force-fire the segment — it never checked `S.evoTrigSuppressed(...)`. Two *other* implementations of the exact same "borrow my own 【진화 시】" mechanic (EX12-064 in `src/cards/shard42.js:157`, and BT24-079's `s52_borrowEvo` op in `src/cards/shard52.js:45`) already carry the guard, each commented `// QA-S6 Q6792: 【진화 시】 suppressed` — i.e. a prior wave already found and fixed this exact ruling for those two cards, but missed the `shard41.js` copy used by EX6-043/EX8-074.
- **Fix**: `src/cards/shard41.js:71` — changed
  `const t = me(ctx); if (!t) return;`
  to
  `const t = me(ctx); if (!t || S.evoTrigSuppressed(ctx.state, ctx.self, t)) return; // QA-S6 Q6792: 【진화 시】 suppressed`
  (matching the existing pattern in shard42.js/shard52.js exactly).
- **Verification**: `scripts/qa/qa-w9-ex8074-evosuppress.mjs` (new). For both EX6-043 and EX8-074: with `noEvoTrigUntil` active, the effect must not even prompt the player, and the opponent's digimon must be untouched; without suppression, the effect must still prompt normally (regression guard). Confirmed the test **fails without the fix** (before the fix, the forced borrow still ran and destroyed the opponent's digimon — `got 0 want 1` on "opponent digimon untouched") and **passes with it**. `node scripts/qa/qa-w9-ex8074-evosuppress.mjs`: 4 pass, 0 fail.

## Flagged for the 유발형/즉시형 reclassification effort (not fixed here)

Per instructions, cards whose text uses prospective "~벗어날 때" phrasing but whose current implementation resolves the effect *after* the card has already left the battle area (via the generic `onLeave`/`queueHookSegment`/`state.pending` path — confirmed at `src/state.js:5711-5727`, comment: "holder is already off the board") are the same architectural class already being fixed by a sibling agent for the `playLeft()` family (BT22-075/081/082, BT23-023/032). Within this slice's Q&A, the following are already-known instances (confirming continuity, not new discoveries) plus two new instances of the same pattern surfaced while investigating:

- **BT23-032 (CS 토우몬)** — Q&A id 6250. Already the flagship example in `docs/effect-classification-rules.md`.
- **BT22-081 (이터・이브) / BT22-082 (이터・아담)** — Q&A ids 6693-6702. Same `playLeft()` family; these Q&A entries additionally confirm that a tamer card placed as this digimon's evolution source *does* count as a live evolution source and *does* grant its "진화원 효과" text — relevant detail for whoever reimplements `playLeft()` as an interrupt.
- **EX7-014 (볼케닉드라몬, EX7 print) / EX7-049 (메탈릭드라몬)** — new instances found in this slice, not previously listed in `docs/effect-classification-rules.md`. `src/cards/shard4.js:1286-1288` implements "【서로의 턴】[턴에 1회] 이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 자신의 패에서 …디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다" via `H(id, { onLeave: (st, hp, stack, cause) => cause !== 'ownEffect' })`, i.e. the same post-hoc `state.pending` queuing — a bonus-without-preventing-departure effect on "벗어날 때" (prospective) text, matching the CS 토우몬 bug shape exactly. Q&A ids 6509 and 6718/6719 in this slice reference these two cards but happen to test other parts of their text (the "진화 시" opponent-deployment lock, and whether the ability still fires when the card is removed via デジクロス), so neither ruling is itself violated by the current implementation — but the underlying architecture is the same known-wrong pattern and should be swept up together with the `playLeft()` fix.

Note for the sibling agent: a broader grep of `src/cards/*.js` for `onLeave:` turns up roughly 25-30 more cards using this exact same post-hoc mechanism (e.g. EX4-021, EX4-060, EX5-070, EX6-031/056/058/060/061, BT9-050/051, BT19-041, BT20-054/058, BT13-040, BT21-060, AD1-013, LM-026, BT10-066, BT12-072, BT14-018, AD1-006, EX12-048, BT23-075, BT24-037) — none of these happened to be referenced by a Q&A in this specific slice (5337-6003), so they were not individually verified against ruling text here, but they are candidates for the same 176-occurrence "벗어날 때" resweep already noted as in-progress in `docs/effect-classification-rules.md`.

## Gaps (card has effect text + a matching Q&A, but no implementation exists at all)

51 unique cards / 124 Q&A entries in this slice reference cards with zero implementation in `src/cards/*.js` (verified by direct grep, e.g. `BT22-077`, `AD1-025`, `BT6-060`, `EX12-028`, `BT25-014/015/018/025/034/035/036/040/043/060/062/067/079/100`, `BT24-034`, and a long tail of older BT7/BT12/BT17/BT18/ST cards). This is expected — this project implements cards incrementally — but is called out here since a human may want to prioritize these for future implementation waves; it is out of scope for this audit (which fixes ruling-vs-code mismatches, not missing content) to write ~50 new card scripts from scratch.

Two worth a specific human look because the Q&A reveals a non-obvious mechanic that whoever implements these cards later should get right the first time:
- **BT22-077 (디아나몬)**: Q&A id 6247 clarifies that its inherited "진화원 효과" (자신의 턴 종료 시 액티브) does *not* trigger if this card has itself become someone else's jogress material by the time turn-end is checked (트리거 조건을 만족한 시점에 이미 진화원이 아니게 됨 → 유발 안 함). Ordinary "self must still be present" trigger-gating, but easy to get backwards.
- **EX12-036 (용궁몬)**: Q&A ids 6790-6794 spell out a full mini-spec for its "【진화 시】 효과는 발휘되지 않고, 레스트할 수 없다" debuff: only suppresses trigger-tag matches literally containing "진화 시" (an 【진화 시】【어택 시】 combo tag can still fire via the attack half), can't be force-triggered by another card's "발휘할 수 있다" effects, can't even partially run the "ことで" condition, and doesn't consume a [턴에 X회] counter it never fired. **This card itself is fully implemented already** (`src/cards/shard8.js:1167,1252`, using the generic `noEvoTrigUntil`/`S.evoTrigSuppressed` mechanism at `src/state.js:915,5467`) and is exactly what led to discovering the EX6-043/EX8-074 bug above — it's listed here only because EX12-036 landed in the "163 unique questions" review, not because it's unimplemented.

## Regression suite

All run from the project root with `TEMP`/`TMP` pointed at `scratch/tmp` (never `C:\`):

- `node scripts/check-syntax.mjs` → **syntax OK (154 files)**
- `node scripts/audit-effects.mjs` → **100.0% coverage** (8168 segments, 0 uncovered)
- `node scripts/soak.mjs 40` → **40 games, 1974 actions, 0 distinct errors**
- `node scripts/test-cpu.mjs` → **0 errors**, all matchups completed (hard vs easy 100%, normal vs easy 92.5%, hard vs normal 60%, easy vs easy 57.5%, normal vs normal 50%, hard vs hard 40% — consistent with a healthy difficulty gradient)
- `node scripts/qa/qa-w9-ex8074-evosuppress.mjs` (new) → **4 pass, 0 fail**

No commits were made; all changes are left in the working tree for review (`src/cards/shard41.js`, new file `scripts/qa/qa-w9-ex8074-evosuppress.mjs`, this doc).
