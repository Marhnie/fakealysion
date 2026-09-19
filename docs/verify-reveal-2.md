# verify-reveal-2 — 덱 위 오픈/서치 계열 검증 (배치 2, 150 세그먼트)

범위: `revealN.json` N=2 (BT11-029 … BT18-060). 모든 카드는 인쇄 텍스트 ↔ 컴파일 결과(또는 bespoke 스크립트)를 대조하고 Node 시나리오(`Effects.runScript` + 스크립트 chooser)로 실행 검증함.

## 공통 근본 수정 (effects.js)
- **새 op `revealPick`** (`compileRevealPick` / `runRevealPick`): "덱 위 N장 오픈 → 그중 <조건> …을 <패/등장/진화원/파기/사용> → 나머지는 <덱 아래/위/파기/패>" 를 단계(step)별로 처리.
  - 오픈한 카드 중 조건에 맞는 카드만 선택 가능(eligible), 반드시 1장(min=1, "수 있다/까지"만 선택 사항), "전부" 는 전부 자동(확인창), 조건에 맞는 카드가 없으면 UI 에 "조건에 맞는 카드가 없습니다" 표시.
  - "A 1장과 B 1장"(그룹) = 기준당 1장(한 카드는 한 기준에만, 남은 기준을 채울 수 있게 선택지 제한), "A 1장 또는 B 1장" = OR 1장.
  - "등장 코스트 합계 N까지" = 남은 예산 안에서 순차 선택/등장, "색이 서로 다른 …2장까지" = 색 겹침 금지.
  - 목적지 여러 개("A 1장을 패에 추가하고 B 1장을 진화원 아래에", "패에 추가하거나 진화원 아래에 놓는다" 선택형), 옵션 무료 사용, 트래시.
  - 나머지: "덱 아래로/위로" 는 플레이어가 순서 선택(orderPlacement), "덱 위 또는 아래로만" 은 카드별 위/아래 분배 + 각각 순서 선택, "파기", "패에 추가"(EX5-042).
  - 덱 상태: 뽑힌 카드는 처리 시점에 덱에서 빠지고 나머지는 처리 후 되돌려 카드 수 일관(오토 검증: 134 op 전부 카드 보존 / 비적합 카드 미선택 / 나머지 위치 OK).
- 필터 개선: `revealCriterion` — "「A」 또는 <조건>", "…를 가지거나 2색의 카드", "명칭에 A를 포함하거나 특징으로 B를 가진 퍼플인 디지몬 카드"(공통 색/Lv./코스트 조건을 양쪽에 적용), "특징으로 특징으로" 오탈자 정규화.
- 후속 문장(`이 효과로 추가했다면` / `놓았다면` / `그 후 …`)은 기존 조건 컴파일 유지: `_res.added`, `ctx._lastPlacedSource` 사용.
- main.js pickFromRevealed: `dest` 표시, "전부" 는 자동 사전 선택.
- shard16.js: bespoke — BT11-056(어택 시, 테이머 수만큼 오픈), EX5-042, P-112, BT14-067(상대 덱), BT16-060, BT16-065, BT13-007(디지타마 덱); 기존 shard 스크립트의 min=0/순서 없음 결함 override — BT13-072, BT16-082, BT17-056, EX7-044.

## 카드별 결과
| 카드 | 패턴 | 결과 | 메모 |
|---|---|---|---|
| BT11-029 메인 | N=3 전부→hand / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-040 소멸 시 | N=3 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT11-044 등장 시 | N=4 99장→play 합계7 / 나머지 trash | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-046 등장 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT11-056 진화 시 | N=3 1장→play / 나머지 topOrBottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-056 어택 시 | 턴당 N(테이머 수)장 오픈 + 합계 10 등장 (bespoke s16_revealPerTamer) | 수정 |  |
| BT11-061 메인 | N=3 1장→hand ; 1장→srcThis / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-062 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT11-068 등장 시 | N=5 1장→play / 나머지 topOrBottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-070 진화 시 | N=3 1장→srcThis / 나머지 trash | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-072 등장 시 | N=5 1장→hand ; 1장→hand/srcThis / 나머지 trash | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT11-077 등장 시 | N=5 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT11-089 등장 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT11-105 시큐리티 | N=3(오픈 선택) 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT11-106 시큐리티 | N=3 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-007 등장 시 | N=4 전부→hand / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT12-021 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| BT12-034 등장 시 | N=4 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-037 등장 시 | N=3 1장→play / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-045 등장 시 | N=1 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-047 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| BT12-059 등장 시 | N=4 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-063 등장 시 | N=3 1장→play / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-071 상대의 턴 | N=3(오픈 선택) 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT12-080 등장 시 | N=3 1장→hand / 나머지 topOrBottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT12-086 등장 시 | N=3 2장색상상이→hand / 나머지 bottom | 수정 | 필터 desc → 구조화(색이 서로 다른 / 공통 색 조건) |
| BT12-098 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| ST14-11 등장 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-016 등장 시 | N=3 1장+1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-032 등장 시 | N=4 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-034 등장 시 | N=4 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-038 등장 시 | N=3 1장+1장→hand / 나머지 top | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-039 등장 시 | N=3 1장+1장→hand / 나머지 top | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-040 소멸 시 | N=1 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-041 소멸 시 | N=1 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-047 소멸 시 | N=2 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX4-053 등장 시 | N=3 1장+1장→hand / 나머지 bottom | 수정 | 필터 desc → 구조화(색이 서로 다른 / 공통 색 조건) |
| BT13-007 자신의 메인 페이즈 개시 시 | 디지타마 덱 오픈 + 로얄나이츠 진화원 아래 (bespoke) | 수정 |  |
| BT13-034 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT13-046 등장 시 | 특정 스크립트/기존 shard | OK | 기존 shard 스크립트 검증 |
| BT13-048 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT13-049 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT13-061 소멸 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT13-072 진화 시 | X항체 1장 강제 진화원+DP 마이너스 방지 (override) | 수정 |  |
| BT13-074 등장 시 | N=3 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT13-087 등장 시 | N=4 2장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| RB1-005 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| RB1-011 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| RB1-017 소멸 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| RB1-020 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| RB1-027 등장 시 | 특정 스크립트/기존 shard | OK | 기존 shard 스크립트 검증 |
| ST15-04 등장 시 | N=1 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-042 등장 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-051 상대의 턴 종료 시 | N=5 2장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-056 등장 시 | N=5 1장→hand / 나머지 topOrBottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT14-060 어택 시 | N=3 1장→play / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-063 소멸 시 | N=3 1장→hand ; 1장→play / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT14-064 등장 시 | N=3 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-064 서로의 턴 | N=3 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-065 등장 시 | 특정 스크립트/기존 shard | OK | 기존 shard 스크립트 검증 |
| BT14-067 등장 시 | 상대 덱 오픈→코스트 합계 소멸→위/아래 (bespoke) | 수정 |  |
| BT14-068 자신의 턴 종료 시 | N=3 99장→play 합계7 / 나머지 trash | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT14-085 등장 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT14-088 등장 시 | N=5(오픈 선택) 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-103 메인 | N=2 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-104 메인 | N=2 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-105 메인 | N=2 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-106 메인 | N=2 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-107 메인 | N=2 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-108 메인 | N=2 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-112 등장 시 | 2장 1장씩 패 + 에오스몬 아래로 이동 후 메노아 등장 (bespoke) | 수정 |  |
| EX5-008 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX5-015 등장 시 | N=4 2장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX5-017 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX5-035 등장 시 | N=3 전부→hand / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| EX5-042 등장 시 | 1장 오픈, 조건 시 강제 등장, 나머지 패로 (bespoke) | 수정 |  |
| EX5-044 등장 시 | N=5 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX5-045 등장 시 | N=3 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX5-048 상대의 턴 | N=3(오픈 선택) 1장→play / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX5-071 메인 | N=3 1장→srcOwn/hand / 나머지 topOrBottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| P-097 등장 시 | 특정 스크립트/기존 shard | OK | 기존 shard 스크립트 검증 |
| P-118 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-119 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-121 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-007 자신의 메인 페이즈 개시 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-011 등장 시 | N=4 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-021 등장 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-027 등장 시 | N=4 2장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-050 등장 시 | N=4 2장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-055 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-062 등장 시 | N=4 2장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-064 등장 시 | N=3 1장→srcThis ; 1장→hand / 나머지 trash | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT15-070 등장 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-077 등장 시 | N=4 2장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-083 등장 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT15-096 메인 | N=5 1장→hand ; 1장→trash / 나머지 top | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT15-096 시큐리티 | N=5 1장→hand ; 1장→trash / 나머지 top | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| LM-014 등장 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| LM-019 등장 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| LM-020 상대의 턴 개시 시 | 특정 스크립트/기존 shard | OK | 기존 shard 스크립트 검증 |
| P-078 등장 시 | 특정 스크립트/기존 shard | OK | 기존 shard 스크립트 검증 |
| BT16-029 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| BT16-037 등장 시 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT16-039 등장 시 | N=4 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT16-060 등장 시 | 오픈한 D-브리가드 수만큼 코스트 -N 후 소멸 (bespoke) | 수정 |  |
| BT16-065 등장 시 | 오픈 디지몬 코스트 이하 소멸, 전부 파기 (bespoke) | 수정 |  |
| BT16-072 등장 시 | N=5 2장→trash / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT16-082 자신의 턴 | 디지몬/테이머 1장 강제, 나머지 순서 선택 (override) | 수정 |  |
| BT16-094 메인 | N=4 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| BT16-096 메인 | N=3 1장→hand / 나머지 top | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT16-096 메인 (《딜레이》) | 딜레이 불릿 3장 오픈, D-브리가드/디지대 코스트 4↓ 1장 무료 등장, 나머지 파기 | OK | parseDelayEffect 본문이 revealPick 으로 컴파일됨 (딜레이 발동 시 pending) |
| BT16-096 시큐리티 | N=3 1장→hand / 나머지 top | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT16-099 메인 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT16-099 시큐리티 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| ST17-11 메인 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-017 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-018 자신의 메인 페이즈 개시 시 | N=3 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-020 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-025 등장 시 | N=4 1장+1장+1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-036 등장 시 | N=3 1장+1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-047 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX6-064 등장 시 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-151 메인 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-116 메인 | N=2 전부→hand / 나머지 top | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT17-009 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT17-020 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT17-031 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| BT17-042 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT17-054 등장 시 | N=3 1장→hand / 나머지 trash | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 (OR 필터 anyOf) |
| BT17-056 서로의 턴 | 패러사이몬/블랙 Lv5↓ 1장 진화원 강제 (override) | 수정 |  |
| BT17-058 등장 시 | N=3 1장→srcThis / 나머지 trash | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT17-098 메인 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT17-098 시큐리티 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| P-138 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX7-007 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX7-008 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX7-016 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| EX7-044 등장 시 | 3총사 옵션 1장 진화원 강제 + 코스트 3↓ 소멸 (override) | 수정 |  |
| EX7-047 등장 시 | N=4 99장→play 합계7 / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| EX7-048 등장 시 | N=6 1장→use / 나머지 topOrBottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| EX7-052 등장 시 | N=3 1장→hand ; 1장→trash / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| EX7-074 메인 | N=3 1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| ST18-04 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| ST19-03 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT18-007 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT18-010 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT18-023 등장 시 | N=3 1장→hand/srcOwn / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |
| BT18-030 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT18-031 등장 시 | N=3 1장+1장→hand / 나머지 bottom | OK | revealPick 로 이동; 필터·수량·목적지·나머지 위치 확인 |
| BT18-060 등장 시 | N=3 1장→hand ; 1장→srcOwn / 나머지 bottom | 수정 | 구 revealTop 은 이 패턴(전부/합계/다중 목적지/위·아래 선택 중 하나)을 처리하지 못함 → revealPick |

## 미해결 / 주의
- BT16-060: "상대의 디지몬 전부 등장 코스트 -N(턴 종료까지)" 는 엔진에 배틀 에어리어 카드의 코스트 수정 개념이 없어 스택 필드(`s16CostMinus`)로만 기록하고 같은 효과의 소멸 대상 판정에만 반영.
- BT14-065 / P-097 / LM-020 / P-078 / RB1-027 / BT13-046 (기존 shard11/2 스크립트)는 실행 검증 OK (덱 위/아래 처리, 드로우/메모리, 시큐리티 되돌림).
- 오픈한 카드의 등장 시 《디지크로스》 재료 선택은 revealPick 의 등장에서는 제공하지 않음(기존 playFree 는 제공).
