# Full Q&A re-check — wave 6

Scope: `data/rulings/all.json` array indices **3336–4002 inclusive** (667 entries, ruling ids 3993–4708), the 6th of 10 parallel slices covering the full 6673-entry official rulings database.

Sub-agent spawning was attempted (per the task's option 6) but the environment's concurrent-subagent budget was saturated by the other 9 parallel wave agents for the entire session (`Concurrent subagent limit reached` on every attempt, at the start and again after significant work had been done). Per the tool's own guidance ("do not retry"), the full 667-entry review was done directly, single-threaded, with heavy use of batch node scripts to triage and dump candidate entries for fast reading.

## Method

1. Resolved every entry's card id(s) against `data/cards_full.json` (keyed by id) and pulled `effectKo`/`inheritedKo`.
2. Cross-referenced each card id against `src/cards/*.js` via substring search to see whether a dedicated script/HOOKS entry exists.
3. **216 / 667** entries matched a card with no script hit at all in `src/cards/*.js`. Sampled ~15 of these by hand (spread across the range): all were generic rules clarifications already covered by core engine mechanics that don't need a per-card script — public trash information, "possible한 만큼 반드시" mandatory sub-effects, simultaneous-trigger ordering (player picks order), evolution-condition/버스트진화/조그레스 enforcement on effect-evolution, exact-vs-substring name matching (already correctly split between `cardNameIs`/`cardNameHas`), and the already-fixed X항체 named-card-vs-trait-only distinction (covered by existing `scripts/qa/qa-slice4-f.mjs` tests for Q4246/Q4259). No discrepancies found in the sample.
4. **451 / 667** entries matched a card with at least one implementation hit. All 451 were read in full and triaged; every entry that described a non-obvious interaction (numeric multipliers, mandatory-vs-optional sub-steps, target-locking vs continuous re-evaluation, timing of continuous DP/keyword thresholds, name-exact-vs-trait checks, "그 후" continuation independent of a preceding condition, raising-area evolution trigger suppression, self-referential hook timing, retreat-immunity mid-peel) was cross-checked against the actual `src/cards/*.js` / `src/state.js` implementation, and for several I wrote throwaway verification scripts under `scratch/tmp/` (not committed) to confirm behavior empirically rather than by inspection alone.

## Bug found and fixed

### P-033 (샌드리자몬) — inherited 《시큐리티 어택 +1》 never granted (rid 4146, idx 153)

- **Card text**: own effect — "【자신의 턴】 블랙인 DP 13000 이상의 자신의 디지몬 전부는 《관통》을 얻는다." (already correctly implemented, live-evaluated, via a `grantKw` HOOKS entry in `src/cards/shard64.js:94-102`, citing "official Q&A 4145"). Inherited (evolution-source) effect — "【자신의 턴】 블랙인 DP 13000 이상인 동안, 이 디지몬은 《시큐리티 어택 +1》을 얻는다." had **no implementation at all**.
- **Root cause**: the generic continuous-grant parser (`parseContGrants`/`contGrantCond` in `src/state.js`) only recognizes bare conditions like "DP N 이상의 이 디지몬은" or a bare color/name/trait clause — it doesn't parse a **combined** "<색>인 DP N 이상인" condition. Traced the regex fallback at the end of `contGrantCond` (state.js ~6032-6039): after stripping known clause shapes, "블랙인 DP 13000 이상인" still has leftover text, so the function returns `null` and `parseContGrants` silently drops the whole grant. Confirmed by tracing through `genericContGrants` → `s7ContSAttack` (state.js ~6176-6190), the actual consumer of this parse path.
- **Fix**: `src/cards/shard64.js` — added a second `HOOKS['P-033']` entry (`src: 'inheritedKo'`, tag `'자신의 턴'`) using the `kwNum` hook mechanism (same pattern used elsewhere, e.g. P-016's `kwNum` in the same file) to grant `+1` 시큐리티어택 live whenever the holder is black and DP ≥ 13000, mirroring the already-correct own-effect `grantKw` entry immediately above it.
- **Verification**: `scripts/qa/qa-slice4-f.mjs` already contained a scenario for this exact ruling (`add(4146, 'P-033', ...)`, added by a prior audit pass but apparently never actually fixed) using `S.securityAttackBonus(bk)`. Before the fix this assertion was failing (confirmed via a manual before/after trace: with a clean DP-12000 black host and P-033 as its evolution source, `securityAttackBonus` returned `0` both under and over the 13000 threshold; after the fix it correctly returns `0`→`1` at the threshold crossing). `node scripts/qa/qa-slice4-f.mjs` now reports `pass 12 fail 0`.
- **File:line**: `src/cards/shard64.js:103-114` (new block, right after the existing P-033 own-effect hook).

No other bugs were found in this slice's 451 implemented entries.

## Deep dives that turned out to be already correct (no fix needed)

Documenting these since they took real investigation and future auditors of adjacent slices may hit the same card families:

- **BT21-061 (idx 542, rid 4568)** — "테이머 색 2색마다 《퇴화 1》" repeated via a single `S.retreat(state, o, uid, n)` call (same pattern used in 7 other call sites: shard2.js:1018, shard3.js:989/1047, shard4.js:801, shard5.js:307/1007/1033, shard11.js:551). The ruling says repeating 퇴화1 N times must let an intermediate top-card's own immunity (e.g. BT15-047 캅테리몬's "레스트 상태인 이 디지몬은 상대의 효과를 받지 않는다") stop the *rest* of the peel once it becomes the exposed top card — i.e. it must NOT behave like one combined 퇴화N. Traced `S.retreat()` (state.js:4911-4943): it already re-checks `effectBlocked(state, p, stack, 'retreat')` **per stage, using the live (already-mutated) `stack.cardId`** (the "16-12-8" comment on line 4918), so a single `retreat(...,2)` call is NOT equivalent to a real batched retreat — it already gets the correct sequential-immunity-check semantics. Verified empirically with a throwaway script: a suspended BT15-047 exposed after 1 stage correctly stops a `retreat(...,2)` call at `trashed=[originalTop]` only, matching the ruling exactly. **No bug** — the shared `retreat()` helper's per-stage recheck already covers this for all 8 call sites.
- **BT20-018 (idx 304, rid 4300)** — evolving a raising-area Digimon via this card's own effect must NOT trigger the evolved card's own 【진화 시】. Confirmed by an explicit comment + implemented gate in `S.digivolve()` (state.js:3874-3878, citing official Q&A BT1-007/Q870) that only fires triggers for raising-area evolutions when a segment is `[육성]`-tagged.
- **P-052 (idx 176, rid 4169) vs LM-006 (idx 3, rid 3996)** — two visually similar "no-evolution-source enemy can't attack" effects that are implemented with opposite (and both correct) semantics: P-052 selects concrete targets and applies a persistent flag to those specific stacks (`setFlag(st,'noAttack',...)` in shard1.js:822-832, matching "그 시점에 대상이 된 디지몬은 이후 조건을 벗어나도 계속 적용"); LM-006's card text instead says "진화원을 갖지 않은 상대의 디지몬 **전부**", a continuous filter re-evaluated every attack (matching "조건에서 벗어난 디지몬은 즉시 대상에서 벗어난다"). Both match their respective ruling.
- **BT20-050/052/055 (idx 370/375/382 family)** — "뒷면의 시큐리티를 위에서부터 1장 앞면으로" when the top card is already face-up must flip the **next hidden** card, not blindly index 0. `S.secFlipTopFaceUp` (state.js:5771-5783) already does this correctly (cites Q5789/EX11-043).
- **P-024 (idx 141, rid 4134)** — "「아구몬」" exact-name check must not match "토이아구몬"/"아구몬 박사"/"부시아구몬" (name-includes-substring but not exact). `cardNameIs` (state.js:1608) does exact array-membership, not substring — already correct, and P-024's script (shard10.js:110) uses `nameIs('아구몬')` correctly.
- **BT3-056 (idx 661, rid 4703)** — this card's own 【자신의 턴】 ability (letting its own 《흡수진화》 target the opponent) cannot retroactively apply to the 흡수진화 currently paying for evolving INTO this same card, because at that moment it isn't yet the top card. Confirmed: the HOOKS entry (shard1.js:1267) is registered with default `src: 'effectKo'` (own-card-only), so `activeHooks` only surfaces it once BT3-056 is already the active top card — matches the ruling by construction.
- Several "BT20-013/EX8-074/etc." Q&As about an opponent's static "코스트를 마이너스할 수 없다"/"효과로 등장할 수 없다" blocking a card's own optional cost-discount sub-action while still letting the optional action itself execute — spot-checked and consistent with the existing cost/board-restriction hook layering; no dedicated fix needed.

## 즉시형/유발형 (immediate-vs-triggered) classification

Per `docs/effect-classification-rules.md`, kept an eye out for the specific "~벗어날 때, [보너스 효과]" pattern implemented via `state.pending`/`queueTriggersFor` instead of the interrupt-before-event replacement path. **None of the flagged family (BT22-075/081/082, BT23-023/032, `shard38.js`'s `playLeft()`) appear in this slice's card range**, and no *new* instances of that misclassification pattern were found among the 667 entries reviewed. Nothing to add to that follow-up list from this slice.

## Inconclusive / needs a human look

None. Every entry that looked ambiguous on first read was resolved one way or the other by tracing the actual code path (see "Deep dives" above); no case was left unresolved.

## Regression suite (run after the fix)

- `node scripts/check-syntax.mjs` → `syntax OK (154 files)`
- `node scripts/audit-effects.mjs` → `coveragePct: "100.0%"`, `uncoveredCount: 0`
- `node scripts/soak.mjs 40` → `games 40 turns 706 actions 2216`, `distinct errors: 0`
- `node scripts/test-cpu.mjs` → `RESULT: OK`, `distinct errors: 0` across all 6 matchups
- `node scripts/qa/qa-slice4-f.mjs` (pre-existing suite covering the fixed card) → `pass 12 fail 0`

## Summary

- Entries reviewed: **667 / 667** (100% of the assigned slice)
- Already correct / no script needed: 216
- Already correct with dedicated implementation (including several that needed real tracing to confirm): 450
- Real bugs found and fixed: **1** (P-033 inherited 시큐리티어택+1, `src/cards/shard64.js`)
- 즉시형/유발형 instances flagged for the other agent: 0 (none found in-slice)
- Inconclusive: 0
