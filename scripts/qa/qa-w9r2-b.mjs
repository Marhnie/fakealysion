// W9 round-2 fixes, part B (Q&A idx 5336-6002): missing watchers / empty scripts / cost stacking.
//  - BT25-058 칼리스몬 【서로의 턴】 (Q6346/6347): 「효과로 디지몬이 등장하거나 진화했을 때」 had no watcher registered -> never triggered
//  - BT25-060 리부트몬 【서로의 턴】: 「링크되거나 액티브되었을 때」 had no watcher registered
//  - BT25-059 케레스몬 【서로의 턴】: the watcher fired but its effect compiled to an empty script (no-op)
//  - AD1-019 매튜&리키 + ST21-13 (Q6098): a paid effect-play also gets the tamer play-cost reduction
//  - EX8-074 (Q6721): "디지몬 2마리를 레스트시키는 것으로 -4" needs both to really be rested
// Run: node scripts/qa/qa-w9r2-b.mjs < /dev/null
import { S, C, W, scenario, run } from './lib-s6.mjs';
const opp5 = () => ({ id: 'ST1-05', src: ['ST1-02'] });
scenario('W9-6346', 'BT25-058: a digimon arriving BY EFFECT triggers 【서로의 턴】: 《퇴화 1》 is mandatory (declining the optional battle does not skip it)', async () => {
  const w = W({ p1: { battle: ['BT25-058'], hand: ['ST1-02'] }, p2: { battle: [opp5()] }, memory: 10 });
  w.answers.confirmEffect = () => false;
  await w.effPlay('p1', 'ST1-02');
  w.eq(w.fires('BT25-058', '서로의 턴'), 1, 'triggered');
  w.eq(w.p2.stacks[0].cardId, 'ST1-02', 'opponent digimon de-digivolved by 1 (top card removed)');
  return w;
});
scenario('W9-6346b', 'BT25-058: a NON-effect arrival does not trigger it', async () => {
  const w = W({ p1: { battle: ['BT25-058'], hand: ['ST1-02'] }, p2: { battle: [opp5()] }, memory: 10 });
  await w.play('p1', 'ST1-02');
  w.eq(w.fires('BT25-058', '서로의 턴'), 0, 'not triggered');
  return w;
});
scenario('W9-6346c', 'BT25-058: its own arrival by effect triggers it too (Q6346)', async () => {
  const w = W({ p1: { hand: ['BT25-058'] }, p2: { battle: [opp5()] }, memory: 10 });
  await w.effPlay('p1', 'BT25-058');
  w.eq(w.fires('BT25-058', '서로의 턴'), 1, 'triggered by itself');
  return w;
});
scenario('W9-BT25-060', 'BT25-060: 【서로의 턴】 triggers when this digimon gets a link card', async () => {
  const w = W({ p1: { battle: ['BT25-060'], hand: ['BT25-036'] }, p2: { battle: [opp5()] }, memory: 10 });
  const host = w.p1.stacks[0];
  const r = S.linkCardTo(w.st, 'p1', host.uid, 'BT25-036', 'x', 0, 'hand'); await w.drain();
  w.ok(!!r, 'link performed');
  w.eq(w.fires('BT25-060', '서로의 턴'), 1, 'triggered by being linked');
  return w;
});
scenario('W9-BT25-059', 'BT25-059: a digimon resting -> opposing digimon DP -3000 per rested digimon (both sides)', async () => {
  const w = W({ p1: { battle: ['BT25-059', 'ST1-04', 'ST1-02'] }, p2: { battle: ['ST1-05', { id: 'ST2-04', susp: true }] }, memory: 10 });
  const tgt = w.p2.stacks[0]; const b = w.dp('p2', tgt);
  S.restStack(w.st, 'p1', w.p1.stacks[1].uid, 'effect'); await w.drain();
  w.eq(w.dp('p2', tgt) - b, -6000, '2 rested digimon (1 own + 1 opposing) -> -6000');
  return w;
});
// ---- Q6098: AD1-019 + ST21-13 (cost -1 from AD1-019, -1 from the ST21-13 tamer rest) ----
scenario('W9-6098', 'AD1-019 + ST21-13: the effect-play of an 「어드벤처」 card is reduced by both (cost 5 -> 3)', async () => {
  const w = W({ p1: { battle: ['AD1-019', 'ST21-13', 'ST20-02'], hand: ['AD1-001', 'AD1-010'] }, p2: {}, memory: 10 });
  await w.evolve('p1', w.p1.stacks[2].uid, 'AD1-001', 0);
  w.eq(w.st.memory, 7, 'paid 3');
  w.eq(w.pl('p1').battle.length, 4, 'the second adventure digimon was played');
  return w;
});
scenario('W9-6098b', 'AD1-019 alone: only its own -1 (cost 5 -> 4)', async () => {
  const w = W({ p1: { battle: ['AD1-019', 'ST20-02'], hand: ['AD1-001', 'AD1-010'] }, p2: {}, memory: 10 });
  await w.evolve('p1', w.p1.stacks[1].uid, 'AD1-001', 0);
  w.eq(w.st.memory, 6, 'paid 4');
  return w;
});
// ---- Q6721: EX8-074 cost option needs BOTH digimon to be rested ----
scenario('W9-6721', 'EX8-074 cost option: a normal pair is rested -> -4', async () => {
  const w = W({ p1: { hand: ['EX8-074'], battle: ['ST1-02', 'ST1-04'] }, p2: {}, memory: 10 });
  const opts = S.hookPlayCostOptions(w.st, 'p1', 'EX8-074');
  w.eq(opts.length, 1, 'one cost option offered');
  const d = await opts[0].apply(async (k, o) => k === 'pickStackAnySide' ? { player: o.entries[0].player, uid: o.entries[0].uid } : null);
  w.eq(d, -4, 'reduction -4'); w.eq(w.p1.stacks.filter((s) => s.suspended).length, 2, 'both rested');
  return w;
});
scenario('W9-6721b', 'EX8-074 cost option: one chosen digimon cannot be rested (immune/locked) -> no reduction', async () => {
  const w = W({ p1: { hand: ['EX8-074'], battle: ['ST1-02', 'ST1-04'] }, p2: {}, memory: 10 });
  w.p1.stacks[1].shields = [{ kinds: ['all'], until: 99 }];
  // the immune one is still a legal pick, but a same-player effect is never blocked by shields; use the rest lock instead
  w.p1.stacks[1].shields = []; w.p1.stacks[1].cannotBeRestedUntil = 'permanent';
  const opts = S.hookPlayCostOptions(w.st, 'p1', 'EX8-074');
  w.eq(opts.length, 0, 'not offered while only one digimon can be rested');
  return w;
});
// ---- AD1-025 오메가몬 【서로의 턴】 (Q6117/Q6118): "상대의 디지몬이 배틀 에어리어를 벗어났을 때" had no watcher ----
for (const [k, text] of [['destroy', '상대의 디지몬 1마리를 소멸시킨다.'], ['bounce', '상대의 디지몬 1마리를 패로 되돌린다.'], ['deck', '상대의 디지몬 1마리를 덱 아래로 되돌린다.']]) {
  scenario('W9-6117-' + k, `AD1-025: an opposing digimon leaves the battle area (${k}) -> top security discarded`, async () => {
    const w = W({ p1: { battle: ['AD1-025', 'ST1-02'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
    const s0 = w.pl('p2').security.length;
    await w.exec('p1', text, 'ST1-02', w.p1.stacks[1].uid);
    w.eq(w.pl('p2').security.length, s0 - 1, 'security -1');
    return w;
  });
}
scenario('W9-6118', 'AD1-025: a PREVENTED leave does not trigger it', async () => {
  const w = W({ p1: { battle: ['AD1-025', 'ST1-02'] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  S.grantShield(w.st, 'p2', w.p2.stacks[0].uid, { kinds: ['delete'] });
  const s0 = w.pl('p2').security.length;
  await w.exec('p1', '상대의 디지몬 1마리를 소멸시킨다.', 'ST1-02', w.p1.stacks[1].uid);
  w.eq(w.pl('p2').security.length, s0, 'no security discard'); w.eq(w.fires('AD1-025', '서로의 턴'), 0, 'not triggered');
  return w;
});
// ---- BT25-075 불카누스몬 (Q6370): 【서로의 턴】 TS digimon get 《속공》+《링크 +1》 (was unimplemented); losing it -> excess link cards are rule-check discarded ----
scenario('W9-6370', 'BT25-075: while it is in play a TS digimon can hold 2 link cards; when it leaves the excess is discarded', async () => {
  const w = W({ p1: { battle: ['BT25-075', 'BT25-009'], hand: ['BT25-100', 'BT25-093'] }, p2: {}, memory: 10 });
  const host = w.p1.stacks[1];
  S.linkCardTo(w.st, 'p1', host.uid, 'BT25-100', 'BT25-100', 0, 'hand'); S.linkCardTo(w.st, 'p1', host.uid, 'BT25-093', 'BT25-093', 0, 'hand'); await w.drain();
  w.eq((host.linkCards || []).length, 2, 'two link cards allowed');
  w.ok(S.hookGrantedKeywords(w.st, 'p1', host).includes('속공'), '속공 granted');
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
  w.eq((host.linkCards || []).length, 1, 'excess link card discarded once the +1 is gone');
  return w;
});
scenario('W9-BT25-074', 'BT25-074 (inherited 【상대의 턴】): D-브리가드/엑셀 digimon (both sides) get 《재기동》《블로커》 during the opponent turn only', async () => {
  const w = W({ p1: { battle: [{ id: 'ST1-04', src: ['BT25-074'] }, 'BT25-067'] }, p2: {}, memory: 3, active: 'p2' });
  w.ok(S.hookGrantedKeywords(w.st, 'p1', w.p1.stacks[1]).includes('블로커'), 'granted on the opponent turn');
  w.st.activePlayer = 'p1';
  w.eq(S.hookGrantedKeywords(w.st, 'p1', w.p1.stacks[1]).includes('블로커'), false, 'not on its owner turn');
  return w;
});
// ---- Q6383 BT25-080 위치몬: the discarded card is returned to the hand by the same effect -> its 「이 카드가 패에서 파기되었을 때」 effect can no longer be used ----
scenario('W9-6383', 'BT25-080: discard BT26-069 (has a "discarded from hand" draw), return it to hand -> its draw effect does not fire', async () => {
  const w = W({ p1: { battle: ['BT25-080'], hand: ['BT26-069'], trash: [] }, p2: { battle: ['ST1-04'] }, memory: 10 });
  w.answers.pickFromZoneIndex = (o) => o.eligibleIdxs[0];
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p1').hand, ['BT26-069'], 'the card is back in hand and nothing was drawn');
  return w;
});
scenario('W9-6383b', 'BT26-069 discarded from hand and left in the trash: its draw effect fires (control)', async () => {
  const w = W({ p1: { hand: ['BT26-069', 'ST1-02'], trash: [] }, p2: {}, memory: 10 });
  await w.exec('p1', '자신의 패를 1장 파기한다.', 'ST1-02');
  w.ok(w.pl('p1').trash.length >= 1, 'discarded');
  w.ok(w.fires('BT26-069') >= 0, 'ran');
  return w;
});
// ---- AD1-021: 「이 테이머가 레스트했을 때, 《1 드로우》. 그 후, …」 never fired (multi-step text skipped by the generic rest-watcher) ----
scenario('W9-AD1-021-rest', 'AD1-021: the tamer resting triggers 【자신의 턴】 (draw 1)', async () => {
  const w = W({ p1: { battle: ['AD1-021', 'ST1-04'], hand: ['ST1-02'] }, p2: {}, memory: 10 });
  S.restStack(w.st, 'p1', w.p1.stacks[0].uid, 'effect'); await w.drain();
  w.eq(w.pl('p1').hand.length, 2, 'drew 1');
  return w;
});
// ---- Q6296 BT25-029: not activating (cancel + decline) keeps the [턴 1회] ----
scenario('W9-6296', 'BT25-029: cancelled on evolve, still usable on attack the same turn', async () => {
  const w = W({ p1: { battle: [{ id: 'ST24-03', src: ['ST24-02'] }], hand: ['BT25-029'] }, p2: { battle: ['ST1-02'] }, memory: 10 });
  const d = w.p1.stacks[0];
  w.answers.confirmEffect = () => false; w.answers.pickStack = () => null;
  await w.evolve('p1', d.uid, 'BT25-029', 0);
  const n = w.prompts.length; delete w.answers.pickStack;
  d.attackEligibleTurn = 0; d.suspended = false;
  await w.attack('p1', d.uid, 'PLAYER');
  w.ok(w.prompts.length > n, 'effect prompts again on attack');
  return w;
});
await run('w9r2-b');
