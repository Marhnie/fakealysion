// Slice3 round 2 part F: "open N, add one card per criterion" family (all possible cards must be added; a lone match is still added).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const F = (pred, skip = []) => cards.find(c => !c.isToken && pred(c) && !skip.includes(c.id))?.id;
const ty = (c, ...t) => (c.types || []).some(x => t.some(y => x.includes(y)));
const isDig = (c) => c.category === 'digimon', isOpt = (c) => c.category === 'option', isTam = (c) => c.category === 'tamer';
const junk = (avoid) => FILL.filter(id => !avoid.includes(id));

// [card, rest destination, N opened, A predicate, B predicate, Q for "as many as possible", Q for "only one criterion present", (optional) Q for "must add both"]
const FAM = [
  ['BT18-007', 'bottom', 3, (c) => c.nameKo.includes('밀레니엄몬') && isDig(c), (c) => ty(c, '합성형', '사신형') && isDig(c) && !c.nameKo.includes('밀레니엄몬'), 2909, null],
  ['BT18-030', 'bottom', 3, (c) => (c.attribute === '데이터종' || ty(c, '데이터종')) && c.colors?.includes('yellow') && !ty(c, '윗체르니'), (c) => ty(c, '윗체르니'), 2953, null],
  ['BT18-031', 'bottom', 3, (c) => ty(c, '하이브리드체', '10투사') && isDig(c), (c) => isTam(c) && c.colors?.includes('yellow') && /INH|겹쳐|진화원/.test(c.inheritedKo || '') && !!c.inheritedKo, 2954, null],
  ['BT18-010', 'bottom', 3, (c) => ty(c, '하이브리드체', '10투사') && isDig(c), (c) => isTam(c) && c.colors?.includes('red') && !!c.inheritedKo, 2912, null],
  ['BT19-017', 'bottom', 3, (c) => ty(c, '수생') && !ty(c, '리버레이터'), (c) => ty(c, '리버레이터') && !ty(c, '수생'), 3072, null],
  ['BT19-056', 'bottom', 3, (c) => ty(c, '용인형', '사이보그형') && isDig(c), (c) => isOpt(c) && ty(c, '디바이스'), 3115, null],
  ['EX2-047', 'bottom', 3, (c) => ty(c, '디·리퍼') && c.nameKo !== 'ADR-02=서쳐', (c) => c.nameKo === 'ADR-02=서쳐', 3343, null],
  ['EX7-007', 'bottom', 3, (c) => c.nameKo === '쿠리하라 히나', (c) => ty(c, '암룡형', '지룡형', '기룡형', '천룡형') && isDig(c), 3828, null],
  ['EX7-016', 'bottom', 3, (c) => /페일드라몬|헥세블라우몬/.test(c.nameKo) && isDig(c), (c) => ty(c, '빙설형') && !/페일드라몬|헥세블라우몬/.test(c.nameKo), 3841, null],
  ['EX7-008', 'bottom', 3, (c) => `${c.effectKo || ''}${c.inheritedKo || ''}`.includes('「3총사」') && !isOpt(c), (c) => isOpt(c) && c.cost === 6, 3829, null],
  ['EX4-038', 'top', 3, (c) => c.nameKo.includes('그레이몬') && isDig(c), (c) => /파피몬|가루몬|오메가몬/.test(c.nameKo) && isDig(c), 3486, 3487],
  ['EX3-007', 'bottom', 4, (c) => ty(c, '암룡형', '지룡형', '조룡형', '기룡형', '천룡형') && isDig(c), (c) => c.nameKo === '쿠리하라 히나', 3372, 3417],
  ['EX3-028', 'bottom', 4, (c) => ty(c, '천사형') && c.colors?.includes('yellow'), (c) => ty(c, '4대용'), 3404, 3407],
];
for (const [holder, dest, n, pa, pb, qAll, qOne] of FAM) {
  const A = F(pa, [holder]), B = F(pb, [holder, A]);
  if (!A || !B) { console.log('SKIP no fixture', holder, !!A, !!B); continue; }
  const j = junk([A, B]);
  const play = async (top) => { const st = newState(); const me = put(st, 'p1', [holder]); st.players.p1.deck = [...top, ...j.slice(0, 12)]; st.players.p1.hand = []; await trig(st, 'p1', me, 'play'); return st; };
  await sc('Q' + qAll, `${holder}: both matching cards among the opened ones are added (as many as possible; leftovers go ${dest})`, async () => {
    const st = await play([A, B, j[0], ...(n === 4 ? [j[1]] : [])]); const h = st.players.p1.hand;
    return all(eq('A in hand', h.includes(A), true), eq('B in hand', h.includes(B), true), eq('hand size', h.length, 2));
  });
  await sc('Q' + (qOne || qAll) + 'o', `${holder}: if only one criterion has a card among the opened, that single card is still added`, async () => {
    const st1 = await play([A, j[0], j[1], ...(n === 4 ? [j[2]] : [])]); const st2 = await play([j[0], B, j[1], ...(n === 4 ? [j[2]] : [])]);
    return all(eq('only A', st1.players.p1.hand.join(), A), eq('only B', st2.players.p1.hand.join(), B));
  });
}
finish('slice3-r2-f');
