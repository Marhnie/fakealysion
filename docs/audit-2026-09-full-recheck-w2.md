# Q&A audit — wave 2, slice idx 668-1334 (ids 1283-1972)

This slice was split between one background sub-agent (idx 668-834, ids ~1283-1450) and
direct work by the coordinating agent (idx 835-1334, ids 1457-1970). Only one of four
requested sub-agents could be spawned (concurrent-subagent limit across the 10 parallel
top-level audit waves), so the remaining ~500 entries were reviewed directly instead of
via further sub-delegation.

## Part A — idx 835-1334 (ids 1457-1970), reviewed directly

- **Entries reviewed**: 500
- Of these, 222 entries' cards had an explicit hardcoded script in `src/cards/*.js` and were
  read in full against their ruling text. All 222 were checked individually; the rest (278)
  had no card-specific script (their effects run entirely through the generic text-driven
  engine) — these were skimmed for red flags; the large majority are duplicate/generic
  rulings (e.g. the ~14-times-repeated "Tamer-as-Digimon evolution" ruling set covering
  BT7-011/021/022/023/035/036/046/047/060/061/071/073/112, and the recurring "부분 실행 불가/전부
  실행" 〈で〉-cost rulings) that reflect core engine rules already exercised by many other
  cards and regression suites in this codebase, not card-specific logic.
- **Already correct / no action needed**: 499 of 500 (see the one exception below).

### Bug found and fixed: EX7-061 리리스몬 X항체 — "X항체" treated as a trait instead of a card name

While reviewing the 9 Q&A entries in this slice that repeat the exact same clarification —
BT9-013 (id 1806), BT9-014 (id 1807), BT9-031 (id 1829/1830 — wait, only 1829 has this text),
BT9-040 (id 1834), BT9-041 (id 1835), BT9-043 (id 1836), BT9-044 (id 1837), BT9-055 (id 1850),
BT9-056 (id 1852... actually 1855/1852 range) — all saying, in essence:

> "진화원에 「X」 또는 「X항체」가 있을 때" 의 「X항체」는 **카드 이름**을 가리키며 (구체적으로는
> BT9-109 "X항체" 카드), 특징(trait) "X항체"를 가진 카드가 아닙니다.

I checked whether this exact "card name, not trait" distinction was actually correct in the
codebase, since 238 cards in `data/cards_full.json` carry `X항체` as a **trait** (`types`
array) distinct from the single card literally named `X항체` (`BT9-109`). For every card that
uses the *generic* engine parser for this bare-quoted-name pattern (`이 디지몬의 진화원에
「A」/「B」가 있다면` in `effects.js:3191`, and the analogous `있다면...때` handler in
`state.js`), the name check is already correctly exact-name-only (`cardNames(id)`), matching
the ruling.

However, one card has a **hardcoded** override that gets this wrong:
`src/cards/shard4.js` line ~893, `EX7-061 리리스몬 X항체`'s leave-prevention ability
(`이 디지몬의 진화원에 「리리스몬」/「X항체」가 있다면, 다른 디지몬 1마리를 소멸시키는 것으로,
벗어나지 않는다`):

```js
// before
if (!h.sources.some(id => (isNamed(id, '리리스몬') || hasTrait(id, 'X항체')))) return [];
```

`hasTrait(id, 'X항체')` incorrectly let the barrier trigger whenever ANY evolution source
merely carried the X-Antibody trait (e.g. a `그레이몬 X항체` source), when per the
official ruling pattern it should require a source literally *named* `X항체` (or `리리스몬`).
Fixed to use exact-name matching:

```js
// after
if (!h.sources.some(id => isNamedAny(id, ['리리스몬', 'X항체']))) return [];
```

File: `src/cards/shard4.js:893` (context ~890-908).

While tracing this, I also found and hardened the *dead-for-this-card-but-shared* generic
parser at `src/state.js:4561` (`parseSurviveAbility`'s condition clause for
`이 디지몬의 진화원에 「A」/「B」가 있다면` inside the printed leave-prevention-ability text),
which had the same trait-OR-name bug (`cardNameHas(id, n) || (card(id).types || []).includes(n)`).
It currently has no other caller in the printed data (EX7-061 is the only card matching that
exact regex + hardcoded-override combo, and its hardcoded override in shard4.js takes
precedence), but fixing it removes a landmine for any future card printed with this pattern.
Changed to exact-name matching via `cardNames(id)`, mirroring the already-correct
`effects.js:3191` implementation. File: `src/state.js:4561` (context ~4550-4568).

**Verification**: new QA scenario `scripts/qa/qa-w2-part2-x-antibody-name-vs-trait.mjs`
(2 scenarios) — confirms EX7-061 does NOT survive when its only "X항체"-related source is
trait-only (`BT9-012` 그레이몬 X항체), and DOES survive (sacrificing another Digimon) when a
source is the literal `BT9-109` "X항체" card. Both pass after the fix; the first scenario
failed before it.

### Classification follow-up flagged (NOT fixed — architectural 즉시형/유발형 misclassification, per docs/effect-classification-rules.md)

- **BT7-063 다크나이트몬** (ids 1621/1622/1623 in this slice — Q&As about its 【등장 시】
  effect, which is correctly hardcoded in `src/cards/shard1.js:712`). Its **second** printed
  ability — 【서로의 턴】 "이 디지몬이 소멸할 때, 이 디지몬의 진화원에서 「스컬나이트몬」과
  「데들리액스몬」 1장씩을 코스트를 지불하지 않고 레스트 상태로 등장시킬 수 있다" — uses the
  prospective "소멸**할** 때" phrasing that, per the effect-classification doc, should be
  즉시형 (interrupt before the stack actually leaves, sourcing from its still-alive
  `sources`). There is **no hardcoded override** for this ability anywhere in `src/cards/*.js`
  (confirmed by grep), meaning it falls through to the generic `queueTriggersFor` /
  `state.pending` machinery — the same post-hoc/유발형 treatment the other agent's fix
  (CS 토우몬 / `playLeft()` family) is addressing. By the time this generic pending item
  would resolve, the stack (and its sources) are already gone to the trash. Recommend adding
  BT7-063 to the `playLeft()`-style immediate-interrupt follow-up list.
  - Related interaction: id 1774/1775 (`BT8-097 홍염`) documents an official erratum
    reordering that card's own text to "prevent effect-summons first, THEN destroy DP≤6000
    digimon" specifically because of an interaction with BT7-063's 소멸-time summon. I checked
    `src/cards/shard10.js:409` (`BT8-097::메인`) — it currently does `destroy` then
    `addTimedLock`. I traced the execution model (`deleteStack` is fully synchronous and only
    *queues* pending triggers; nothing drains `state.pending` until the whole script returns)
    and confirmed that, as the engine is architected today, swapping this order would not
    change any observable behavior — the real bug is BT7-063's own misclassification above,
    not BT8-097's op order. No fix applied to BT8-097; re-test this interaction once BT7-063's
    classification is corrected.

### Inconclusive / needs a human look

None found that couldn't be resolved via source-reading — all ambiguous card-matching cases
(e.g. multiple `files` hits for a shared helper like `bondScript` in `shard10.js`) were
resolved by reading the actual script.

## Part B — idx 668-834 (ids ~1283-1450), background sub-agent

A background sub-agent was launched for this range but had not reported back by the time
this document was written. **This section will be filled in when it completes** — the
sub-agent was instructed to write its own findings to
`scratch/tmp/audit-w2-part1.md` and follow the same standing constraints (no commit/push,
re-Read before editing, flag-not-fix for 즉시형/유발형 misclassifications) as this agent.

## Regression (Part A's changes only, run from the coordinating agent)

- `node scripts/check-syntax.mjs` → **syntax OK (154 files)**
- `node scripts/qa/qa-w2-part2-x-antibody-name-vs-trait.mjs` → **2/2 pass**
- `node scripts/audit-effects.mjs` → **100.0% coverage** (8168 segments, 0 uncovered)
- `node scripts/soak.mjs 40` → **0 errors** (40 games, 664 turns, 2168 actions)
- `node scripts/test-cpu.mjs` → **RESULT: OK, 0 errors** across all 6 difficulty matchups

Regression will be re-run once more after Part B's changes are merged in, in case its edits
touch overlapping files.
