# Q&A full recheck 2 - wave 5 (idx 2668-3334, ids 3317-3991, EX2-024 .. LM-003)

Entries reviewed: 667/667 (every entry read; generic/duplicate rulings grouped: reveal-N "add as many as possible", raising-area plays,
option-used timing, 効果を受けない family, face-up security, "ことで" full-cost rules, ends-attack family). Verified by headless probes
and by dumping the generic compiler output of all 285 cards in the slice and comparing with card text.

## Bugs found and fixed (regression scripts in scripts/qa/qa-w5r2-*.mjs)

| Card / ruling | Problem | Fix |
|---|---|---|
| EX2-055 (3347) | hand-play cost option trashed protected sources (BT9-109) / miscounted | shard39: count only trashable sources, run under _fxSrc |
| EX2-064 (3350) | evolving Lv.5 itself could not be destroyed (evolution should fail) | shard39 + main.js `_evoAbort` |
| EX2-070 (3354-3360) | "진화 코스트 3 이하" compiled as 등장 코스트 | effects.js `evoCostMax` |
| EX8-073 | compound "DP+4000 하고, 상대 DP-4000" dropped 2nd part | effects.js compile |
| EX6-028 | Lv. <= security-count cap missing | shard3 script |
| EX6-031 | "디지몬 전부에게 S어택-1" granted to one digimon | effects.js compile (both sides) |
| EX3-024 (3397/3398) | forced attacker choice limited to attack-capable digimon | shard2 `s2_forceOppAttack` |
| EX5-060 (3657-3659) | Lv. cap of played digimon missing | shard3 script (evtSnap level) |
| EX5-062 (3664) | simultaneous plays from one effect triggered watcher N times | `_playBatch` (state.js/effects.js), batchKey on multi-play compile |
| EX3-053 (3422) | evolve lock did not cover active tamer treated as digimon | state.js evolveTargetRestriction |
| EX4-014 (3454) | [턴에 1회] consumed at queue time swallowed 2nd trigger | shard39 resolution-time once |
| EX4-023 (3464) | opened card put in security despite 「금강」 lock | shard39 -> trash |
| EX4-072 | 【시큐리티】 "패로 되돌리고" dropped the trash return | effects.js regex |
| EX3-065 (3430/3431) | tamer rested automatically at evolve time, no confirm | shard39 cost paid at resolution |
| EX4-011 (3448) | could not decline the play after paying destroy | shard39 |
| EX7-014 (3834/3835) | P-143 move to raising not blocked; token play on opponent board wrongly restricted | shard4, state.js (playing player = _fxSrc) |
| EX6-006 (3697) | several copies shared one [턴에 1회] | shard4 |
| EX6-062 | standing 관통/S+3 never applied | shard41 hook |
| general Lv.-less (3589, 3796, 2596...) | "Lv.N 이하"/"가장 Lv.이 낮은" matched Lv.-less digimon, tamers | effects.js matchesFilter + extreme |

## Not fixed / notes
- EX2-056 (3348): grant when the evolution later fails on cost is not reproduced (cost check happens before digivolve).
- EX6-006 (3699): hook play-cost options are not offered for effect-driven plays.
- EX5-013 / EX6-063 / EX8-028: costs remain "manualCost" (player confirms).
- Hook-based [턴에 1회] is consumed at queue time; declining is not refunded (sibling test qa-w2r2-a Q1180 covers this).
- Pre-existing failures unrelated to this slice: qa-audit-g5-t1b3 (BT21-061), qa-slice2-r2-m (Q1784), qa-slice6/w6 `plainTamer` fixtures (card data changed), qa-w2r2-a Q1180.
