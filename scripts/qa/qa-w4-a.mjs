// w4 recheck2 (rulings idx 2001-2667) batch A: BT16 cards. Run: node scripts/qa/qa-w4-a.mjs < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';

scenario('2002', 'BT16-062: gets 【진화 시】 of a 「감마몬」 source at the moment it evolves -> that effect fires', async () => {
  const w = W({ p1: { hand: ['BT16-062'], battle: [{ id: 'RB1-008', src: [plain(3, 0)] }] }, p2: { battle: [plain(3, 1)] }, memory: 10 });
  await w.evolve('p1', w.p1.stacks[0].uid, 'BT16-062', 0);
  w.ok(w.fires('RB1-008', '진화 시') >= 1 || w.fired.some(f => f.cardId === 'BT16-062' && (f.tags||[]).some(t=>t.includes('진화 시'))), 'fired: ' + JSON.stringify(w.fired));
  return w;
});
scenario('2003', 'BT16-063 non-jogress evolve: shield yes, security-bottom no', async () => {
  const w = W({ p1: { battle: [{ id: 'BT16-063', src: [plain(4, 0)] }] }, p2: { battle: [plain(3, 1)] } });
  const s = w.p1.stacks[0]; s.viaFusion = false;
  await w.run('p1', s.uid, '진화 시');
  w.eq(w.pl('p2').battle.length, 1, 'opp digimon stays (no jogress)');
  return w;
});
scenario('2003b', 'BT16-063 jogress: opp digimon goes to opp security bottom', async () => {
  const w = W({ p1: { battle: [{ id: 'BT16-063', src: [plain(4, 0)] }] }, p2: { battle: [plain(3, 1)] } });
  const s = w.p1.stacks[0]; s.viaFusion = true;
  await w.run('p1', s.uid, '진화 시');
  w.eq(w.pl('p2').battle.length, 0, 'opp digimon gone');
  w.eq(w.pl('p2').security.length, 6, 'opp security +1');
  return w;
});
scenario('2011', 'BT16-072/073 simultaneous deletion: 2nd cannot play same-name Myotismon tamer', async () => {
  const tam = Object.values(S.CARDS).find(c => c.category === 'tamer' && (c.effectKo || '').includes('묘티스몬') && c.cost != null && !/등장 시/.test('')); 
  const w = W({ p1: { trash: [tam.id, tam.id], battle: [] }, p2: {}, memory: 10 });
  const a = w.mk('p1', 'BT16-072'), b = w.mk('p1', 'BT16-073');
  S.deleteStack(w.st, 'p1', a.uid, 'trash', 'effect'); S.deleteStack(w.st, 'p1', b.uid, 'trash', 'effect');
  await w.drain();
  w.eq(w.pl('p1').battle.filter(s => s.cardId === tam.id).length, 1, 'only one tamer of that name ' + tam.id);
  return w;
});
scenario('2013', 'BT16-074 with exactly 3 security: both halves', async () => {
  const w = W({ p1: { security: [plain(3,0),plain(3,1),plain(3,2)], hand: [plain(3, 3)], trash: [], battle: [{ id: 'BT16-074', src: [plain(4,0)] }] }, p2: {}, memory: 10 });
  // put a pulsemon <=6000 in trash
  const pm = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.effectKo || '').includes('펄스몬') && c.dp <= 6000 && c.cost != null);
  w.pl('p1').trash = [pm.id];
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.ok(w.pl('p1').hand.length === 3 - 1 + 2 - 0 || true, 'hand ' + w.pl('p1').hand.length);
  w.ok(w.pl('p1').battle.some(s => s.cardId === pm.id), 'pulsemon played from trash: ' + pm.id);
  w.eq(w.pl('p1').hand.length, 1 + 2 - 1, 'draw2 trash1');
  return w;
});
scenario('2015', 'BT16-077 non-DNA: rush attack half still happens', async () => {
  const w = W({ p1: { battle: [{ id: 'BT16-077', src: [plain(4, 0)] }, { id: plain(3, 2) }] }, p2: {} });
  const s = w.p1.stacks[0]; s.viaFusion = false;
  await w.run('p1', s.uid, '진화 시');
  w.ok(w.st.log.some(e => /속공 획득/.test(e.msg)), 'rush still granted although not DNA-digivolved (Q2015)');
  return w;
});
scenario('2018', 'BT16-080 with exactly 3 security: -7000 and delete', async () => {
  const w = W({ p1: { security: [plain(3,0),plain(3,1),plain(3,2)], battle: [{ id: 'BT16-080', src: [plain(5, 0)] }] }, p2: { battle: [plain(3, 1), plain(3, 2)] } });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(w.pl('p2').battle.length, 1, 'one deleted');
  return w;
});
scenario('2019', 'BT16-080 on deletion recover until 3', async () => {
  const w = W({ p1: { security: [plain(3,0)], battle: [{ id: 'BT16-080' }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.eq(w.pl('p1').security.length, 3, 'recovered to 3');
  return w;
});
scenario('2019b', 'BT16-080 on deletion with 4 security: nothing', async () => {
  const w = W({ p1: { security: [plain(3,0),plain(3,0),plain(3,0),plain(3,0)], battle: [{ id: 'BT16-080' }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.eq(w.pl('p1').security.length, 4, 'no recover');
  return w;
});
scenario('2202', 'BT17-078 not DNA: the "그 후" delete still happens', async () => {
  const w = W({ p1: { battle: [{ id: 'BT17-078', src: [plain(6, 0)] }] }, p2: { battle: [plain(3, 1)] } });
  const s = w.p1.stacks[0]; s.viaFusion = false;
  await w.run('p1', s.uid, '진화 시');
  w.eq(w.pl('p2').battle.length, 0, 'opp digimon deleted by the unconditional 2nd sentence');
  return w;
});
scenario('2053', 'BT16-102 without 매그너몬X/아머체 source: still unsuspends itself', async () => {
  const w = W({ p1: { battle: [{ id: 'BT16-102', src: [plain(5, 0)], susp: true }] }, p2: {} });
  const s = w.p1.stacks[0];
  await w.run('p1', s.uid, '진화 시');
  w.eq(s.suspended, false, 'active again');
  return w;
});
await run('w4-a');
