# Q&A re-verification, wave 3 — data/rulings/all.json idx 1334-2000 (BT10-046 … BT16-060)

Entries in range: 667 (339 distinct cards). All were read; 171 cards have hardcoded scripts (read against the ruling), 168 run on the
generic compiler (compiled output dumped and read). Many entries are duplicates of generic rulings (search "either/both", "must take all",
"BT9-109 rule-discard", Tactimon, DigiXros-via-tamer, etc.) that earlier waves already proved. Regression scenarios: `scripts/qa/qa-w3-a.mjs` (63 scenarios, all pass).

## Bugs found and fixed (idx = array index)
- BT10-056 ロータスモン (1341): simultaneous mass deletion lost the granted 【소멸 시】 → `S.orderSimulDelete` (granter/protector deleted last), used in mass destroy + BT11-107.
- BT11-082 ツワーモン (1468): same ordering fix (Yu survives simultaneous deletion).
- BT10-084 タクティモン (1367-1370): "선택하여 N장 파기" replacement now moves to Tactimon (effects.js trashEvoSources+`S.redirectSourceTrash`); BT10-077 cost can be paid from Tactimon.
- BT10-042 ベヌスモン / BT10-110 (1401): continuous 《S 어택》 (제스몬GX) now counts; BT10-110 respects evoTrigSuppressed.
- BT12-106 / BT14-047 (1598, 1769): "all opp cards / DP≤5000 digimon don't become active" is now standing (late arrivals, DP judged at active phase) — `addLateUnsuspendSkip`.
- BT15-047/049/053, BT16-048 (1878-1890): recorded skip-unsuspend no longer lingers and eats a later active phase.
- BT16-025 (1974): jogress lock covers all opp digimon incl. later arrivals and effect activation (`addNoActiveAll`; also BT13-060).
- Generic compiler (BT12-056 1539/40, BT9-100, EX5-068, BT20-041/044, BT23-047, BT24-051/060, EX11-036): later sentence's 「수 있다」 leaked `optional` onto the earlier mandatory rest and attack ran before it.
- BT13-092 (1694): 〈룰〉 alias names for "같은 명칭".  BT14-081 (1806): all-or-nothing play.  BT11-086 (1473): 2-or-none.
- BT10-086 (1372): opened-then-trashed security emits securityDecrease.  BT10-096/097 (1391/1395): 김태성 data typo + hand/play chain is all-or-none.
- BT12-112 (1610/1612): 「카드 넘버가 서로 다른」 xros compares card numbers, not names.
- BT12-090/BT13-101 (1581/1582/1703): "A와 B 2색" = exactly those two colours (gained colours count).
- BT13-007 (1616/1617): only tamer-as-digimon evolution blocked, printed tamer evolution allowed.
- BT11-087 (1474): under-tamer cards come from hand after being returned.
- Fake manual costs replaced by scripts: BT13-089 (destroy-self cost was never paid), BT14-030, BT14-088, BT15-102, BT12-088 (granted memory+2), BT13-108, BT13-033, BT14-094.

## Not fixed / notes
- BT12-083 tamer colour count (1572) for e.g. red/blue/red-blue tamers counts combos, official wording ambiguous.
- 1446 (original-DP override on a devolved DP-less card): fix broke tamer-as-digimon DP, reverted.
- Timing rulings needing the UI loop (per-check DP-4000 of BT11-045, per-check draws) not provable headless.
- Data typos in other slices: 그랑쿠가몬 (BT9-055), 블루플레어 (BT10-026), 황제드라몬: 드래곤모드 (AD1-024) etc. name nonexistent cards.
- Pre-existing/sibling failures seen in full qa run (not from these edits): qa-audit-g5-t1b3 Q4, qa-slice2-r2-m Q1784, qa-slice6-a G22/G28, qa-slice6-r2-a G114, qa-slice6-r2-b G76, qa-w2r2-a Q1180, qa-w6-b 3506/3512.

Final gates: check-syntax OK, audit-effects 100%, soak 30 games 0 errors.
