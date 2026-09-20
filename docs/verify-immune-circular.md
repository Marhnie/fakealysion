# 「효과를 받지 않는다」 부여 기록 + EX10-010 미러(순환 조건) 검증

테스트: `node scripts/test-immune-grants.mjs < /dev/null` -> ALL PASS (95 assertions)

## Part A — 효과를 받지 않는 디지몬에 대한 효과 부여 (룰 15-15-5)

| 룰 | 처리 |
|---|---|
| 15-15-5-1 결과를 받지 않음 | 소멸/레스트/바운스/퇴화/진화원 파기 등 1회성 처리는 그대로 결과 없음 (`effectBlocked`) |
| 15-15-5-3 대상으로는 선택 가능 | `wrapChoose`: `IMMUNE_SAFE_OPS`(destroy, destroySum, retreat, bounce류, rest(All), trashEvoSources, modifyDP(All), setDP, grantKeyword, restrictAttack(Player))는 면역 디지몬을 대상 후보에서 빼지 않음. 그 외 op는 기존 필터 유지 |
| 15-15-5-4 부여해도 갖지 않음 | 면역 중에는 effectiveDP/hasKeyword/공격 제한/S어택 등에서 비활성 |
| 15-15-5-2 면역이 끝나면 즉시 적용 | 부여를 `stack.deferred`에 **기록**(출처 player/category/cardId, 종류, 절대 만료 턴). 읽기 시점(`settleDeferred`)에 출처 효과에 대해 더 이상 면역이 아니면 원래 만료 그대로 적용 |

중앙 헬퍼: `S.grantGate(state,p,stack,kind,spec)` (true면 바로 적용, false면 기록만) + `S.settleDeferred`. 적용 대상: grantKeyword(S어택 포함), modifyDP, s7AddDpMod, restrictAttack, restrictAttackPlayer, setSkipNextUnsuspend, noBlock 플래그(`setS3FlagFx`). 정산 지점: effectiveDP, hasKeyword, securityAttackBonus, s3Flag, 어택 선언, canAttackPlayer, 액티브 페이즈.

- 면역은 **효과별**로 판정: 출처(`state._fxSrc`)의 player/category. 상대 디지몬 효과만 막는 면역이면 상대 옵션/자신의 효과는 즉시 적용, 상대 디지몬 효과는 기록. 자신의 효과로 부여하면(요청 5) 항상 즉시 적용.
- 지속시간: 부여 시점 기준 만료 턴을 저장하므로 면역 기간이 지속시간을 늘리지 않음. 만료된 기록은 적용되지 않고 폐기.
- 한계(문서화): 이미 적용된 효과가 있는 상태에서 나중에 면역이 생겨도 기존 효과는 유지(기존 동작). 기록 대상 밖 op(lockOpp, preventRest, grantText, moveEach 등)는 기존처럼 후보 필터/개별 검사.

## Part B — EX10-010 블랙워그레이몬 미러

룰북 15-8-2(상시 효과)와 18-3(영구 순환)에는 서로의 DP에 의존하는 상시 조건에 대한 명시 규정이 없다. 18-3은 "처리의 연속"이 멈추지 않는 경우이며 상시 효과 판정은 처리가 아니므로 해당하지 않는다. 따라서 **최소 고정점(least fixed point)** 의미를 채택했다: 조건부 상시 효과는 자기 자신을 근거로 성립할 수 없고, 자기 순환 없이 성립하는 것만 유효.

구현: `S.condFix(key, fn)` — 같은 key가 평가 중이면 "성립하지 않음"으로 취급. 재귀를 펼치면 "조건부 효과 전부 비활성"에서 시작한 반복과 동일하며 매 읽기마다 처음부터 재계산(래칭/캐시 없음, 진동·무한재귀 없음). EX10-010의 dp와 effectImmune은 같은 key를 써서 항상 일치. 일반 조건(`DP N 이상의 상대의 디지몬이 있는/없는 동안`, `DP N 이상의 이 디지몬`)도 같은 경로(기존 전역 가드 `B11_DPGUARD` 대체). 고정점 평가 중에는 기록 정산을 하지 않음(가정 상태 오염 방지).

결과(12000 vs 12000):
- 양쪽 12000, 면역 없음.
- A에 +1000: B 15000+면역 -> A 16000+면역. 어택 시 16000 vs 15000, 서로의 디지몬 효과는 무효(옵션은 유효). A가 B에 준 +1000은 B가 면역인 동안 기록만 됨.
- +1000 만료: 둘 다 12000으로 복귀(서로를 지탱하지 못함), 면역 해제, 만료된 기록은 적용 안 됨. 면역이 도중에 풀리면 미만료 기록이 즉시 적용(15-15-5-2).
- 옵션 +3000(B): B 18000, A 15000; 종료 후 둘 다 12000.
- 일반 케이스(자신 BWG + 상대 13000 이상): 15000, 【서로의 턴】이므로 양쪽 턴에서 유지.
- 평가 순서 무관, 500회 반복 평가 문제 없음.

다른 카드: `DP N 이상의 상대의 디지몬이 있는 동안` 형태 개별 descriptor는 EX10-010뿐이고, 나머지 동형 조건은 state.js 범용 파서 경로(`contGrantCond`) -> `condFix` 사용.

회귀: soak 40 (오류 0), audit-effects 100%, fuzz random 200게임 (finding 0), test-census-regress OK.
