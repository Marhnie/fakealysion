# Q&A re-verification — wave 8, idx 4669-5335 (ids 5401-6084)

667 entries / 266 cards, all considered (grouped by ruling text; ~570 already covered by scripts/qa/qa-slice5-*.mjs, which all still pass; the rest checked with new probes).
Method: gap list of ruling groups without a regression, probes on the real engine, plus structural scans (missing optionUsed emission, duplicate triggers, leave-time immediate abilities without a hook, continuous-tag watchers without a hook, ignoreLevel evolution cost, manualCost hiding non-automation).

## Bugs found and fixed
| Card / ruling | Problem | Fix |
|---|---|---|
| ST22-07, BT16-014, P-027/EX2-060 (Q5449-5518, 5430) | free option use (from tamer / by effect) never emitted optionUsed, so "옵션 카드를 사용했을 때" holders did not trigger | emit in shard6/shard3/shard1 |
| BT24-045 (Q5583/5635) | hardcoded hook + generic preamble = drew twice per discard | removed hardcoded hook (shard7) |
| EX11-074 etc. (Q5959) | scripted battle by a non-attacking digimon granted the 관통 bonus check | state.consumePierceCheck requires own attack (or queued effect attack, marker in cpusim); pierce test 1 rewritten |
| BT24-102 (Q6029, 5721) | borrowed 등장/진화 시 ignored exhausted [턴에 N회] and 진화 시 suppression | filters + spends limit in runSegmentOf (shard7) |
| AD1-008 via BT12-089 (Q6066), BT24-025 (Q5604) | "Lv.을 무시" evolution always paid normal-line cost | ignoreLevel passed to condition check (shard2 evoInfo, shard7 evoCheck) |
| EX11-027 (Q5823) | link card moved under sources did not fire "진화원이 늘어났을 때" | emit sourcesAdded |
| BT24-065 (Q5644-5646) | leave-time 「디아블로몬」 play never wired | passive candidate hook (shard38) |
| BT24-078 (Q5656-5658) | evolution cost was a manualCost: security discarded without evolving | bespoke script (shard38) |
| BT24-060, BT20-071, BT18-065, BT21-058 | tamer-under-sources / 벰몬-to-deck watchers unwired | hooks (shard38) |

Found by scanning, outside the range (please dedupe if siblings also wire them): EX10-031, EX13-015, BT26-055 (inh), BT14-020 (inh), EX9-032 (inh) leave-time hooks; BT22-035, EX10-016, BT23-022, BT26-086, P-217 link watchers; BT19-075 delete watcher.

Regression scripts: scripts/qa/qa-w8-*.mjs (optuse-free, hand-discard-draw, bt24102-borrow, bt12089-evocost, ex11027-linksrc, bt24065-leave, leave-immediate-gaps, bt24078-trash-evo, watcher-gaps) + updated qa-pierce-scripted-battle.mjs.

## Unresolved / notes
- BT24-098 Delay (Q5710): event-triggered path refuses to offer the discard when the bullet's leading condition fails; ruling allows the discard without effect (manual 🗑 button still works). Left as is.
- EX11-038 and similar manualCost effects remain manual (player confirms).
- Working-tree failures not caused by this wave (verified by reverting my files): qa-slice6-a (G22,G28), slice6-r2-a (G114), slice6-r2-b (G76), audit-g5-t1b3 Q4, w2r2-a Q1180; qa-slice2-r2-m fails at HEAD too.
- Many continuous-tag watchers (older digiburst-related ones) flagged by the scan were not individually verified.

Checks: check-syntax OK, audit-effects 100.0%, soak 30 games 0 errors.
