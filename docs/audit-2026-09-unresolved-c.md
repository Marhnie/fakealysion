# Unresolved class C: unwired watchers and stray compiled ops (2026-09)

Earlier Q&A audit agents found two engine bug classes (BT6-044, AD1-021, AD1-025, BT25-058/060 fixed; BT11-087, BT24-020, BT26-068, EX9-069 and the "older digiburst watchers" flagged):

* (a) a continuous / 【자신의 턴】 / 【상대의 턴】 / 【서로의 턴】 "~했을 때" watcher whose trigger filter never matches, so the effect never fires;
* (b) a text-compiler mis-parse that turns a keyword line into a stray effect (AD1-005 counter, BT26-079 [트래시]【메인】).

`scripts/qa/scan-unwired-watchers.mjs` now scans every card (effectKo / inheritedKo / option half) and reports untriaged suspects (`--strict` exits 1). Result before the fixes: 24 real (a) suspects + 2 stray-op suspects (AD1-005, BT15-081) + the BT12-083 ruling; after: 0 (43 segments triaged as handled elsewhere, see below).

## How the scan decides

(a) For each segment tagged only with a turn tag whose first sentence contains an event phrase (~했을/되었을/늘어났을/... 때, reminder text and quoted 「【태그】…」 grants ignored):

| class | meaning |
|---|---|
| A1 | no `parseWatcherTrigger`/`parseEventWatcher` parse and no HOOKS descriptor (nothing can ever queue it) |
| A2 | `parseEventWatcher` reads it but `emitGameEvent` drops it as `EW_UNSAFE` (conditional / multi-step text) and no descriptor is `ewTrusted` |
| A3 | watcher fires but the effect sentence compiles empty (manual pending only) |
| A4 | only a card SCRIPT exists, nothing triggers it |
| A5 | HOOKS event descriptor whose `tag`/`has` matches no printed segment, or whose event kind is never emitted |
| A6 | two-clause trigger "A했을 때, 또는 B했을 때": only clause A is parsed, the effect text starts with 또는 |

(b) generic-compiled scripts (no card script) are checked op by op against the words of the printed segment (`grantKeyword` needs its keyword outside trailing keyword lines, `modifyDP` needs "DP", `gainMemory` needs 메모리/코스트, ...).

Triaged as handled by other means (table `HANDLED` in the scan): 11 `《디지버스트》로 이 카드가 파기되었을 때` payoffs (state.js `queueDigiburstTrashed`, verified end to end), 10 inherited `이 카드가 (…의 효과로) 진화원에서 파기되었을 때` (state.js `queueOwnDiscardTriggers`), 22 `《딜레이》` option watchers (main.js `delayBulletPlan`). No hook listens to an event kind that is never emitted, and no event hook has a dead filter.

## Real (a) bugs fixed (src/cards/shard170.js)

| card | printed trigger | why it never fired | fix |
|---|---|---|---|
| BT12-041 | 【자신의 턴】 상대의 디지몬이 DP가 0이 되어 소멸**됐**을 때 | "소멸됐을" spelling not in the watcher regex | 'delete'+dp0 hook, 《1 드로우》 |
| BT14-030 | 【자신의 턴】[턴에 1회] 다른 디지몬이 패로 되돌아갔을 때 | "되돌아갔을" unsupported | 'leaveBattle' hook + `stack._leftTo === 'hand'` (set by the generic bounce ops in effects.js / shard2 / shard3) |
| EX5-025 | 【서로의 턴】 상대의 디지몬의 진화원이 효과로 파기되었을 때 | unsupported subject | 'sourcesTrashed' hook |
| EX7-034 (inh.) | 이 디지몬이 상대의 디지몬에게 어택했을 때 | "상대의 디지몬에게" not parsed | 'attackOnDigimon' hook |
| AD1-016 | 자신의 「최건우」가 등장하거나 레스트했을 때 | "등장하거나 레스트했을" not parsed, no script | 'play'/'rest' hook + destroy script |
| BT26-057 | 어택의 대상이 변경되었거나 자신의 테이머 아래의 카드가 효과로 파기되었을 때 | two-clause | 'redirect' + 'sourcesTrashed' hook |
| BT9-085 | 블루 **또는** 레드인 자신의 디지몬이 액티브 상태가 되었을 때 | colour alternative | 'active'/'unsuspend' hook, rest tamer then bounce Lv.3 |
| BT10-076 | 상대의 디지몬 **또는** 테이머가 등장했을 때 | "또는" subject | 'play' hook |
| RB1-011 (inh.) | 자신의 패가 자신의 효과로 파기되었을 때 | word order | 'discard' hook (own effect) |
| RB1-033 | 「젤리몬」 자신의 디지몬 또는 Lv.5 이상의 상대의 디지몬이 어택했을 때 / 이 테이머가 액티브가 되었을 때 | two unparsed watchers | 'attack' and 'active'/'unsuspend' hooks |
| BT25-065 | 【자신의 턴】 이 디지몬이 플레이어에게 어택했을 때, 메모리 -2 | only its 【서로의 턴】 line was wired (the previous probe was fooled by that other line firing) | 'attackTarget' hook |
| BT24-020 (inh.) | 이 디지몬이 액티브가 되었을 때, 자신의 패가 7장 이하라면 《1 드로우》 | EW_UNSAFE "라면" | `ewTrusted` hook + script |
| BT26-068 | 효과로 상대의 패가 늘어났을 때, 자신의 패를 1장 파기하는 것으로 상대는 … | EW_UNSAFE "하는 것으로"; the generic compile also made the opponent's discard the acting player's own | `ewTrusted` hook + script |
| BT11-087 | 상대의 디지몬이 육성 에어리어에서 이동했을 때 … 「【어택 시】 메모리 -3」의 효과를 준다 | EW_UNSAFE; "그 디지몬" grant compiled to a manual note | `ewTrusted` hook + `s170_grantAtkMem` (grants `s2Granted` to the moved digimon) |
| BT7-016 | 이 디지몬이 블록당했을 때 | script existed in shard31, the "블록당했을" trigger was never wired | 'blocked' hook |
| BT23-059 | 배틀 에어리어의 옵션 카드가 파기되었을 때 | script existed in shard13, never wired | 'delete'/'optionTrashed' hook (option category) |
| BT13-007 (inh., [육성]) | 로얄 나이츠 옵션 카드가 배틀 에어리어에 놓였을 때 | unwired | 'optionPlaced' hook (works in the raising area via the synthetic `~육성i` id) |
| BT15-081 | [트래시]【서로의 턴】 상대의 디지몬/테이머가 효과로 등장했을 때 … 이 카드로 진화 | trash-zone watcher, nothing scanned the trash | `zone:'trash'` hook + `s8_evolve` from trash |
| BT17-099 | 자신의 테이머가 소멸했을 때 **또는** 패로 되돌아갔을 때, 《딜레이》 | clause A queued a garbled "또는 …" text, clause B never wired | hook on both clauses + `s8_delaySelf` |
| BT26-049 | 상대의 디지몬/테이머가 레스트했을 때, **또는** 자신의 테이머 아래의 카드가 효과로 파기되었을 때 | clause B never wired | hook covering both clauses (script in shard14 kept) |
| BT17-037, BT24-021, BT26-066, BT26-069 (inh.) | watcher fired but the sentence compiled empty (manual) | A3 | scripts (`placeSecurity` from trash / `s8_evolve` from trash with cost -1) |

Named cards from the task: BT11-087, BT24-020, BT26-068 were real (fixed above); EX9-069 already worked (kept as a regression test, along with BT6-044, AD1-021, AD1-025, BT25-058/060, BT11-069). "Older digiburst-related watchers": verified working end to end (all 11), no change needed.

## (b) stray compiled ops

Root cause: `parseEffectSegments` glued a bare static-keyword line that follows a tagged segment ("[패]【카운터】 《블래스트 진화》\n《S 어택 +1》《블로커》《링크 +1》") into that segment's body, and the generic compiler read `《S 어택 +1》` as a permanent `grantKeyword`. Fix (state.js `stripTrailingKeywordLines`): keyword-only lines after the first line of a segment (static keywords only: 블로커/재기동/돌진/관통/충돌/회피/재밍/속공/길동무/방벽/아머 퍼지/빙장/볼텍스/프로그레스/연계, 《S 어택 ±N》, 《링크 +N》, 《프래그먼트《N》》, 디코드/오버클럭/파티션, 머티리얼 세이브 N) are no longer part of the segment. The card keeps those keywords because `parseStaticGrants` reads the whole text line by line. Affected: AD1-005 (counter), BT15-081 (also gave the [트래시] evolve a stray S-attack grant), BT26-079 [트래시]【메인】 (already had a card script), plus ~30 harmless bodies (ST15-08, BT5-065 ...). After the fix the (b) scan reports 0.

## BT12-083 colour count (ruling 2216, "1572" in the audit notes)

Japanese answer: 色の異なる自分のテイマー1体ごとに Lv.上限+1; a multicolour tamer "refers to the part whose colour differs from the other tamers and counts as one differently coloured tamer"; example red / red-blue / blue-yellow tamers = red, blue, yellow = +3. The old code counted distinct colour *sets* (red-blue and blue-red merge, but red + blue + red-blue gave +3). A plain union of colours would give +2 for a lone red-blue tamer, contradicting "1体として扱う". Implemented reading: a maximum matching of tamers to distinct colours (each tamer counts once, through a colour no other counted tamer already uses): lone red-blue = +1, red + red-blue + blue-yellow = +3 (the Q&A example), red + blue + red-blue = +2, two red tamers = +1. `shard2.js distinctColourTamers`.

## Deferred / limits

* BT14-030 relies on `stack._leftTo`, set by the three generic bounce implementations (effects.js `returnToHandStripSources`, shard2 and shard3 `bounceStack`). Bespoke bounce code in other shards (shard4/6/7/8/11 …) does not set it, so a bounce by such a card script would not trigger it. Rare; a follow-up could route them through one helper.
* BT26-057 / BT26-049 clause "テイマー아래の카드가 효과로 파기": uses `sourcesTrashed` (fires from `trashEvoSources`, the pick path and the generic sources trasher); other bespoke tamer-under trash code that does not emit the event is not covered.
* Scan blind spots: hooks that exist and register events but filter wrongly (like BT6-044 / AD1-025 earlier) can only be found by playing the card; the scan only proves the hook is present, its `tag`/`has` match a printed segment, and its event kind is emitted. Regression scripts play each fixed card.
* AD1-025's follow-up step ("상대의 옵션 카드 1장을 파기") does not destroy the option in the test fixture used by `qa-unres-c-stray.mjs` (not investigated here: the watcher itself fires and the security part works).

## Tests

* `scripts/qa/qa-unres-c-watchers.mjs` (28 scenarios): each fixed card fires and does its printed effect (plus negative cases), BT12-083 colour cases.
* `scripts/qa/qa-unres-c-stray.mjs` (23 scenarios): AD1-005 / BT15-081 / BT26-079 strays and static keywords intact, 《디지버스트》 payoff family, earlier-fixed watchers, and the scanner (`--json`) reporting 0 suspects.
* `node scripts/qa/scan-unwired-watchers.mjs [--strict]` for re-scans after adding cards.
