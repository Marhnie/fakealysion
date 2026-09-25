// build-cards.mjs's colors 파싱이 color1/color2만 읽고 color3를 빠뜨려서, BT20-102(오메가몬 X항체) 등 3색 카드가
// 2색으로 잘못 빌드되던 버그의 회귀 테스트. 원본(dgchub_cards_raw.json)의 색 개수와 빌드된 cards_full.json의
// 색 개수가 항상 일치해야 한다 (raw 쪽에 color1~color3 모두 있으면 3개가 그대로 나와야 함).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = JSON.parse(readFileSync(path.join(root, 'data/dgchub_cards_raw.json'), 'utf-8'));
const built = JSON.parse(readFileSync(path.join(root, 'data/cards_full.json'), 'utf-8'));
const builtById = Object.fromEntries((Array.isArray(built) ? built : Object.values(built)).map((c) => [c.id, c]));

let pass = 0, fail = 0;
const bad = [];
for (const c of raw) {
  const expected = [c.color1, c.color2, c.color3].filter(Boolean).length;
  const b = builtById[c.cardNo];
  if (!b) continue; // not every raw entry necessarily ships (e.g. filtered categories) — not this test's concern
  const actual = (b.colors || []).length;
  if (actual === expected) pass++; else { fail++; bad.push(`${c.cardNo}: raw ${expected}색 vs built ${actual}색 (${(b.colors||[]).join('/')})`); }
}
console.log(`qa-card-colors-3plus: ${raw.length}장 중 색 개수 일치 ${pass}, 불일치 ${fail}`);
if (fail) { console.log(bad.slice(0, 20).join('\n')); process.exitCode = 1; }
// 대표 사례 직접 확인: BT20-102는 반드시 blue/white/red 3색이어야 한다
const bt20102 = builtById['BT20-102'];
const ok3 = bt20102 && ['blue', 'white', 'red'].every((c) => bt20102.colors.includes(c)) && bt20102.colors.length === 3;
console.log(`BT20-102 3색(blue/white/red) 확인: ${ok3 ? 'OK' : 'FAIL got ' + JSON.stringify(bt20102 && bt20102.colors)}`);
if (!ok3) process.exitCode = 1;
