// 카드풀 자동 갱신: dgchub.com 의 공개 정적 JSON 을 내려받아 신규/수정 카드를 data/ 에 반영한다.
//   node scripts/update-cards.mjs            # 확인만 (dry-run): 신규/수정 카드 목록
//   node scripts/update-cards.mjs --apply    # data/dgchub_cards_raw.json 갱신 + build-cards + 트레이트 보충 + 효과 커버리지 점검
// 출처: https://dgchub.com/version.json -> assets/assets/data/cards.<버전>.json (gzip 일 수 있음), tokens.<버전>.json
// 저작권: 카드 데이터는 원본 그대로 재배포하지 않는다는 점에 유의 (이 저장소의 data/*.json 은 기존과 같은 가공 결과물).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://dgchub.com';
const apply = process.argv.includes('--apply');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let b = Buffer.from(await r.arrayBuffer());
      if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
      return b;
    } catch (e) { if (i === tries - 1) throw new Error(`${url}: ${e.message}`); await sleep(2000 * (i + 1)); }
  }
}
const kor = (c) => (c.localeCardData || []).find(l => l.locale === 'KOR') || {};

const ver = JSON.parse((await get(`${BASE}/version.json`)).toString('utf8'));
console.log('원격 버전', JSON.stringify(ver));
const remote = JSON.parse((await get(`${BASE}/assets/assets/data/cards.${ver.cards}.json`)).toString('utf8'));
if (!Array.isArray(remote) || remote.length < 5000) throw new Error(`원격 카드 목록이 이상합니다 (${remote && remote.length}장) — 갱신 중단`);

const rawPath = path.join(root, 'data/dgchub_cards_raw.json');
const local = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const lmap = new Map(local.map(c => [c.cardId, c]));
const added = remote.filter(c => !lmap.has(c.cardId));
const changed = remote.filter(c => lmap.has(c.cardId) && lmap.get(c.cardId).modifiedAt !== c.modifiedAt);
const rset = new Set(remote.map(c => c.cardId));
const localOnly = local.filter(c => !rset.has(c.cardId));
console.log(`로컬 ${local.length}장 / 원격 ${remote.length}장 → 신규 ${added.length}, 수정 ${changed.length}, 로컬에만 있음 ${localOnly.length}`);
const sets = {};
for (const c of added) { const k = String(c.cardNo).split('-')[0]; sets[k] = (sets[k] || 0) + 1; }
console.log('신규 세트별:', JSON.stringify(sets));
for (const c of added.slice(0, 30)) console.log('  +', c.cardNo, kor(c).name || '', c.cardType, c.releaseDate);
for (const c of changed.slice(0, 20)) console.log('  ~', c.cardNo, kor(c).name || '');

if (!apply) { console.log('\n(dry-run) 반영하려면 --apply'); process.exit(0); }
if (!added.length && !changed.length) { console.log('변경 없음 — 반영할 것이 없습니다'); process.exit(0); }

// 1) raw 갱신: 원격을 기준으로 하되 로컬에만 있는 카드는 유지
fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
fs.writeFileSync(path.join(root, 'scratch/dgchub_cards_raw.backup.json'), fs.readFileSync(rawPath));
const merged = [...remote, ...localOnly];
fs.writeFileSync(rawPath, JSON.stringify(merged));
// (토큰 목록 data/dgchub_tokens.json 은 저장소에서 원본과 형식이 달라 자동 갱신하지 않는다 — 새 토큰이 필요하면 수동으로 확인)

// 2) 가공 (cards_full.json / cards.json)
const run = (cmd) => execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
console.log(run('node scripts/build-cards.mjs').trim().split('\n').slice(-3).join('\n'));
// 3) 비어 있는 트레이트 보충 (공식 카드 목록 기준, 이미 채운 사전이 있으면 재사용)
try { console.log(run('node scripts/fill-missing-traits.mjs').trim().split('\n').slice(-3).join('\n')); } catch (e) { console.log('트레이트 보충 건너뜀:', String(e.message).split('\n')[0]); }

// 4) 신규 카드 효과 커버리지 점검 (컴파일되지 않는 효과가 있는 신규 카드 목록)
const newNos = added.map(c => c.cardNo);
fs.writeFileSync(path.join(root, 'scratch/new-cards.json'), JSON.stringify(newNos));
console.log(`\n신규 카드 ${newNos.length}장의 번호를 scratch/new-cards.json 에 기록했습니다.`);
console.log('다음 단계: node scripts/audit-effects.mjs 로 새 카드의 효과 커버리지를 확인하고, 미커버 효과는 src/cards/shard*.js 에 구현하세요.');
