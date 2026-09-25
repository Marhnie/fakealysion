# Q&A Audit — Wave 8 (data/rulings/all.json index 4670–5337, ids ~5407–6085)

Scope: this agent's slice of the full 10-way parallel Q&A recheck. `data.slice(4670, 5337)` = 667 entries.

Work was split: the lead agent directly reviewed index 4670–5171 (501 entries, parts A+B+C below),
and spawned one background sub-agent for index 5171–5337 (166 entries, part D).

## Method

1. Extracted the set-code prefix (e.g. `BT23-032`) from each ruling's `card`/`cards` field — this is
   exactly the `id` key in `data/cards_full.json` (an object keyed by card id, not an array).
2. For each of the 501 entries in my own range, resolved the card(s), and classified:
   - card has no `effectKo`/`inheritedKo` text at all → trivially fine (no code needed).
   - card has effect text AND a dedicated script in `src/cards/*.js` (matched by `'ID'` or `'ID::tag'`
     string literals) → read the script, compared against the ruling.
   - card has effect text but no dedicated script found → relies on the generic text-to-script
     compiler (`Effects.compileToScript` / `parseEffectSegments`). Verified via
     `node scripts/audit-effects.mjs`, which reports **100% coverage** (8168/8168 segments compile,
     0 uncovered) — confirms these aren't silent implementation gaps.
3. Deduplicated by card: 501 rulings referenced only **139 unique cards with dedicated scripts** and
   **59 unique cards handled only by the generic compiler**. Read every dedicated script and compared
   it line-by-line against the Japanese Q&A ruling and the card's printed Korean effect text.

## Results — Part A+B+C (index 4670–5171, 501 entries, lead agent)

- **501/501 entries reviewed.**
- **Already-correct / trivial: 499** (generic rules clarifications — simultaneous-trigger ordering,
  DP-0 rule-check timing, "사용 코스트" vs "지불하는 코스트" cost-reference distinctions, [턴에 1회]
  consumption semantics, security face-up mechanics, etc. — all already match the existing generic
  engine behavior or an already-correct dedicated script. No fix needed.)
- **Real bugs found and fixed: 0.**
- **즉시형/유발형 misclassification hits flagged for the other agent's follow-up (NOT fixed here): 2**
  - **BT24-037 실피드몬** (`src/cards/shard65.js:82-97`) — both `effectKo` and `inheritedKo` read
    "이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어**날 때**, 이 디지몬의 진화원에서 … 카드를
    코스트 없이 등장시킬 수 있다" (예정형 phrasing → should be 즉시형 per 15-8-5-1, same family as
    the already-identified CS 토우몬/`playLeft()` bug). Current implementation uses
    `hk('BT24-037', { tag: '서로의 턴', ..., onLeave: (state, hp, stack, cause) => cause !== 'ownEffect', noAuto: true })`
    plus a handler that reads `evt.sources` filtered by `pl.trash.includes(id)` — i.e. it resolves
    **after** the digimon and its evolution sources have already been moved to the trash (the
    `descriptor.onLeave` → `state.pending` post-hoc path documented at `src/state.js:5708`), not
    before the leave event as 즉시형 requires.
  - **EX11-052 헤비메탈드라몬** (`src/cards/shard7.js:2417-2418`) — `effectKo`: "특징 「마룡형」/「사룡형」을
    가진 자신의 디지몬이 배틀 에어리어를 벗어**날 때**, 자신의 패가 4장 이하라면, 상대의 시큐리티
    1장을 파기한다." Also 예정형 phrasing, implemented via `H('EX11-052', { ..., events: { delete: ... } })`
    — the same post-hoc `state.pending` event path (correct for 유발형/"~했을 때" but not for this
    "벗어날 때" card). Functionally the effect body doesn't need the leaving stack's live state (it
    only checks the owner's hand size and hits opponent security), so the practical impact is likely
    low, but it's the same architectural misclassification and should go on the reclassification list.
  - Both are **additional instances** of the pattern already described in
    `docs/effect-classification-rules.md` (the doc's own "176건 재조사 필요" note) — not fixed here
    per the task's standing instruction that the trigger-timing architecture fix belongs to the
    sibling agent already working on it.
  - For contrast/confirmation: all the "벗어날 때 … 벗어나지 않는다" (leave-*prevention*) cards
    touched by rulings in this range (BT24-012, BT24-030, BT24-040, BT24-052, BT24-060, BT24-101,
    BT18-.../EX11-022/EX11-031, etc.) already correctly use the immediate-type
    `preventLeave`/`preventLeaveOptions` path in `src/state.js`, exactly as the classification doc
    says they should — no issue there.
- **Inconclusive / needs human look: none.**

## Results — Part D (index 5171–5337, 166 entries, background sub-agent)

Pending — sub-agent still running at the time this file was first written. Will be appended/updated
once it reports back, along with the consolidated regression run (check-syntax / audit-effects /
soak 40 / test-cpu) covering both parts' changes (if any).

## Regression

Not yet run to completion for the full slice (waiting on part D so any edits from that sub-agent are
included in one pass). `node scripts/audit-effects.mjs` was run standalone during triage and reports
100% coverage (8168/8168 segments), 0 uncovered — this is unaffected by this wave since no edits were
made in part A+B+C.
