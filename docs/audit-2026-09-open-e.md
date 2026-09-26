# Open items, batch E (2026-09)

Official Q&A (data/rulings/all.json) is authoritative. Regression scripts: `scripts/qa/qa-open-e-repl-resume.mjs`, `scripts/qa/qa-open-e-structural.mjs`.

## 1. Interactive replacement prompts in the browser - fixed and verified in a real browser
- `src/main.js` `scriptedSecurityCheck` (the ≪관통≫ bonus check driven by a scripted "can battle" op through `ctx.securityCheck`): when `S.settleSecurityLoss` returned `'deferred'` (a parked replacement prompt, `pumpReplacementPrompt`) the loop simply left, so the remaining ≪S 어택≫ checks were lost. It now awaits `ctl.onLossResolved` (called by `S.resumeReplacement`) and continues while the result is `'survived'`.
- The normal attack path (`doSecurityStep`, also used by the pierce "체크" button through `runSecurityCheck`) already handled `'deferred'`; it was the BT8-095 (Q4705) code that had never run in a browser.
- Real-browser check (http://localhost:5588, saved decks in localStorage, board crafted via `window.__dbg()`, then driven through `attackFlow` and the real modal buttons):
  1. Normal attack, BT8-012 (≪아머 퍼지≫, ≪S 어택 +1≫) loses check 1: the confirm modal "소멸하려 합니다 ..." appears; "사용한다" -> log "배틀에서 소멸하지 않아 남은 시큐리티 체크(1회)를 계속함", check 2 happens, attacker stays.
  2. Scripted ≪관통≫ (EX12-052 【카운터】 scripted battle, attacker with ≪아머 퍼지≫ + ≪S 어택 +1≫): the bonus check loses, the prompt parks; "사용한다" resumes and the 2nd check happens, "사용하지 않는다" deletes the attacker with no further check.
- Headless mirror of the loops: `qa-open-e-repl-resume.mjs`.

## 2. Structural leftovers
| Item | Result |
|---|---|
| EX9-031 Q4079 (face-down above a face-up source) | Not remodelled. Face-down sources are one contiguous bottom block (`stack.s5fd`, `S.fdCount`) used by ~60 call sites. What the ruling asks (trash the lowest FACE-DOWN source, ignoring face-up ones) is what the engine does already (`trashEvoSources(..., 'bottom')` takes index 0..fd-1); only the physical interleaving (face-down cards above a face-up one) is not represented, which has no rules consequence for face-down cards (no card information, lend no effects). Regression test added (`4079`). |
| 네가몬 totals (EX9-005/054/055/057) | Fixed: `digsR` = battle area + raising-area Digimon; used by EX9-005, EX9-054, EX9-055 (shard5/shard13), EX9-057 (shard42). Test `nega`. |
| BT22-076 self target | Fixed (`shard6.js`): the printed text says "이 디지몬의 DP 이하의 디지몬", no "이 디지몬 이외", so it may target itself. Test `bt22076`. |
| BT22-092 memory +1 (Q4252) | The grant already came after `runScript`, but the CPU driver defers the attack declaration. `S.declareAttack` accepts `opts.onDeclared`; the script wraps `ctx.startAttack` so the +1 is given at declaration (`onAborted` if the CPU cannot declare). Drivers that declare synchronously (browser, headless libs) keep "after the effect". `cpusim` ctx gets `deferredAtk: true`. Test `4252`. |
| RB1-005 「A와 B 1장씩」 with one card fitting both (Q3420) | Fixed in `effects.js` `pickByGroups`: a card that fits several remaining criteria is also offered for the current slot even when that leaves another slot unfillable (maximal outcome listed first so defaults/CPU take it). Taking only the both-criteria card is then possible, the other card returns to the deck bottom. Test `3420`. |
| Q1446 original-DP override on a DP-less card | Fixed correctly this time: `state.js` `dpOverrideOf(stack)` - `dpBaseOverride` applies only if the top card has a printed DP or the stack is currently a Tamer treated as a Digimon (`s2AsDigimon`, whose "DP N으로 취급" is stored in the same `baseOv`). Used by `effectiveDP` and `stackHasDP`. Test `1446` covers both. |
| P-011 rulings 3460-3462 (ids 4117-4119) | Outdated: they describe the old text (trash the top 2 / 6 cards of the deck, +2000/+4000 DP). The current card text in data/cards_full.json is the 트래시 -> 덱 아래 3장 + ≪1 드로우≫ wording that the newer rulings 3463-3465 (ids 4120-4122) test; that is what is implemented. Nothing to change. |

## Verification
check-syntax, audit-effects (100%), soak 30 (0 errors), test-cpu (OK) and all `scripts/qa/qa-*.mjs` were run after the edits.
