// w4 recheck2 (rulings idx 2001-2667) batch E: BT19. Run: node scripts/qa/qa-w4-e.mjs < /dev/null
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const anyTamer = () => Object.values(S.CARDS).find((c) => c.category === "tamer" && !(c.inheritedKo || "").includes("자신의 턴")).id;
const cards = Object.values(S.CARDS);
const mateFor = (optId) => C(optId).colors.map(col => cards.find(c => c.category === 'digimon' && c.dp && c.level === 3 && !(c.effectKo || '').trim() && (c.colors || []).length === 1 && c.colors[0] === col).id);

scenario('2517', 'BT19-093 discarded from the battle area during the OPPONENT turn: -3000 lasts until the end of THAT turn', async () => {
  const big = plain(4, 0);
  const w = W({ p1: { battle: [{ id: 'BT19-093' }] }, p2: { battle: [{ id: big }] }, active: 'p2', turn: 4 });
  const before = w.dp('p2', w.p2.stacks[0]);
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
  w.eq(w.dp('p2', w.p2.stacks[0]), before - 3000, 'DP -3000 now');
  E.endTurn(w.st, false); let g = 0; while (w.st.turnEnding && g++ < 10) { await w.drain(); E.settleTurnEnd(w.st); }
  w.eq(w.dp('p2', w.p2.stacks[0]), before, 'restored after that opp turn ended');
  return w;
});
scenario('2519', 'BT19-094 【메인】 with 0 security: delete opp digimon until 0 remain', async () => {
  const w = W({ p1: { security: [], hand: ['BT19-094'], battle: [...mateFor('BT19-094')] }, p2: { battle: [{ id: plain(3, 1) }, { id: plain(3, 2) }] }, memory: 10 });
  await w.useOption('p1', 'BT19-094');
  w.eq(w.pl('p2').battle.length, 0, 'all deleted');
  return w;
});
scenario('2512', 'BT19-091: own 메가로그라우몬 ACE means the 메가로그라우몬 token cannot be created (ACE is not part of the name)', async () => {
  const mega = C('BT19-011');
  if (!mega) { const w0 = W({}); w0.ok(false, 'no ACE card in data'); return w0; }
  const w = W({ p1: { hand: ['BT19-091'], battle: [{ id: mega.id }, ...mateFor('BT19-091')] }, p2: {}, memory: 10 });
  await w.useOption('p1', 'BT19-091');
  const names = w.pl('p1').battle.map(s => C(s.cardId).nameKo);
  w.eq(names.filter(n => n === '메가로그라우몬').length, 1, 'only the ACE card itself, no extra 메가로그라우몬 token; got ' + names.join(','));
  w.ok(names.some(n => n.includes('도사몬')) && names.some(n => n.includes('래피드몬')), 'others created: ' + names.join(','));
  return w;
});
scenario('2513', 'BT19-091: freshly created tokens (no Lv.) cannot be the 「Lv.5 digimon」 that gets 2 《연계》', async () => {
  const w = W({ p1: { hand: ['BT19-091'], battle: [...mateFor('BT19-091')] }, p2: {}, memory: 10 });
  await w.useOption('p1', 'BT19-091');
  const toks = w.pl('p1').battle;
  w.ok(toks.length >= 2, 'tokens made ' + toks.length);
  w.ok(toks.every(s => !(s.keywords && s.keywords['연계'])), 'no linked keyword on tokens');
  return w;
});
const egg2 = () => cards.find(c => c.category === 'digitama');
scenario('2036', 'BT16-090 main: raising-area digi-egg can be the digimon to discard; 웃코몬 deleted; 빅웃코몬 to breeding area', async () => {
  const w = W({ p1: { hand: ['BT16-083'], battle: [{ id: 'BT16-090' }, { id: 'BT16-082' }], raising: { id: egg2().id } }, p2: {}, memory: 5 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.eq(w.pl('p1').raising && w.pl('p1').raising.cardId, 'BT16-083', '빅웃코몬 in breeding area');
  w.ok(!w.pl('p1').battle.some(s => s.cardId === 'BT16-082'), '웃코몬 deleted');
  return w;
});
scenario('2037', 'BT16-090 main: no digimon in breeding area -> cost not payable, 웃코몬 is NOT deleted', async () => {
  const w = W({ p1: { hand: ['BT16-083'], battle: [{ id: 'BT16-090' }, { id: 'BT16-082' }] }, p2: {}, memory: 5 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.ok(w.pl('p1').battle.some(s => s.cardId === 'BT16-082'), '웃코몬 stays');
  w.ok(w.pl('p1').hand.includes('BT16-083'), 'hand unchanged');
  return w;
});
scenario('2038', 'BT16-090 main: may decline playing 빅웃코몬 after both costs paid', async () => {
  const w = W({ p1: { hand: ['BT16-083'], battle: [{ id: 'BT16-090' }, { id: 'BT16-082' }], raising: { id: egg2().id } }, p2: {}, memory: 5 });
  w.answers.confirmEffect = () => false;
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.ok(w.pl('p1').hand.includes('BT16-083'), '빅웃코몬 still in hand (declined) - got hand ' + w.pl('p1').hand);
  return w;
});
const ex6 = cards.find(c => c.category === 'digimon' && c.nameKo === '샤우트몬 EX6'), sstar = cards.find(c => c.category === 'digimon' && c.nameKo === '슈팅스타몬');
scenario('2510', 'BT19-090 2nd bullet: EX6 rested + Shooting Star already active -> cannot make BOTH active -> nothing happens (no attack, EX6 stays rested)', async () => {
  const w = W({ p1: { hand: ['BT19-090'], battle: [{ id: ex6.id, susp: true }, { id: sstar.id }, ...mateFor('BT19-090')] }, p2: {}, memory: 10 });
  w.answers.multipleChoice = () => 1;
  await w.useOption('p1', 'BT19-090');
  w.eq(w.p1.stacks[0].suspended, true, 'EX6 still rested');
  w.eq((w.attackReqs || []).length, 0, 'no attack');
  return w;
});
scenario('2510b', 'BT19-090 2nd bullet: both rested -> both become active and one digimon attacks the player', async () => {
  const w = W({ p1: { hand: ['BT19-090'], battle: [{ id: ex6.id, susp: true }, { id: sstar.id, susp: true }, ...mateFor('BT19-090')] }, p2: {}, memory: 10 });
  w.answers.multipleChoice = () => 1;
  await w.useOption('p1', 'BT19-090');
  w.eq([w.p1.stacks[0].suspended, w.p1.stacks[1].suspended], [false, false], 'both active');
  w.ok((w.attackReqs || []).length === 1, 'attack requested');
  return w;
});
for (const [q, atk, mine] of [['2318a', 'p2', true], ['2318b', 'p1', true]]) {
  scenario(q, 'BT18-042 【서로의 턴】: triggers when ANY digimon attacks (attacker ' + atk + ')', async () => {
    const w = W({ p1: { battle: [{ id: 'BT18-042', susp: true }, { id: plain(3, 3) }] }, p2: { battle: [{ id: plain(3, 4) }] }, active: atk });
    const a = atk === 'p1' ? w.p1.stacks[1] : w.p2.stacks[0];
    await w.attack(atk, a.uid, 'PLAYER');
    w.ok(w.fires('BT18-042') >= 1, 'fired: ' + JSON.stringify(w.fired));
    return w;
  });
}
scenario('2527', 'BT19-100 [시큐리티]: 마더 디·리퍼 (a Digi-Egg card with the 디·리퍼 form) counts as a Digimon with the trait; all digimon+tamers must have it; breeding area ignored', async () => {
  const tamX = cards.find(c => c.category === 'tamer' && !(c.types || []).includes('디·리퍼') && !/DP/.test(c.effectKo || '') && !(c.effectKo || '').includes('【자신의 턴】'));
  const egg = cards.find(c => c.category === 'digitama' && !(c.types || []).includes('디·리퍼'));
  w0: {
    w4trait: {
      const w = W({ p1: {}, p2: {} });
      w.ok(S.effectiveInfo(w.st, w.mk('p1', 'EX2-007'), 'p1').traits.includes('디·리퍼'), 'EX2-007 has the 디·리퍼 trait (form column folded into traits)');
    }
  }
  const run1 = async (extra) => {
    const w = W({ p1: { battle: [{ id: 'EX2-007', src: [plain(3, 0), plain(3, 1), plain(3, 2)] }, ...(extra.tamer ? [{ id: tamX.id }] : [])], raising: extra.egg ? { id: egg.id } : undefined }, p2: { battle: [{ id: plain(4, 0) }] }, active: 'p2', turn: 4 });
    S.secAddFaceUp(w.st, 'p1', 'BT19-100', 'top');
    const a = w.p2.stacks[0]; const before = w.dp('p2', a);
    await w.attack('p2', a.uid, 'PLAYER');
    return { w, delta: w.dp('p2', a) - before };
  };
  const r1 = await run1({}), r2 = await run1({ tamer: true }), r3 = await run1({ egg: true });
  r1.w.eq(r1.delta, -3000, 'only D-Reaper cards: DP -1000 x 3 sources');
  r1.w.eq(r2.delta, 0, 'a tamer without 디·리퍼 -> condition fails (2527)');
  r1.w.eq(r3.delta, -3000, 'non-D-Reaper digimon in the BREEDING area is ignored (2528)');
  return r1.w;
});
scenario('2633', 'EX2-007 【자신의 턴】: playing a 「디·리퍼」 card from hand costs 1 less per source of the Mother D-Reaper (ADR cards carry the trait only in their form column)', async () => {
  const w = W({ p1: { hand: ['EX2-049'], battle: [{ id: 'EX2-007', src: [plain(3, 0), plain(3, 1), plain(3, 2)] }] }, p2: {}, memory: 10 });
  w.eq(S.s1PlayDiscount(w.st, 'p1', 'EX2-049'), -3, 'discount -3');
  return w;
});
await run('w4-e');
