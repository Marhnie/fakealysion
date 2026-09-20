# CPU 대 CPU 대량 버그 헌트 리포트

도구: `scripts/cpu-hunt.mjs` (헤드리스, 양쪽 모두 `src/cpu.js` 가 조종, `src/cpusim.js` 로 실제 엔진 실행),
`scripts/cpu-hunt-agg.mjs` (샤드 결과 병합/클러스터), `scripts/cpu-hunt-blind.mjs` (블라인드 스팟), 회귀 테스트 `scripts/test-hunt-regress.mjs`.

재현: 발견 항목에 찍힌 `spec` JSON 을 그대로 `node scripts/cpu-hunt.mjs --spec '<json>' --verbose < /dev/null` (시드 고정, 어려움+탐색은 노드 예산 고정이라 결정적).

사용법 요약
```
node scripts/cpu-hunt.mjs --mode starters|focus|theme|mech|random|mix --minutes 8 --seed N --shard i/n --levels easy,normal,hard,hard4 --out f.json < /dev/null
```
- `focus`: S.CARDS 전 카드(4394장 id, 토큰 제외 4391)마다 「4장 + 진화 라인(canEvolveAny 그래프 전/후) + 같은 색 서포트」로 합법 50장 덱을 만들어 카드당 2게임(상대는 theme/mech/random/스타터/다른 focus 덱).
- `starters`: ST1..ST24(데이터에 있는 23종) 전 조합(23x23) x 시드. (데이터에 스타터 덱 리스트가 없어 ST 카드 + 같은 색 보충으로 합법 50장 구성.)
- 어려움 탐색(`hard4`)은 시간 대신 노드 30 / 깊이 3 로 고정(결정적 + 빠름).
- 탐지기: EXC(예외), CONS(카드 보존/소유), NAN/LOG(undefined·NaN·[object]), MEM(메모리 범위·자동 턴 종료 누락), STALL(턴 80 초과·벽시계·한 턴 40액션 초과), REPEAT(같은 액션 x8), REJECT(CPU 액션이 효과 없음 — 종류별), PEND(미해결 pending), SUSP(불법 진화/공격, 이른 덱아웃 승리 등), DP0(DP<=0 생존), MANUAL(수동 fallback 효과 빈도), 카드별 노출(top/source/hand/trigger).

## 통계 (누적)
- 총 약 12만 게임(≈135만 턴): focus 4394장 x2 (focB, focE: 각 8.8k 게임, 전 카드 커버) + focA/focC(어려움+탐색 포함 각 ~1.9k), 스타터 조합 ~7.5만(stA/stB), mix(theme/mech/random/starter/focus 혼합) ~2.3만, 이전 배치 ~1.3k.
- 레벨 조합: 쉬움/보통/어려움/어려움+탐색 16개 조합 전부.
- 최종 확인 배치(수정 후, focE 8784 + mixE 1097 게임): 예외 0, 스톨 0, CONS 소유자 이동 1건(아래 "남은 것") 외 클린.
- 카드 노출(수정 후 배치 focB/focC/focE/mixD/mixE/stA, 85,975게임, 4391장 중): 필드에 오르거나 효과가 발동된 카드 4296장(97.8%). 스택 최상단 등장 횟수 분포: 0회 616(대부분 옵션 — 옵션은 발동 pending 으로 집계), 1~4회 450, 5~19회 329, 20회 이상 2996.

## 발견 클러스터 -> 원인 -> 수정 (누적 목록)
1. **`[턴에 1회]` 【메인】이 무한 재발동** (STALL >40액션/턴, ST17-03 로프몬·EX7-065·BT10-112 등 수천 건)
   원인: `src/cpusim.js` drain 이 `main.js runPendingScript` 의 15-4-4-3 stale 검사와 `[턴에 N회]` 게이트/마킹(`turnEffectUses`)을 재현하지 않아 CPU(및 탐색 시뮬레이션)가 사용 횟수 제한을 무시.
   수정: cpusim drain 에 stale 검사 + 사용 횟수 게이트/마킹/비용 미지불 롤백 이식.
2. **턴 시작 효과로 메모리가 넘어간 채 main 진입 시 Pass 선언** (MEM: auto-end 조건이 참인데 CPU 가 패스 -> 상대 메모리 3 고정)
   수정: `cpusim.mainLoop` 시작에서 `E.checkAutoEndTurn` 선확인.
3. **【메인】 능력의 비용이 이미 못 내는데 계속 선택** (EX7-065 유우키: `if 조건 -> costGroup` 래퍼라 `mainAbilityPayable` 이 항상 true)
   수정: `effects.js mainAbilityPayable` 이 선두 `condition -> costGroup` 래퍼를 풀어서 비용 검사. + cpusim 에 「같은 main 키 한 턴 3회 이상이면 금지」 안전장치.
4. **BT1-089 이미나: 육성 에어리어가 차 있어 부화/이동 불가인데 테이머만 레스트** — `cpu.js` 후보에서 제외.
5. **아무것도 못 하는 공격 선언을 매 액션 재시도** (가드로몬 「상대 디지몬이 없는 동안 어택 불가」 — 거절 로그가 진행으로 오인되어 40회 반복)
   수정: `state.js cannotAttackNoOppDigimon` 신설(declareAttack 과 공유) + `cpu.js canDeclareAttack` 에 반영 + cpusim 이 선언 거절/진화 거절/조그레스 거절/트레이닝 거절 시 그 액션 키를 즉시 금지.
6. **옵션 사용 봉인(s1cannotUseOption) 중인데 옵션 반복 사용 시도** (BT22-100/BT5-100/EX8-069 x8 반복) — `cpu.js canUseOptionNow` 에 `S.s1HookAny('s1cannotUseOption')` 추가.
7. **레스트 불가 디지몬으로 《트레이닝》 반복** — `cpu.js` 트레이닝 후보에 `canRestByRule` 추가 (거절이 cpusim 에서 금지 처리됨).
8. **《불굴》로 재등장한 디지몬이 DP<=0 인 채 생존** (BT4-106 퍼지 샤인 「상대 디지몬 전부 DP -3000」이 나중에 들어온 디지몬에도 적용 + 불굴 재등장 시 룰체크 누락, ST18-02)
   수정: `state.js deleteStack` 불굴 경로에서 `ruleCheckDP + ruleSweepDP`.
9. **효과 처리 중(공개한 카드가 덱 위에 남아 있음) 큐잉된 「드로우/덱 파기」 【등장 시】가 즉시 자동 처리되어 카드 복제/소실** (CONS DUP+LOST: BT10-105 【시큐리티】 + 피코데블몬 「덱 위 2장 파기」가 공개 중인 카드를 트래시로 보냄 -> 이후 "나머지 덱 아래로"가 같은 카드를 다시 넣음)
   수정: `state.js tryAutoApplySegment` — `_rcDepth > 0`(효과 처리 중)일 때는 드로우/덱 파기 자동 적용을 하지 않고 pending 큐로 대기.
10. **조건부 DP 보너스가 사라지면서 DP<=0 이 되었는데 룰체크가 안 돎** (ST12-06 바오헉몬: 공격 중/레스트 등에 따라 +1000 이 붙었다 떨어짐)
    수정: `engine.js checkAutoEndTurn` 앞에서(액션 사이마다) `ruleSweepDP` 실행 + `state.js s8AttackEnded` 에서도 스윕.
11. (헌트 도구 정정) 탐지기 오탐 제거: 배틀 에어리어에 놓인 딜레이 옵션, 스택 소유권(외부 소유 top), 진화 검증은 `E.evolutionMethods` 기준.

회귀 테스트: `scripts/test-hunt-regress.mjs` (mainLoop 자동 종료, once-per-turn, EX7-065 비용, 불굴 DP 룰체크, 덱 파기 대기) — 전부 OK.
수정 후 확인: `soak.mjs 40` 0 에러 / `audit-effects.mjs` 100% / `fuzz.mjs --gen random --games 100` 0 findings / `test-cpu.mjs` 정상 / 헌트 재배치 클린.

## 남은 것
- **CPU 낭비 액션(REJECT main)**: 효과가 아무 일도 못 하는 【메인】(주로 테이머 「레스트하는 것으로 …」: BT17-085/086, BT19-084/086/088, BT7-085/087, BT14-086/087, BT15-086, BT16-086/087/090, BT25-089/092, ST17-02/10, P-012, P-224, EX5-064, EX11-071 …)을 CPU 가 1회 시도(비용만 지불) 후 금지. 원인은 "실행 가능성 사전 검증"이 없는 것. 규칙 위반은 아님. (개선안: 카드별 적용 가능 조건 검사 또는 스냅샷 드라이런)
- **CONS OWNER (소수, 약 2만 게임당 1건)**: 외부 소유 카드를 다루는 효과 (BT19-102 루미나몬 유라 「상대 진화원에서 등장」, BT17-075 에오스몬, BT26-086/BT26-007 링크 계열, 보안카드를 상대 패로 가져가는 시큐리티 효과). fuzz 의 "foreign stack: known limitation" 과 같은 계열. 예: spec `{"seed":70466689,"a":"theme","b":"theme","la":"easy","lb":"normal"}`.
- **MANUAL fallback 빈도 상위** (전부 자동화 안 된 효과, 헌트 내 노출 빈도 순): BT24-099/BT21-100/BT24-098 《딜레이》 옵션(트리거형), BT14-088(육성->배틀 이동), BT24-062 「진화원에서 코스트 없이 등장」, BT26-031/BT25-043 〔아츠 진화〕 뒤절(「이 DP 마이너스 수치 -5000」/「상대 디지몬 모두 DP -5000」), BT4-098(블록당했을 때 메모리 +3 부여), BT8-040(파기한 카드의 색으로 취급), BT19-100 시큐리티, EX5-043, EX9-047(등장 코스트 마이너스), BT10-080(소멸 시 부여), BT15-102, EX12-059(겹쳐진 카드 파기 방지), BT26-066, BT25-074(진화 불가).
- **블라인드 스팟 (95장, 전 배치에서 필드 등장/효과 발동이 한 번도 없음)**: 대부분 특수 진화/조합 조건이 있는 카드(예: 링크·조그레스·어셈블리 전용). 목록:
  BT6-018 BT1-063 BT2-020 BT2-065 BT3-019 BT4-020 BT4-074 BT5-016 BT5-017 BT5-018 BT5-082 BT5-083 BT7-017 BT8-019 BT8-069 BT8-081 EX2-011 EX2-012 EX2-018 EX2-024 EX2-053 EX2-055 BT9-017 BT9-066 BT10-042 BT10-069 EX3-012 EX3-024 EX3-035 EX3-054 BT11-016 BT11-031 BT11-057 BT11-074 BT11-088 BT12-018 BT12-031 BT12-043 BT12-044 EX4-012 EX4-030 EX4-051 BT13-017 BT13-018 BT13-075 BT15-018 BT15-032 BT16-035 BT16-078 BT16-080 BT16-102 EX6-058 BT17-039 BT17-051 BT17-058 BT17-070 BT18-018 BT18-028 BT18-086 BT19-072 BT19-073 EX8-037 EX8-073 EX8-074 BT20-078 BT21-045 BT21-060 LM-039 LM-041 P-179 BT22-026 BT22-040 BT22-067 BT22-076 EX10-021 EX10-057 P-203 BT23-060 P-222 EX11-034 AD1-009 AD1-016 AD1-018 BT25-019 BT25-029 EX12-047 BT26-048 LM-062 LM-061 LM-060 LM-059 LM-058 LM-057 P-244 P-243.
  (옵션 8장 LM-057~062, P-243/244 는 발동 pending 이 한 번도 큐잉되지 않음 — CPU 가 사용하지 않거나 색/조건 미충족.)
  필드에 5회 이상 올랐지만 트리거 효과가 한 번도 큐잉되지 않은 카드(텍스트에 【등장 시】 등 태그 있음): BT2-007 BT5-085 EX2-007 BT9-061 BT10-025 ST14-06 EX4-004 ST16-07 BT14-048 BT14-069 EX6-008 EX6-038 EX6-040 EX6-042 BT17-074 BT18-033 EX8-008 BT21-065 EX9-005 (조건부 유발/구조상 해당 이벤트가 안 일어난 경우가 대부분이나 개별 확인 필요).
- 어려움+탐색 헌트는 노드 30 으로 축소해 표본이 적음(약 6%). 전수 재현은 `--levels hard4 --nodes 250` 로 별도 배치 권장.
- 다른 에이전트가 동시에 `state.js` 를 편집해 한 배치(stB)에서 일시적 `grantGate is not defined` 예외(편집 도중 상태)가 보였음 — 현재는 해소됨.
