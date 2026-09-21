// Slice3 round 2 part D: memory / once-per-turn history / turn-end timing / frozen targets (Q ids only, paraphrased).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const mono = (color, lv, skip = []) => cards.find(c => c.category === 'digimon' && c.level === lv && c.colors.length === 1 && c.colors[0] === color && !c.effectKo?.trim() && !skip.includes(c.id))?.id;
const bat = (st, p, id) => st.players[p].battle.find(s => s.cardId === id);
const tamerAny = () => cards.find(c => c.category === 'tamer' && !c.effectKo?.includes('테이머 아래'))?.id;

// Q3528/3556: [턴에 1회] of an INHERITED effect keeps its history when the source card is moved to the bottom (no infinite memory)
for (const [q, id] of [['Q3528', 'EX5-007'], ['Q3556', 'EX5-016']]) await sc(q, `${id}: source [턴에 1회] memory +2 cannot be repeated by re-using the same card after it was moved`, async () => {
  const st = newState(); const top = put(st, 'p1', [id, id, FILL[0]]); st.memory = 0; const txt = '[턴에 1회] 특징으로 「나이트 클로」/「라이트 팽」을 가진 이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 이 디지몬의 진화원 아래에 놓는 것으로, 메모리 +2.';
  for (let k = 0; k < 3; k++) { S.queuePending(st, { player: 'p1', cardId: id, stackUid: top.uid, tags: ['메인'], text: txt, resolved: false, inherited: true }); await drain(st); }
  return eq('memory after 3 tries', st.memory, 2);
});
// Q3557: EX5-016 start of main: it may return ITSELF to hand (+2 memory)
await sc('Q3557', 'EX5-016 main-start: returning the digimon itself to hand for memory +2 is allowed', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-016']); st.memory = 0;
  S.queuePending(st, { player: 'p1', cardId: 'EX5-016', stackUid: me.uid, tags: ['자신의 메인 페이즈 개시 시'], text: '자신의 디지몬 1마리를 패로 되돌리는 것으로, 메모리 +2.' });
  await drain(st, (k, o) => (k === 'pickStack' ? me.uid : undefined)); return all(eq('memory', st.memory, 2), eq('in hand', st.players.p1.hand.includes('EX5-016'), true));
});
// Q3708: EX6-013 played from sources: draw AND memory +1
await sc('Q3708', 'EX6-013 on play from evolution sources: both the draw and memory +1', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX6-013']); me.playedFromSources = true; st.memory = 0; const d0 = st.players.p1.deck.length;
  await trig(st, 'p1', me, 'play'); return all(eq('drew', d0 - st.players.p1.deck.length, 1), eq('memory', st.memory, 1));
});
await sc('Q3708c', 'EX6-013 control: normal play draws but no memory', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX6-013']); st.memory = 0; const d0 = st.players.p1.deck.length; await trig(st, 'p1', me, 'play'); return all(eq('drew', d0 - st.players.p1.deck.length, 1), eq('memory', st.memory, 0));
});
// Q3505: EX4-064 tamer: purple 새/레이브몬 digimon deleted by an effect -> draw AND memory +1
await sc('Q3505', 'EX4-064: effect-deleted purple bird digimon -> 1 draw and memory +1 both', async () => {
  const bird = cards.find(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'purple' && (c.types || []).some(t => t.includes('새')) && !c.effectKo?.trim())?.id || cards.find(c => c.category === 'digimon' && c.colors.includes('purple') && /레이브몬/.test(c.nameKo))?.id;
  if (!bird) return 'no fixture'; const st = newState(); put(st, 'p1', ['EX4-064']); const b = put(st, 'p1', [bird]); st.memory = 0; const d0 = st.players.p1.deck.length;
  S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); await drain(st); return all(eq('draw', d0 - st.players.p1.deck.length, 1), eq('memory', st.memory, 1));
});
// Q3459: EX4-018 grants "【어택 시】 memory -2" to the LOWEST-Lv opp digimon at that moment; it keeps it after evolving even if no longer lowest
await sc('Q3459', 'EX4-018: the granted attack-memory penalty stays on the chosen digimon even after another becomes the lowest Lv', async () => {
  const st = newState(); const lo = put(st, 'p2', [mono('red', 3)]); const hi = put(st, 'p2', [mono('blue', 4)]); const me = put(st, 'p1', ['EX4-018']); await trig(st, 'p1', me, 'play');
  lo.cardId = mono('green', 5); S.recomputeStackGrants(lo); st.activePlayer = 'p2'; st.turnNumber++; st.memory = 0;
  await trig(st, 'p2', lo, 'attack'); const dLo = st.memory; st.memory = 0; await trig(st, 'p2', hi, 'attack'); const dHi = st.memory;
  return all(eq('chosen digimon (now Lv5) still costs memory', dLo, 2), eq('other digimon unaffected', dHi, 0));
});
// Q3374/Q3426: after a jogress by the 진화 시 effect the memory went to the opponent; the SOURCE effect at turn end may jogress again
for (const [q, src] of [['Q3374', 'EX3-008'], ['Q3426', 'EX3-058']]) await sc(q, `${src}: turn-end (memory on opp side) inherited effect can jogress again`, async () => {
  const st = newState(); const a = put(st, 'p1', [mono('blue', 5), src]); const b = put(st, 'p1', [mono('green', 5)]); st.players.p1.hand = ['BT18-041']; st.memory = -3;
  S.queuePending(st, { player: 'p1', cardId: src, stackUid: a.uid, tags: ['자신의 턴 종료 시'], text: '이 디지몬과 다른 자신의 디지몬으로 패의 디지몬 카드로 조그레스 진화할 수 있다.', inherited: true }); await drain(st);
  return eq('jogressed again', !!bat(st, 'p1', 'BT18-041'), true);
});
// Q3893/Q3961: EX8-026 / EX8-068: as soon as memory reaches 1+ the effect is live (no gap for a 진격 attack / a battle deletion)
await sc('Q3893', 'EX8-026: while memory is 1+ opp digimon cannot rest (so 진격/attack-by-rest is impossible); at 0 they can', async () => {
  const st = newState(); put(st, 'p1', ['EX8-026']); const o = put(st, 'p2', [FILL[1]]); st.memory = 0; const at0 = S.canRestByRule(st, 'p2', o); st.memory = 1; const at1 = S.canRestByRule(st, 'p2', o);
  return all(eq('memory 0', at0, true), eq('memory 1', at1, false));
});
// Q3514: EX4-070 delay: opp declines discarding an option -> the user gains memory +2 (user's perspective)
await sc('Q3514', 'EX4-070 delay: opp does not discard -> memory +2 for the user (p1 side)', async () => {
  const st = newState(); st.memory = 0; st.players.p2.hand = [cards.find(c => c.category === 'option')?.id];
  S.queuePending(st, { player: 'p1', cardId: 'EX4-070', stackUid: null, tags: ['메인'], text: '《딜레이》(놓인 다음 턴 이후에 이 카드를 파기하는 것으로, 효과를 발휘한다)\n·상대는 본인의 패에서 옵션 카드 1장을 파기할 수 있다. 파기하지 않았다면, 메모리 +2.' });
  await drain(st, (k) => (k === 'confirmEffect' ? false : undefined)); return eq('memory', st.memory, 2);
});
finish('slice3-r2-d');
