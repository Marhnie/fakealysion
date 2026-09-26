// w4 recheck2 (rulings idx 2001-2667) batch F: EX1/EX2. Run: node scripts/qa/qa-w4-f.mjs < /dev/null
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const cards = Object.values(S.CARDS);
const dgOf = (pred) => cards.find(c => c.category === 'digimon' && c.dp && pred(c));

scenario('2545', 'EX1-005 in the RAISING area is not treated as green', async () => {
  const w = W({ p1: { raising: { id: 'EX1-005' } }, p2: {} });
  w.ok(!S.stackColors(w.p1.raising).includes('green'), 'raising: colors ' + S.stackColors(w.p1.raising));
  const w2 = W({ p1: { battle: [{ id: 'EX1-005' }] }, p2: {} });
  w2.ok(S.stackColors(w2.p1.stacks[0]).includes('green'), 'battle on own turn: green');
  return w;
});
scenario('2554', 'EX1-013 (Veemon) inherited: unsuspend effect on an ACTIVE digimon gives no memory', async () => {
  const w = W({ p1: { battle: [{ id: plain(4, 0), src: ['EX1-013'] }] }, p2: {}, memory: 0 });
  S.unsuspendStack(w.st, 'p1', w.p1.stacks[0].uid); await w.drain();
  w.eq(w.st.memory, 0, 'no memory (was already active)');
  const w2 = W({ p1: { battle: [{ id: plain(4, 0), src: ['EX1-013'], susp: true }] }, p2: {}, memory: 0 });
  S.unsuspendStack(w2.st, 'p1', w2.p1.stacks[0].uid); await w2.drain();
  w2.eq(w2.st.memory, 1, 'memory +1 when it really becomes active in main phase');
  return w;
});
scenario('2560', 'EX1-022: +1000 per colour among sources (4 blue cards = +1000, blue+red = +2000)', async () => {
  const blue = dgOf(c => c.colors.length === 1 && c.colors[0] === 'blue' && !c.effectKo).id, red = dgOf(c => c.colors.length === 1 && c.colors[0] === 'red' && !c.effectKo).id;
  const w = W({ p1: { battle: [{ id: 'EX1-022', src: [blue, blue, blue, blue] }, { id: 'EX1-022', src: [blue, red] }] }, p2: {} });
  const [a, b] = w.p1.stacks;
  w.eq(w.dp('p1', a), 11000 + 1000, 'four blue = one colour');
  w.eq(w.dp('p1', b), 11000 + 2000, 'blue+red = two colours');
  return w;
});
scenario('2561', 'EX1-026 inherited (DP -2000): stays when security later drops to 2', async () => {
  const big = plain(4, 0);
  const w = W({ p1: { security: [plain(3, 0), plain(3, 0), plain(3, 0)], battle: [{ id: plain(4, 1), src: ['EX1-026'] }] }, p2: { battle: [{ id: big }] } });
  await w.run('p1', w.p1.stacks[0].uid, '어택 시', { inherited: true, cardId: 'EX1-026' }).catch(() => {});
  const before = w.dp('p2', w.p2.stacks[0]);
  w.pl('p1').security.pop();
  w.eq(w.dp('p2', w.p2.stacks[0]), before, 'DP unchanged by later security drop');
  return w;
});
scenario('2591', 'EX1-055 inherited: two of your other digimon deleted at once -> only one draw', async () => {
  const w = W({ p1: { battle: [{ id: plain(4, 0), src: ['EX1-055'] }, { id: plain(3, 1) }, { id: plain(3, 2) }] }, p2: {}, deck: 10 });
  const h0 = w.pl('p1').hand.length;
  S.deleteStack(w.st, 'p1', w.p1.stacks[1].uid, 'trash', 'effect'); S.deleteStack(w.st, 'p1', w.p1.stacks[2].uid, 'trash', 'effect'); await w.drain();
  w.eq(w.pl('p1').hand.length - h0, 1, 'one draw');
  return w;
});
scenario('2601', 'EX1-064: 4 opp digimon deleted by 【등장 시】 -> only one draw this turn', async () => {
  const w = W({ p1: { battle: [{ id: 'EX1-064' }] }, p2: { battle: [plain(3, 1), plain(3, 2), plain(3, 3), plain(3, 4)] } });
  const h0 = w.pl('p1').hand.length;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, 0, 'all 4 deleted');
  w.eq(w.pl('p1').hand.length - h0, 1, 'one draw');
  return w;
});
scenario('2599', 'EX1-062 【소멸 시】: only a card NAMED 「아구몬」 (not 아구몬 박사 etc.), played rested', async () => {
  const ag = cards.find(c => c.category === 'digimon' && c.nameKo === '아구몬');
  const other = cards.find(c => c.category === 'digimon' && c.nameKo !== '아구몬' && c.nameKo.includes('아구몬'));
  const w = W({ p1: { trash: [other ? other.id : plain(3, 9), ag.id], battle: [{ id: 'EX1-062' }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.eq(w.pl('p1').battle.map(s => s.cardId), [ag.id], 'only exact-name Agumon played');
  w.ok(w.pl('p1').battle[0] && w.pl('p1').battle[0].suspended, 'rested');
  return w;
});
scenario('2582', 'EX1-044 inherited: "같은 명칭" = name of the digimon that has it as a source (not 케라몬)', async () => {
  const d = plain(4, 2);
  const w = W({ p1: { battle: [{ id: d, src: ['EX1-044'] }, { id: d }] }, p2: {} });
  const [a, b] = w.p1.stacks;
  w.eq(w.dp('p1', a) - C(d).dp, 1000, '+1000 for the other same-name digimon');
  return w;
});
scenario('2590', 'EX1-052 in the RAISING area: no evolution-cost discount', async () => {
  const w = W({ p1: { raising: { id: 'EX1-052' }, hand: [] }, p2: {} });
  const ok = S.continuousEvoCostDiscount ? S.continuousEvoCostDiscount(w.st, 'p1', w.p1.raising, dgOf(c => c.nameKo.includes('에테몬') && c.id !== 'EX1-052').id) : null;
  w.ok(!ok || ok === 0, 'no discount in raising: ' + ok);
  return w;
});
await run('w4-f');
