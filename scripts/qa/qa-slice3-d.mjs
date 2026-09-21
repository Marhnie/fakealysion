// Slice3 Q&A conformance part D: EX1 inherited effects / options.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);
const insect = findC(c => c.category === 'digimon' && (c.types || []).includes('곤충형'), 3);
const nonInsect = findC(c => c.category === 'digimon' && !(c.types || []).some(t => /곤충형/.test(t)) && c.level >= 4, 1)[0];

// Q3218/Q3219/Q3221/Q3222: EX1-033 source [on attack]: next evolution into an insect-type card costs -1 for ANY own digimon; only insect targets
await sc('Q3218', 'EX1-033 source: -1 evo cost applies to another own digimon, only for insect targets', async () => {
  const st = newState(); const a = put(st, 'p1', ['EX1-035', 'EX1-033']); const b = put(st, 'p1', [FILL[1]]);
  await trig(st, 'p1', a, 'attack');
  const dNon = S.s1EvoAuto(st, 'p1', b, nonInsect); const dIns = S.s1EvoAuto(st, 'p1', b, insect[0]);
  return all(eq('non-insect delta (Q3219 stays alive)', dNon, 0), eq('insect delta', dIns, -1), eq('used up', S.s1EvoAuto(st, 'p1', b, insect[0]), 0));
});
await sc('Q3220', 'EX1-033 source: two attacks accumulate -2', async () => {
  const st = newState(); const a = put(st, 'p1', ['EX1-035', 'EX1-033']); const b = put(st, 'p1', [FILL[1]]);
  await trig(st, 'p1', a, 'attack'); await trig(st, 'p1', a, 'attack');
  return eq('delta', S.s1EvoAuto(st, 'p1', b, insect[0]), -2);
});
// Q3231: EX1-044 DP bonus counts other own digimon sharing the NAME of the evolved (top) digimon, not Keramon
await sc('Q3231', 'EX1-044 source: counts by top-card name of the holder', async () => {
  const st = newState(); const X = FILL[0]; const a = put(st, 'p1', [X, 'EX1-044']); put(st, 'p1', [X]);
  put(st, 'p1', ['EX1-044']);
  const dpBase = C(X).dp; return eq('dp', S.effectiveDP(st, 'p1', a) - dpBase, 1000);
});
// Q3241/Q3242: EX1-056 without Myotismon-name digimon may attack the player but not digimon
await sc('Q3241', 'EX1-056: may attack player, no digimon targets without Myotismon', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX1-056']); put(st, 'p2', [FILL[1]], { rest: true });
  return all(eq('player ok', S.canAttackPlayer(st, 'p1', me.uid), true), eq('no digimon target', S.legalDigimonTargets(st, 'p1', me.uid).length, 0));
});
// Q3240: EX1-055 source draws at most once per turn even if two digimon are deleted
await sc('Q3240', 'EX1-055 source: two deletions -> 1 draw', async () => {
  const st = newState(); put(st, 'p1', [FILL[0], 'EX1-055']); const b = put(st, 'p1', [FILL[1]]); const c = put(st, 'p1', [FILL[2]]);
  const d0 = st.players.p1.deck.length; S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); S.deleteStack(st, 'p1', c.uid, 'trash', 'effect'); await drain(st);
  return eq('draws', d0 - st.players.p1.deck.length, 1);
});
// Q3250: EX1-064 on play deleting 4 opp digimon -> only 1 draw
await sc('Q3250', 'EX1-064 on play: 4 deleted -> 1 draw only', async () => {
  const st = newState(); const lv4 = findC(c => c.category === 'digimon' && c.level <= 4, 4); for (const id of lv4) put(st, 'p2', [id]);
  const me = put(st, 'p1', ['EX1-064']); const d0 = st.players.p1.deck.length; await trig(st, 'p1', me, 'play');
  return all(eq('opp left', st.players.p2.battle.length, 0), eq('draws', d0 - st.players.p1.deck.length, 1));
});
// Q3243/Q3244: EX1-058 source [on deleted]: returns a purple Lv<=4 digimon from trash incl. itself
await sc('Q3243', 'EX1-058 source: on deleted returns itself from trash', async () => {
  const st = newState(); const a = put(st, 'p1', ['EX1-062', 'EX1-058']); S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); await drain(st);
  return eq('in hand', st.players.p1.hand.includes('EX1-058'), true);
});
// Q3248: EX1-062 on delete: only the exact-named Agumon may be played from trash (not Agumon Doctor etc.)
await sc('Q3248', 'EX1-062 on delete: name-including Agumon cards are not eligible', async () => {
  const oth = findC(c => c.category === 'digimon' && /아구몬/.test(c.nameKo) && c.nameKo !== '아구몬')[0];
  const ex = findC(c => c.nameKo === '아구몬' && c.category === 'digimon')[0];
  let st = newState(); const a = put(st, 'p1', ['EX1-062']); st.players.p1.trash = [oth]; S.deleteStack(st, 'p1', a.uid, 'trash', 'effect'); await drain(st);
  const bad = st.players.p1.battle.length;
  st = newState(); const b = put(st, 'p1', ['EX1-062']); st.players.p1.trash = [ex]; S.deleteStack(st, 'p1', b.uid, 'trash', 'effect'); await drain(st);
  return all(eq('other-name not played', bad, 0), eq('exact played', st.players.p1.battle.length, 1));
});
// Q3249: EX1-063 on attack: the card must itself HAVE Bodyguard/Partner keyword (printed) - one with it only as source effect is not eligible
await sc('Q3249', 'EX1-063 on attack: card with source-only 길동무 not eligible', async () => {
  const src = findC(c => c.category === 'digimon' && c.colors.includes('purple') && c.level <= 4 && /길동무/.test(c.inheritedKo || '') && !/길동무/.test(c.effectKo || ''))[0];
  const own = findC(c => c.category === 'digimon' && c.colors.includes('purple') && c.level <= 4 && /^《길동무》/.test((c.effectKo || '').trim()))[0];
  let st = newState(); let me = put(st, 'p1', ['EX1-063']); st.players.p1.trash = [src]; await trig(st, 'p1', me, 'attack'); const bad = st.players.p1.battle.length;
  st = newState(); me = put(st, 'p1', ['EX1-063']); st.players.p1.trash = [own]; await trig(st, 'p1', me, 'attack');
  return all(eq('source-only not played', bad, 1), eq('printed played', st.players.p1.battle.length, 2));
});
// Q3255/Q3256/Q3257: EX1-068: all opp digimon (incl. those entering later) get on-attack memory -2 (from opp view) until end of next opp turn
await sc('Q3255', 'EX1-068: opp attack gives user memory +2, also for digimon played later', async () => {
  const st = newState(); put(st, 'p2', [FILL[1]]); st.players.p1.hand = ['EX1-068']; put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('blue') && c.level === 3)[0]]); st.memory = 5; S.useOptionCard(st, 'p1', 0); await drain(st);
  st.activePlayer = 'p2'; st.turnNumber++; const late = put(st, 'p2', [FILL[2]]); const m0 = st.memory;
  await trig(st, 'p2', late, 'attack');
  return eq('memory delta', st.memory - m0, 2);
});
// Q3272: EX2-004 source: draws when an opp digimon rests (block rest counts)
await sc('Q3272', 'EX2-004 source: opp digimon resting -> draw', async () => {
  const st = newState(); put(st, 'p1', [FILL[0], 'EX2-004']); const o = put(st, 'p2', [FILL[1]]); const d0 = st.players.p1.deck.length;
  S.restStack(st, 'p2', o.uid, 'block'); await drain(st); return eq('drew', d0 - st.players.p1.deck.length, 1);
});
finish('slice3-d');
