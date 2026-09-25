// gh-pages 배포 (폰용 https://marhnie.github.io/fakealysion/): 작업 폴더가 아니라 "커밋된 HEAD" 기준으로 src/ index.html data/*.json 을 올린다.
// 모듈/CSS 주소에 ?v=<커밋> 를 붙이는 import map 을 만들어 브라우저 캐시(GitHub Pages max-age=10분) 때문에 새 main.js 와 옛 cpu.js 가 섞이는 사고를 막는다.
// 사용: node scripts/deploy-pages.mjs [--dry]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const head = sh('git rev-parse --short HEAD', { cwd: root });
if (sh('git status --porcelain -- src index.html data/cards.json data/cards_full.json', { cwd: root })) console.log('※ 커밋되지 않은 변경이 있습니다. 배포에는 포함되지 않습니다 (HEAD 기준).');
const DATA = ['cards', 'cards_full', 'decks', 'dgchub_keywords', 'dgchub_tokens', 'parallels'].map(n => `data/${n}.json`);
for (const extra of ['data/cpu-decks.json', 'data/cpu-params.json']) { try { sh(`git cat-file -e HEAD:${extra}`, { cwd: root }); DATA.push(extra); } catch { /* optional */ } }

sh('git fetch -q origin gh-pages', { cwd: root });
const TMPROOT = path.join(root, 'scratch', 'tmp'); fs.mkdirSync(TMPROOT, { recursive: true }); // C: 드라이브는 쓰지 않는다 (사용자 지시)
const W = fs.mkdtempSync(path.join(TMPROOT, 'ghp-'));
fs.rmSync(W, { recursive: true, force: true });
sh('git worktree prune', { cwd: root });
sh(`git worktree add -q -f "${W}" origin/gh-pages`, { cwd: root });
try {
  sh('git checkout -q -B gh-pages-deploy origin/gh-pages', { cwd: W });
  fs.rmSync(path.join(W, 'src'), { recursive: true, force: true });
  fs.rmSync(path.join(W, 'assets'), { recursive: true, force: true });
  // MSYS tar(Git for Windows 번들)에 역슬래시 경로를 넘기면 cmd.exe -> msys 이중 이스케이프로 깨진다 (한글 등 비ASCII 경로에서 특히 두드러짐) — 슬래시로 바꿔서 넘긴다
  const Wposix = W.split(path.sep).join('/');
  let hasAssets = true;
  try { sh('git cat-file -e HEAD:assets', { cwd: root }); } catch { hasAssets = false; }
  sh(`git archive HEAD src index.html ${hasAssets ? 'assets ' : ''}${DATA.join(' ')} | tar -x -C "${Wposix}"`, { cwd: root, shell: true });
  const files = sh('git ls-tree -r --name-only HEAD src', { cwd: root }).split('\n').filter(f => /\.(js|css)$/.test(f));
  const imports = {};
  for (const f of files) if (f.endsWith('.js')) imports['./' + f] = `./${f}?v=${head}`;
  let html = fs.readFileSync(path.join(W, 'index.html'), 'utf8');
  html = html.replace(/href="(\.\/src\/[^"?]+\.css)"/g, `href="$1?v=${head}"`);
  // import map은 모듈 "안"에서 하는 import만 다시 쓴다 — 진입점 <script type="module" src="...">의 src 자체는 import map의 적용 대상이
  // 아니라서, 이걸 그대로 두면 이 파일 하나만 GitHub Pages 캐시(약 10분)에 갇혀 정작 새로 배포한 main.js가 안 실행되는 사고가 난다.
  html = html.replace(/(<script type="module" src="\.\/src\/[^"?]+\.js)(")/, `$1?v=${head}$2`);
  html = html.replace('<script type="module"', `<script type="importmap">${JSON.stringify({ imports })}</script>\n  <script type="module"`);
  fs.writeFileSync(path.join(W, 'index.html'), html);
  if (!fs.existsSync(path.join(W, '.nojekyll'))) fs.writeFileSync(path.join(W, '.nojekyll'), '');
  sh('git add -A', { cwd: W });
  const changed = sh('git status --porcelain', { cwd: W });
  if (!changed) console.log('변경 없음');
  else {
    sh(`git commit -q -m "Pages 배포용 정적 파일 갱신 (${head}, import map 캐시 버전)"`, { cwd: W });
    if (dry) console.log('dry-run: 커밋만 만들고 푸시하지 않음');
    else { sh('git push -q origin gh-pages-deploy:gh-pages', { cwd: W }); console.log(`배포 완료: gh-pages ← ${head}`); }
  }
} finally {
  try { sh(`git worktree remove --force "${W}"`, { cwd: root }); } catch { /* ignore */ }
  try { sh('git branch -D gh-pages-deploy -q', { cwd: root }); } catch { /* ignore */ }
}
