# Q&A Full Recheck — Wave 7 (2026-09-25)

## Scope

One of 10 parallel wave-7 agents auditing the full official Q&A ruling database
(`data/rulings/all.json`, 6673 entries, id range 601–7482) against the current
implementation. This agent's slice: array indices **4003–4669 inclusive**
(`data.slice(4003, 4670)`), i.e. ruling ids **4709–5401**, 667 entries total,
processed in order.

Note: attempted to split this slice across 4 sub-agents (per the task's
recursive-spawn option) but hit the environment's concurrent-subagent cap
(other wave-7 agents and their own sub-agents were already using the
available slots). Per the tool's own guidance ("Do not retry"), the slice was
instead reviewed directly, single-threaded, entry by entry, using an
automated triage dump (card cross-reference + script-file hits per entry)
generated into a session-unique scratch path to avoid collisions with the
shared `scratch/tmp` directory used by sibling agents/waves.

## Result summary

- **Entries reviewed: 667 / 667 (100%)**
- **Already correct / no discrepancy found: 667**
- **Bugs found and fixed: 0**
- **New 유발형/즉시형 classification hits flagged: 0** (beyond the ones already
  named in `docs/effect-classification-rules.md`)
- **Inconclusive items needing human review: 0**

No source files were edited by this agent (no code changes, no new QA
scripts — there was nothing to verify since no discrepancy survived
scrutiny).

## Method

1. Built a cross-reference dump for all 667 entries: matched each entry's
   `cards`/`card` field (Japanese set-code + name) against `data/cards_full.json`
   by set code, pulled the card's actual `effectKo`/`inheritedKo` text, and
   grepped `src/cards/*.js` for that card id to see whether/where it has a
   bespoke script.
2. Read every entry's Japanese `q`/`a` text against the card's printed effect
   text and (where a script exists) the actual implementation, in order,
   without skipping.
3. Spot-verified the engine's generic effect parser (`parseEffectSegments`,
   `queueTriggersFor`/`emitGameEvent` in `src/state.js`) against several of the
   most common recurring Q&A patterns in this slice (see below) to confirm the
   generic (non-bespoke) path already produces the ruled behavior, rather than
   assuming correctness.

## What this slice's rulings turned out to be

The 667 entries in this range are dominated by a fairly small set of
recurring generic-rules patterns repeated across many different cards
(the official FAQ restates the same generic ruling for every card the rule
could apply to). None of these are card-specific implementation risks once
verified against the generic engine once; they were still checked
individually per entry, but not re-derived from scratch each time. The
recurring categories seen in this slice:

- "～なら" (if) 조건을 만족 못해도 "그 후" 이후 처리는 계속되는가 → 예.
  Verified against `src/state.js`'s `seq()`/segment-continuation handling
  (e.g. BT20-019 in `src/cards/shard37.js:153-156`, whose `seq()` array keeps
  the conditional clause and the unconditional "자신의 디지몬 1마리로 어택할 수
  있다" clause as separate steps) — matches ruling id 4717.
- "ことで" (cost/by-doing) 조건을 만족 못하면 그 후 처리 전부 불가 → 이 프로젝트의
  `handPlayOption`/cost-gate style helpers already abort the whole chain when
  the optional cost isn't paid.
- 「효과를 받지 않는다」("does not receive effects") semantics — can still be
  targeted, can still be granted keywords, loses/regains effect immunity
  dynamically, blocks future triggers while immune — this is generic engine
  behavior (`replGate`/effect-application checks), not per-card.
  Repeated verbatim for ~15 different ACE/EX cards in this slice.
  (BT20-102, EX9-021, EX10-010, BT23-059, etc.)
- 앞면 시큐리티(표면 세큐리티) 관련 일반 규칙 5종 세트 (0장일 때도 조건 만족,
  공개된 채로 유지, 체크해도 공개 유지, 【시큐리티】 효과 유발, 셔플 시 뒷면으로 복귀)
  — repeated for ~10 different "이 카드를 시큐리티 아래에 앞면으로 놓는다"
  cards (P-181, BT22-100, EX10-012/020/035/057, BT23-015, BT23-034, ...).
- 시큐리티 체크 시 【시큐리티】/체크했을 때/줄었을 때 동시 유발 순서 — 항상
  "【시큐리티】 효과 우선, 이후 턴 플레이어부터" — generic priority rule, not
  per-card.
- 「기술이 있는 카드」("card with the reference") 정의 — pure rules-glossary
  entry, repeated verbatim for ~15 cards.
- 「그 후」/링크 관련: 링크 카드 자신을 파기해도 링크 효과 발동 가능, ≪링크+X≫로
  여러 장 링크된 상태에서 다른 링크 카드 파기 가능, 〈링크〉 없는 카드는 링크 불가
  — generic link-mechanic rules, verified against the shared link-effect
  helpers used across dozens of EX10/BT22/BT23 cards in this slice.
- 【진화 시】/【등장 시】효과를 발휘하지 않는다 부여 효과의 세부 규칙 (5-Q&A
  set: 정의, 【어택 시】는 별도 발휘 가능, 다른 효과로도 발휘 불가, "ことで"
  조건만 처리 불가, [턴에 N회] 소비 안 함) — repeated for BT22-038, BT23-028,
  BT23-029, BT23-034, BT23-094 with no divergence.
- DP가 0이 되어도 그 효과 처리 도중에는 즉시 소멸하지 않고 룰체크 시점에
  일괄 소멸 — generic rule-check batching, not per-card.
- 진화원/테이머 아래에 카드를 놓는 처리에서 상대 테이머는 그 카드의 진화원
  효과를 얻지 않는다 / 진화원에 놓인 디지몬이 배틀 에어리어를 벗어나는 것으로
  취급 — generic zone-transfer rules.
- "아타크를 종료한다" 효과의 정의 및 효과를 받지 않는 디지몬의 어택도 종료
  가능 — generic timing-change rule.

None of the individually-checked cards in this slice showed a script whose
hard-coded logic contradicted these generic rules (e.g. no card was found
gating an unconditional "그 후" clause on the preceding "~라면" condition, no
card's link-discard helper required the discarded card to be a *different*
link card than itself, etc.).

## Known architectural bug class (NOT touched, per task instructions)

`docs/effect-classification-rules.md` documents a real 유발형 vs 즉시형
misclassification affecting `playLeft()` in `src/cards/shard38.js` for
BT22-075, BT22-081, BT22-082, BT23-023, BT23-032 (all use "벗어날 때"
prospective phrasing but are currently resolved post-hoc via
`state.pending`). Two of these cards' own rulings appear in this slice:

- ruling id 4938 (BT22-075 페이크몬, entry about `〈링크〉`-less cards not being
  linkable) — not about the leave-timing bug itself; no new information.
- ruling ids 5244/5245 (BT23-023 고래몬 "어떤 카드를 등장시킬 수 있는가") and
  5277–5279 (BT23-032 토우몬, same pattern) — again about the *content* of the
  bonus effect (which color/level of card can be fetched), not the timing bug.

These are already on the other agent's list; no new cards from this slice
need to be added to that follow-up.

## Inconclusive items

None. Every entry in the slice resolved to "already correct" with
reasonable confidence after checking against either the generic engine path
(with source-level spot verification) or, when a bespoke script existed, the
actual `src/cards/*.js` code for that card.

## Regression

Ran after the review (no edits made, so this only confirms the shared
codebase — as touched by concurrent sibling agents — is in a runnable state
at the time this agent finished):

- `node scripts/check-syntax.mjs`
- `node scripts/audit-effects.mjs`
- `node scripts/soak.mjs 40`
- `node scripts/test-cpu.mjs`

See the parent session's final report for the actual pass/fail output of
this run (results reflect the repo state at the time of the run, which
includes any concurrent sibling-agent edits made during this review).
