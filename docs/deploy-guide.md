# HTML(정적 파일) 배포 방법 — GitHub Pages

이 프로젝트는 빌드 단계가 없는 순수 정적 HTML/JS/CSS 앱이라, "배포"는 결국 `index.html` + `src/*` + `data/*.json`을 `gh-pages` 브랜치에 그대로 올리는 것이다. 실제 서비스 주소: **https://marhnie.github.io/fakealysion/** (폰에서 접속하는 그 주소).

## 한 줄 요약

```bash
node scripts/deploy-pages.mjs
```

이 한 줄이면 끝난다. 아래는 이게 정확히 뭘 하는지, 그리고 언제/왜 돌려야 하는지에 대한 설명이다.

## 언제 돌려야 하나

- `git commit`으로 뭔가를 **커밋한 직후**. 스크립트는 작업 폴더(working tree)가 아니라 **커밋된 HEAD 기준**으로 파일을 가져가기 때문에, 커밋 안 한 변경은 절대 폰에 반영되지 않는다.
- 커밋 없이 그냥 돌리면 "변경 없음" 또는 이미 배포된 것과 같은 내용이 다시 올라간다 (해롭진 않지만 의미 없음).
- 커밋했는데 깜빡하고 이 스크립트를 안 돌리면, 코드는 GitHub `main` 브랜치엔 있는데 폰 화면(gh-pages)엔 안 보이는 상태가 된다 — 이번 세션에서 실제로 몇 번 나온 혼란("덱빌더 정렬 버그가 재현이 안 됨 → 예전 배포본을 보고 있었을 가능성")이 바로 이 케이스다.

## `scripts/deploy-pages.mjs`가 하는 일 (순서대로)

1. **HEAD 확인**: `git rev-parse --short HEAD`로 지금 커밋 해시를 구함. 커밋 안 된 변경이 `src/`나 `index.html`, 카드 데이터에 있으면 경고만 찍고 무시함.
2. **원격 gh-pages 최신화**: `git fetch origin gh-pages` — 로컬에 없어도 되게.
3. **임시 워크트리 생성**: `D:\닼웤롴덬\digimon-sim\scratch\tmp\ghp-*` 밑에 `origin/gh-pages`를 체크아웃한 별도 작업 폴더를 만든다 (⚠ **C: 드라이브를 쓰지 않기 위해 일부러 scratch 밑에 만듦** — 이 프로젝트의 절대 규칙).
4. **파일 갈아끼우기**: 그 워크트리의 기존 `src/`를 지우고, `git archive HEAD`로 커밋된 `src/`, `index.html`, 카드 데이터 JSON들(`cards`, `cards_full`, `decks`, `dgchub_keywords`, `dgchub_tokens`, `parallels`, 있으면 `cpu-decks`/`cpu-params`)만 뽑아서 그 자리에 풀어놓는다.
5. **캐시 무효화(import map)**: GitHub Pages는 정적 파일을 약 10분 캐시한다. 오래된 `cpu.js`와 새 `main.js`가 섞여서 로드되는 사고를 막기 위해, 모든 JS/CSS 경로에 `?v=<커밋해시>`를 붙이는 [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)을 `index.html`에 자동 주입한다. 즉, 브라우저가 실제로 요청하는 URL은 `./src/main.js?v=a13f74d` 같은 식이 되어, 커밋이 바뀌면 무조건 새 파일을 받는다.
6. **커밋+푸시**: 워크트리에서 변경이 있으면 `Pages 배포용 정적 파일 갱신 (<해시>, import map 캐시 버전)`이라는 메시지로 커밋하고, `gh-pages` 브랜치로 푸시한다. `--dry` 플래그를 주면 커밋까지만 하고 푸시는 안 한다.
7. **정리**: 임시 워크트리와 로컬 브랜치를 삭제한다.

## 자주 헷갈리는 점

- **"커밋했는데 폰에 안 보여요"** → `deploy-pages.mjs`를 안 돌렸거나, 돌렸는데 그 시점 HEAD가 원하는 커밋이 아니었을 가능성. `git log -1`로 지금 HEAD를 확인하고 다시 돌리면 됨.
- **"배포했는데도 옛날 버전이 보여요"** → 브라우저/GitHub Pages 캐시. import map 덕분에 파일 자체는 캐시 무효화되지만, `index.html` 자체는 여전히 몇 분간 캐시될 수 있다. 새로고침(강제 새로고침) 또는 몇 분 대기.
- **이 프로젝트가 git 저장소가 아니라고 나올 때가 있음** — 세션 환경이 가끔 cwd를 프로젝트 상위 폴더로 표시하는 경우가 있는데, 실제로는 `D:\닼웤롴덬\digimon-sim`이 저장소 루트다. 명령을 그 디렉터리에서 실행하면 정상 동작한다.

## 다른(비슷한 구조의) 프로젝트에 이 방식을 그대로 쓰고 싶다면

이 스크립트는 이 프로젝트에 특화돼 있진 않고, "빌드 없는 정적 앱을 GitHub Pages로, 캐시 문제 없이" 배포하는 일반적인 패턴이다. 재사용하려면:

1. GitHub 저장소에 `gh-pages`라는 빈 브랜치를 하나 만들어 둔다(`git checkout --orphan gh-pages && git commit --allow-empty -m init && git push origin gh-pages`).
2. GitHub 저장소 설정(Settings → Pages)에서 소스를 `gh-pages` 브랜치로 지정한다.
3. 이 스크립트의 `DATA`(데이터 파일 목록)와 `git archive` 대상 경로(`src`, `index.html`)를 자기 프로젝트 구조에 맞게 바꾼다.
4. 캐시 문제가 없는 프로젝트라면 5번(import map 주입) 단계는 통째로 생략해도 된다 — 단순히 `git archive HEAD | tar -x`만으로 충분하다.
