// Slice3 Q&A conformance part I: EX5-EX6 options / digimon.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);
const tamerAny = () => findC(c => c.category === 'tamer')[0];

// Q3671: EX5-066 main: with no opp digimon, the "then return from trash" sentence still resolves
await sc('Q3671', 'EX5-066 main: no opp digimon -> still returns a Light Fang digimon from trash', async () => {
  const lf = findC(c => c.category === 'digimon' && (c.types || []).includes('라이트 팽'))[0]; const st = newState();
  put(st, 'p1', [tamerAny()]); put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('red') && c.level === 3)[0]]); st.players.p1.trash = [lf]; st.players.p1.hand = ['EX5-066']; st.memory = 8;
  S.useOptionCard(st, 'p1', 0); await drain(st); return eq('returned', st.players.p1.hand.includes(lf), true);
});
// Q3672/Q3673: EX5-067 main: works with only one of digimon/tamer present; with none present the tamer play still happens
await sc('Q3673', 'EX5-067 main: no opp digimon/tamer -> the free tamer play still resolves', async () => {
  const nc = findC(c => c.category === 'tamer' && (c.types || []).some(t => /나이트 클로|라이트 팽/.test(t)))[0]; const st = newState();
  put(st, 'p1', [findC(c => c.category === 'digimon' && c.colors.includes('blue') && c.level === 3)[0]]); st.players.p1.hand = ['EX5-067', nc]; st.memory = 8; const n0 = st.players.p1.battle.length;
  S.useOptionCard(st, 'p1', 0); await drain(st); return eq('tamer played', st.players.p1.battle.length - n0, 1);
});
// Q3688: EX5-073 on attack: without jogress, the following deletion (opp digimon with sources <= own) still resolves
await sc('Q3688', 'EX5-073 on attack: not jogressed -> still deletes opp digimon with sources <= own', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX5-073', FILL[0], FILL[1], FILL[2]]); put(st, 'p2', [FILL[3], FILL[4]]);
  await trig(st, 'p1', me, 'attack'); return eq('opp deleted', st.players.p2.battle.length, 0);
});
// Q3709/Q3710/Q3711: EX6-015 on play: all OTHER Lv<=4 digimon (own too) go to their OWNERS' hands even when nothing was put under it
await sc('Q3709', 'EX6-015 on play: bounces every other Lv<=4 digimon to each owner hand', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX6-015']); const mine = put(st, 'p1', [FILL[0]]); put(st, 'p2', [FILL[1]]); const big = put(st, 'p2', [findC(c => c.category === 'digimon' && c.level === 5)[0]]);
  await trig(st, 'p1', me, 'play', (k) => (k === 'confirmEffect' ? false : undefined));
  return all(eq('own returned to own hand', st.players.p1.hand.includes(FILL[0]), true), eq('opp Lv3 returned to opp hand', st.players.p2.hand.includes(FILL[1]), true), eq('Lv5 stays', st.players.p2.battle.some(s => s.uid === big.uid), true));
});
// Q3719 / Q3744: EX6-021 / EX6-027: the "by adding a security to hand" cost gates the WHOLE effect; with 0 security nothing happens
await sc('Q3719', 'EX6-021 on play: security 0 -> no DP change on opp digimon', async () => {
  const st = newState(); const o = put(st, 'p2', [FILL[1]]); const me = put(st, 'p1', ['EX6-021']); st.players.p1.security = []; await trig(st, 'p1', me, 'play');
  return eq('no DP change', o.tempDP || 0, 0);
});
await sc('Q3744', 'EX6-027 on play: security 0 -> effect cannot be used', async () => {
  const st = newState(); const o = put(st, 'p2', [FILL[1]]); const me = put(st, 'p1', ['EX6-027']); st.players.p1.security = []; await trig(st, 'p1', me, 'play');
  return eq('no DP change', o.tempDP || 0, 0);
});
// Q3777: EX6-046 on delete: with opp hand <=5 the EFFECT USER (owner) draws
await sc('Q3777', 'EX6-046 on delete: owner draws when opp hand <= 5', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX6-046']); st.players.p2.hand = FILL.slice(0, 3); st.players.p1.hand = [FILL[5]]; const d0 = st.players.p1.deck.length;
  S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st); return all(eq('p1 drew', d0 - st.players.p1.deck.length, 1), eq('p2 deck untouched', st.players.p2.deck.length, 15));
});
finish('slice3-i');
