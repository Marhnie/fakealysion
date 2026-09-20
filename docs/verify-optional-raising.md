# 검증 로그: 임의 처리 조건(~하는 것으로) 선택권 + 육성 에어리어 룰(3-4-7)

## TASK 1 — 「~하는 것으로」 = 임의 처리 조건 (룰 15-7-1 / 15-7-2 / 15-14-1)

### 조사 결과 (scripts/enum-optional-cost.mjs)
'것으로'가 붙은 효과 세그먼트 1,227개 분류:

| 처리 방식 | 개수 | 이전 동작 |
|---|---|---|
| 컴파일러 costGroup | 687 (manualCost 포함 123) | 비용을 낼 수 있으면 **묻지 않고** 즉시 지불 (진화원 파기·소멸·패 파기 등) |
| 카드별 스크립트(shard, costGroup 없음) | 402 | 카드마다 제각각 (자체 confirm 27종 / 그냥 자동 지불 다수) |
| 워처가 큐잉하는 "이 테이머를 레스트시키는 것으로" | 수십 장 (BT2-084/086, ST4-14, ST6-14, BT8-092, BT11-089 …) | 트리거 시점에 **테이머를 먼저 레스트**하고 효과 큐잉 (선택 불가) |
| 소멸/이탈 대체(《세이브》류, `resumeReplacement`) | 다수 | UI에서는 이미 예/아니오 (pendingReplacements), 헤드리스는 기본값 |

### 수정 (중앙 처리)
- `src/effects.js` `case 'costGroup'`: 비용 지불 가능 확인(15-7-3) 직후, 지불 **이전에** `askOptionalCost` 확인창.
  페이로드: `{ optionalCost:true, cardId, costKinds[], costText, effectText, prompt }` (카드명·비용·효과 표기).
  '아니오' → 상태 무변경, 효과 전체(이후 문장 포함) 취소, `ctx._declined/_costUnpaid` (15-7-2).
  `else`(대신 …) 형태는 기존 확인창 유지(중복 방지). 컴파일러가 `costText/thenText`를 costGroup에 기록(디지버스트 포함).
- `optionalGate` (runScript 진입부, `ctx.trigger`가 있을 때): costGroup이 없는 카드별 스크립트도
  첫 문장에 `…하는 것으로,`가 있으면 스크립트 실행 전에 같은 확인창을 띄움. 스크립트 자체가 confirm을 하는 경우(소스에 confirm 계열 호출)는 중복을 피해 제외.
- 워처 테이머(`restPending`): `state.js`가 트리거 시점에 레스트하지 않고 `restPending`+`onceKey`를 큐잉 →
  게이트에서 '예'일 때만 레스트(이미 레스트면 비용 불가로 스킵). '아니오'는 [턴에 N회] 사용 횟수 환불.
- `main.js`: '할 수 있다' 확인창을 이미 받은 효과는 `ctx._optAsked`로 costGroup 재질문 방지, `_declined`면 발동 취소 + 〔턴에 1회〕 환불.
  `cpusim.js`도 `_declined` 환불. 헤드리스 드라이버(soak/lib-driver)는 `trigger: t`를 ctx에 전달.
- `src/cpu.js`: `optionalCostAnswer` — CPU는 비용이 손해일 때 자동 예를 하지 않음
  (시큐리티 ≤2장 남으면 파기 거절, 자기 디지몬 소멸/되돌림은 명확한 이득일 때만, 패 3장 미만이면 패 파기 거절, 메모리 <2면 지불 거절;
  easy는 60%). 대체효과(대신 다음 효과를 사용) 프롬프트도 자기 디지몬/시큐리티 희생 비용이면 거절.
- 강제 효과(15-15-7-4, `_forceOptional`)는 기존 wrapChoose가 true로 처리.

### 테스트: `scripts/test-optional-cost.mjs` (659 assertions, 0 fail)
- 컴파일 costGroup 71장(비용 종류별 ≤7장: 패 파기, 자기 디지몬 소멸, 테이머/디지몬 레스트, 되돌리기, 진화원 아래 놓기, 메모리 지불, 진화원 파기, 시큐리티 파기/이동, moveEach 등):
  프롬프트가 상태 변화 **이전**에 출현, '아니오'면 상태 완전 동일 + `_declined`, '예'면 정확히 1회 질문 후 상태 변화.
- 지불 불가(부분 지불 불가, 15-7-3) 14건: 프롬프트도 상태 변화도 없음.
- 카드별(shard) 스크립트 60장: 게이트 프롬프트 → '아니오' 시 상태 무변경 (27장은 자체 확인창/스킵).
- 필수형("메모리를 +1 한다") 무질문, 〔턴에 N회〕 미소모, 워처 테이머 BT2-086/ST6-14/ST4-14: 큐잉 시 테이머 액티브 유지 → 질문 → 예/아니오 후 레스트 여부.

### 남은 한계
- 카드별 스크립트 게이트는 "지불 가능 여부"를 미리 알 수 없어(스크립트 내부에서 판단) 지불 불가여도 질문이 뜰 수 있음(예 후 아무 일도 안 일어남). costGroup 컴파일 효과는 지불 가능일 때만 질문.
- 두 번째 이후 문장에 `…하는 것으로`가 나오는 다문장 효과(이하 불릿 포함)는 게이트가 아니라 해당 costGroup 시점의 질문에 의존.

## TASK 2 — 육성 에어리어(3-4-7)

### 원인
스캐너 ~35곳이 `stackContributors(stack)`를 직접 순회하며 육성 에어리어 스택도 배틀과 동일하게 본문/상속 효과를 적용했음
(예: 육성 중인 디지몬의 상속 【자신의 턴】 DP+N이 적용, 【자신의 턴】 워처가 육성 카드에서 큐잉, 《블로커》 보유 판정).

### 수정 (중앙)
- `state.js` `stackContributors`: 스택이 육성 에어리어(`S7_BOUND` 상태 기준)이면 기여 카드를 **[육성] 표기 세그먼트만** 가진 합성 카드(`ID~육성`, `ID~육성i`)로 대체하고 나머지는 제외.
  부화한 Lv.2 카드, 육성에서 진화한 디지몬, 그 진화원 전부에 동일 적용. 메모(_cc)에 영역 포함, 영역이 바뀌면 `recomputeStackGrants`로 키워드/DP 캐시 재계산(배틀로 이동 시 효과가 즉시 유효, 【등장 시】는 발동 안 함).
- 배틀 에어리어에서는 [육성] 표기 훅/워처를 휴면 처리 (`hookMarkedRaising`, watcher zoneMarker 검사).
- 3-4-7-6: 육성 카드가 대상(subject)인 이벤트는 [육성] 표기가 아닌 워처/훅의 트리거 조건을 만족시키지 못함 (`emitGameEvent`, `dispatchHookEvents`; `hatch`는 예외).
- 타겟 열거(candidateStacks 등)는 기존에도 `pl.battle`만 사용, 룰체크(DP≤0)는 배틀 한정 — 확인만.
- `[육성]` 표기 카드(BT13-007, EX6-006, BT22-007 등)는 육성에서만 동작 확인 (`ID~육성` 훅/큐잉 정상, 배틀에서는 휴면).
- 육성 에어리어를 명시하는 옵션(BT13-110 등)은 카드 스크립트 스모크 테스트에서 육성 스택 대상 동작 확인(BT13-110: 진화원 추가 OK).
  shard62.js는 개별 수정이 필요한 카드가 없어 만들지 않음.

### 테스트: `scripts/test-raising-area.mjs`
digimon/digitama 전 카드 3,520 케이스(최상단 / 진화원 모드) × 이벤트 27종 × 트리거 9종: 큐잉, activeHooks, DP(상대/자신 턴), 키워드, 주변 디지몬 DP → **위반 0**.
(수정 전: 1,688건/1,014장 — DP 누수 242, 워처 큐잉 ~250, 훅 ~70, 키워드 481 …)
추가: 배틀 홀더 3,863종이 육성 대상 이벤트에 반응하지 않음, 육성 내 진화 1,446종 【진화 시】 미발동, 이동 시 【등장 시】 미발동.

## 회귀
soak 40 (0 오류), audit-effects 100%, fuzz random×100 (0 findings), test-census-regress / test-oracle-regress / test-cpu / test-immune-grants / test-cs-evolution / test-hunt-regress / test-snapshot 전부 OK.
