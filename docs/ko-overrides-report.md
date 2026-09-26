# ko-overrides report

Cards whose KOR export (dgchub) was empty / English now get Korean text from `data/ko-overrides.json`
(`{cardNo: {nameKo, effectKo, inheritedKo}}`). `scripts/build-cards.mjs` applies it only where the KOR field is
missing (nameKo: also when it is the card number or English). Re-run `node scripts/build-cards.mjs`; only the 18 cards below changed.

## Translated
- P-059 / P-060 / P-061 effectKo: copied from the identical-English twins P-047 / P-049 / P-050.
- LM-057..062 (월/파쿠르/히트/섀도우/펀칭/브리딩 · 트레이닝): name, effect, security text (template = LM-054).
- P-239 피코데블몬, P-240 아크투루스몬, P-241 김영웅, P-242 권레이, P-243 디지시배스 (no official Korean found, transliterated), P-244 유니크 엠블럼: 라그나로크 어테이너 — name + effect + inherited/security.
- Names only: P-116 디지몬 콘 2023, P-235 디지털 액시던트 택틱스 스쿼드, P-236 글로잉 던.
- Not changed on purpose: BT4-001..006 / BT5-001..006 (digitama: the dump puts the inherited text in the ENG `effect` field, KOR already has it in inheritedKo, so an empty effectKo is correct); P-082..086 inheritedKo "－" (printed dash, engine ignores it); BT23-088 "K" (official name); BT26 "ー" inherited (printed dash).
- Remaining English in cards_full is legitimate: trait 「Legend-Arms」, 「EDEN」, 「ZERO」, 「DEFEAT」 in names.

## UI raw enum values
`form` is only shown when it starts with Hangul (main.js) and is mapped to 유년기/성장기/… in state.js FORM_KO (folded into `types`), so IN_TRAINING/ROOKIE… never show.
Fixed: attribute `NO DATA` (EX5-074, BT26-085) was printed raw in the card preview (main.js) and offered as a search trait (dbsearch.js); both now skip non-Korean attributes.
Other raw forms (D_REAPER, APPMON, STND, SUP, ULT, GOD, UNKNOWN) are not displayed anywhere.

## Engine work
Generic compiler covered everything except (checked with a "수동으로 처리" scan): P-239, P-241, P-242, P-243, P-244, and the P-060 blocked watcher.
- `src/cards/shard160.js` (new, registered in `src/cards/index.js`): P-243 (딜레이 at turn start), P-244 (sourcesAdded watcher + 딜레이 evolve, cost -3), P-060 blocked watcher (same as P-049 in shard43).
- P-239 (shard151), P-241 (shard6), P-242 (shard8) were implemented concurrently by the Q&A audit agents; my duplicates were dropped and QA runs against theirs.
- `audit-effects`: 100%, 0 uncovered. `check-syntax` OK. `soak 30`: 0 errors.

## QA
`scripts/qa/qa-ko-overrides-1.mjs` (P-059/060/061, LM-057..062 incl. 딜레이 flow), `-2` (P-239, P-241, P-242, P-243, P-244), `-3` (P-240 incl. 어셈블리, P-060 blocked, P-116/235/236, BT4/BT5 digitama).

## Unresolved
- Names for P-243/P-244/P-235 are transliterations; replace in `data/ko-overrides.json` when official Korean is known (the effect text of the LM- Training options mentions their own name, keep them in sync).
- Nothing committed / deployed.
