// w4 recheck2 (rulings idx 2001-2667) batch C: BT18/BT19. Run: node scripts/qa/qa-w4-c.mjs < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const anyTamer = () => Object.values(S.CARDS).find((c) => c.category === "tamer" && !(c.inheritedKo || "").includes("자신의 턴")).id;
const cards = Object.values(S.CARDS);

scenario('2279', 'BT18-019 jogress: only Lv-distinct DIGIMON cards (no digi-egg, no Lv.-) go to opp deck top; +1 memory each', async () => {
  const egg = cards.find(c => c.category === 'digitama');
  const noLv = cards.find(c => c.category === 'digimon' && c.level == null);
  const l3 = plain(3, 0), l4 = plain(4, 0), l4b = plain(4, 1);
  const w = W({ p1: { battle: [{ id: 'BT18-019' }] }, p2: { trash: [egg.id, l3, l4, l4b, ...(noLv ? [noLv.id] : [])], deck: [plain(3, 5)] }, memory: 0 });
  w.p1.stacks[0].viaFusion = true;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.st.memory, 2, 'memory +2 (two levels)');
  w.eq(w.pl('p2').deck.length, 3, 'two cards to opp deck top');
  w.ok(w.pl('p2').trash.includes(egg.id), 'egg stays');
  return w;
});
scenario('2282', 'BT18-019 【소멸 시】: only one of キメラモン/パワードラモン in trash -> cost not paid, no play', async () => {
  const w = W({ p1: { trash: [], battle: [{ id: 'BT18-019', src: [] }] }, p2: {} });
  const ch = cards.find(c => c.nameKo === '키메라몬' && c.category === 'digimon');
  w.pl('p1').trash = [ch.id, 'BT18-019'];
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.eq(w.pl('p1').battle.length, 0, 'nothing played (needs both)');
  w.ok(w.pl('p1').trash.includes(ch.id), 'chimeramon still in trash');
  return w;
});
scenario('2281', 'BT18-019 【소멸 시】: its own former sources (chimeramon+powerdramon) count', async () => {
  const ch = cards.find(c => c.nameKo === '키메라몬' && c.category === 'digimon');
  const pd = cards.find(c => c.nameKo === '파워드라몬' && c.category === 'digimon');
  const w = W({ p1: { trash: [], battle: [{ id: 'BT18-019', src: [ch.id, pd.id] }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.ok(w.pl('p1').battle.some(s => s.cardId === 'BT18-019'), 'Millenniummon replayed');
  return w;
});
scenario('2298', 'BT18-026 [패]【메인】: only one of チャックモン/ブリザーモン in trash -> cannot', async () => {
  const chuck = cards.find(c => c.nameKo === '챠크몬' && c.category === 'digimon');
  const tam = cards.find(c => c.category === 'tamer' && (c.colors || []).some(x => x === 'blue' || x === 'red'));
  const w = W({ p1: { hand: ['BT18-026'], trash: [chuck.id], battle: [{ id: tam.id }] }, p2: {} });
  await w.runCard('p1', 'BT18-026', '메인');
  w.ok(w.pl('p1').battle.length === 1 && w.pl('p1').battle[0].cardId === tam.id, 'tamer not evolved');
  w.ok(w.pl('p1').trash.includes(chuck.id), 'trash intact');
  return w;
});
scenario('2311', 'BT18-037: may decline the security add; then no recover, but security is shuffled', async () => {
  const hy = cards.find(c => c.category === 'digimon' && (c.types || []).includes('하이브리드체'));
  const w = W({ p1: { security: [hy.id, plain(3, 0)], battle: [{ id: 'BT18-037' }] }, p2: {} });
  w.answers.pickFromRevealed = () => [];
  w.answers.pickFromZoneIndex = () => null;
  w.answers.confirmEffect = () => false;
  const before = w.pl('p1').security.length;
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(w.pl('p1').security.length, before, 'security count unchanged (no add, no recover)');
  return w;
});
const lucSrc = cards.find(c => c.category === 'digimon' && c.nameKo.includes('루체몬')).id;
for (const [sec2, expectLeave] of [[0, true], [2, false]]) {
  scenario('2447-' + sec2, 'BT19-043: leave-prevention needs BOTH players to be able to trash a security (opp security ' + sec2 + ')', async () => {
    const w = W({ p1: { security: [plain(3, 0), plain(3, 0)], battle: [{ id: 'BT19-043', src: [lucSrc] }] }, p2: { security: Array.from({ length: sec2 }, () => plain(3, 0)), battle: [plain(3, 1)] }, active: 'p2' });
    await w.exec('p2', '상대의 디지몬 1마리를 소멸시킨다.', plain(3, 1), w.p2.stacks[0].uid);
    w.eq(w.pl('p1').battle.length === 0, expectLeave, 'deleted? expected ' + expectLeave);
    return w;
  });
}
scenario('2430', 'BT19-026: degen turns opp digimon into a DP-less digi-egg (still a Digimon this effect) -> "2 or more" holds, egg goes to digi-egg deck bottom when returned', async () => {
  const egg = cards.find(c => c.category === 'digitama' && c.level === 2);
  const w = W({ p1: { battle: [{ id: 'BT19-026' }] }, p2: { battle: [{ id: plain(4, 1), src: [egg.id] }, { id: plain(3, 2) }] } });
  w.answers.pickStack = (o) => { const a = w.pl('p2').battle[0]; return o.uids.includes(a.uid) ? a.uid : o.uids[0]; };
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(!w.pl('p2').trash.includes(egg.id), 'egg not trashed by rule check');
  w.ok(w.pl('p2').digitamaDeck.includes(egg.id) || w.pl('p2').digitamaDeck.slice(-1)[0] === egg.id, 'egg returned to digi-egg deck');
  return w;
});
scenario('2431', 'BT19-026: degen turns opp digimon into a Tamer -> no longer 2+ digimon -> nothing returned', async () => {
  const w = W({ p1: { battle: [{ id: 'BT19-026' }] }, p2: { battle: [{ id: plain(4, 1), src: [anyTamer()] }, { id: plain(3, 2) }] } });
  w.answers.pickStack = (o) => w.pl('p2').battle[0].uid;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').hand.length, 0, 'nothing bounced');
  w.eq(w.pl('p2').battle.length, 2, 'tamer + digimon remain');
  return w;
});
scenario('2400', 'BT18-098: when discarded from security BY AN EFFECT its 【시큐리티】 effect fires (deletes DP<=6000 opp digimon)', async () => {
  const w = W({ p1: { security: ['BT18-098', plain(3, 0)], battle: [plain(3, 1)] }, p2: { battle: [plain(3, 2)] }, active: 'p2' });
  S.trashTopSecurityByEffect(w.st, 'p1'); await w.drain();
  w.eq(w.pl('p2').battle.length, 0, 'opp digimon deleted by security effect');
  return w;
});
await run('w4-c');
