// Unresolved-A (6): the 「【등장 시】 효과 1개를 발휘한다」 borrowers must honour BT20-037's 「【등장 시】 효과는 발휘하지 않는다」 flag on the BORROWING card
// (Q4350 own 【등장 시】 / Q4351 another card's 【등장 시】 / Q4353 not even the 「…것으로」 cost / Q4352 the flag on the card whose effect is borrowed does not matter).
// Run: node scripts/qa/qa-unres-a-forced-play-trig.mjs < /dev/null
import { S, W, plain, scenario, run } from './lib-s6.mjs';

const flag = (w, s) => { s.s13NoTrig = { play: w.st.turnNumber + 1 }; };
const blocked = (w) => w.st.log.some((l) => /BT20-037/.test(l.msg));
const cyb5 = 'ST7-07', hyb4 = 'BT6-010', csTamer = 'BT22-083', dober = 'BT4-082', rina = 'BT2-086', purple3 = 'ST6-02';
const src = (n) => Array.from({ length: n }, (_, i) => plain(3, i));

for (const flagged of [false, true]) {
  const tag = flagged ? ' (flagged)' : ' (control)';
  scenario('4350-EX5-059' + tag, 'EX5-059 【진화 시】: the 도베르몬 source lets it fire its own 【등장 시】' + (flagged ? ' -> suppressed' : ''), async () => {
    const w = W({ p1: { battle: [{ id: 'EX5-059', src: [dober] }, plain(3, 5)], hand: [plain(3, 1)] }, p2: {} });
    const st = w.p1.stacks[0]; if (flagged) flag(w, st);
    await w.run('p1', st.uid, '진화 시');
    w.eq(blocked(w), flagged, 'BT20-037 log');
    w.eq(w.st.log.some((l) => /길동무/.test(l.msg)), !flagged, '길동무 granted (own 등장 시 fired) unless flagged');
    return w;
  });
  scenario('4351-BT18-066' + tag, 'BT18-066 【등장 시】: place a card under and borrow its 【등장 시】' + (flagged ? ' -> nothing at all (cost not paid)' : ''), async () => {
    const w = W({ p1: { battle: ['BT18-066'], hand: [hyb4] }, p2: {} });
    const st = w.p1.stacks[0]; if (flagged) flag(w, st);
    await w.run('p1', st.uid, '등장 시');
    w.eq(st.sources.length, flagged ? 0 : 1, 'card placed under only when not flagged');
    w.eq(w.pl('p1').hand.length, flagged ? 1 : 0, 'hand card stays when flagged');
    return w;
  });
  scenario('4351-EX9-073' + tag, 'EX9-073 【등장 시】: cost + borrow' + (flagged ? ' -> nothing (cost not paid)' : ''), async () => {
    const w = W({ p1: { battle: ['EX9-073'], hand: [cyb5] }, p2: {} });
    const st = w.p1.stacks[0]; if (flagged) flag(w, st);
    await w.run('p1', st.uid, '등장 시');
    w.eq(st.sources.length, flagged ? 0 : 1, 'card placed on top only when not flagged');
    return w;
  });
  scenario('4351-BT15-102' + tag, 'BT15-102 【자신의 턴 종료 시】: place from trash + borrow' + (flagged ? ' -> nothing' : ''), async () => {
    const w = W({ p1: { battle: ['BT15-102'], trash: [plain(3, 2)] }, p2: {} });
    const st = w.p1.stacks[0]; if (flagged) flag(w, st);
    await w.run('p1', st.uid, '자신의 턴 종료 시');
    w.eq(st.sources.length, flagged ? 0 : 1, 'card placed under only when not flagged');
    return w;
  });
  scenario('4350-BT23-101' + tag, 'BT23-101 【어택 시】: return a CS tamer to hand as the cost, then fire its own 【등장 시】' + (flagged ? ' -> tamer NOT returned' : ''), async () => {
    const w = W({ p1: { battle: ['BT23-101', csTamer] }, p2: { battle: [plain(3, 3)] } });
    const st = w.p1.stacks[0]; if (flagged) flag(w, st);
    await w.run('p1', st.uid, '어택 시');
    w.eq(w.st.log.some((l) => /DP -3000/.test(l.msg)), !flagged, 'its 【등장 시】 (DP -3000) fired only when not flagged');
    if (flagged) { w.eq(w.pl('p1').battle.filter((s) => s.cardId === csTamer).length, 1, 'the CS tamer stays (cost not paid)'); w.eq(w.pl('p1').hand.length, 0, 'nothing returned to hand'); }
    return w;
  });
  scenario('4351-BT11-029' + tag, 'BT11-029 (inherited 【어택 시】): fire 시노미야 리나\'s 【등장 시】' + (flagged ? ' -> suppressed' : ''), async () => {
    const w = W({ p1: { battle: [{ id: plain(3, 0), src: ['BT11-029'] }, rina] }, p2: {} });
    const st = w.p1.stacks[0]; if (flagged) flag(w, st);
    await w.exec('p1', S.parseEffectSegments(S.card('BT11-029').inheritedKo).segments.find((x) => x.tags.includes('어택 시')).body, 'BT11-029', st.uid, { tags: ['어택 시'], inherited: true });
    w.eq(blocked(w), flagged, 'BT20-037 log');
    return w;
  });
}
scenario('4352', 'the flag on the card whose 【등장 시】 is borrowed does NOT matter: an unflagged EX9-073 can borrow a flagged card', async () => {
  const w = W({ p1: { battle: ['EX9-073'], hand: [cyb5] }, p2: {} });
  const st = w.p1.stacks[0];
  w.pl('p1').hand.forEach(() => {}); // (the borrowed card sits in hand: no stack to flag) -> a flag on OTHER stacks changes nothing
  w.p1.stacks.forEach(() => {}); const other = w.mk('p1', plain(3, 4)); flag(w, other);
  await w.run('p1', st.uid, '등장 시');
  w.eq(st.sources.length, 1, 'borrow works');
  w.eq(blocked(w), false, 'not blocked');
  return w;
});
scenario('4350-EX3-065', 'EX3-065: the tamer is NOT rested and nothing fires when the evolved digimon is flagged', async () => {
  for (const flagged of [false, true]) {
    const w = W({ p1: { battle: ['EX3-065', 'EX7-014'] }, p2: { battle: [plain(3, 6)] } });
    const tam = w.p1.stacks[0], dg = w.p1.stacks[1]; if (flagged) flag(w, dg);
    await w.exec('p1', S.parseEffectSegments(S.card('EX3-065').effectKo).segments.find((x) => x.tags.includes('자신의 턴')).body, 'EX3-065', tam.uid, { tags: ['자신의 턴'], trigger: { evt: { kind: 'digivolve', stackUid: dg.uid } } });
    w.eq(tam.suspended, !flagged, `tamer rested only when the digimon is not flagged (flagged=${flagged})`);
    if (w.results.some((r) => !r.ok)) return w;
  }
  const w = W({}); w.ok(true, 'ok'); return w;
});
await run('qa-unres-a-forced-play-trig');
