// open-d (3): the headless CPU driver (src/cpusim.js, also used by test-cpu / lookahead) resolves the 《딜레이》 event bullet of a placed Option:
// it discards the option and runs the bullet when the gate holds, and declines when the bullet's gate fails (no pointless discard).
// Run: node scripts/qa/qa-open-d-cpudelay.mjs < /dev/null
import { S, E, C, mk, put, setHand, secN, stackOf, T, eq, ok, runAll } from './lib-s1.mjs';
import { createSim } from '../../src/cpusim.js';
const red5 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && c.colors.length === 1 && c.colors[0] === 'red' && c.dp && !c.effectKo && !c.inheritedKo)?.id;
const sim = (st) => createSim(st, { cfgOf: () => ({ level: 'hard', banned: new Set() }), onError: (w, e) => { throw e; } });

T('od-delay-1', 'BT17-096 delay bullet: CPU discards the option and evolves into 듀크몬 from hand', async () => {
  ok('fixture', !!red5);
  const st = mk(); const opt = put(st, 'p1', 'BT17-096'); opt.placedTurn = 1; const d = put(st, 'p1', red5); setHand(st, 'p1', ['ST7-09']);
  st.pending.push({ uid: 'dl1', player: 'p1', cardId: 'BT17-096', stackUid: opt.uid, topId: 'BT17-096', tags: ['서로의 턴'], text: '《딜레이》.', resolved: false });
  await sim(st).drain();
  ok('option discarded', !stackOf(st, 'p1', opt.uid) && st.players.p1.trash.includes('BT17-096'));
  ok('bullet ran (evolved)', st.players.p1.battle.some(s => s.cardId === 'ST7-09'));
});
T('od-delay-2', 'BT17-096 delay bullet on the turn it was placed: not usable, option stays', async () => {
  const st = mk(); const opt = put(st, 'p1', 'BT17-096'); opt.placedTurn = st.turnNumber; put(st, 'p1', red5); setHand(st, 'p1', ['ST7-09']);
  st.pending.push({ uid: 'dl1', player: 'p1', cardId: 'BT17-096', stackUid: opt.uid, topId: 'BT17-096', tags: ['서로의 턴'], text: '《딜레이》.', resolved: false });
  await sim(st).drain();
  ok('option kept', !!stackOf(st, 'p1', opt.uid));
});
T('od-delay-3', 'BT24-098 delay bullet with a failing gate (memory < 5 on the opponent side): CPU declines, option stays', async () => {
  const st = mk(); const opt = put(st, 'p1', 'BT24-098'); opt.placedTurn = 1; st.memory = -1;
  st.pending.push({ uid: 'dl1', player: 'p1', cardId: 'BT24-098', stackUid: opt.uid, topId: 'BT24-098', tags: ['자신의 턴'], text: '《딜레이》.', resolved: false });
  await sim(st).drain();
  ok('option kept', !!stackOf(st, 'p1', opt.uid));
});
runAll('qa-open-d-cpudelay');
