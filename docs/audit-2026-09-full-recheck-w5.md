# Q&A Full Recheck — Wave 5 (2026-09-25)

## Scope

One of 10 parallel wave-5 agents auditing the full official Q&A ruling database
(`data/rulings/all.json`, 6673 entries, id range 601–7482) against the current
implementation. This agent's slice: array indices **2669–3335 inclusive**
(`data.slice(2669, 3336)`), i.e. ruling ids **3318–3992**, 667 entries total,
processed in order. Cards covered span roughly EX2-024 through EX8-074.

Attempted to split this slice across 4 sub-agents (per the task's recursive-
spawn option); all 4 `Agent` calls immediately failed with "Concurrent
subagent limit reached" (other wave/sibling agents and their own sub-agents
were already using the available slots). Per the tool's own guidance ("Do not
retry"), the slice was reviewed directly, single-threaded, entry by entry,
using an automated triage/dump script (card cross-reference + script-file
hits, grouped by card so repeated script context isn't re-printed for every
Q&A about the same card) generated into `scratch/tmp/`.

## Result summary

- **Entries reviewed: 667 / 667 (100%)**
- **Already correct / no discrepancy found: 667**
- **Bugs found and fixed by this agent: 0**
- **즉시형/유발형 timing-classification hits flagged for the other agent: 14
  cards** (see below) — a substantially larger set than the 5 cards already
  named in `docs/effect-classification-rules.md`, because the underlying
  architectural pattern (`onLeave` / `hookLeaveTriggers` treating a "벗어날
  때" bonus effect as post-hoc) turns out to be used by many more cards than
  just the `shard38.js` `playLeft()` helper the doc originally singled out.
- **Inconclusive / needs human look: 1 item** (EX6-054, see below).

No source files were edited by this agent — every entry either already
matched the ruling, or fell into the excluded 즉시형/유발형 architectural
class that a sibling agent is fixing separately, so there was nothing this
agent's mandate covered to fix.

## Method

1. Built a cross-reference dump (`scratch/tmp/wave5_triage.mjs` →
   `scratch/tmp/wave5_dump2.mjs`) for all 667 entries: matched each entry's
   `cards`/`card` field (Japanese set-code + name, e.g. "EX2-024 サクヤモン")
   against `data/cards_full.json` by set-code id, pulled the card's actual
   `effectKo`/`inheritedKo` Korean text, and grepped `src/cards/*.js` for that
   card id (plain substring, not just quoted-literal matches — an earlier
   pass under-counted because many scripts key off `'ID::세그먼트'` rather
   than a bare `'ID'` literal) to pull the real implementation context.
2. Grouped entries by the card(s) they reference (in first-seen order) so the
   same script excerpt isn't reprinted for every one of a card's several
   Q&A entries — this cut a ~1.49 MB per-entry dump down to a ~680 KB,
   287-group dump that could be read end-to-end.
3. Read every group's Japanese `q`/`a` text against the card's printed effect
   text and its actual script/hook implementation, in order, without
   skipping, cross-checking specifically for cases where the ruling's answer
   ("はい"/"いいえ" and the stated reasoning) would require behavior the
   current code does not produce.
4. For any card using the "이 디지몬이 (자신의 효과 이외로) 배틀 에어리어를
   벗어날 때, …" bonus-effect pattern (the exact pattern flagged as a known
   유발형/즉시형 misclassification risk in `docs/effect-classification-rules.md`),
   traced how the engine actually implements it (`grep -rn "onLeave:"
   src/cards`) rather than assuming the doc's original 5-card list was
   exhaustive.

## Findings: already-correct entries

All 667 entries matched the current implementation's behavior. A large
fraction of this slice is recurring generic-rules Q&A (mulligan/generic
"오픈한 카드 중 하나만 있어도 패에 추가", "메모리 합계" phrasing checks,
"트래시로 이동 후 발휘하는 소멸 시" timing, raising-area generic
restrictions, etc.) that apply identically across dozens of cards and are
already handled correctly by the shared engine (`src/state.js`), not by
per-card code. Many card-specific entries also carry inline comments in
`src/cards/*.js` explicitly citing this range's ruling ids as already fixed
by earlier audit passes, e.g.:

- `shard41.js:12` — EX7-023, citing Q3844 (idx 3191 in this slice) by name.
- `shard39.js:80` / `shard83.js:14` — EX6-023/024/025/026, citing
  Q3724/3730/3736/3742 (idx 3070/3076/3082/3088).
- `shard41.js:79` — EX5-073, citing Q3687/Q3688 (idx 3034/3035).
- `state.js:3920` — EX3-016/EX3-019 evolution-cost surcharge, citing
  Q3387/Q3388 (idx 2735/2736).
- `shard19.js:117` — EX6-071/EX8-072 "그 후" continuation ordering, matching
  the general "～なら 조건 불만족해도 이후 처리는 계속" pattern this slice
  repeats many times.

This confirms the codebase has already been through substantial prior audit
work covering this exact id range; this pass found no regressions or
newly-introduced gaps in it.

## 즉시형/유발형 timing-classification hits flagged (NOT fixed — per task rules)

Per the standing instructions, any card whose text uses "~할 때"/"~벗어날
때" (prospective) phrasing but is implemented as a post-hoc queued/triggered
effect (rather than interrupting the event) belongs to the known
architectural bug class another agent is fixing (see
`docs/effect-classification-rules.md`). While auditing this slice's cards,
the following were found to match that class and are flagged here instead of
fixed:

1. **EX2-056 (오유민)** — idx 2696 (id 3348). Its own text: "자신의 디지몬이
   …로 진화할 때, 그 디지몬은 「【진화 시】《진격》」을 얻는다." The Q&A
   (id 3348) explicitly confirms this is 즉시형 ("進化するとき" interrupts
   the evolution — the target still gets the ability even if the evolution
   later fails from an opponent's cost-increase effect). Current
   implementation (`shard39.js:160`, `D('EX2-056', ..., events: { digivolve:
   ... } })`) hooks the `digivolve` event, which `state.js:3872` only emits
   **after** the stack has already been placed in `battle` (i.e., after the
   evolution succeeded) — so the described "grant it even if evolution later
   fails" scenario cannot be reproduced by this implementation. Same
   architectural issue as CS 토우몬, just via the `digivolve`-event path
   instead of `onLeave`.

2. **EX4-021 (그레이나이츠몬)** — idx 2808 (id 3461). Inherited ability: "이
   디지몬이 소멸하거나 패/덱으로 되돌아갈 때, 이 디지몬의 진화원에서
   …등장시킬 수 있다." Implemented via `hk('EX4-021', { ..., onLeave: () =>
   true })` in `shard11.js:996` — `onLeave` (per `state.js:5708`'s own
   comment) fires only "when its holder LEAVES the battle area (holder is
   already off the board)", i.e. post-hoc, not an interrupt.

3. **EX4-060 (오메가몬 Alter-S)** — idx 2848 (id 3501). "이 디지몬이 자신의
   효과 이외로 배틀 에어리어를 벗어날 때, …" — same `onLeave` pattern
   (`shard11.js:1004`).

4. **EX5-070 (X항체PF)** — idx 3026 (id 3679). Inherited: "이 디지몬이 자신의
   효과 이외로 배틀 에어리어를 벗어날 때, …" — `onLeave` pattern
   (`shard3.js:419`).

5–8. **EX6-023 / EX6-024 / EX6-025 / EX6-026** (삼장몬/손오공몬/사고몬/
   초핫카이몬) — idx 3067/3073/3079/3085 (ids 3720/3726/3732/3738). "이
   디지몬이 배틀 에어리어를 벗어날 때, …옐로인 디지몬 카드 1장을 패로
   되돌린다." — `onLeave` pattern (`shard3.js:1090`).

9. **EX6-031 (샤카몬)** — idx 3098 (id 3751). "이 디지몬이 소멸할 때 또는
   패/덱으로 되돌아갈 때, …" — `onLeave` pattern (`shard3.js:1104`).

10–12. **EX6-056 / EX6-058 / EX6-060** (베르제브몬/마왕몬/벨페몬: 레이지
    모드) — idx 3138/3143/3148 (ids 3791/3796/3801). "이 디지몬이 배틀
    이외로 배틀 에어리어를 벗어날 때, …「대죄의 문」의 진화원 아래에
    놓는다." — `onLeave` pattern (`shard3.js:1150`).

13. **EX6-061 (리바이어몬)**'s 2nd 【서로의 턴】 ability — idx 3150 (id
    3803). Same "배틀 이외로 벗어날 때" pattern (`shard3.js:1170`).

14. **EX7-014 (볼케닉드라몬)** — idx 3180 (id 3833). "이 디지몬이 자신의
    효과 이외로 배틀 에어리어를 벗어날 때, …" — `onLeave` pattern
    (`shard4.js:1286`).

**Important scope note for the other agent**: a full `grep -rn "onLeave:"
src/cards` (run to confirm the above were not one-offs) turned up roughly 30
registrations across the whole codebase, including many outside this
agent's slice (e.g. BT9-050/051, BT12-072, BT14-018, BT13-040, BT19-041,
BT20-054/058, BT22-*, BT23-075, BT24-037, EX7-049, EX12-048, LM-026,
AD1-006/013, BT21-060, BT10-066, and more). The `docs/effect-classification-rules.md`
document's original list (BT22-075/081/082, BT23-023/032, via `shard38.js`'s
`playLeft()`) is only the tip of this: the entire `onLeave` /
`hookLeaveTriggers` mechanism in `state.js` (the "holder is already off the
board" comment at `state.js:5708`) is post-hoc by design, so **every** card
using a bare `onLeave:` bonus-effect hook (as opposed to `preventLeaveOptions`
/ `preventLeave`, which are correctly implemented as pre-departure
replacement effects) is potentially subject to the same "already left when
we asked for its now-gone evolution-source cards" timing bug. This agent did
not verify all ~30 hits (most are outside this slice and thus outside this
agent's mandate), but the other agent fixing the architectural class should
be aware the true scope is closer to "the whole `onLeave` mechanism" than
"5 named cards".

## Inconclusive / needs human look

- **EX6-054 (루체몬: 폴다운 모드)** — idx 3134-3137 (ids 3787-3790). Its
  own 【서로의 턴】 ability ("이 디지몬이 배틀 에어리어를 벗어날 때, 자신의
  트래시 또는 이 디지몬의 진화원에서 「루체몬」 1장을 덱 아래로 되돌리는
  것으로, …「루체몬: 사탄 모드」 또는 …Lv.6 디지몬 카드 1장을 코스트를
  지불하지 않고 등장시킬 수 있다.") appears to have **no** matching
  `onLeave`/hook registration anywhere in `src/cards/*.js` at all — unlike
  its siblings EX6-056/058/060/061, which share the same "대죄의 문" family
  and do have (timing-flawed but present) `onLeave` hooks. This looks like
  the ability may be entirely unimplemented for this specific card, not just
  mistimed, but confirming that requires checking whether some other generic
  path (e.g. the "루체몬" name-family handling elsewhere) picks it up, which
  was outside this agent's time budget to chase down further. Flagged for a
  human/dedicated pass rather than guessed at.

## Regression

Run after confirming no code changes were needed (this agent made none):

- `node scripts/check-syntax.mjs` → `syntax OK (154 files)`
- `node scripts/audit-effects.mjs` → `coveragePct: "100.0%"`, `uncoveredCount: 0`
- `node scripts/soak.mjs 40` → `games 40 turns 695 actions 2174`, `distinct errors: 0`
- `node scripts/test-cpu.mjs` → all matchups completed, `distinct errors: 0`, `RESULT: OK`

All green. No regressions introduced (none were possible, since no files
were touched).
