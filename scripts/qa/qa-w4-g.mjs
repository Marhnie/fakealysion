// w4 recheck2 (rulings idx 2001-2667) batch G. Run: node scripts/qa/qa-w4-g.mjs < /dev/null
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const cards = Object.values(S.CARDS);

scenario('2394', 'BT18-082: opp picks own effect-immune digimon -> not deleted -> "did not delete" branch runs (recover +1, opp security trash)', async () => {
  const imm = 'BT16-102'; // gets 「相手の効果を受けない」 via its own 【진화 시】; use a stack flag instead
  const w = W({ p1: { security: [plain(3, 0), plain(3, 0)], battle: [{ id: 'BT18-082' }] }, p2: { security: [plain(3, 0), plain(3, 0), plain(3, 0)], battle: [{ id: plain(3, 1) }] }, memory: 10 });
  const o = w.p2.stacks[0];
  S.grantShield(w.st, 'p2', o.uid, { kinds: ['all'], until: w.st.turnNumber + 5, fromCategory: 'digimon' });
  w.answers.confirmEffect = () => true;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(w.pl('p2').battle.some(s => s.uid === o.uid), 'immune digimon survived');
  w.eq(w.pl('p1').security.length, 3, 'p1 recovered');
  w.eq(w.pl('p2').security.length, 2, 'p2 security trashed');
  return w;
});
scenario('2600', 'EX1-063 【어택 시】: only a card with 《길동무》 in its OWN text (not in its source effect) can be played', async () => {
  const purpleOwn = cards.find(c => c.category === 'digimon' && c.level <= 4 && c.colors.includes('purple') && /《길동무》/.test(c.effectKo || ''));
  const purpleInh = cards.find(c => c.category === 'digimon' && c.level <= 4 && c.colors.includes('purple') && !/《길동무》/.test(c.effectKo || '') && /《길동무》/.test(c.inheritedKo || ''));
  const w = W({ p1: { trash: [purpleInh.id], battle: [{ id: 'EX1-063' }] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '어택 시');
  w.eq(w.pl('p1').battle.length, 1, 'source-effect 길동무 card not playable (' + purpleInh.id + ')');
  const w2 = W({ p1: { trash: [purpleOwn.id], battle: [{ id: 'EX1-063' }] }, p2: {} });
  await w2.run('p1', w2.p1.stacks[0].uid, '어택 시');
  w2.eq(w2.pl('p1').battle.length, 2, 'own-text 길동무 card playable (' + purpleOwn.id + ')');
  return w;
});
scenario('2475', 'BT19-063 【등장 시】: opp digimon degen then "digixros" clause gate; may delete own digimon', async () => {
  const w = W({ p1: { battle: [{ id: 'BT19-063' }, { id: plain(3, 2) }] }, p2: {} });
  w.pl('p1').battle[0].xrosCount = 2; // digixrossed
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(w.prompts.some(p => p.k === 'pickStack' && (p.o.uids || []).includes(w.p1.stacks[1].uid)) || w.pl('p1').battle.length <= 1, 'own digimon selectable for the delete (prompts: ' + w.prompts.map(p => p.k + ':' + (p.o.uids || []).join('/')) + ')');
  return w;
});
scenario('2405', 'BT18-102 【어택 시】: several tamer cards placed under the security are ordered by the player (orderCards prompt)', async () => {
  const t = cards.filter(c => c.category === 'tamer').slice(0, 3).map(c => c.id);
  const runWith = async (ans) => {
    const w = W({ p1: { battle: [{ id: 'BT18-102', src: [...t] }] }, p2: { security: [plain(3, 0), plain(3, 0), plain(3, 0), plain(3, 0), plain(3, 0)] } });
    let asked = 0;
    w.answers.orderCards = (o) => { asked++; return ans(o); };
    const sg = S.parseEffectSegments(C('BT18-102').effectKo).segments.find(x => x.body.includes('테이머 카드 5장까지'));
    await w.exec('p1', sg.body, 'BT18-102', w.p1.stacks[0].uid, { tags: sg.tags });
    return { sec: w.pl('p1').security.slice(-3), asked, w };
  };
  const id = await runWith((o) => o.ids.map((_, i) => i));
  const rev = await runWith((o) => o.ids.map((_, i) => o.ids.length - 1 - i));
  const w = rev.w;
  w.ok(rev.asked >= 1 && id.asked >= 1, 'order prompt asked');
  w.eq(rev.sec, id.sec.slice().reverse(), 'reversed order applied');
  return w;
});
scenario('2241', 'BT17-097 Delay: two 「프리」 digimon deleted at once by an opp effect -> only ONE can be evolved (and only that one survives)', async () => {
  const w = W({ p1: { hand: ['EX1-022', 'EX1-022'], battle: [{ id: 'BT17-097' }, { id: 'EX1-019' }, { id: 'EX1-019' }] }, p2: { battle: [plain(3, 5)] }, active: 'p2', turn: 4 });
  w.p1.stacks[0].placedTurn = 1;
  await w.exec('p2', '상대의 디지몬 전부를 소멸시킨다.', plain(3, 5), w.p2.stacks[0].uid);
  const left = w.pl('p1').battle.filter(s => s.cardId !== 'BT17-097').map(s => s.cardId);
  w.eq(left, ['EX1-022'], 'exactly one digimon (the evolved one) remains; got ' + left);
  return w;
});
scenario('2359', 'BT18-069: an effect-immune opp digimon CAN be chosen and is then made to attack (the effect acts on the player)', async () => {
  const w = W({ p1: { battle: [{ id: 'BT18-069' }] }, p2: { battle: [{ id: plain(3, 1) }, { id: plain(3, 2) }] }, active: 'p2', turn: 4 });
  const o = w.p2.stacks[0];
  S.grantShield(w.st, 'p2', o.uid, { kinds: ['all'], until: w.st.turnNumber + 5, fromCategory: 'digimon' });
  let offered = null;
  w.answers.pickStack = (x) => { offered = x.uids.slice(); return o.uid; };
  await w.run('p1', w.p1.stacks[0].uid, '상대의 턴 종료 시');
  w.ok(offered && offered.includes(o.uid), 'immune digimon is offered');
  w.eq((w.attackReqs || []).map(r => r.uid), [o.uid], 'it is made to attack');
  return w;
});
scenario('2228', 'BT17-093 【서로의 턴】: playing a digimon into the breeding area by an effect is NOT hatching -> no trigger', async () => {
  const egg = cards.find(c => c.category === 'digitama');
  const w = W({ p1: { hand: [plain(3, 3)], battle: [{ id: 'BT17-093' }] }, p2: {}, active: 'p2', memory: 0 });
  await w.exec('p1', '자신의 패에서 Lv.4 이하의 디지몬 카드 1장을 육성 에어리어에 코스트를 지불하지 않고 등장시킨다.', 'BT16-083', null, {});
  w.eq(w.fires('BT17-093'), 0, 'no hatch trigger');
  w.ok(!!w.pl('p1').raising, 'digimon is in the breeding area');
  const w2 = W({ p1: { battle: [{ id: 'BT17-093' }] }, p2: {}, active: 'p2', memory: 0 });
  w2.pl('p1').digitamaDeck = [egg.id];
  S.s7HatchByEffect(w2.st, 'p1'); await w2.drain();
  w2.ok(w2.fires('BT17-093') >= 1, 'real hatch triggers it');
  return w;
});
scenario('2306', 'BT18-033 [패]【메인】: with an empty breeding area, may return a 3대천사 digimon card from trash to the deck bottom and play this card into the breeding area', async () => {
  const ang = cards.find(c => c.category === 'digimon' && (c.types || []).includes('3대천사') || (c.effectKo||'').includes('3대천사') && c.category === 'digimon' && (c.types||[]).includes('3대천사'));
  const w = W({ p1: { hand: ['BT18-033'], trash: [ang.id] }, p2: {}, memory: 5 });
  await w.runCard('p1', 'BT18-033', '메인');
  w.eq(w.pl('p1').raising && w.pl('p1').raising.cardId, 'BT18-033', 'played into breeding area');
  return w;
});
const optCost3 = () => cards.find(c => c.category === 'option' && c.cost === 3 && !(c.effectKo || '').includes('코스트를') && !/사용 코스트/.test(c.effectKo || '') && c.colors.length === 1);
for (const [q, label, prep, expectDraw] of [
  ['2133', 'payment reduced (costDelta -2) but printed cost 3 -> triggers', (w) => ({ costDelta: -2 }), true],
  ['2132', 'card lowers its OWN hand cost to 1 (BT2-099 with 8 yellow tamers = printed 9 -> 1) -> does not trigger', null, false],
]) {
  scenario(q, 'EX2-003 inherited "사용 코스트 2 이상의 옵션": ' + label, async () => {
    if (prep) {
      const o = optCost3();
      const w = W({ p1: { hand: [o.id], battle: [{ id: plain(4, 0), src: ['EX2-003'] }, ...C(o.id).colors.map(col => cards.find(c => c.category === 'digimon' && c.dp && c.level === 3 && c.colors.length === 1 && c.colors[0] === col).id)] }, p2: {}, memory: 10 });
      const h0 = w.pl('p1').hand.length;
      S.useOptionCard(w.st, 'p1', 0, prep(w)); await w.drain();
      w.eq(w.pl('p1').hand.length - (h0 - 1) >= 1, expectDraw, 'drew: ' + (w.pl('p1').hand.length - (h0 - 1)));
      return w;
    }
    const yel = cards.find(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === 'yellow');
    const ydig = cards.find(c => c.category === 'digimon' && c.dp && c.level === 3 && c.colors.length === 1 && c.colors[0] === 'yellow').id;
    const w = W({ p1: { hand: ['BT2-099'], battle: [{ id: plain(4, 0), src: ['EX2-003'] }, { id: ydig }, ...Array.from({ length: 8 }, () => ({ id: yel.id }))] }, p2: { battle: [plain(3, 1)] }, memory: 10 });
    const h0 = w.pl('p1').hand.length;
    S.useOptionCard(w.st, 'p1', 0); await w.drain();
    w.eq(w.pl('p1').hand.length - (h0 - 1) >= 1, expectDraw, 'drew: ' + (w.pl('p1').hand.length - (h0 - 1)));
    return w;
  });
}
scenario('2616', 'EX1-072: after use the opponent cannot USE option cards during their next turn; expires at the end of that turn', async () => {
  const opt2 = cards.find(c => c.category === 'option' && c.cost === 0 && !/^s*$/.test(c.effectKo || '') && c.colors.length === 1);
  const mate = (col) => cards.find(c => c.category === 'digimon' && c.dp && c.level === 3 && c.colors.length === 1 && c.colors[0] === col).id;
  const w = W({ p1: { hand: ['EX1-072'], battle: [mate('white') || plain(3, 0)] }, p2: { hand: [opt2.id], battle: [mate(opt2.colors[0])] }, memory: 10 });
  w.pl('p1').battle.push(S._s4.makeStack(cards.find(c => c.category === 'digimon' && c.colors.includes('white')).id, 1));
  await w.useOption('p1', 'EX1-072');
  E.endTurn(w.st, false); let g = 0; while (w.st.turnEnding && g++ < 10) { await w.drain(); E.settleTurnEnd(w.st); }
  w.eq(w.st.activePlayer, 'p2', 'p2 turn');
  const r = S.useOptionCard(w.st, 'p2', 0);
  w.eq(r, null, 'p2 cannot use an option card');
  return w;
});
await run('w4-g');
