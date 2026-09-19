# 알려진 엔진 미해결 항목 수정 기록 (verify-gaps)

하네스: scratchpad g1~g11.mjs (실제 S/E/Fx, 구체적 보드). 결과: soak 40 / SOAK_INTERACTIVE 15 → distinct errors 0, audit-effects 100%.

| # | 항목 | 원인 | 수정 | 검증 |
|---|------|------|------|------|
| 1a | BT25-102 《링크 +1》(「불카누스몬」 조건) | 링크 상한 훅 없음 | `linkCapOf`가 활성 훅의 `linkPlus(state,hp,holder,stack)`를 합산 (state.js), shard19 `contSec`에 `link:{n,when}` 옵션 | 불카누스몬 유/무 × 자신/상대 턴: 링크 카드 2장 유지/1장 파기 |
| 1b | BT25-095 DP+2000 (서로의 턴) | (기존 훅 확인) | 변경 없음 | 자신/상대 턴 모두 12000→14000 |
| 1c | BT8-084 / BT3-014 진화원 색·옐로 취급 (자신의 턴) | `stackColors`가 state 미보유 | `stackColors`가 훅 `addColors(state,hp,holder)`를 반영(재진입 가드), shard1 훅 추가, BT8-084 DP 훅은 `stackColors`만 사용 | 자신의 턴 5색/DP 12000, 상대 턴 1색/8000 |
| 1d | AD1-004 테이머 색 DP/S어택 | (기존 훅 확인) | 변경 없음 | 3색: +3000, S어택 +1 |
| 1e | EX5-065 (턴 종료 시 패로 되돌림, 조그레스 부분) | 카드 스크립트 자체가 없음 | **미해결** (구현 규모 큼) | – |
| 2 | 【카운터】 옵션 사용 | 코스트/색 조건/1회 제한 없음 | `S.activateCounter` (룰 9, 4-22, 11-3-2): 옵션은 색 조건+사용 코스트 지불+트래시, 1회 어택 1번(`pa.counterUsed`), main.js 버튼 연동 | 합성 옵션: 색 없음→거부, 지불 후 메모리 감소, 2번째 거부, 메모리 부족 거부 |
| 3 | EX7-023/EX8-023 진화원 선택 파기 | 컴파일러가 오래된 순 자동 | `trashEvoSources {choose:true}` → `S.chooseSourceIdxs` (「선택하여」 문구 시) | 5장 중 지정 4장 파기 확인 |
| 4 | BT10-024/099 및 「N마리에게」 S어택 -N 중복 대상 | 매 반복 독립 선택 | 옵 `distinct` 키(ctx._distinctPicks)로 후보에서 제외; 컴파일러 반복 grantKeyword에 자동 부여; BT10-024는 「블록 불가」(s1.noBlock)도 추가 | 3마리 순차 후보 4→3→2 감소 |
| 5 | BT4-090 액티브공격 턴 전체 | keyword 부여 | `stack.anyActiveOnce` + `startAttack(..., {anyActive:true})`; attackFlow가 이번 어택의 대상 판정에만 사용 후 제거 | 키워드 미부여, 플래그 소거 |
| 6 | BT16-060 등장 코스트 -N | 필드 카드 코스트 수정 개념 없음 | `S.addCostMod/effectiveCost`; `matchesFilter`의 costMax/Min/Eq와 extreme(cost)가 배틀 에어리어 스택에 유효 코스트 사용 | 코스트5→2, 다음 턴 5 복귀, 소멸 후보 필터 반영 |
| 7 | 효과로 등장 시 디지크로스 재료 선택(7-2-2-13) | playFree op 하나만 지원 | `Fx.xrosOptsFor` 헬퍼 → 덱/공개 카드/트래시/진화원 등장·n5_playSum·s8_playOrUse에 적용 | 샤우트몬X4 재료 4장 선택 등장 xrosCount 4 |
| 7b | 〃 shard 개별 스크립트(shard3/4/5/7 등 다수의 `playFreeFromZone` 직접 호출) | 동기 호출 | **미해결** (각 스크립트에서 `xrosOptsFor` 호출 필요) | – |
| 8 | 배틀 에어리어 이탈 반응이 소멸만 감지 | 약 60곳이 `pl.battle.splice` 직접 호출 | `battle.splice` 후킹(trackLeaves) → 미통지 스택은 `flushLeaves`(runScript 종료/룰체크)에서 `hookLeaveTriggers('other')`; 조그레스 재료·재배치는 제외, 이미 통지된 스택은 중복 방지 | 직접 splice/통지/deleteStack/덱·패 되돌리기 op: 딜레이 1회씩 |
| 9 | 지속 기간 표 | `opponentTurn`이 항상 T+1 | `S.durationEnd(state, dur)` (시전자 기준, runScript가 state._caster 설정): turn / opponentTurn(상대의 턴 종료까지) / nextOpponentTurn(다음 상대의 턴 종료까지) / ownTurn / nextOwnTurn; 컴파일러가 「다음」 구분, state.js/effects.js 모든 산식 교체, shard1·4의 하드코딩 T+1 교체, BT10-099/024는 nextOpponentTurn | 자신/상대 턴 시전 × 5종 표 테스트 + 컴파일 스크립트 (T=3: 4/5/4/3/3) |
| 10 | EX5-001 [턴에 1회] 진화 시 리셋 | 진화 시 전 카운터 `{}` | 룰 15-14-1-5-2/3-1-3-1-3: 겹쳐진 카드는 새 카드가 아님 → 이미 스택에 있던 카드의 카운터 유지, 새 최상단 카드만 리셋 (`resetUsesForNewTop`) | 진화 후 EX5-001 사용 기록 유지 |
| 11 | EX10-023 등 〔진화〕 상태 의존 게이트 | 「…있는 동안」 접두 무시 | `evolveTargetRestriction`이 `evoGate` 제공, `satisfiedEvoConditions`가 접두 평가(이름 존재/시큐리티·트래시 매수/DP 상대 디지몬/특징 테이머 수) | 최지석 유/무, LM-021, BT23-013 |

## 잔존
- EX5-065 (상대의 턴 개시 시 진화원 등장 + 조그레스 + 턴 종료 시 패로) 미구현.
- shard 개별 스크립트의 직접 `playFreeFromZone` 호출은 디지크로스 재료 선택 미적용.
- 「자신의 턴 종료까지」/「자신의 다음 턴 종료까지」 컴파일러 지원은 durationEnd에 있으나 컴파일러 출력은 아직 opponentTurn 계열만 사용.
