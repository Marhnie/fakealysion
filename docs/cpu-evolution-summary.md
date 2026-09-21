# CPU 진화 종합 요약 (덱 짜기 + 플레이 강도 + UI 통합)

- 덱 진화 리포트: [cpu-deck-evolution.md](cpu-deck-evolution.md) (`src/cpudeck.js`, `scripts/evolve-decks.mjs`, `data/cpu-decks.json`)
- 플레이 강도 리포트: [cpu-play-evolution.md](cpu-play-evolution.md) (새 레벨 '전문가', `data/cpu-params.json`)

## UI에 연결한 것 (`src/main.js`)
1. 시작 화면(CPU 모드) P2 덱 선택에 'CPU 추천/진화 덱' 그룹(이름 + 색 이모지 + 측정 승률)과 '🎲 랜덤 CPU 덱'. 키는 `cpu:<이름>` / `cpu:__random`이며 `resolveDeckPick`이 해석. 랜덤은 게임 시작 때 한 번 뽑고, '시작 핸드 다시 뽑기'는 다시 뽑는다.
2. CPU 강도 버튼에 '전문가' 포함(쉬움/보통/어려움/전문가).
3. 덱 빌더에 '🤖 CPU가 덱 짜주기'(색 선택/자동, 세트 선택) → `buildDeckFromCollection` 결과로 초안을 채우고 기존 체크업 패널이 그대로 결과를 보여 주며 이후 자유롭게 수정 가능.
4. 배포: `scripts/deploy-pages.mjs`가 `data/cpu-decks.json`, `data/cpu-params.json`을 (커밋돼 있으면) 올린다. 로더(`loadCpuDecks`, `Cpu.loadParams`)는 상대 URL로 가져오고 파일이 없어도 오류 없이 넘어간다.
5. CPU 대 CPU 관전 모드는 만들지 않았다(선택 사항).

## 확인한 것
- 실제 브라우저(dev server 5588): 진화 덱 상대로 전문가·어려움(랜덤 CPU 덱)·보통·쉬움 각각 게임 시작, 턴 4~10까지 진행. 자바스크립트 오류 0(내 스크립트 외), 데이터 파일 200 로드. 덱 빌더 '초록' 자동 짜기 → 메인 50/디지타마 4 채워지고 체크업 표시.
- 회귀: check-syntax, audit-effects 100%, soak 60 (0 error), test-cpu OK, test-all 22단계 전부 통과(test-cpu-search 포함), test-ui-regress OK.

## 확인하지 못한 것 / 한계
- 화면 캡처는 브라우저 패널이 숨김 상태라 타임아웃되어 찍지 못했다(DOM으로만 확인).
- UI에서의 결정 시간은 따로 재지 않았다. 전문가 결정 시간은 B 리포트의 헤드리스 측정(중앙값 0.7초, p95 1.4초)을 따른다. 사람 쪽은 자동 '패스'만 눌렀으므로 사람 조작 경로는 검증하지 않았다.
- 진화 덱 승률(스타터 상대 약 73%)은 헤드리스 자가대전 수치이며, 전문가 이득은 어려움 대비 54.8%로 작다. 두 리포트의 한계(레드 편중, 탐색 평가 가중치 미튜닝)가 그대로 남아 있다.
