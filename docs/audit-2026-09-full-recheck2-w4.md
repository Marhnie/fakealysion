# Q&A recheck 2 - worker 4, idx 2001-2667 (BT16-061 .. EX2-023)

Entries reviewed: 667 (all read). Many are duplicates of one generic ruling (tamer-as-digimon evolution, "can't skip a valid target",
"評価 ことで partial cost", face-up security, option-use cost). ~330 were probed with headless scenarios (scripts/qa/qa-w4-*.mjs);
the remainder were judged against the compiled scripts (scratch dump of every generic compile for the range) and existing suites.

## Bugs found and fixed
- BT16-077 / BT16-102 / BT17-078 family (ids 2015, 2053, 2202): effects.js - a "그 후, ..." tail after an unmet condition was skipped when it contained
  "그 디지몬"/"그 카드" intra-sentence; new thenTailRefsPrev only treats it as a back-reference when it precedes its own noun.
- BT17-098, BT24-093, BT20-084, P-153, BT13-107/BT21-085/BT9-083, BT16-056 (ids 2892, 4958, 1247, 6497 family): shard80/shard3 - a lone card has no
  "겹쳐져 있는 카드"; effects now require a source under the top card.
- BT19-026 (id 2430): Digi-Egg card in battle area counted as Digimon in condition counts / candidate picks (effects.js cat(), candidateStacks).
- BT17-076 (id 2198): "그 디지몬의 DP 이하" when the played digimon already left -> nothing selectable.
- EX1-071 (ids 2609-2615): was a manual note; now real evo-cost option (state.js hookEvoCostOptions + shard80 script), evolving digimon's colour, next evolution only, not breeding area.
- BT19-090 (id 2510): 2nd bullet implemented (both EX6 and Shooting Star must be made active).
- BT18-102 (ids 2405/2408): cards placed under security are player-ordered.
- BT17-097 + 3 trash-evolve saves (id 2241): only the one evolved digimon is saved (noGroup).
- BT18-069 (id 2359): effect-immune digimon can be picked and must attack.
- BT2-099 (ids 2132/2133): its own hand-cost lowering now feeds optionBaseCost (EX2-003/019/021, BT17-031/038 trigger by resulting cost).
- 디·리퍼 trait (D_REAPER form column) folded into traits: BT19-100 (2527-2529), EX2-007 discount, shard19 mother handling of Digi-Egg.
- EX2-007 (2629/2630): Digi-Egg with DP is a legal attack target.

## Unresolved
- EX2-007 (2631-2632, 2635): generic "destroy/return own digimon" pickers still exclude a battle-area Digi-Egg (effects.js category==='digimon' in the destroy/bounce
  base set) and the digi-egg-deck-bottom redirect on hand/deck/security moves is not exercised. Needs a broader digitama-as-digimon pass.
- "must pick a valid target / can't decline" rulings are UI-level (required prompts) and were not headlessly provable.

Regression scripts: qa-w4-a..h, qa-w4-under, qa-w4-ex1071 (all pass); qa-topcard-audit BT13-058 case updated to the lone-card rule.
check-syntax OK, audit-effects 100%, soak 30: 0 errors.
