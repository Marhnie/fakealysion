// Slice-4 round 2, batch D: "…라면, A. 그 후, B." — B is still processed when the condition of A is not met (official answers on 8+ cards).
import { S, E, Fx, newBoard, F3, fillerLv, scenario, report, stk, mkChoose, drain, fire, pend, nm } from './lib5.mjs';
const L3 = fillerLv(3), L4 = fillerLv(4), L5 = fillerLv(5), L6 = fillerLv(6), L7 = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === 7).slice(0, 5).map(c => c.id);
const on = async (st, p, id, evt = 'digivolve', opts = {}) => { const ch = mkChoose(st, opts); const ran = await fire(st, p, stk(st, p, id), evt, ch); return { ran, ch }; };
const gone = (st, p, id) => !st.players[p].battle.some(s => s.cardId === id);
await scenario(4706, 'BT12-055: not jogress-evolved -> the "그 후" attack on a digimon still available', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT12-055'] }, p2: { battle: [{ id: L3[0], rested: true }] } }); stk(st, 'p1', 'BT12-055').attackEligibleTurn = 0;
  await on(st, 'p1', 'BT12-055'); chk((st._atk || []).length === 1, 'no attack started: ' + JSON.stringify(st._atk));
});
await scenario(4707, 'BT15-081: opponent has fewer digimon+tamers -> the Lv3/Lv5/Lv7 deletions still happen', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT15-081', L3[1]] }, p2: { battle: [L3[0], L5[0], L7[0]] } });
  await on(st, 'p1', 'BT15-081'); chk(gone(st, 'p2', L3[0]) && gone(st, 'p2', L5[0]) && gone(st, 'p2', L7[0]), 'left: ' + st.players.p2.battle.map(s => nm(s.cardId)));
});
await scenario(4713, 'BT17-102: name is not コロモン -> still deletes an opponent digimon with DP <= own', async (chk) => {
  const weak = L3.find(id => (S.card(id).dp || 0) <= (S.card('BT17-102').dp || 0) && (S.card(id).dp || 0) > 0);
  const st = newBoard({ p1: { battle: ['BT17-102'] }, p2: { battle: [weak] } });
  await on(st, 'p1', 'BT17-102'); chk(gone(st, 'p2', weak), 'weak digimon survived');
});
await scenario(4736, 'EX6-062: not jogress-evolved -> still returns one opponent digimon per Lv.6 source to the deck bottom', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: 'EX6-062', src: [L6[0], L6[1]] }] }, p2: { battle: [L3[0], L3[1], L3[2]] } });
  await on(st, 'p1', 'EX6-062'); chk(st.players.p2.battle.length === 1, 'opp left ' + st.players.p2.battle.length);
});
await scenario(4942, 'BT22-077: no two same-Lv cards stacked -> the "그 후" return of a source-poor opponent digimon still happens', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT22-077'] }, p2: { battle: [L3[0]] } });
  await on(st, 'p1', 'BT22-077'); chk(gone(st, 'p2', L3[0]), 'not returned');
});
await scenario(4717, 'BT20-019: no 제스몬/X항체 source -> the "그 후" attack is still allowed', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT20-019'] }, p2: { battle: [{ id: L3[0], rested: true }] } }); stk(st, 'p1', 'BT20-019').attackEligibleTurn = 0;
  await on(st, 'p1', 'BT20-019'); chk((st._atk || []).length >= 1, 'no attack');
});
await scenario(4764, 'EX9-021: not jogress-evolved -> still deletes all opponent digimon of the highest Lv', async (chk) => {
  const st = newBoard({ p1: { battle: ['EX9-021'] }, p2: { battle: [L3[0], L5[0], L5[1]] } });
  await on(st, 'p1', 'EX9-021'); chk(st.players.p2.battle.length === 1 && st.players.p2.battle[0].cardId === L3[0], 'opp: ' + st.players.p2.battle.map(s => nm(s.cardId)));
});
await scenario(4725, 'BT20-102: no オメガモン/X抗体 source -> still returns an opponent digimon to the deck bottom', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT20-102'] }, p2: { battle: [L3[0]] } });
  await on(st, 'p1', 'BT20-102'); chk(gone(st, 'p2', L3[0]), 'opp digimon still there');
});
await scenario(4712, 'BT17-101: tamer in sources -> memory +1 even when the first sentence conditions are unmet', async (chk) => {
  const tam = Object.values(S.CARDS).find(c => c.category === 'tamer').id;
  const st = newBoard({ p1: { battle: [{ id: 'BT17-101', src: [tam] }], deck: F3.slice(0, 4), security: F3.slice(4, 6) }, p2: { battle: [L3[0]] }, memory: 0 });
  const m0 = st.memory; await on(st, 'p1', 'BT17-101'); chk(st.memory === m0 + 1, 'memory ' + st.memory);
});
await scenario(4708, 'BT16-069: no 연체몬/X항체 source -> the "그 후" rest-lock on a source-less opponent digimon still applies', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT16-069'] }, p2: { battle: [L3[0]] } });
  await on(st, 'p1', 'BT16-069'); const t = stk(st, 'p2', L3[0]); S.restStack(st, 'p2', t.uid, 'effect'); chk(!t.suspended, 'opponent digimon could still be rested');
});
await scenario(4740, 'EX8-072: opponent hand under 5 -> the "그 후" Lv.7-or-lower deletion still happens', async (chk) => {
  const st = newBoard({ p1: { battle: [L3[1]], hand: [] }, p2: { battle: [L5[0]], hand: F3.slice(0, 2) } });
  const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX8-072', sourceStackUid: null, choose: mkChoose(st), trigger: { player: 'p1', cardId: 'EX8-072', tags: ['메인'] }, startAttack() {} };
  const seg = S.parseEffectSegments(S.card('EX8-072').effectKo).segments.find(x => x.tags.includes('메인'));
  await Fx.runScript(Fx.lookupCardSpecific('EX8-072', ['메인'], seg.body) || Fx.compileToScript(seg.body), ctx);
  chk(gone(st, 'p2', L5[0]), 'opponent digimon survived');
});
await scenario(4714, 'BT19-020: 2+ tamers -> the first sentence is skipped but 《세이브》 is still done', async (chk) => {
  const tams = Object.values(S.CARDS).filter(c => c.category === 'tamer').slice(0, 2).map(c => c.id);
  const st = newBoard({ p1: { battle: ['BT19-020', tams[0], tams[1]] } }); const h = stk(st, 'p1', 'BT19-020');
  S.deleteStack(st, 'p1', h.uid, 'trash', 'battle'); await drain(st, mkChoose(st));
  const under = st.players.p1.battle.filter(s => s.cardId === tams[0] || s.cardId === tams[1]).some(s => s.sources.includes('BT19-020'));
  chk(under, 'BT19-020 not placed under a tamer by 세이브');
});
report();
