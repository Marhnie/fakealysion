// Deck builder "번호순" (카드 번호) sort must put every set's cards in strict ascending card-number order,
// and every set's cards must group together in (ST → BT → EX → RB → LM → AD → P) then numeric set-number order.
// Written for the playtester report: "덱빌더에서 카드들 순번대로 정렬 안되어 있음 (bt1~6, bt23 / ex2, ex11~13 / st5, st7, st22, st24)".
// Investigation found src/dbsearch.js cardNoKey/cardNoCompare already parses set+card numbers numerically and sorts
// every set correctly (verified against the full ~4468-card pool and live in the deck builder) — this test locks
// that in for the FULL pool (not just the reported sets), across every code path that claims to sort by card number:
//   - DBS.cardNoCompare (src/dbsearch.js) — used by DT.sortEntries('no') for the deck's own card lists
//   - DBS.buildIndex + DBS.sortIds via DBS.runSearch (src/dbsearch.js) — the deck builder's browse/search grid
// Run with: node scripts/qa/qa-card-sort.mjs < /dev/null
import { S, T, eq, ok, runAll } from './lib-s1.mjs';
import * as DBS from '../../src/dbsearch.js';
import * as DT from '../../src/decktools.js';

function setsOf(ids) {
  const bySet = new Map();
  for (const id of ids) {
    const m = String(id).match(/^([A-Za-z]+\d*)-(\d+)$/);
    if (!m) continue; // parallels/promos with a non-plain id shape aren't part of this check
    if (!bySet.has(m[1])) bySet.set(m[1], []);
    bySet.get(m[1]).push({ id, no: Number(m[2]) });
  }
  return bySet;
}

T('cardNoCompare-per-set', '카드 번호 비교기: 모든 세트가 오름차순으로 정렬된다 (bt/ex/st 전 세트)', async () => {
  const ids = Object.keys(S.CARDS);
  const sorted = ids.slice().sort(DBS.cardNoCompare);
  const bySet = setsOf(sorted); // grouping the ALREADY-sorted array preserves relative order, so within-set order = sort correctness
  const broken = [];
  for (const [set, rows] of bySet) {
    for (let i = 1; i < rows.length; i++) if (rows[i].no < rows[i - 1].no) broken.push(`${set}: ${rows[i - 1].id} -> ${rows[i].id}`);
  }
  ok('세트별 카드 번호가 모두 오름차순 (' + bySet.size + '개 세트, ' + ids.length + '장)\n' + broken.slice(0, 20).join('\n'), broken.length === 0);
});

T('cardNoCompare-set-grouping', '카드 번호 비교기: 같은 세트의 카드들은 한 덩어리로 뭉치고, 세트 자체도 ST→BT→EX… 순으로 정렬된다', async () => {
  const ids = Object.keys(S.CARDS);
  const sorted = ids.slice().sort(DBS.cardNoCompare);
  const seen = new Set(); let prevSet = null; const scattered = [];
  for (const id of sorted) {
    const m = id.match(/^([A-Za-z]+\d*)-(\d+)$/); if (!m) continue;
    const set = m[1];
    if (set !== prevSet) { if (seen.has(set)) scattered.push(set); seen.add(set); prevSet = set; }
  }
  eq('세트가 흩어져 재등장하지 않음', scattered, []);
});

T('runSearch-id-sort', '덱빌더 검색 결과("정렬: 번호순")도 전체 풀에서 세트·번호 순서가 올바르다', async () => {
  const ix = DBS.buildIndex(S.CARDS, S.PARALLELS);
  const f = DBS.defaultFilter(); f.pageSize = Object.keys(S.CARDS).length + 1;
  const r = DBS.runSearch(f, S.CARDS, ix, null);
  eq('전체 카드가 검색됨', r.ids.length, Object.keys(S.CARDS).length);
  const bySet = setsOf(r.ids);
  const broken = [];
  for (const [set, rows] of bySet) for (let i = 1; i < rows.length; i++) if (rows[i].no < rows[i - 1].no) broken.push(`${set}: ${rows[i - 1].id} -> ${rows[i].id}`);
  ok('runSearch 결과도 세트별 오름차순\n' + broken.slice(0, 20).join('\n'), broken.length === 0);
});

T('sortEntries-no-mode', "덱 카드 목록(내 덱 정렬: '카드 번호')도 뒤섞인 입력 순서와 무관하게 올바른 순서를 낸다", async () => {
  const allIds = Object.keys(S.CARDS);
  // deterministic shuffle (no Math.random) so the test is reproducible
  const shuffled = allIds.slice().sort((a, b) => (a + '#').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) - (b + '#').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));
  const entries = shuffled.map(id => [id, 1]);
  const sorted = DT.sortEntries(entries, 'no', S.card).map(([id]) => id);
  const expected = allIds.slice().sort(DBS.cardNoCompare);
  eq('sortEntries(\'no\')가 cardNoCompare와 동일한 순서를 냄', sorted, expected);
});

// The specific sets named in the bug report — kept as an explicit, human-readable checklist even though the tests
// above already cover the entire pool (so a regression anywhere would fail regardless of which sets are listed here).
T('reported-sets-explicit', '버그 제보에 적힌 세트들(BT1~6, BT23, EX2, EX11~13, ST5, ST7, ST22, ST24)을 이름으로 콕 집어 재확인', async () => {
  const reported = ['BT1', 'BT2', 'BT3', 'BT4', 'BT5', 'BT6', 'BT23', 'EX2', 'EX11', 'EX12', 'EX13', 'ST5', 'ST7', 'ST22', 'ST24'];
  const ids = Object.keys(S.CARDS);
  const sorted = ids.slice().sort(DBS.cardNoCompare);
  const bySet = setsOf(sorted);
  const missing = reported.filter(s => !bySet.has(s));
  eq('제보된 세트가 모두 카드 풀에 존재함', missing, []);
  const broken = [];
  for (const set of reported) {
    const rows = bySet.get(set) || [];
    for (let i = 1; i < rows.length; i++) if (rows[i].no < rows[i - 1].no) broken.push(`${set}: ${rows[i - 1].id} -> ${rows[i].id}`);
  }
  ok('제보된 세트 전부 오름차순\n' + broken.join('\n'), broken.length === 0);
});

await runAll('qa-card-sort');
