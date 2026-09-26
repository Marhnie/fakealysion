# Q&A re-verification (recheck 2, wave 7) — rulings idx 4002-4668 (ids 4708-5400)

Scope: `data/rulings/all.json` entries idx 4002..4668 (667 entries, 314 distinct cards: BT16-069 ... P-208, mostly EX9/EX10/BT22/BT23 plus the generic "definition" rulings).
Regression script: `scripts/qa/qa-w7r2-a.mjs` (45 scenarios, all pass). Run: `node scripts/qa/qa-w7r2-a.mjs < /dev/null`.

## Method

* Every entry was read; entries were grouped by identical wording (e.g. the ~30 "「記述があるカード」" definitions, the 5x "手札から破棄してもコスト0で登場", the 4x "効果を受けない" set) and each *group* was checked against the implementing code.
* For each card with a hardcoded script (src/cards/shard*.js) the script was read against the ruling; generic (text-compiled) cards were probed with headless scenarios (lib-s4 `runEffect` / `drain`).
* Unusual/older shards were targeted first (shard2/4/5/6/8/12/13/37), then cross-cutting engine rules: effect-immunity (targeting vs. affecting), raising-area plays, "어택 중이라면", 자신/상대 트래시 택일, digicross/assembly for effect plays, evolve-cost stacking, 【등장 시】 suppression, and cards that `scripts/scan-manual.mjs` still lists as manual.

## Bugs found and fixed (real contradictions with a ruling)

| # | Card(s) | Ruling ids | What was wrong -> fix |
|---|---|---|---|
| 1 | BT17-077 インペリアルドラモン:パラディンモード | 4005 | 「자신/상대의 트래시」 ("/" = OR) sent BOTH trashes to the deck bottom. Now the player picks ONE trash (multipleChoice) and only that trash returns; the white Lv.7 -> memory +3 check reads the returned trash only. (`shard12.js`) |
| 2 | BT20-018 オウリュウモン | 4010 (family 4009/4015/4018) | 「어택 중이라면」 required `attackCtx.attacker === self`; the opponent's attack (ruling: satisfied) failed. Any attack in progress now counts. (`shard12.js`) |
| 3 | BT20-015 / BT20-053 ヒシャリュウモン / グレイドモン | 4488/4489/4492 (BT9-033, BT9-047, BT14-009) | Their "육성 에어리어에 등장" wrote `pl.raising` directly and ignored the "효과로 디지몬을 등장시킬 수 없다" field lock. Both now use `S.playFreeToRaising` (lock, DP restriction, effect-play flags). (`shard13.js`, `shard37.js`) |
| 4 | BT11-088 バグラモン, BT12-083 アレスタードラモン:スペリオルモード, BT11-109 (shared op `s2_moveUnder`) | 4278, 4490, 4491 | (a) an opponent digimon could be put under an effect-immune opponent digimon/tamer; (b) the moved digimon's own evolution sources were carried along instead of being trashed at the same time. Both fixed in `s2_moveUnder`/`moveStackUnder` (`shard2.js`). |
| 5 | BT18-034 ルーチェモン (EX6-018 / EX10-013 same family) | 4282, 4285, 4324 | The trash -> 「루체몬: 폴다운 모드」 evolution ignored the evolution condition (BT7-111 has none; its "hand only" text does not apply from the trash). `ignoreCond` removed in BT18-034 and EX10-013; BT18-082 (which has a printed 〔진화〕) still works. (`shard4.js`, `shard6.js`) |
| 6 | BT22-024 マリンブルモン, BT22-036 シャペロモン, EX10-032 プロガノモン, BT23-065 ファントモン (shared `handEvolveMain`) | 4168, 4174, 4374, 4611 | The fixed evolve cost 3 did not combine with the subject's own evolve-cost reduction (산호몬/슈몬/샌드리자몬/아이고스몬 -1 -> pays 2). Continuous + hook discounts are now applied. (`shard6.js`) |
| 7 | shard6 `evolveEffect` (BT22-049/070/090/101/102, BT23-040, EX10-042 ... "코스트를 지불하고 진화") | 4476-4479, 4176 family | Effect evolutions with a paid cost ignored the digimon's own/continuous evolve-cost reductions (P-202 -1, 肉 -2 stacking etc.). Same adjustment as `effects.js` `evolveEffect` added for non-free modes. (`shard6.js`) |
| 8 | BT21-021 オメガシャウトモン (shard5 `playDiscounted`) | 4021 | Effect plays with a paid cost never offered DigiXros (the ruling: the effect's own digimon can be a material and leaves before its self-delete), nor lowered the cost by the DigiXros amount. `playDiscounted` now offers DigiXros and applies `per x materials`. (`shard5.js`) |
| 9 | P-205 狂気の合成魔獣 (+ every paid effect-play: `s8_playOrUse`, `playDiscounted`) | 4483, 4665 | 《어셈블리》 could not be declared for an effect-driven play, and DigiXros did not reduce the paid cost in `s8_playOrUse`. Added `S.planAssemblyFor`, `xrosOptsFor(..., paidPlay)` (offers assembly, returns `assembly`/`asmDiscount`), `playFreeFromZone` places assembly materials, and both paid-play paths subtract the DigiXros/assembly discount. (`state.js`, `effects.js`, `shard8.js`, `shard5.js`) |
| 10 | EX9-073 ムゲンドラモン (`runSegmentsOf`, also BT23-060/BT23-101 style borrowing) | 4135 | While 「【등장 시】 효과는 발휘하지 않는다」 (BT20-037) is active, the placed card's 【등장 시】 was still run as "this digimon's effect". New `S.playTrigSuppressed`; the borrowed 【등장 시】 is now skipped. (`state.js`, `shard6.js`) |
| 11 | EX9-005 ネガーモン, EX9-055 アバドモン | 4038, 4104 | Face-down evolution sources were counted as 「네가몬」 (face-down cards carry no name; EX9-054/057 already skipped them). Fixed for consistency. (`shard5.js`) |
| 12 | BT22-092 ジミィKEN | 4251-4253 | Only the top card's own 【메인】 was offered; a 【메인】 the digimon has from an evolution source (inherited, e.g. 테리어몬) was missed, and a borrowed [턴에 1회] 【메인】 did not consume that digimon's once-per-turn. Now both own and inherited 【메인】 are offered and the once-limit is marked/respected. (`shard6.js`) |
| 13 | EX9-069 アナログの少年 | 4123, 4268 | The 【자신의 턴】 "진화원에 뒷면의 카드가 놓였을 때" trigger was left manual by the generic watcher (conditional tail). Marked trusted + bespoke script (rest tamer, memory +1, draw if hand <= 7); the raising-area exclusion (4123) already comes from `emitGameEvent`. (`shard5.js`) |
| 14 | P-179 ジャスティモン:クリティカルアーム, EX10-054 ベノムミミックモン系(베놈묘티스몬), EX10-058 リリスモン | 4141, 4443 | Listed as manual by `scan-manual.mjs` (manual cost / no watcher). Implemented: P-179 【진화 시】 (device option -> battle area, DP +3000), EX10-054 [트래시]【메인】 (delete own 「묘티스몬」 Lv.5, pay cost-7), EX10-058 【서로의 턴】 (discard 2 own sources, play purple Lv.4- from the trash). (`shard6.js`) |
| 15 | EX9-006 パグモン | 4042 | The trash-evolution candidate check ran before the face-down source was discarded, so the effect refused to activate when the discarded card itself was the only Ver.5 target. (`shard5.js`) |

## Rulings verified as already correct (spot list)

`BT16-069/BT17-101/BT17-102/BT19-020/BT20-019/BT20-102/BT21-061/BT21-078/BT22-063/BT22-077/BT23-033/EX10-049` ("~なら" fails -> later sentences still run; probes confirm the engine queues/compiles the split correctly), `EX8-037` (mandatory activate after a free option), `EX9-017/018/025/029/037/038/039/042/053` (spread / single-target / independence), `BT22-007` (top-deck look, 10+ sources, 3 mothers), `BT22-015/BT22-031/BT22-047...` ("Lv.の同じカード" counts the whole stack), `BT22-038/BT23-028/029/034/094` ("【진화 시】 효과는 발휘하지 않는다": attack timing still works, [턴 1회] not consumed), `BT23-024` (dynamic highest-cost rest lock), `BT23-014` (trash-play lock uses the effect controller), `BT23-069/071/BT22-074/EX10-009` ("消滅しなかったなら" with immune/none targets), `BT23-070` (rested attacker with noRest), `EX10-019/023` (rest + skip-unsuspend, active-phase lock includes turn-start effects), face-up security rules (`EX9-072`, `P-181`, `BT22-100`, ... shuffle turns them face-down), `BT22-093` (2nd tamer cannot fire after the 1st evolved it), `BT22-090/101` (tamer evolution keeps the evolution condition), area-colour options (`qa-area-color-raising.mjs`, 22 options).

## Not fixed / notes

* **EX9-031 Q4079** (face-down sources "top FD, FD, face-up" order): the engine models face-down sources as one contiguous bottom block (`s5fd`), so a face-down card *above* a face-up one cannot be represented. Structural; not changed.
* **Raising-area digimon sources** are not counted by 「자신의 트래시와 디지몬의 진화원에 있는 「네가몬」」 (EX9-005/054/055/057); rulings do not address it, left as is.
* **BT22-076 신퍼펫몬**: the engine excludes the digimon itself from "이 디지몬의 DP 이하의 디지몬 1마리" targets; no ruling, left as is.
* **BT22-092** memory +1 is granted immediately after the borrowed effect starts, not after the borrowed effect (attack declaration) resolves (Q4252 ordering nuance).
* Timing-only rulings (肉 ≪딜레이≫ cannot be declared mid-attack Q4035/4036/4043, "어택 중 새 어택 불가" Q4022/4506, BT20-052/055 turn-end security loss Q4013/4016) are enforced by the UI/attack flow (`main.js startAttack` guard, `pendingAttack`) rather than card scripts; not re-tested headlessly.
* Existing suite failures seen while regression-running `scripts/qa/*.mjs` that are NOT caused by these edits (they also fail on a clean `git archive HEAD` copy or come from concurrent sibling edits of `data/cards_full.json`/`effects.js`): `qa-slice6-*` (`plainTamer` helper), `qa-slice2-r2-m` Q1784.

## Checks

`node scripts/check-syntax.mjs`, `node scripts/audit-effects.mjs` (100 % coverage), `node scripts/soak.mjs 30` — see the final run at the bottom.
