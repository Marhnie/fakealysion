// W6 recheck2 (Q&A idx 3335-4001): batch C — ST20/ST21/BT20/BT21 rulings.
// Run: node scripts/qa/qa-w6-c.mjs < /dev/null
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const adv = all.find((c) => c.category === 'digimon' && (c.types || []).includes('어드벤처') && c.level === 3 && (c.cost || 0) >= 2);
const adv1 = all.find((c) => c.category === 'digimon' && (c.types || []).includes('어드벤처') && c.level === 3 && !(c.effectKo || '').includes('등장 시'));

for (const [a, b, q] of [['ST20-12', 'ST20-13', '3799/3800'], ['ST21-12', 'ST21-13', '3819/3820']]) {
  scenario(q, `${a} + ${b}: both 【자신의 턴】 -1 apply to one hand play (-2 in total)`, async () => {
    const w = W({ p1: { battle: [a, b] }, p2: {} });
    w.eq(S.tamerPlayCostDiscount(w.st, 'p1', adv.id), -2, 'total discount');
    w.ok(w.p1.stacks.every((s) => s.suspended), 'both Tamers rested');
    return w;
  });
}
scenario('3690', 'BT20-037 진화 시: 【등장 시】 suppression also covers opp digimon arriving later in the window', async () => {
  const dr = 'BT1-029';
  const w = W({ p1: { battle: [{ id: 'BT20-037', src: ['BT4-001'] }] }, p2: { hand: [dr], deck: 10 }, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.st.activePlayer = 'p2'; w.st.turnNumber = 4;
  const h0 = w.pl('p2').hand.length;
  await w.play('p2', dr, 0);
  w.eq(w.pl('p2').hand.length, h0 - 1, 'played, but no 등장 시 draw');
  w.st.activePlayer = 'p1'; w.st.turnNumber = 5; // window over
  const w2 = W({ p1: {}, p2: { hand: [dr], deck: 10 }, memory: 3, active: 'p2' });
  const h1 = w2.pl('p2').hand.length; await w2.play('p2', dr, 0);
  w.eq(w2.pl('p2').hand.length, h1, 'control: without the effect the draw happens (hand -1 +1)');
  return w;
});
scenario('3628', 'BT16-077 진화 시: ≪속공≫ granted digimon attacks the Player (no decline), even without 조그레스', async () => {
  const w = W({ p1: { battle: ['BT16-077', plain(3, 0)] }, p2: { battle: [plain(3, 1)] } });
  w.answers.confirmEffect = () => false;
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq((w.attackReqs || []).length, 1, 'an attack was requested');
  w.eq((w.attackReqs || [])[0] && w.attackReqs[0].tgt, 'PLAYER', 'against the Player');
  return w;
});
for (const [label, adventure, holder] of [...['ST20-04', 'ST20-06', 'ST20-09', 'ST21-04', 'ST21-06', 'ST21-09', 'BT21-061', 'BT21-078'].flatMap((h) => [['어드벤처 entrant grants ≪연계≫', true, h], ['non-어드벤처 entrant: no ≪연계≫ but the 그 후 attack still processed', false, h]])]) {
  scenario('3987-' + holder + (adventure ? 'a' : 'b'), holder + ': ' + label, async () => {
    const ent = adventure ? adv1.id : plain(3, 0);
    const w = W({ p1: { battle: [holder], hand: [ent] }, p2: { battle: [plain(3, 1)] } });
    await w.play('p1', ent, 0);
    w.eq(w.p1.stacks.some((s) => S.hasKeyword(s, '연계')), adventure, '연계 granted?');
    w.eq((w.attackReqs || []).length, 1, 'attack step reached');
    return w;
  });
}
for (const [ending, want] of [[true, 5], [false, 3]]) {
  scenario('3618-' + (ending ? 'endstep' : 'main'), 'P-165 사역마 토큰: vanishes at the ' + (ending ? 'NEXT' : 'current') + ' opponent turn end (turn ' + want + ')', async () => {
    const w = W({ p1: { battle: ['P-165'] }, p2: { battle: [plain(3, 0)] }, active: 'p2', turn: 3 });
    if (ending) w.st.turnEnding = { player: 'p2', via: false, expired: false };
    await w.run('p1', w.p1.stacks[0].uid, '등장 시');
    const eot = (w.st.endOfTurnEffects || []).filter((e) => e.cardId === 'P-165');
    w.eq(eot.map((e) => e.turnNumber), [want], 'scheduled turn number');
    return w;
  });
}
scenario('3878', 'a single 《퇴화 2》 peels both cards simultaneously (a rested BT15-047 that becomes the top mid-way does not stop it)', async () => {
  const w = W({ p1: { battle: [{ id: plain(5, 0), src: [plain(3, 0), 'BT15-047'], susp: true }] }, p2: { battle: [plain(3, 1)] } });
  w.st.activePlayer = 'p2'; w.st.turnNumber = 4; w.answers.pickStack = (o) => o.uids[0]; w.answers.multipleChoice = (o) => o.options.length - 1;
  await w.exec('p2', '상대의 디지몬 1마리를 《퇴화 2》.', plain(3, 1), w.p2.stacks[0].uid);
  w.eq(w.p1.stacks[0].cardId, plain(3, 0), 'top is now the Lv.3 card (both peeled)');
  return w;
});
for (const [q, to, keep] of [['3888', 'EX7-044', false], ['3868/3895', 'BT21-074', true]]) {
  scenario(q, 'Link card survives a normal evolution when the link condition is still met (' + to + '), else is discarded by the rule check', async () => {
    const w = W({ p1: { battle: [{ id: 'BT21-071' }], hand: [to] }, p2: {}, memory: 10 });
    const st = w.p1.stacks[0]; (st.linkCards ||= []).push({ cardId: 'BT21-054' });
    S.digivolve(w.st, 'p1', st.uid, to, 0, 'hand'); await w.drain();
    w.eq((st.linkCards || []).length, keep ? 1 : 0, 'link cards left');
    w.eq(w.pl('p1').trash.includes('BT21-054'), !keep, 'link card in trash?');
    return w;
  });
}
scenario('3916-17', 'BT21-092: player orders the digimon sources going under the Tamer; they go below the Tamer existing cards', async () => {
  const xh = all.find((c) => c.category === 'digimon' && (c.types || []).includes('크로스 하트') && c.level === 3).id;
  const [a, b2, x] = [plain(3, 0), plain(3, 1), plain(3, 2)];
  const w = W({ p1: { battle: [{ id: xh, src: [a, b2] }, { id: 'RB1-035', src: [x] }], hand: ['BT21-092'] }, p2: {}, memory: 10 });
  w.answers.orderCards = () => [1, 0];
  await w.runCard('p1', 'BT21-092', '메인');
  const t = w.p1.stacks[1];
  w.ok(w.prompts.some((p) => p.k === 'orderCards'), 'an ordering prompt was asked');
  w.eq(t.sources.length, 3, 'three cards under the Tamer');
  w.eq(t.sources[t.sources.length - 1], x, 'the Tamer existing card stays topmost of the under-stack (new cards go to the bottom)');
  return w;
});
for (const [q, pick, dMem] of [['3625', 'BT20-068', 0], ['3626', 'BT20-063', 1]]) {
  scenario(q, 'BT20-006 + BT20-063 sources of a deleted BT20-068: returning ' + pick + ' from the trash; the waiting card is the DIGIMON card (068), so 063 memory +1 happens only in the 063 case', async () => {
    const w = W({ p1: { battle: [{ id: 'BT20-068', src: ['BT20-006', 'BT20-063'] }] }, p2: {} });
    w.answers.pickFromZoneIndex = (o) => { const tr = w.pl('p1').trash; const i = o.eligibleIdxs.find((k) => tr[k] === pick); return i !== undefined ? i : o.eligibleIdxs[0]; };
    const m0 = w.st.memory;
    S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
    w.eq(w.st.memory - m0, dMem, 'memory delta');
    w.ok(w.pl('p1').hand.includes(pick), pick + ' returned to hand');
    return w;
  });
}
await run('w6-c');
