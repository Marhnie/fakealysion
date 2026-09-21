// Slice-6 official Q&A scenarios, part B (BT25 second half).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-b.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';

// Q6397: BT25-084 without discarding a card nothing else happens
scenario('G37', 'BT25-084 on-play: empty hand -> no destroy of the highest-DP digimon', async () => {
  const w = W({ p1: { hand: ['BT25-084'] }, p2: { battle: [plain(3, 0)] } });
  await w.play('p1', 'BT25-084');
  w.eq(w.pl('p2').battle.length, 1, 'untouched');
  return w;
});
// Q6398: leave-prevention needs the full 2-card discard: a single card in hand is not enough
scenario('G38', 'BT25-084: with only 1 hand card it cannot prevent leaving', async () => {
  const w = W({ p1: { hand: [plain(3, 1)], battle: ['BT25-084'] }, p2: {} });
  w.st._fxSrc = { player: 'p2', category: 'digimon', cardId: plain(3, 0) };
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect');
  w.st._fxSrc = null; await w.drain();
  w.eq(w.pl('p1').battle.length, 0, 'digimon left');
  return w;
});
scenario('G38b', 'BT25-084: with 2 hand cards the leave-prevention works (control)', async () => {
  const w = W({ p1: { hand: [plain(3, 1), plain(3, 2)], battle: ['BT25-084'] }, p2: {} });
  w.st._fxSrc = { player: 'p2', category: 'digimon', cardId: plain(3, 0) };
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect');
  w.st._fxSrc = null; await w.drain();
  w.eq(w.pl('p1').battle.length, 1, 'digimon stayed');
  return w;
});
// Q6400/6401: discarding 2 at once triggers once; two 1-card discards trigger twice
scenario('G40', 'BT25-084: two separate 1-card discards -> two destroys', async () => {
  const w = W({ p1: { hand: [plain(3, 1), plain(3, 2)], battle: ['BT25-084'] }, p2: { battle: [plain(3, 0), plain(3, 3), plain(3, 4)] } });
  await w.exec('p1', '자신의 패를 1장 파기한다.', plain(3, 5)); await w.exec('p1', '자신의 패를 1장 파기한다.', plain(3, 5));
  w.eq(w.pl('p2').battle.length, 1, 'two destroyed');
  return w;
});
scenario('G41', 'BT25-084: discarding 2 at once triggers only once', async () => {
  const w = W({ p1: { hand: [plain(3, 1), plain(3, 2)], battle: ['BT25-084'] }, p2: { battle: [plain(3, 0), plain(3, 3), plain(3, 4)] } });
  await w.exec('p1', '자신의 패를 2장 파기한다.', plain(3, 5));
  w.eq(w.pl('p2').battle.length, 2, 'one destroyed');
  return w;
});
// Q6406: BT25-086 turn-end DP bonus counts the opponent-side memory
scenario('G44', 'BT25-086 end-of-turn: memory at opponent side 5 -> TS digimon DP +5000', async () => {
  const w = W({ p1: { battle: ['BT25-086', 'P-196'] }, p2: {}, memory: -5 });
  const d = w.p1.stacks[1]; const b = w.dp('p1', d);
  await w.run('p1', w.p1.stacks[0].uid, '자신의 턴 종료 시');
  w.eq(w.dp('p1', d) - b, 5000, 'DP +5000');
  return w;
});
// Q6407: BT25-086 cannot process the DP part if the tamer cannot be rested
scenario('G45', 'BT25-086 end-of-turn: tamer already rested -> no DP bonus', async () => {
  const w = W({ p1: { battle: [{ id: 'BT25-086', susp: true }, 'P-196'] }, p2: {}, memory: -5 });
  const d = w.p1.stacks[1]; const b = w.dp('p1', d);
  await w.run('p1', w.p1.stacks[0].uid, '자신의 턴 종료 시');
  w.eq(w.dp('p1', d), b, 'DP unchanged');
  return w;
});
// Q6430/6431: BT25-091 on-play: no option in trash -> draw; declining the option -> draw
scenario('G58', 'BT25-091 on-play with no option in trash -> draws 1', async () => {
  const w = W({ p1: { hand: ['BT25-091'] }, p2: {} });
  const h = w.pl('p1').deck.length; await w.play('p1', 'BT25-091');
  w.eq(w.pl('p1').deck.length, h - 1, 'drew 1');
  return w;
});
scenario('G57', 'BT25-091 on-play: declining to add the trash option -> draws 1', async () => {
  const w = W({ p1: { hand: ['BT25-091'], trash: ['BT25-093'] }, p2: {} });
  w.answers.confirmEffect = () => false; w.answers.pickFromZoneIndex = () => null; w.answers.pickFromRevealed = () => [];
  const h = w.pl('p1').deck.length; await w.play('p1', 'BT25-091');
  w.eq(w.pl('p1').deck.length, h - 1, 'drew 1'); w.ok(w.pl('p1').trash.includes('BT25-093'), 'option left in trash');
  return w;
});
// Q6434: BT25-092 main: resting + discarding an option is one indivisible cost; without an option the tamer is not even rested
scenario('G61', 'BT25-092 main: no option to discard -> tamer stays active, nothing evolves', async () => {
  const w = W({ p1: { battle: ['BT25-092', plain(3, 0)], hand: [plain(4, 0)] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.ok(!w.p1.stacks[0].suspended, 'tamer not rested');
  w.eq(w.p1.stacks[1].cardId, plain(3, 0), 'no evolution');
  return w;
});
// Q6475: BT25-101 main: need the discard to draw / link
scenario('G80', 'BT25-101 main: no TS card in hand -> no draw', async () => {
  const w = W({ p1: { battle: [plain(3, 0)], hand: [plain(3, 1)] }, p2: {} });
  const h = w.pl('p1').hand.length, d = w.pl('p1').deck.length;
  await w.runCard('p1', 'BT25-101', '메인');
  w.eq([w.pl('p1').hand.length, w.pl('p1').deck.length], [h, d], 'no change');
  return w;
});
await run('slice6-b');
