// BT22-099 쿠레미 탐정사무소: "에어리어에 특징 「CS」를 가진 자신의 디지몬/테이머가 있는 동안, 이 카드는 색 조건을 무시할 수 있다" — 특징 참조 확인. Run: node scripts/qa/qa-kuremi-office.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const card = S.card('BT22-099');
const csDigi = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('CS') && c.level >= 3 && !c.colors.some(k => (card.colors || []).includes(k)))?.id;
const csTamer = Object.values(S.CARDS).find(c => c.category === 'tamer' && (c.types || []).includes('CS') && !c.colors.some(k => (card.colors || []).includes(k)))?.id;
const other = Object.values(S.CARDS).find(c => c.category === 'digimon' && !(c.types || []).includes('CS') && !c.colors.some(k => (card.colors || []).includes(k)) && c.level >= 3)?.id;
console.log('option colors', card.colors, 'csDigi', csDigi, 'csTamer', csTamer, 'other', other);
T(1, '색이 안 맞고 CS 특징이 아닌 디지몬만 있으면 사용 불가', async () => { const st = mk(); put(st, 'p1', other); ok('불가', !S.optionColorOk(st, 'p1', 'BT22-099')); });
T(2, '에어리어에 특징 CS 디지몬이 있으면 색 조건 무시', async () => { const st = mk(); put(st, 'p1', csDigi); ok('가능', S.optionColorOk(st, 'p1', 'BT22-099')); });
T(3, '에어리어에 특징 CS 테이머가 있으면 색 조건 무시', async () => { const st = mk(); put(st, 'p1', csTamer); ok('가능', S.optionColorOk(st, 'p1', 'BT22-099')); });
T(4, '상대의 CS 디지몬은 세지 않는다', async () => { const st = mk(); put(st, 'p2', csDigi); put(st, 'p1', other); ok('불가', !S.optionColorOk(st, 'p1', 'BT22-099')); });
T(5, '아무 것도 없으면 사용 불가', async () => { const st = mk(); ok('불가', !S.optionColorOk(st, 'p1', 'BT22-099')); });
T(6, '육성 에어리어의 특징 CS 디지몬도 "에어리어에 … 있는 동안"으로 인정 (공식 Q&A: 배틀 에어리어 또는 육성 에어리어)', async () => {
  const st = mk(); const ra = S._s4.makeStack(csDigi, 1); st.players.p1.raising = ra; S.recomputeStackGrants(ra);
  ok('가능', S.optionColorOk(st, 'p1', 'BT22-099'));
});
T(7, '육성 에어리어의 CS가 아닌 디지몬은 인정하지 않는다', async () => { const st = mk(); const ra = S._s4.makeStack(other, 1); st.players.p1.raising = ra; ok('불가', !S.optionColorOk(st, 'p1', 'BT22-099')); });
await runAll('qa-kuremi-office');
