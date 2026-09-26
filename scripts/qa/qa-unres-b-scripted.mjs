// Unresolved-b (2): former "manualCost" effects now scripted — EX11-038 (Q5865), EX5-013 (Q3550), EX8-028 (Q3897), BT8-040 (Q1728/1729); EX6-063 (Q3808) verified to work through the generic watcher.
// Run: node scripts/qa/qa-unres-b-scripted.mjs < /dev/null
import { S, E, Fx, C, FILL, LOW, BIG, mk, put, setHand, setDeck, secN, drain, stackOf, playCard, evolve, atkSec, T, eq, ok, runAll, resolved } from './lib-s1.mjs';
const mineral = Object.values(S.CARDS).find(c => (c.types || []).includes('광물형') && c.category === 'digimon' && !c.isParallel && !c.id.includes('~') && c.id !== 'EX11-038')?.id;
const uses = (s) => Object.values(s.turnEffectUses || {}).reduce((a, b) => a + b, 0);
const deckLen = (st, p = 'p1') => st.players[p].deck.length;

T(5865, 'EX11-038: discard a 광물형 from hand -> draw 1; from ANOTHER digimon sources works; cancel pays nothing', async () => {
  ok('fixture', !!mineral);
  let st = mk(); setHand(st, 'p1', [mineral, FILL]); let d0 = deckLen(st);
  await playCard(st, 'p1', 'EX11-038'); eq('hand: mineral discarded', st.players.p1.hand.includes(mineral), false); ok('trash has it', st.players.p1.trash.includes(mineral)); eq('drew 1', deckLen(st), d0 - 1);
  st = mk(); const other = put(st, 'p1', FILL, { src: [mineral] }); setHand(st, 'p1', [FILL]); d0 = deckLen(st);
  await playCard(st, 'p1', 'EX11-038'); eq('source discarded', stackOf(st, 'p1', other.uid).sources, []); eq('drew 1', deckLen(st), d0 - 1);
  st = mk(); setHand(st, 'p1', [mineral]); d0 = deckLen(st); st._qaAns = { pickFromHandIndexes: [] };
  await playCard(st, 'p1', 'EX11-038'); eq('nothing paid', st.players.p1.hand, [mineral]); eq('no draw', deckLen(st), d0);
  st = mk(); setHand(st, 'p1', [FILL]); d0 = deckLen(st); await playCard(st, 'p1', 'EX11-038'); eq('no draw without a legal card', deckLen(st), d0);
});

const deva = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && (c.types || []).includes('데바') && c.id !== 'EX5-013' && !c.isParallel)?.id;
T(3550, 'EX5-013: destroy a DP<=6000 / 데바 digimon (either side) as the cost -> S attack +1; cancel keeps the once', async () => {
  ok('fixture', !!deva);
  let st = mk(); const m = put(st, 'p1', deva); const tgt = put(st, 'p2', LOW); secN(st, 'p2', 3);
  st._qaAns = { pickStackAnySide: (o) => o.entries.find(e => e.player === 'p2') };
  await evolve(st, 'p1', m.uid, 'EX5-013', 0, 'hand'); const s = stackOf(st, 'p1', m.uid);
  ok('opp digimon destroyed', !stackOf(st, 'p2', tgt.uid)); ok('S attack +1', S.securityAttackBonus(s) >= 1 || S.hasKeyword(s, '시큐리티어택'));
  eq('once used', uses(s), 1);
  st = mk(); const m2 = put(st, 'p1', deva); const t2 = put(st, 'p2', LOW); st._qaAns = { pickStackAnySide: null };
  await evolve(st, 'p1', m2.uid, 'EX5-013', 0, 'hand'); ok('target alive', !!stackOf(st, 'p2', t2.uid)); eq('once kept', uses(stackOf(st, 'p1', m2.uid)), 0);
  st = mk(); const m3 = put(st, 'p1', deva); const mine = put(st, 'p1', LOW);
  st._qaAns = { pickStackAnySide: (o) => o.entries.find(e => e.uid === mine.uid) };
  await evolve(st, 'p1', m3.uid, 'EX5-013', 0, 'hand'); ok('own digimon destroyed', !stackOf(st, 'p1', mine.uid));
});

const EX8TXT = '[턴에 1회] 진화원을 갖지 않은 디지몬 1마리를 시큐리티 아래에 놓는 것으로, 이 디지몬을 액티브로 한다.';
T(3897, 'EX8-028: a sourceless digimon (either side) goes under its owner security; this digimon becomes active; cancel keeps the once', async () => {
  let st = mk(); const m = put(st, 'p1', 'EX8-028', { susp: true }); const t = put(st, 'p2', LOW); secN(st, 'p2', 2);
  st._qaAns = { pickStackAnySide: (o) => o.entries.find(e => e.player === 'p2') };
  st.pending.push({ uid: 'e1', player: 'p1', cardId: 'EX8-028', stackUid: m.uid, topId: 'EX8-028', tags: ['진화 시', '어택 시'], text: EX8TXT, resolved: false });
  await drain(st);
  ok('opp digimon left the field', !stackOf(st, 'p2', t.uid)); eq('opp security +1', st.players.p2.security.length, 3); eq('bottom is that card', st.players.p2.security[2], LOW);
  ok('this digimon active', !stackOf(st, 'p1', m.uid).suspended); eq('once used', uses(stackOf(st, 'p1', m.uid)), 1);
  st = mk(); const m2 = put(st, 'p1', 'EX8-028', { susp: true }); put(st, 'p2', LOW); st._qaAns = { pickStackAnySide: null };
  st.pending.push({ uid: 'e2', player: 'p1', cardId: 'EX8-028', stackUid: m2.uid, topId: 'EX8-028', tags: ['진화 시', '어택 시'], text: EX8TXT, resolved: false });
  await drain(st); ok('still rested', stackOf(st, 'p1', m2.uid).suspended); eq('once kept', uses(stackOf(st, 'p1', m2.uid)), 0);
  st = mk(); const m3 = put(st, 'p1', 'EX8-028', { susp: true }); const t3 = put(st, 'p2', LOW, { src: [FILL] }); let offered = null; st._qaAns = { pickStackAnySide: (o) => { offered = o.entries; return null; } };
  st.pending.push({ uid: 'e3', player: 'p1', cardId: 'EX8-028', stackUid: m3.uid, topId: 'EX8-028', tags: ['진화 시', '어택 시'], text: EX8TXT, resolved: false });
  await drain(st); ok('sourced digimon not offered', !offered || !offered.some(e => e.uid === t3.uid));
});

const redT = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'red' && !c.effectKo && !c.isParallel)?.id;
const bicolor = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.colors.length === 2 && !c.isParallel && !c.id.includes('~'))?.id;
const BT8TXT = () => C('BT8-040').effectKo.replace(/^[\s\S]*?【진화 시】\s*/, '');
T(1728, 'BT8-040: discarded card colour is added for the turn (2 colours -> draw 2); a 2-colour discard makes 3; expires at end of turn', async () => {
  ok('fixtures', !!redT && !!bicolor);
  let st = mk(); const m = put(st, 'p1', 'BT8-040'); setHand(st, 'p1', [redT]); const d0 = deckLen(st);
  st.pending.push({ uid: 'b1', player: 'p1', cardId: 'BT8-040', stackUid: m.uid, topId: 'BT8-040', tags: ['진화 시'], text: BT8TXT(), resolved: false });
  await drain(st); const s = stackOf(st, 'p1', m.uid);
  eq('colours', [...S.stackColors(s)].sort(), [...new Set([...C('BT8-040').colors, ...C(redT).colors])].sort()); eq('drew 2', deckLen(st), d0 - 2);
  st = mk(); const m2 = put(st, 'p1', 'BT8-040'); setHand(st, 'p1', [bicolor]);
  st.pending.push({ uid: 'b2', player: 'p1', cardId: 'BT8-040', stackUid: m2.uid, topId: 'BT8-040', tags: ['진화 시'], text: BT8TXT(), resolved: false });
  await drain(st); eq('colour count', S.stackColors(stackOf(st, 'p1', m2.uid)).length, new Set([...C('BT8-040').colors, ...C(bicolor).colors]).size);
  const s2 = stackOf(st, 'p1', m2.uid); st.turnNumber++; S.refreshBaseInfo(st, s2, true); st.turnNumber--; eq('back to printed colours after the turn ends', S.stackColors(s2), C('BT8-040').colors);
  st = mk(); const m3 = put(st, 'p1', 'BT8-040'); setHand(st, 'p1', [redT]); const d1 = deckLen(st); st._qaAns = { pickFromHandIndexes: [] };
  st.pending.push({ uid: 'b3', player: 'p1', cardId: 'BT8-040', stackUid: m3.uid, topId: 'BT8-040', tags: ['진화 시'], text: BT8TXT(), resolved: false });
  await drain(st); eq('no draw', deckLen(st), d1); eq('colours unchanged', S.stackColors(stackOf(st, 'p1', m3.uid)), C('BT8-040').colors);
});

T(3808, 'EX6-063: an own 천사형 digimon entering pays rest and gives memory +1 (generic watcher, not a manual cost)', async () => {
  const ang = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('천사형') && c.level <= 4 && !c.isParallel && !c.id.includes('~'))?.id; ok('fixture', !!ang);
  const st = mk(); const t = put(st, 'p1', 'EX6-063'); st.memory = 0; await playCard(st, 'p1', ang);
  eq('memory +1', st.memory, 1); ok('tamer rested', stackOf(st, 'p1', t.uid).suspended);
  const st2 = mk(); const t2 = put(st2, 'p1', 'EX6-063'); st2.memory = 0; await playCard(st2, 'p1', FILL); eq('non-angel: nothing', st2.memory, 0); ok('tamer active', !stackOf(st2, 'p1', t2.uid).suspended);
});
runAll('qa-unres-b-scripted');
