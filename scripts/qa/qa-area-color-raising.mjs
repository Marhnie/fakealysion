// "에어리어에 … 자신의 디지몬/테이머가 있는 동안, 이 카드는 색 조건을 무시" 옵션 23장: 배틀 에어리어에서 충족되는 카드는 육성 에어리어에서도 충족 (공식 Q&A 4970). Run: node scripts/qa/qa-area-color-raising.mjs < /dev/null
import { S, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const opts = Object.values(S.CARDS).filter(c => c.category === 'option' && /에어리어에[^.\n]{0,50}있는 동안[^.\n]*색 조건을 무시|에어리어에[^.\n]{0,50}있다면[^.\n]*색 조건을 무시/.test((c.effectKo || '')) && !/(?:배틀|육성) 에어리어에/.test((c.effectKo || '').split('\n')[0]));
const cands = Object.values(S.CARDS).filter(c => (c.category === 'digimon' || c.category === 'tamer') && c.colors.length);
let tested = 0, skipped = [];
for (const o of opts) {
  const need = new Set(o.colors);
  const fine = cands.filter(c => !c.colors.some(k => need.has(k))); // colours that do NOT satisfy the colour condition by themselves
  const hit = fine.find(c => { const st = mk(); const sk = put(st, 'p1', c.id); if (S.stackColors(sk).some(k => need.has(k))) return false; /* 다른 색으로도 취급하는 카드는 제외 */ return S.optionColorOk(st, 'p1', o.id); });
  if (!hit) { skipped.push(o.id); continue; }
  tested++;
  T(tested, `${o.id} ${o.nameKo}: 배틀 에어리어에서 충족 → 육성 에어리어에서도 충족 (${hit.id})`, async () => {
    const st = mk(); ok('처음엔 불가', !S.optionColorOk(st, 'p1', o.id));
    const ra = S._s4.makeStack(hit.id, 1); st.players.p1.raising = ra; S.recomputeStackGrants(ra);
    const neg = fine.find(c => c.id !== hit.id && !(S.card(c.id).types || []).some(t => (S.card(hit.id).types || []).includes(t) && false) && (() => { const s2 = mk(); const k = put(s2, 'p1', c.id); return !S.stackColors(k).some(x => need.has(x)) && !S.optionColorOk(s2, 'p1', o.id); })()); // 조건을 만족하지 않는 카드는 배틀 에어리어에 있어도 불가
    ok('조건 불충족 카드는 불가(음성 대조)', !!neg);
    ok('육성 에어리어에서 가능', S.optionColorOk(st, 'p1', o.id));
  });
}
console.log('options', opts.length, 'tested', tested, 'skipped', skipped.join(','));
await runAll('qa-area-color-raising');
