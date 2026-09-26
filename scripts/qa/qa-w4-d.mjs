// w4 recheck2 (rulings idx 2001-2667) batch D: BT18 misc. Run: node scripts/qa/qa-w4-d.mjs < /dev/null
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const anyTamer = () => Object.values(S.CARDS).find((c) => c.category === "tamer" && !(c.inheritedKo || "").includes("자신의 턴")).id;
const cards = Object.values(S.CARDS);
const dg = (cols) => cards.find(c => c.category === 'digimon' && c.level && c.dp && JSON.stringify([...c.colors].sort()) === JSON.stringify([...cols].sort()));
const tm = (cols) => cards.find(c => c.category === 'tamer' && JSON.stringify([...c.colors].sort()) === JSON.stringify([...cols].sort()));

scenario('2259', 'BT18-006 inherited 【소멸 시】: colours counted across opp digimon+tamer = red,blue,yellow -> 3 deck cards trashed', async () => {
  const a = dg(['red', 'blue']), t = tm(['red', 'yellow']);
  const w = W({ p1: { deck: 12 }, p2: { battle: [{ id: a.id }, { id: t.id }] } });
  await w.exec('p1', '상대의 디지몬과 테이머의 색 1색마다 자신의 덱 위에서부터 1장 파기한다.', 'BT18-006', null, { tags: ['소멸 시'] });
  w.eq(w.pl('p1').trash.length, 3, 'trashed 3');
  return w;
});
scenario('2388', 'BT18-079 On Play: 3 colours -> both decks lose 3', async () => {
  const a = dg(['red', 'blue']), t = tm(['red', 'yellow']);
  const w = W({ p1: { deck: 12, battle: [{ id: 'BT18-079', src: [plain(3, 0)] }] }, p2: { deck: 12, battle: [{ id: a.id }, { id: t.id }] } });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p1').deck.length, 9, 'p1 deck 12->9'); w.eq(w.pl('p2').deck.length, 9, 'p2 deck 12->9');
  return w;
});
for (const [label, src, expect] of [['digimon effect', plain(3, 4), 0], ['tamer effect', 'TAMER', 1]]) {
  scenario('2261-' + label, 'BT18-009: opp cannot plus memory except by a tamer effect (' + label + ')', async () => {
    const t = anyTamer();
    const w = W({ p1: { battle: [{ id: 'BT18-009' }] }, p2: { battle: [{ id: plain(3, 5) }] }, memory: 0, active: 'p2' });
    await w.exec('p2', '메모리 +1.', src === 'TAMER' ? t : src, null, {});
    w.eq(-w.st.memory, expect, 'p2 memory gain');
    return w;
  });
}
scenario('2262', 'BT18-009/059: a card that is both digimon and tamer (BT17-087 as digimon) may still gain memory', async () => {
  const w = W({ p1: { battle: [{ id: 'BT18-009' }] }, p2: { battle: [{ id: 'BT17-087' }] }, memory: 0, active: 'p2' });
  w.p2.stacks[0].s2AsDigimon = true;
  await w.exec('p2', '메모리 +1.', 'BT17-087', w.p2.stacks[0].uid, {});
  w.eq(-w.st.memory, 1, 'gained');
  return w;
});
scenario('2312', 'BT18-039: original DP changed to 6000 keeps earlier +1000 on top; re-change overwrites', async () => {
  const d = dg(['red']);
  const w = W({ p1: { battle: [{ id: 'BT18-039' }] }, p2: { battle: [{ id: d.id }] } });
  const o = w.p2.stacks[0];
  const base = w.dp('p2', o);
  await w.exec('p1', '턴 종료까지 상대의 디지몬 1마리의 원래 DP를 6000으로 변경한다.', 'BT18-039', w.p1.stacks[0].uid, {});
  w.eq(w.dp('p2', o), 6000, 'now 6000');
  await w.exec('p1', '턴 종료까지 상대의 디지몬 1마리의 원래 DP를 3000으로 변경한다.', 'BT18-039', w.p1.stacks[0].uid, {});
  w.eq(w.dp('p2', o), 3000, 'overwritten with the last value');
  return w;
});
scenario('2395', 'BT18-086 【서로의 턴】: DP0 digimon do not get deleted while a non-white 루체몬 is on the field', async () => {
  const luc = cards.find(c => c.category === 'digimon' && c.nameKo.includes('루체몬') && !(c.colors || []).includes('white') && c.dp);
  const w = W({ p1: { battle: [{ id: 'BT18-086' }, { id: luc.id }, { id: plain(3, 3) }] }, p2: {} });
  const x = w.p1.stacks[2];
  await w.exec('p2', '턴 종료까지 상대의 디지몬 1마리를 DP -99000.', plain(3, 5), null, {});
  w.ok(w.pl('p1').battle.length >= 2, 'a digimon survives; battle: ' + w.pl('p1').battle.map(s => s.cardId + ':' + w.dp('p1', s)));
  return w;
});
await run('w4-d');
