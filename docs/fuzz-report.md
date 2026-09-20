# 퍼저(scripts/fuzz.mjs) 발견 기록 — 발견 → 원인 → 수정

`node scripts/fuzz.mjs [게임수] --gen random|theme|mech|starter|mix [--seed N] [--interactive]` — 매 행동 뒤 카드 보존·구조 불변식을 검사합니다.
재현: 보고서에 찍히는 `seed=… gen=…`으로 `node scripts/fuzz.mjs 1 --gen <gen> --seed <seed> < /dev/null` (게임 하나가 시드로 결정적으로 재현됨. `--logn 30`으로 로그 길게).
분류: `CONSERVATION`(분실/복제/소유자), `STRUCT`, `EXC`(예외), `NaN`, `DP`, `TURN`, `PENDING`, `WINNER`, `LOG`. 접두사 `INFO-`는 실패로 세지 않는 참고 항목.

## 카드 보존 불변식이 잡은 것 (복제/분실/소유자)

| 발견 | 원인 | 수정 |
|---|---|---|
| EX6-037/EX6-009/010/044 등 `[패]【메인】`을 쓰면 카드가 패에도, 진화원 아래에도 있음(복제) | ① EX6-037은 `[패]`가 앞 줄에 홀로 적혀 `parseEffectSegments`가 zoneMarker를 못 읽음 → 패 전용 【메인】이 배틀 필드 카드의 ⚡메인 버튼으로 노출됨. ② EX6-009/010/044/037, BT23-072는 스크립트가 없어 일반 컴파일 결과가 "이 카드"를 패에서 빼지 않고 진화원에 넣음 | `state.js parseEffectSegments`: 바로 앞 줄의 단독 `[패]`/`[트래시]`… 표식도 zoneMarker로 인정. `shard3.js legendMain`에 `after` 훅을 추가하고 EX6-009(S 어택+1)/010(DP 이하 소멸)/044(DP 이하 전부 퇴화)/037(1 드로우), BT23-072(육성 에어리어 위그드라실 아래+1 드로우) 스크립트 추가 |
| BT24-094 (센트럴 타운 옥좌의 방): 옵션이 진화원 아래로 갔는데 【메인】이 같은 카드를 시큐리티 아래로도 놓음(복제) | `placeThisAtSecurityBottom`/`placeThisInBattle`이 트래시에 카드가 없어도 "새로" 놓음 | 두 함수 모두 트래시에서 그 카드를 못 찾으면 로그만 남기고 중단 (복제 방지) |
| BT21-012 (화염몬) 【메인】을 육성 에어리어에서 쓰면 방금 등장시킨 테이머(EX11-054)가 사라짐(분실) | `pl.battle.splice(pl.battle.indexOf(mv),1)`에서 mv가 육성 에어리어에 있으면 indexOf=-1 → **마지막 배틀 스택**이 잘려 나감 | `shard13.js`: 배틀/육성 어디에 있는지 구분. 같은 관용구(다른 shard 28곳)를 위해 `trackLeaves`의 `battle.splice`가 `splice(-1,1)`을 거부하고 `state._badSplice`에 호출 위치를 기록(퍼저가 EXC로 보고) |
| BT19-102 등 "상대의 진화원 카드를 등장시킨다": 카드가 내 트래시로 가서 소유자가 바뀜 | 엔진에 카드 소유자 개념이 없음 | `playFromStackSource`(shard12)가 등장한 스택에 `foreignTop`/`foreignCardId`(원 소유자)를 기록하고 `deleteStack`이 그 카드를 소유자의 트래시로 보냄. **남은 한계**: 패로 되돌리기/덱/시큐리티 등 다른 이동, 상대 덱·진화원에서 "가져온" 카드가 내 진화원 아래에 있다가 파기되는 경우는 여전히 조종자의 영역으로 감(퍼저에서 `INFO-CONSERVATION … known limitation`으로 표시) |

## 구조/룰 불변식이 잡은 것

| 발견 | 원인 | 수정 |
|---|---|---|
| BT25-089 ReferenceError `isDi is not defined` (어플 합체 op) | shard8 `s8_appFuse`가 없는 헬퍼 `isDi` 사용 (동일 파일 헬퍼는 `isDigi`) | `isDigi`로 교체 (다른 에이전트가 되돌린 적이 있어 재확인 필요) |
| ST23-15 (e-펄스) 등 "등장 코스트 N 이하의 카드" 효과가 디지타마(코스트 없음)를 배틀 에어리어에 등장시킴 | 필터가 cost=null을 통과시키고 `playFreeFromZone`이 카테고리를 검사하지 않음 | `playFreeFromZone`: DP 없는 디지타마 카드는 등장 거부 |
| 《퇴화》로 디지타마가 최상단이 되면 배틀 에어리어에 영구 잔류 | `ruleCheckDP`의 "DP 없는 카드 파기(17-1-3-2-1)"가 category==='digimon'만 처리 | digitama도 포함 |
| 등장/이동/진화 직후 DP 0 이하가 된 디지몬(자신 또는 상대)이 소멸하지 않음 | 룰 체크(17-1-3-1)가 modifyDP 호출에만 연결되어 있고 지속 효과·새로 도착한 스택은 확인 안 함 | `ruleSweepDP` 추가: 등장(신규/효과)·이동·진화·조그레스 직후 및 턴 시작(턴 카운터로 만료되는 s7Dp 등) 전체 스캔 |
| 공격 선언 로그에 `DPnull` (Lv.2 디지몬) | 로그가 card.dp를 그대로 출력 | `?? '-'` |

## 하네스 쪽(엔진 버그 아님)으로 판명

- 승리 후에도 pending을 계속 처리해 승자가 정해진 뒤 로그가 늘어남: UI는 `state.winner`가 있으면 아무것도 처리하지 않으므로 퍼저도 동일하게 멈춤.
- `ctx.endAttack` 없음(BT25-103): UI ctx에만 있는 함수 → 퍼저 ctx에도 추가. 효과로 시작한 어택(`startAttack`)은 큐에 넣어 UI와 같은 어택 흐름으로 실행.
- BT26-078(케루비몬) 등장 시 자기 자신을 소멸→트래시에서 재등장 반복: 선택 효과라 응답기가 계속 "예"를 골라 생기는 무한 루프(룰 18-3). `INFO-LOOP`로 분류.
- 디지타마가 덱/패/시큐리티에 잠시 있는 상태: main.js는 render마다 `E.autoAdvance`→`normalizeDigitamaZones`(3-1-3-9)를 호출하므로 퍼저도 행동 뒤 호출.
- 디지타마지만 DP가 있는 EX2-007(마더 디·리퍼)은 배틀 에어리어에 있어도 정상.

## 실행 규모(마지막 배치)

random/theme/mech/starter 각 2500게임(총 1만 게임, 게임당 평균 약 13턴·100행동+), `--interactive`(대체 효과 프롬프트 응답) 포함. 남은 항목은 아래 "남은 한계".

## 남은 한계

- 카드 소유자 미추적: 상대 영역에서 가져온 카드가 스택 밖으로 나가는 대부분의 경로(패/덱/시큐리티로 되돌리기, 진화원에 놓인 뒤 파기)는 조종자 영역으로 감.
- DP 0 이하 룰 체크는 이벤트 기반(등장/이동/진화/modifyDP/턴 시작). 대체 효과로 살아남은 디지몬은 다음 체크 시점까지 DP≤0로 남을 수 있음(퍼저는 이 경우를 무시).
