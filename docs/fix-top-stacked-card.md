# 최상단 카드(top stacked card) 해석 수정

## 규칙
"이 디지몬에 겹쳐져 있는 카드를 위에서부터 N장" / "이 디지몬의 최상단 카드"는 **스택의 맨 위 카드(디지몬 카드 자신)** 를 뜻한다. 그 다음 카드가 새 디지몬이 된다.
진화원(아래 깔린 카드)을 뜻하지 않는다. (공식 영문: "this Digimon's top stacked card", "the top card of this Digimon")

- 맨 위 카드가 이동/파기되면 바로 아래 카드가 디지몬이 된다 (이름/Lv/DP/색/효과 재계산, 링크 카드 재검사, DP 룰 체크, `[턴에 N회]` 초기화).
- 스택에 카드가 한 장뿐이면 그 카드가 유일한 카드이므로 스택 자체가 배틀 에어리어를 벗어난다 (소멸이 아니라 이동/파기).
- 뒷면 진화원(fdCount)은 새 최상단이 될 수 없다.

## 공통 헬퍼 (src/state.js)
- `detachTopStackCard(state, p, stack, cause)` — 최상단 분리 + 다음 카드 승격 (`{id, whole}`).
- `moveTopStackCard(state, p, stack, dest, opts)` — dest: `trash | secTop | secBottom | hand | deckTop | deckBottom` (`opts.faceUp` = 앞면 시큐리티). 이벤트 `topTrashed` / `topMoved`.
- `rotateTopStackToBottom(state, p, stack, cause)` — 최상단을 자기 진화원 맨 아래로. 이벤트 `sourceRotated` / `topPlaced` / `sourcesAdded(rotated)` (BT22-006, EX5-001/065, BT22-044/054).
- 《아머 퍼지》(state.js `trySurviveByKeyword`)와 버스트 진화 종료 시 파기(`burstEotFn`)도 최상단 카드를 파기하도록 수정. 《퇴화》(retreat)는 원래 맞았고 `topTrashed`만 추가.

## 카드별 결과
| 카드 | 상태 | 비고 |
|---|---|---|
| EX5-007/016, BT22-043/044/054/069 (진화원 [메인]) | 이미 수정됨 (shard20 rotateSource) | 검증 시나리오 추가 |
| EX5-064 | 이미 수정됨 (shard41/shard3) | |
| BT23-008/018 | 수정 (shard80) | 기존은 진화원을 회전시킴 |
| P-225 딜레이 | 수정 (shard80) | 기존은 수동 처리 |
| BT26-058 | 수정 (shard8 hook -> rotateTopStackToBottom) | |
| ST19-10/13, BT8-0xx 등 《아머 퍼지》 전부 | 수정 (state.js) | |
| BT13-020/033/060/092 버스트 진화 | 수정 (state.js burstEotFn) | 버스트 진화한 카드가 파기되고 원래 디지몬으로 복귀 |
| BT13-058, BT13-091, EX10-022 | 수정 (shard80) | |
| BT9-083 | 수정 (shard80) | |
| BT21-085, BT8-110 | 수정 (shard80 / shard1) | |
| BT13-107 | 수정 (shard80) | |
| BT21-030 (상대 디지몬 위에서 10장 파기) | 수정 (shard80) | 최상단 포함, 마지막 1장은 남김 (BT26-060과 동일 해석) |
| BT26-060 | 이미 올바름 | 검증 |
| BT9-044 | 수정 (shard1) | 최상단 카드를 뒷면으로 시큐리티 위에 |
| BT16-056 | 이미 올바름 (shard3) | 검증 |
| BT17-098, BT24-093, P-153 | 수정 (shard80) | 최상단 -> 시큐리티 위 |
| BT20-052/055, EX11-041/043 | 수정 (shard80, shard7 hook) | 최상단 -> 시큐리티 아래 앞면; 진화원이 없어도 발동 가능 |
| BT20-084 | 수정 (shard80) | |
| BT26-033 | 수정 (shard8) | 최상단 -> 시큐리티 아래 |
| BT21-094 | hook 수정 (shard5) | `topTrashed` 이벤트, 파기된 카드가 「아머체」인지 검사 |

## 테스트
`node scripts/qa/qa-topcard-audit.mjs < /dev/null` (34 시나리오). 새 파일: `src/cards/shard80.js` (index.js 마지막에 등록).
