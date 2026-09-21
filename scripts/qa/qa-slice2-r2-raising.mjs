// slice2 round 2 (raising-area family): BT15-027/050/062/077 "at your turn end: delete an own digimon to play a 어둠의 4천왕 digimon into the BREEDING area for free".
// Official Q&As (16 ids, same 4 rulings per card): the played digimon's 【등장 시】 does not run in the breeding area; "when a digimon is played" watchers do not
// trigger; moving it to the battle area the same turn does not let it attack; a "cannot play digimon by effect" lock also blocks this play.
import { runScenarios, FILL, S, E, C, fillOf, world } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const DM = 'BT15-031'; // 어둠의 4천왕 Lv6: 【등장 시】 returns a Lv<=5 opposing digimon to hand
const endTurn = async (W) => { W.st.activePlayer = 'p1'; W.st.phase = 'main'; E.endTurn(W.st, false); let g = 0; while (W.st.turnEnding && g++ < 8) { await W.drain(); E.settleTurnEnd(W.st); } await W.drain(); };
const CARDS = [['BT15-027', 2509, 2510, 2511, 2512], ['BT15-050', 2530, 2531, 2532, 2533], ['BT15-062', 2546, 2547, 2548, 2549], ['BT15-077', 2566, 2567, 2568, 2569]];
for (const [card, qEnter, qWatch, qAttack, qBan] of CARDS) {
  const setup = (W) => { W.s = W.put('p1', card); W.pl('p1').hand = [DM]; W.o = W.put('p2', 'ST1-02'); W.picks.confirmEffect = true; W.picks.pickStack = (o) => o.uids?.[0]; };
  T(qEnter, card, 'the digimon put into the breeding area does not use its 【등장 시】', async (W) => { setup(W); await endTurn(W); }, (W) => [['card sits in the breeding area', W.pl('p1').raising?.cardId === DM], ['no 등장 시 bounce of the opposing digimon', W.alive('p2', W.o)], ['its 등장 시 was never queued', !W.resolved.some(x => x.cardId === DM)]]);
  T(qWatch, card, 'no "a digimon was played" event is raised for the breeding-area play', async (W) => { setup(W); W.ev = 0; const orig = S.emitGameEvent; S.EVENT_HOOKS.push((st, kind) => { if (kind === 'play') W.ev++; }); await endTurn(W); S.EVENT_HOOKS.pop(); }, (W) => [['raising filled', W.pl('p1').raising?.cardId === DM], ['no play event', W.ev === 0]]);
  T(qAttack, card, 'moving it into the battle area the same turn: it cannot attack', async (W) => { setup(W); await endTurn(W); W.st.breedingActionTaken = false; const mv = S.moveRaisingToBattle(W.st, 'p1'); const st = W.pl('p1').battle.find(x => x.cardId === DM); W.d = st ? S.declareAttack(W.st, 'p1', st.uid, {}) : { ok: null }; W.mv = mv; }, (W) => [['moved', W.mv === true], ['attack refused (entered this turn)', W.d.ok === false]]);
  T(qBan, card, 'with a 「cannot play digimon by effect」 lock, the breeding-area play is impossible', async (W) => { setup(W); W.put('p2', 'BT9-033'); await endTurn(W); }, (W) => [['breeding area stays empty', !W.pl('p1').raising]]);
}
await runScenarios(L, 'r2-raising');
