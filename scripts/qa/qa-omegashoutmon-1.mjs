// BT21-021 オメガシャウトモン: (7) 【소멸 시】 may take the card from hand OR trash (player picks the zone); (8) 【어택 종료 시】 effect-play of an EX6 DigiXros card offers 《디지크로스》 (Q4727)
import { runScenarios, FILL } from './lib2.mjs';
import * as S from '../../src/state.js';
const L = [];
const T = (q, name, run, expect, extra = {}) => L.push({ q, card: 'BT21-021', name, run, expect, ...extra });
const XH = 'BT10-007', TAM = 'P-242';
const del = async (W, s) => { S.deleteStack(W.st, 'p1', s.uid, 'trash', 'effect'); await W.drain(); };
T(7, 'on-deletion: hand and trash both eligible -> zone choice, trash pick works', async (W) => {
  const s = W.put('p1', 'BT21-021'); W.tam = W.put('p1', TAM); W.hand('p1', [XH, FILL[0]]); W.trash('p1', [XH]);
  W.picks.multipleChoice = (o) => (o.options?.[0] === '패' ? 1 : 0); // choose trash
  await del(W, s);
}, (W) => [['zone choice offered', W.prompts.some(p => p.k === 'multipleChoice' && p.o.options?.[1] === '트래시')], ['trash picked', W.prompts.some(p => p.k === 'pickFromZoneIndex' && p.o.zone === 'trash')], ['card from trash under tamer', W.tam.sources.includes(XH)], ['hand card untouched', W.pl('p1').hand.includes(XH)]]);
T(7, 'on-deletion: hand choice works', async (W) => {
  const s = W.put('p1', 'BT21-021'); W.tam = W.put('p1', TAM); W.hand('p1', [XH, FILL[0]]); W.trash('p1', [XH]);
  await del(W, s);
}, (W) => [['card from hand under tamer', W.tam.sources.includes(XH) && !W.pl('p1').hand.includes(XH)], ['trash card untouched', W.pl('p1').trash.includes(XH)]]);
T(7, 'on-deletion: only trash has a match -> trash used', async (W) => {
  const s = W.put('p1', 'BT21-021'); W.tam = W.put('p1', TAM); W.hand('p1', [FILL[0]]); W.trash('p1', [XH]);
  await del(W, s);
}, (W) => [['trash card under tamer', W.tam.sources.includes(XH)]]);
T(7, 'on-deletion: non-matching card is not offered', async (W) => {
  const s = W.put('p1', 'BT21-021'); W.tam = W.put('p1', TAM); W.hand('p1', [FILL[0]]); W.trash('p1', []);
  await del(W, s);
}, (W) => [['nothing placed', !W.tam.sources.includes(FILL[0])]]);
T(4727, 'attack-end effect play of EX6 offers DigiXros', async (W) => {
  W.st.memory = 10; const s = W.put('p1', 'BT21-021'); W.hand('p1', ['BT19-014']);
  W.picks.multipleChoice = (o) => (/디지크로스/.test(o.prompt) ? 0 : undefined);
  await W.fire('p1', s, 'attackEnd');
}, (W) => [['DigiXros offered', W.prompts.some(p => p.k === 'multipleChoice' && /디지크로스/.test(p.o.prompt))], ['EX6 in play with materials', W.pl('p1').battle.some(b => b.cardId === 'BT19-014' && b.sources.length > 0)]], { allowErrors: true });
await runScenarios(L, 'omegashoutmon-1');
