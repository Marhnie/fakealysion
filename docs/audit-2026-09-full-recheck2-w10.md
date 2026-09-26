# Q&A 전수 재점검 2차 — Wave 10 (idx 6003–6672, ids 6800–7482)

670 entries reviewed (all read; boilerplate FAQ groups checked once per mechanism, card-specific rulings checked per card with headless probes; ~208 cards, 468 segments smoke-run without errors).

## Bugs found and fixed
| Card / ruling | Change |
|---|---|
| EX13-026 (6474) | card placed face-down under the 세이버즈 tamer must also be a specified card (`shard130.js`) |
| EX12-059 / BT26-029 / BT26-085 (6062, 6187) | 「겹쳐진 카드는 파기되지 않는다」 now blocks 《퇴화》/source discard (`srcTrash` shield; EX12-059's clause was only a manual note; compiler pattern in `effects.js`) |
| EX13-020 (6450) | 「트래시의 색 1색마다」 counts both trashes |
| EX13-071 (6637) | face-down cards are discarded first; discarded cards may go under 쿠다몬 |
| BT26-085 assembly (6400) | Lv.- (level 0) cards can't fill 「Lv.이 서로 다른」 slots (`state.js`) |
| BT26-086 (6325) | 링크 카드 ≥7 (was ==7) |
| BT24-102 (6137) | borrowed 【등장 시】/【진화 시】 includes 《계승》-gained effects (`shard7.js`) |
| BT26-097 (6364) | 「さらに」 host is any own 유피테르몬 (`shard8.js` hostPred) |
| Leave-replacement family (6197, 6265, 6391…, ~15 cards) | one activation now covers every stack of the same cause meeting the trigger (`state.js` grpSnap/grpCovered; headless and interactive paths) |
| 「배틀할 수 있다」 (6047, 6208…) | effect-immune digimon can be picked and battled (`effects.js` wrapChoose) |
| P-240 grant (6128) | granted forced attack doesn't trigger if target is immune at timing |
| EX13-035 (6505/6506) | cost (10 cards, +6) now first; 2-card / sum-cap enforced (`shard151.js`) |
| EX12-060 | dropped 「등장 코스트 ≤ 진화원 장수」 bound restored (`shard151.js`) |
| BT26-079 (6302) | [트래시]【메인】 was compiled into a stray S-attack grant; now plays itself at -4 with assembly |
| P-239, P-241 (6130), P-242 (6131) | were manual-only; implemented (`shard151.js`, `shard6.js`, `shard8.js`) |

New shard `src/cards/shard151.js` (registered in `index.js`; a placeholder `shard150.js` exists because another agent's import referenced it).
Regression: `scripts/qa/qa-w10-a.mjs` (13), `scripts/qa/qa-w10-b.mjs` (5).

## Unresolved
- P-245, P-248, P-249, P-250: no card data in repo (rulings 6669–6672 unverifiable).
- Pre-existing/unrelated qa failures: qa-audit-g5-t1b3 (BT21-061), qa-slice2-r2-m (BT8-105), qa-slice6-a/r2-a/r2-b (`plainTamer` helper; card data now has text for every tamer).
- AD1-005 [카운터] compiles a stray S-attack grant from its keyword line (outside range, not fixed).
- UI still prompts each simultaneous leaving stack separately (later prompts are covered without paying).

Checks: check-syntax OK, audit-effects 100%, soak 30 → 0 errors.
