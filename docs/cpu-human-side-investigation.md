# CPU battle: "cards I never played get played, their effects fire, prompts appear" (investigation)

Report: in CPU battles, cards the human never played appear/act and choice prompts show up.

## Method
`scripts/qa/qa-cpu-human-side-decider.mjs` (new, in the qa suite) drives the real engine through `src/cpusim.js` with the exact UI ownership rule
(`Cpu.deciderFor` + effect owner as `pendingOwner`, the same call `ctxChoose` in main.js makes) and records every prompt whose decider is not the owner
of the resolving effect (new optional hook `hooks.decide` in cpusim.js), every p1 effect that resolves while p1 is passive and every p1 card that
arrives during the CPU's turn. Modes: default = both seats CPU on random decks (census, 800 games), `--passive` = p1 passive human vs CPU.
The browser-driven pass by the coordinator (all uiChoices owned by the CPU when the human only passes) is consistent with this: the bugs below need
specific cards.

## Real bugs found and fixed (effect user's decision routed to the OTHER seat)
`deciderFor` falls back to `payload.player`, which for many prompts is the *owner of the shown cards*, not the player using the effect. So:
* CPU effect "상대 디지몬의 진화원을 선택해서 N장 파기" (EX11-016, BT24-074, BT25-028, EX5-025, shard7 `trashSourcesPicked`, shard8 EX12-033 style
  `pickFromRevealed`) -> the HUMAN got "…의 진화원에서 파기할 카드 선택" for the CPU's card; in the reverse case the CPU silently chose for the human's effect.
* Opponent-deck reveals ("자신/상대의 덱 위에서부터 5장 오픈", BT18-068 와이즈몬 …) -> every pick / 덱 위·아래 choice / ordering of `revealTop` was asked
  from the deck owner.
* `orderCards` (3-1-3-4: the player behind the effect orders) and `pickSourcesMulti` with a foreign `player`.
* `deciderFor` heuristic for `pickStack` ("자신의" in the prompt => the stack owner decides) misfired on "DP -3000 (자신의 턴 종료까지)을 줄 디지몬 선택"
  (AD1-017 【시큐리티】 etc.): now `자신의 (다음) 턴` is ignored.

Fix: explicit `payload.decider` (honoured first by `Cpu.deciderFor`); `wrapChoose` (effects.js) stamps it for `orderCards`/`pickSourcesMulti` with a foreign
player and, through `ctx._deciderOverride`, for the whole `revealTop` of an opponent's deck; shard7 `pickFromList`/`trashSourcesPicked` and the two shard8
prompts pass `decider` explicitly. The qa script fails on any of these prompts (`MUST_OWN`) being decided by the other seat.

## Legitimate mechanisms that look like "cards I never played" (unchanged rules)
* 【시큐리티】 effects: when the CPU's attack reveals a security card, Tamers/Digimon/Options with "이 카드를 코스트 없이 등장시킨다" (BT4-097 신나리, BT13-102 한지호,
  BT17-082 서나미 …) enter the human's field, and their 【등장 시】 prompts follow.
* "상대는 본인의 …" effects: the opponent is asked (BT17-075 에오스몬 "패에서 테이머 등장", BT15-074 연체몬/EX6-050 펠레스몬 "패 1장 파기 or 효과를 받는다",
  BT13-102, ST22-14, BT3-102 크래커, BT24-016 …) — the human is rightly the decider.
* Automatic triggers of the human's own earlier cards: 【자신의 턴/메인 페이즈 개시 시】 (BT13-007, BT21-084), 【소멸 시】, 【서로의 턴】/【상대의 턴】 watchers,
  《블래스트 진화》/【카운터】 windows.
* Autosave / undo: reviewed `cpuSyncFromState`, driver epoch reset (`D.stRef`) and `cpuBusy` gating; no replay of CPU actions onto the human found.

## UI clarity (small, non-invasive)
* In vs-CPU games the CPU seat is named `CPU(P2)` in effect banners/logs (`pNm`), no longer a bare "P2".
* New `fxWhyNote`: the banner and every choice modal now say why an effect fired on its own — "🛡 시큐리티 체크로 공개돼 룰에 따라 자동 발동", "⏰ 턴 시작/종료 시
  자동 발동", "💀 소멸 시 자동 발동", and for CPU-owned effects that ask the human: "🤖 CPU 카드의 효과가 당신에게 선택을 요구합니다". The source line
  (📌 owner 「card」【tag】) in the choice modal now also shows without the field-fx setting when playing the CPU.
