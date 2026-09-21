// Slice3 round 2 part B: Jogress / DNA rulings (official Q&A referenced by Q id, paraphrased).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const mono = (color, lv, skip = []) => cards.find(c => c.category === 'digimon' && c.level === lv && c.colors.length === 1 && c.colors[0] === color && !c.effectKo?.trim() && !skip.includes(c.id))?.id;
const fire = async (st, p, stk, cardId, tag, ch, text) => { const cd = C(cardId); const seg = (text != null) ? text : null; const it = S.queuePending(st, { player: p, cardId, stackUid: stk.uid, tags: [tag], text: seg }); return drain(st, ch); };
const bat = (st, p, id) => st.players[p].battle.find(s => s.cardId === id);

// ---- Q2922/Q3015 + Q2923/Q3016: 【소멸 시】 jogress into hand 「밀레니엄몬」 (BT18-015 / BT18-073): the target must have a jogress line; the trash copy of itself may be the material
for (const [q, dying, mate, qs] of [['Q2922', 'BT18-015', 'BT18-073', 'Q2923'], ['Q3015', 'BT18-073', 'BT18-015', 'Q3016']]) {
  await sc(q, `${dying}: no jogress into a 「밀레니엄몬」 that has no jogress line`, async () => {
    const st = newState(); put(st, 'p1', [mate]); const me = put(st, 'p1', [dying]); st.players.p1.hand = ['BT2-083']; S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st);
    return all(eq('hand kept', st.players.p1.hand.join(), 'BT2-083'), eq('no fusion', st.players.p1.battle.some(s => s.cardId === 'BT2-083'), false));
  });
  await sc(qs, `${dying}: the trashed card itself may be the material for jogress into 밀레니엄몬 (BT18-019)`, async () => {
    const st = newState(); put(st, 'p1', [mate]); const me = put(st, 'p1', [dying]); st.players.p1.hand = ['BT18-019']; S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st);
    return all(eq('fused', !!bat(st, 'p1', 'BT18-019'), true), eq('trash card consumed', st.players.p1.trash.includes(dying), false));
  });
}

// ---- Q2965 / Q3806 / Q3850: jogress pair tables (each side is an OR of colours; the two sides are separate slots)
const col5 = { blue: mono('blue', 5), yellow: mono('yellow', 5), green: mono('green', 5), black: mono('black', 5), red: mono('red', 5) };
const col6 = { blue: mono('blue', 6), yellow: mono('yellow', 6), green: mono('green', 6), black: mono('black', 6), purple: mono('purple', 6), red: mono('red', 6) };
const can = (a, b, t) => S.canJogress({ cardId: a }, { cardId: b }, t).ok;
await sc('Q2965', 'BT18-041: (blue|yellow Lv5)+(green|black Lv5) only', async () => {
  const t = 'BT18-041', c = col5;
  return all(eq('blue+green', can(c.blue, c.green, t), true), eq('yellow+black', can(c.yellow, c.black, t), true), eq('blue+black', can(c.blue, c.black, t), true), eq('yellow+green', can(c.yellow, c.green, t), true),
    eq('blue+yellow (same side) no', can(c.blue, c.yellow, t), false), eq('green+black (same side) no', can(c.green, c.black, t), false), eq('red+green no', can(c.red, c.green, t), false));
});
await sc('Q3806', 'EX6-062: (yellow|black Lv6)+(green|purple Lv6); yellow+black / green+purple are rejected', async () => {
  const t = 'EX6-062', c = col6;
  return all(eq('yellow+green', can(c.yellow, c.green, t), true), eq('black+purple', can(c.black, c.purple, t), true), eq('yellow+black no', can(c.yellow, c.black, t), false), eq('green+purple no', can(c.green, c.purple, t), false));
});
await sc('Q3850', 'EX7-037: (green|yellow Lv6)+(black|blue Lv6)', async () => {
  const t = 'EX7-037', c = col6;
  return all(eq('green+black', can(c.green, c.black, t), true), eq('yellow+blue', can(c.yellow, c.blue, t), true), eq('green+yellow no', can(c.green, c.yellow, t), false), eq('black+blue no', can(c.black, c.blue, t), false));
});

// ---- Q3813/Q3814: EX6-074 turn end jogress obeys the printed jogress condition (no ignoring); Q3822 EX6-072
await sc('Q3813', 'EX6-074 turn end: hand digimon without a jogress line cannot be jogressed into', async () => {
  const st = newState(); const tm = put(st, 'p1', ['EX6-074']); put(st, 'p1', [col5.blue]); put(st, 'p1', [col5.green]); st.players.p1.hand = [FILL[3]]; st.memory = 10;
  await fire(st, 'p1', tm, 'EX6-074', '자신의 턴 종료 시', null, '자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할 수 있다.');
  return all(eq('still 3 stacks', st.players.p1.battle.length, 3), eq('hand kept', st.players.p1.hand.length, 1));
});
await sc('Q3814', 'EX6-074 turn end: designated-pair mismatch (red+red vs BT18-041) is rejected; correct pair is allowed', async () => {
  let st = newState(); let tm = put(st, 'p1', ['EX6-074']); put(st, 'p1', [col5.red]); put(st, 'p1', [col5.red === col5.red ? mono('red', 5, [col5.red]) : col5.red]); st.players.p1.hand = ['BT18-041']; st.memory = 10;
  await fire(st, 'p1', tm, 'EX6-074', '자신의 턴 종료 시', null, '자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할 수 있다.'); const bad = !!bat(st, 'p1', 'BT18-041');
  st = newState(); tm = put(st, 'p1', ['EX6-074']); put(st, 'p1', [col5.blue]); put(st, 'p1', [col5.green]); st.players.p1.hand = ['BT18-041']; st.memory = 10;
  await fire(st, 'p1', tm, 'EX6-074', '자신의 턴 종료 시', null, '자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할 수 있다.');
  return all(eq('wrong pair rejected', bad, false), eq('right pair fused', !!bat(st, 'p1', 'BT18-041'), true));
});
await sc('Q3822', 'EX6-072 main: Lv6 digimon + hand card that does not satisfy the Lv7 card\'s jogress condition -> no evolution', async () => {
  const st = newState(); put(st, 'p1', [col6.red]); put(st, 'p1', [mono('red', 6, [col6.red])]); st.players.p1.hand = ['EX6-072', 'EX6-062']; st.memory = 10; st.players.p2.battle.push(S._s4.makeStack(mono('red', 6), 1));
  S.useOptionCard(st, 'p1', 0); await drain(st);
  return all(eq('no ultimate chaos', !!bat(st, 'p1', 'EX6-062'), false));
});
// ---- Q3387/Q3388: EX3-019 (opp source): jogress is one evolution -> surcharge +1 once; applies if at least one material lacks sources
for (const [q, srcA, srcB, want] of [['Q3387', 0, 0, 1], ['Q3388', 0, 1, 1], ['Q3388b', 1, 1, 0], ['Q3388c', 1, 0, 1]]) await sc(q, `EX3-019 surcharge on jogress: materials with sources (${srcA},${srcB}) -> +${want}`, async () => {
  const st = newState(); put(st, 'p2', [FILL[5], 'EX3-019']);
  const a = put(st, 'p1', [col5.blue, ...(srcA ? [FILL[1]] : [])]); const b = put(st, 'p1', [col5.green, ...(srcB ? [FILL[2]] : [])]);
  const cs = S.jogressCostStack(a, b); return eq('delta', S.continuousEvoCostDiscount(st, 'p1', cs, 'BT18-041') + S.hookEvoCostDiscount(st, 'p1', cs, 'BT18-041'), want);
});
// end-to-end through the effect path (EX6-074 turn end -> BT18-041 has jogress cost 0; +1 surcharge => 1 memory)
await sc('Q3387e', 'EX3-019 surcharge is really paid by an effect-driven jogress (BT18-041 cost 0 -> 1)', async () => {
  const st = newState(); put(st, 'p2', [FILL[5], 'EX3-019']); const tm = put(st, 'p1', ['EX6-074']); put(st, 'p1', [col5.blue]); put(st, 'p1', [col5.green]); st.players.p1.hand = ['BT18-041']; st.memory = 5;
  await fire(st, 'p1', tm, 'EX6-074', '자신의 턴 종료 시', null, '자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할 수 있다.');
  return all(eq('fused', !!bat(st, 'p1', 'BT18-041'), true), eq('memory paid', 5 - st.memory, 1));
});
// ---- Q3420: EX3-053 play (no deletion) -> next opp turn every ACTIVE opp digimon cannot evolve; a jogress needs BOTH materials rested
await sc('Q3420', 'EX3-053: active opp digimon cannot evolve; jogress with one active + one rested material is rejected, two rested is fine', async () => {
  const st = newState(); const big = mono('blue', 6); const me = put(st, 'p1', ['EX3-053']); const a = put(st, 'p2', [big]); const b = put(st, 'p2', [mono('red', 6)]); b.suspended = true; const c = put(st, 'p2', [mono('green', 6)]); c.suspended = true;
  await trig(st, 'p1', me, 'play'); st.activePlayer = 'p2'; st.turnNumber++;
  const rr = (s) => E.evoRestrictionCheck('BT18-041', S.evolveTargetRestriction(st, 'p2', s)).ok;
  return all(eq('active blocked', rr(a), false), eq('rested allowed', rr(b), true), eq('mixed pair => one material blocked', [a, b].every(rr), false), eq('both rested ok', [b, c].every(rr), true));
});
// ---- Q3355: EX2-070 evolves ONE own digimon (normal evolution); a jogress-only card is never reachable, an ordinary evolution is
await sc('Q3355', 'EX2-070: single-digimon evolution, no jogress fusion (other digimon untouched)', async () => {
  const st = newState(); const a = put(st, 'p1', [mono('blue', 5)]); const b = put(st, 'p1', [mono('green', 5)]); const opt = 'EX2-070'; st.players.p1.hand = [opt, 'BT18-019']; st.memory = 8; put(st, 'p1', [tamerAny()]);
  S.useOptionCard(st, 'p1', 0); await drain(st);
  return all(eq('no jogress result', !!bat(st, 'p1', 'BT18-019'), false), eq('both stacks intact', st.players.p1.battle.filter(s => s.uid === a.uid || s.uid === b.uid).length, 2));
});
function tamerAny() { return cards.find(c => c.category === 'tamer' && !c.effectKo?.includes('테이머 아래'))?.id; }
// ---- Q2928/Q2929: BT18-019 (jogress evolution) returns from the opp trash ONLY digimon cards with a Lv., different Lv. from each other; no digi-eggs / Lv.- cards
await sc('Q2928', 'BT18-019 on play: a digi-egg in the opp trash is never returned (only digimon cards with a Lv.); Lv.- digimon do not exist outside tokens', async () => {
  const egg = cards.find(c => c.category === 'digitama')?.id;
  const st = newState(); const me = put(st, 'p1', ['BT18-019', 'BT18-015', 'BT18-073']); me.viaFusion = true; put(st, 'p2', [FILL[4]]); st.players.p2.trash = [egg]; const d0 = st.players.p2.deck.length;
  await trig(st, 'p1', me, 'play');
  return all(eq('only the just-deleted digimon returned', st.players.p2.deck.length - d0, 1), eq('egg stays in trash', st.players.p2.trash.includes(egg), true));
});
await sc('Q2928c', 'control: BT18-019 on play returns different-Lv digimon from opp trash (+memory per card)', async () => {
  const st = newState(); const me = put(st, 'p1', ['BT18-019', 'BT18-015', 'BT18-073']); me.viaFusion = true; put(st, 'p2', [FILL[4]]); const l3 = cards.find(c => c.category === 'digimon' && c.level === 3).id, l4 = cards.find(c => c.category === 'digimon' && c.level === 4).id;
  st.players.p2.trash = [l3, l4]; const d0 = st.players.p2.deck.length; const m0 = st.memory; await trig(st, 'p1', me, 'play');
  return all(eq('cards returned', st.players.p2.deck.length - d0, 2), eq('memory +2', st.memory - m0, 2));
});
// ---- Q3434: EX3-069 played digimon cannot digivolve into Lv7 — jogress into a Lv7 card is a digivolution too
await sc('Q3434', 'EX3-069: a digimon that may not reach Lv7 cannot jogress into a Lv7 card either (evolution restriction applies to jogress materials)', async () => {
  const st = newState(); const a = put(st, 'p1', [mono('blue', 6)]); const b = put(st, 'p1', [mono('green', 6)]); a.s39MaxEvoLevel = 6;
  const chk = (s) => E.evoRestrictionCheck('BT18-041', S.evolveTargetRestriction(st, 'p1', s)).ok; const chk7 = (s) => E.evoRestrictionCheck('EX7-037', S.evolveTargetRestriction(st, 'p1', s)).ok;
  return all(eq('Lv7 target blocked for the marked material', chk7(a), false), eq('unmarked material ok', chk7(b), true));
});
finish('slice3-r2-b');
