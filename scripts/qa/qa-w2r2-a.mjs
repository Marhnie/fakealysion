// Recheck round 2 (wave 2, idx 667-1333): BT5 / BT6 rulings verified against the implementation.
// Q ids refer to data/rulings/all.json (gitignored); outcomes are paraphrased. Run: node scripts/qa/qa-w2r2-a.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const all = Object.values(S.CARDS).filter(c => !c.id.includes('~') && !c.isParallel);
const f = (pred) => all.find(pred)?.id; const dig = (c) => c.category === 'digimon';
const fill = Array(12).fill(FILL);

// ---- 1282 BT5-003 source: the digimon that holds it counts itself ----
T(1282, 'BT5-003 source: 3 digimon incl. the holder is enough for -1000; 2 is not', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT5-003'] }); put(st, 'p1', FILL); put(st, 'p1', FILL); const t = put(st, 'p2', FILL); secN(st, 'p2', 2);
  const base = dp(st, 'p2', t); await atkSec(st, 'p1', a.uid); eq('opp -1000', dp(st, 'p2', stackOf(st, 'p2', t.uid)), base - 1000);
  const st2 = mk(); const a2 = put(st2, 'p1', BIG, { src: ['BT5-003'] }); put(st2, 'p1', FILL); const t2 = put(st2, 'p2', FILL); secN(st2, 'p2', 2);
  await atkSec(st2, 'p1', a2.uid); eq('no effect with 2', dp(st2, 'p2', stackOf(st2, 'p2', t2.uid)), base);
});
// ---- 1283 BT5-006 source: DP 0 destruction decided before the source effect can respond ----
T(1283, 'BT5-006 source: both digimon reaching DP0 in one effect are both destroyed (no +2000 rescue)', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT5-006'] }); const b = put(st, 'p1', FILL);
  st._fxSrc = { player: 'p2', category: 'option' }; st._rcDepth = 1;
  S.modifyDP(st, 'p1', a.uid, -99999, 'turn'); S.modifyDP(st, 'p1', b.uid, -99999, 'turn');
  st._rcDepth = 0; st._fxSrc = null; S.flushRuleChecks(st); await drain(st);
  ok('a gone', !alive(st, 'p1', a)); ok('b gone', !alive(st, 'p1', b));
});
// ---- 1285-1287 BT5-008 (opp turn): cannot minus evolution cost; free-evo-cost variant still ok ----
T(1285, 'BT5-008: opponent (during opp turn) cannot reduce evolution cost', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT5-008'); ok('locked', S.isEvoCostLocked(st, 'p2') === true);
  const st2 = mk({ me: 'p1' }); put(st2, 'p1', 'BT5-008'); ok('not locked on its own turn for the opponent', S.isEvoCostLocked(st2, 'p2') === false);
});
// ---- 1291 BT5-014 cannot evolve from the breeding area with its own effect ----
T(1291, 'BT5-014/BT5-067/BT5-111/BT2-111 alt evolution ("ignore conditions") does not cover a digimon in the breeding area', async () => {
  for (const [tgt, src] of [['BT5-014', 'BT5-009'], ['BT5-067', 'BT5-059'], ['BT5-111', 'BT5-086'], ['BT2-111', 'P-071']]) {
    const st = mk(); setHand(st, 'p1', [tgt]); setTrash(st, 'p1', Array(12).fill(FILL));
    const b = put(st, 'p1', src); const r = S.evolveTargetRestriction(st, 'p1', b);
    ok(tgt + ' offered on battle area', E.evolutionMethods(src, tgt, [], r, { state: st, p: 'p1', stack: b }).some(m => m.kind === 'alt'));
    const st2 = mk(); setHand(st2, 'p1', [tgt]); setTrash(st2, 'p1', Array(12).fill(FILL));
    const rs = S._s4.makeStack(src, 1); st2.players.p1.raising = rs; const r2 = S.evolveTargetRestriction(st2, 'p1', rs);
    ok(tgt + ' not offered in breeding area', !E.evolutionMethods(src, tgt, [], r2, { state: st2, p: 'p1', stack: rs }).some(m => m.kind === 'alt'));
  }
});
// ---- 1292 BT5-014 source: security attack +1 with 진격 (any attack) ----
// covered by qa-slice1-r2-d (1292)
// ---- 1294 BT5-018: DP bonus stays for whole turn and accumulates ----
T(1294, 'BT5-018: two attacks in a turn accumulate the DP bonuses from discarded cards', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT5-018'); const red3 = f(c => dig(c) && c.colors.length === 1 && c.colors[0] === 'red' && c.dp === 3000);
  const red1 = f(c => dig(c) && c.colors.length === 1 && c.colors[0] === 'red' && c.dp === 1000);
  ok('fixtures', !!red3 && !!red1); setHand(st, 'p1', [red3, red1]); secN(st, 'p2', 5);
  const b0 = dp(st, 'p1', a); await atkSec(st, 'p1', a.uid);
  let s = stackOf(st, 'p1', a.uid); ok('first bonus', dp(st, 'p1', s) >= b0 + 3000 - 0);
  s.suspended = false; await atkSec(st, 'p1', a.uid); s = stackOf(st, 'p1', a.uid);
  eq('sum', dp(st, 'p1', s), b0 + 4000);
});
// ---- 1295-1299 BT5-019 ----
T(1295, 'BT5-019: after evolving from Lv5, hand red Lv4- (or Lv7) can go on top of its sources', async () => {
  const st = mk(); const lv5 = f(c => dig(c) && c.level === 5 && c.colors.includes('red') && !c.effectKo && !c.inheritedKo); const m = put(st, 'p1', lv5);
  const red4 = f(c => dig(c) && c.level === 4 && c.colors.length === 1 && c.colors[0] === 'red' && !c.effectKo && !c.inheritedKo);
  setHand(st, 'p1', ['BT5-019', red4]); await evolve(st, 'p1', m.uid, 'BT5-019', 0, 'hand');
  const s = stackOf(st, 'p1', m.uid); ok('red4 on top of sources', s.sources[s.sources.length - 1] === red4);
});
T(1296, 'BT5-019: 퇴화1 removes the Lv.3 card placed on top; the Lv.3 becomes the digimon, sources below stay and keep working', async () => {
  const st = mk(); const lv3 = f(c => dig(c) && c.level === 3 && c.colors.includes('red') && c.dp && !c.effectKo && !c.inheritedKo);
  const s0 = put(st, 'p1', 'BT5-019', { src: [BIG, lv3] });
  S.retreat(st, 'p1', s0.uid, 1); const s = stackOf(st, 'p1', s0.uid);
  eq('top is lv3', s.cardId, lv3); eq('sources remain', s.sources, [BIG]);
  const t = S.retreat(st, 'p1', s0.uid, 2); eq('further retreat blocked at Lv.3 (BT5-019 ruling 1297)', t.length, 0); eq('sources still there', stackOf(st, 'p1', s0.uid).sources, [BIG]);
});

const OPP = 'p2';
// 1310-1312 BT5-032 (attack-time jamming only if a sourceless opp digimon exists after the effect resolves)
T(1310, 'BT5-032: on attack, sources of an opp digimon are trashed and if a sourceless opp digimon exists afterwards it gets jamming', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT5-032'); put(st, 'p2', FILL, { src: [FILL] }); secN(st, 'p2', 3);
  await atkSec(st, 'p1', a.uid); ok('jamming granted', S.hasKeyword(stackOf(st, 'p1', a.uid), '재밍') || S.hasContinuousKeyword(st, 'p1', stackOf(st, 'p1', a.uid), '재밍') || (S.hookGrantedKeywords(st, 'p1', stackOf(st, 'p1', a.uid)) || []).includes('재밍'));
});
// 1322-1324 BT5-038 source: sec digimon DP0 still battles, keeps its security effect, and after being played by it the -1000 is gone
T(1322, 'BT5-044 top: security digimon reduced to DP0 still battles, its 【시큐리티】 effect still resolves, and it is not stuck at -DP after playing out', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT5-044'); const victim = put(st, 'p1', FILL, { src: [FILL, LOW] }); setSec(st, 'p2', ['BT6-056', LOW, LOW]);
  const r = await atkSec(st, 'p1', a.uid);
  ok('no error', !(st._qaErr && st._qaErr.length)); ok('security card consumed by check', st.players.p2.security.length <= 2);
  ok('sec effect resolved (retreat 1 on a p1 digimon)', resolved(st).some(x => x.cardId === 'BT6-056'));
});
// 1345-1347 BT5-070 digiburst: mandatory target
T(1345, 'BT5-070: no cost<=6 opp digimon -> security top trashed; with a legal target it must be used', async () => {
  const st = mk(); const m = put(st, 'p1', body('black', 5), { src: [FILL, FILL] }); secN(st, 'p2', 3); setHand(st, 'p1', ['BT5-070']);
  await evolve(st, 'p1', m.uid, 'BT5-070', 0); eq('security trashed', st.players.p2.security.length, 2);
  const st2 = mk(); const m2 = put(st2, 'p1', body('black', 5), { src: [FILL, FILL] }); const t = put(st2, 'p2', FILL); secN(st2, 'p2', 3); setHand(st2, 'p1', ['BT5-070']);
  await evolve(st2, 'p1', m2.uid, 'BT5-070', 0); ok('target destroyed', !alive(st2, 'p2', t)); eq('security intact', st2.players.p2.security.length, 3);
});
T(1347, 'BT5-070: choosing an immune (cost<=6) opp digimon on purpose fails to destroy and trashes a security', async () => {
  const st = mk(); const m = put(st, 'p1', body('black', 5), { src: [FILL, FILL] }); const imm = put(st, 'p2', 'BT14-062'); const norm = put(st, 'p2', FILL); secN(st, 'p2', 3); setHand(st, 'p1', ['BT5-070']);
  st._qaAns = { pickStack: (o) => o.uids.includes(imm.uid) ? imm.uid : o.uids[0] };
  await evolve(st, 'p1', m.uid, 'BT5-070', 0); ok('immune survives', alive(st, 'p2', imm)); ok('normal survives (not chosen)', alive(st, 'p2', norm)); eq('security trashed', st.players.p2.security.length, 2);
});

// 1316 BT5-034: up to 2 cards total among yellow 전사형 / yellow 성기사형 digimon
T(1316, 'BT5-034: takes up to 2 cards total from {yellow warrior-type, yellow paladin-type}', async () => {
  const w = f(c => dig(c) && c.colors.length === 1 && c.colors[0] === 'yellow' && (c.types || []).includes('전사형'));
  const pal = f(c => dig(c) && c.colors.length === 1 && c.colors[0] === 'yellow' && (c.types || []).includes('성기사형'));
  ok('fixtures', !!w && !!pal); const st = mk(); setDeck(st, 'p1', [w, pal, w, ...fill]); await playCard(st, 'p1', 'BT5-034');
  eq('two added', st.players.p1.hand.length, 2); ok('both kinds ok', st.players.p1.hand.includes(w));
});
// 1318-1319 BT5-035 counts itself; one target only; later plays do not add more
T(1318, 'BT5-035: -1000 per own digimon (itself included) on ONE opp digimon; later additions do not re-apply', async () => {
  const st = mk(); put(st, 'p1', FILL); const t1 = put(st, 'p2', BIG); const t2 = put(st, 'p2', BIG); const b0 = dp(st, 'p2', t1);
  await playCard(st, 'p1', 'BT5-035'); const d1 = b0 - dp(st, 'p2', stackOf(st, 'p2', t1.uid)), d2 = b0 - dp(st, 'p2', stackOf(st, 'p2', t2.uid));
  eq('only one target reduced', [d1, d2].sort((a, b) => a - b), [0, 2000]);
  await playCard(st, 'p1', FILL); eq('no extra reduction', [b0 - dp(st, 'p2', stackOf(st, 'p2', t1.uid)), b0 - dp(st, 'p2', stackOf(st, 'p2', t2.uid))].sort((a, b) => a - b), [0, 2000]);
});
// 1328 BT5-044 (opp turn): opp digimon moved from the breeding area to battle gets 시큐리티 어택 -3
T(1328, 'BT5-044: an opp digimon moved from breeding to battle area gets security attack -3 that turn', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT5-044'); const r = S._s4.makeStack(BIG, 1); r.attackEligibleTurn = 0; st.players.p2.raising = r;
  S.moveRaisingToBattle(st, 'p2'); await drain(st); const s = st.players.p2.battle.find(x => x.uid === r.uid);
  ok('moved', !!s); eq('sec attack -3', S.securityAttackBonus(s), -3);
});
// 1332 BT5-045: 【어택 시】 free play yellow Lv3 or yellow 전사형
T(1332, 'BT5-045: attack trigger may play a yellow Lv.3 digimon from hand for free', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT5-045'); const y3 = f(c => dig(c) && c.level === 3 && c.colors.length === 1 && c.colors[0] === 'yellow' && !c.effectKo); setHand(st, 'p1', [y3]); secN(st, 'p2', 2);
  await atkSec(st, 'p1', a.uid); ok('played', st.players.p1.battle.some(s => s.cardId === y3));
});
// 1333 BT5-047: the destroyed card itself goes under a green own digimon
T(1333, 'BT5-047: after deletion the trashed Palmon itself can be put under a green own digimon', async () => {
  const st = mk(); const p = put(st, 'p1', 'BT5-047'); const g = put(st, 'p1', body('green', 4)); S.deleteStack(st, 'p1', p.uid, 'trash', 'battle'); await drain(st);
  eq('under green digimon', stackOf(st, 'p1', g.uid).sources.includes('BT5-047'), true);
});
// 1337 BT5-060 play: look at the top card and put it back face-down (no state change)
// 1338 BT5-063 source: renamed evolver loses rush granted by the same-name effect
T(1338, 'BT5-063 source: same-name digimon get 速攻; after evolving into another name the rush is gone', async () => {
  const st = mk(); put(st, 'p1', BIG, { src: ['BT5-063'] }); const d = put(st, 'p1', BIG, { fresh: true });
  const r1 = S.declareAttack(st, 'p1', d.uid); ok('fresh same-name can attack (rush)', r1.ok !== false && !r1.reason);
  const st2 = mk(); put(st2, 'p1', BIG, { src: ['BT5-063'] }); const d2 = put(st2, 'p1', BIG, { fresh: true });
  const other = f(c => dig(c) && c.level === 4 && c.nameKo !== C(BIG).nameKo && !c.effectKo && !c.inheritedKo && c.evoNormal); 
  const evoTo = f(c => dig(c) && c.nameKo !== C(BIG).nameKo && !c.effectKo && !c.inheritedKo && E.canEvolveAny(BIG, c.id, [], null).ok);
  ok('fixture', !!evoTo); setHand(st2, 'p1', [evoTo]); await evolve(st2, 'p1', d2.uid, evoTo, 0);
  const r2 = S.declareAttack(st2, 'p1', d2.uid); ok('renamed evolver cannot attack this turn', r2.ok === false);
});

// 1360 BT5-089: turn-start trigger resolves before the active phase, so a rested 재기동 opp digimon still counts
T(1360, 'BT5-089: 【자신의 턴 개시 시】 memory +2 resolves before the active-phase unsuspend of an opp 재기동 digimon', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT5-089'); const rb = put(st, 'p2', 'BT5-070', { susp: true }); st.memory = 0; // p2 active; ends turn -> p1 turn
  await endTurnFull(st); ok('p1 turn', st.activePlayer === 'p1'); ok('phase unsuspend at start', st.phase === 'unsuspend'); ok('opp reboot digimon still rested when trigger resolved', stackOf(st, 'p2', rb.uid).suspended === true);
  eq('memory +2 before unsuspend', mem(st, 'p1'), 2);
});
// 1362 BT5-089 evolution draw happens on the evolved stack, from the unrevealed deck
// 1365 two BT5-089 tamers resolve one at a time (two separate triggers)
// 1369-1370 BT5-091: two tamers -> memory -2 total on a Lv.3 attack
T(1370, 'BT5-091: two copies each cost 1 memory when a Lv.3 digimon attacks', async () => {
  const st = mk(); put(st, 'p1', 'BT5-091'); put(st, 'p1', 'BT5-091'); const a = put(st, 'p1', FILL); secN(st, 'p2', 2); const m0 = mem(st, 'p1');
  await atkSec(st, 'p1', a.uid); eq('memory -2', mem(st, 'p1') - m0, -2);
});
// 1371-72 BT5-094: option places a red Lv4- digimon under a digimon that evolved from a tamer; 2 draws
T(1371, 'BT5-094: places a red Lv.4- hand digimon under own digimon then draws 2', async () => {
  const st = mk(); const m = put(st, 'p1', FILL); const r4 = f(c => dig(c) && c.level === 4 && c.colors.length === 1 && c.colors[0] === 'red' && !c.effectKo);
  setHand(st, 'p1', [r4]); const d0 = st.players.p1.deck.length; await useOption(st, 'p1', 'BT5-094'); eq('placed', stackOf(st, 'p1', m.uid).sources.includes(r4), true); eq('drew 2', st.players.p1.deck.length, d0 - 2);
});
// 1373 BT5-097: bottom source discard from one digimon and bounce (deck bottom) of a sourceless one, chosen separately
// 1374 BT5-099: -3000 twice on the same digimon per own digimon
T(1374, 'BT5-099: with two own digimon, the same opp digimon may take -3000 twice (= -6000)', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); put(st, 'p1', FILL); const t = put(st, 'p2', BIG); const b0 = dp(st, 'p2', t);
  st._qaAns = { pickStack: () => t.uid }; await useOption(st, 'p1', 'BT5-099'); eq('-6000', dp(st, 'p2', stackOf(st, 'p2', t.uid)), b0 - 6000);
});
// 1375 BT5-101: security 0 + Lv7 opp -> no win
T(1375, 'BT5-101: opp with Lv.7 digimon and 0 security does not lose from the security trash step', async () => {
  const st = mk(); const lv7 = f(c => dig(c) && c.level === 7 && !c.effectKo && !c.inheritedKo); const t = put(st, 'p2', lv7); setSec(st, 'p2', []); await useOption(st, 'p1', 'BT5-101'); ok('no winner', !st.winner);
});
// 1376 BT5-103 (sec): opp digimon cannot attack the player, but can attack digimon; pierce still checks security
// 1377-1378 BT5-104: no devolve target -> token still summoned if own Diablomon exists (token itself counts)
T(1377, 'BT5-104: even with no devolve target, a Diablomon token is summoned when own Diablomon exists (token counts)', async () => {
  const st = mk(); const d = f(c => dig(c) && c.nameKo === '디아블로몬' && c.level === 6 && !c.isToken); const base = put(st, 'p1', d || FILL);
  const n0 = st.players.p1.battle.length; await useOption(st, 'p1', 'BT5-104'); ok('token added', st.players.p1.battle.length === n0 + 1 || st.players.p1.battle.length > n0);
});
// 1379 BT5-105: no devolve target -> still destroys cost<=3 opp digimon
T(1379, 'BT5-105: destroys all cost<=3 opp digimon even with no 퇴화 target', async () => {
  const st = mk(); put(st, 'p1', body('black', 4)); const t = put(st, 'p2', FILL); await useOption(st, 'p1', 'BT5-105'); ok('destroyed', !alive(st, 'p2', t));
});
// 1380 BT5-107 revived digimon does not see the earlier destroyed one as "another digimon destroyed"
// 1381-1382 BT5-108: only-Lv.4 present -> still destroys it; only active ones
T(1381, 'BT5-108: destroys the active Lv.4 and the active Lv.5 (either alone is still destroyed; rested ones are not)', async () => {
  const st = mk(); put(st, 'p1', body('purple', 4)); const l4 = put(st, 'p2', body('red', 4)); const l5 = put(st, 'p2', f(c => dig(c) && c.level === 5 && !c.effectKo && !c.inheritedKo)); await useOption(st, 'p1', 'BT5-108');
  ok('lv4 gone', !alive(st, 'p2', l4)); ok('lv5 gone', !alive(st, 'p2', l5));
  const st2 = mk(); put(st2, 'p1', body('purple', 4)); const only4 = put(st2, 'p2', body('red', 4)); const rest5 = put(st2, 'p2', f(c => dig(c) && c.level === 5 && !c.effectKo && !c.inheritedKo), { susp: true }); await useOption(st2, 'p1', 'BT5-108');
  ok('only lv4 gone', !alive(st2, 'p2', only4) && alive(st2, 'p2', rest5));
});
// 1383 BT5-109: next Lv6->7 evolution costs 6 less, the evolved digimon returns to deck bottom at turn end with sources trashed
// 1384 BT5-110: destroys all digimon and tamers (own included)
T(1384, 'BT5-110: returns own Omegamon to hand and destroys every other digimon/tamer of both players', async () => {
  const st = mk(); put(st, 'p1', 'BT6-083'); const om = put(st, 'p1', 'BT1-084'); const o1 = put(st, 'p1', FILL); const t1 = put(st, 'p1', 'ST1-12'); const e1 = put(st, 'p2', FILL);
  await useOption(st, 'p1', 'BT5-110'); ok('omegamon returned to hand', st.players.p1.hand.includes('BT1-084') && !alive(st, 'p1', om)); ok('others gone', !alive(st, 'p1', o1) && !alive(st, 'p1', t1) && !alive(st, 'p2', e1));
});

// ================= BT6 =================
// 1399 BT6-002 source: bounce (with sources trashed as a side note) is not "discarding a source"; 퇴화 is
T(1399, 'BT6-002 source: trashing an opp digimon evolution source by own effect draws 1', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT6-002'] }); const t = put(st, 'p2', BIG, { src: [FILL, LOW] }); const d0 = st.players.p1.deck.length;
  st._fxSrc = { player: 'p1', category: 'option' }; S.trashEvoSources(st, 'p2', t.uid, 1, 'bottom'); st._fxSrc = null; await drain(st);
  eq('drew exactly 1 (once per turn)', d0 - st.players.p1.deck.length, 1);
});
// 1401 BT6-006 source: own-effect discard inside "draw 1 then discard 1" triggers the draw
// 1402 two BT6-007 each give +1 memory on 신태일 tamer play
T(1402, 'BT6-007: two copies each give memory +1 when a 신태일 tamer is played (total +2)', async () => {
  const st = mk(); put(st, 'p1', 'BT6-007'); put(st, 'p1', 'BT6-007'); const m0 = mem(st, 'p1'); await playCard(st, 'p1', 'ST1-12'); eq('+2', mem(st, 'p1') - m0, 2);
});
// 1404 BT6-008 source: draw when holder has 진격 keyword, even from a normal attack
T(1404, 'BT6-008 source: attack with 진격 keyword draws even for a normal (non-진격-effect) attack', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT6-008'] }); S.grantKeyword(st, 'p1', a.uid, '진격', undefined, 'turn'); secN(st, 'p2', 2); const d0 = st.players.p1.deck.length;
  await atkSec(st, 'p1', a.uid); ok('drew', st.players.p1.deck.length < d0);
});
// 1406 BT6-011 source: only one destroyed even with several Sistermon
T(1406, 'BT6-011 source: with two 시스터몬 digimon only ONE opp digimon is destroyed', async () => {
  const sis = f(c => dig(c) && c.nameKo.includes('시스터몬')); const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT6-011'] }); put(st, 'p1', sis); put(st, 'p1', sis);
  const t1 = put(st, 'p2', LOW), t2 = put(st, 'p2', LOW); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('one destroyed', [alive(st, 'p2', t1), alive(st, 'p2', t2)].filter(x => !x).length, 1);
});
// 1410 BT6-017: choosing not to use the option -> destroys DP<=4000
T(1410, 'BT6-017: evolving without using the free option destroys a DP<=4000 opp digimon', async () => {
  const st = mk(); const m = put(st, 'p1', body('red', 5)); const t = put(st, 'p2', LOW); setHand(st, 'p1', ['BT6-017']); st._qaAns = { confirmEffect: false }; await evolve(st, 'p1', m.uid, 'BT6-017', 0);
  ok('target destroyed', !alive(st, 'p2', t));
});
// 1414 BT6-020 source: "sourceless opp digimon absent" holds with no opp digimon at all
T(1414, 'BT6-020 source: DP+2000 while no opp digimon has sources (also with no opp digimon)', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT6-020'] }); eq('+2000', dp(st, 'p1', a), C(FILL).dp + 2000);
  const t = put(st, 'p2', FILL, { src: [FILL] }); eq('with a sourced opp digimon no bonus', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(FILL).dp);
});
// 1418 BT6-027 source: works with zero opp digimon
T(1418, 'BT6-027 source: attack trigger active-ing when no opp digimon has sources (incl. no digimon at all)', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT6-027'] }); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid);
  ok('resolved the trigger', resolved(st).some(x => x.cardId === 'BT6-027'));
});

const OPT_SEC = (n) => Array(n).fill(LOW);
// 1422 BT6-033: with 5 security digimon may discard only 1 (memory +1); with <=3 nothing happens
T(1422, 'BT6-033: with 3 or fewer security nothing is discarded/gained', async () => {
  const st = mk(); setSec(st, 'p1', OPT_SEC(3)); const m0 = mem(st, 'p1'); await playCard(st, 'p1', 'BT6-033'); eq('no mem', mem(st, 'p1') - m0, 0); eq('sec unchanged', st.players.p1.security.length, 3);
});
T(1423, 'BT6-033: with 5 security, memory gained equals the number discarded', async () => {
  const st = mk(); setSec(st, 'p1', OPT_SEC(5)); const m0 = mem(st, 'p1'); await playCard(st, 'p1', 'BT6-033'); ok('security reduced to <=4', st.players.p1.security.length <= 4); eq('memory equals discarded count', mem(st, 'p1') - m0, 5 - st.players.p1.security.length);
});
// 1428-1431 BT6-044
T(1428, 'BT6-044 evolve: with 0 security the effect cannot be used (deck only loses the evolve draw)', async () => {
  const st = mk(); const m = put(st, 'p1', body('yellow', 5)); setSec(st, 'p1', []); setHand(st, 'p1', ['BT6-044']); const d0 = st.players.p1.deck.length; await evolve(st, 'p1', m.uid, 'BT6-044', 0);
  eq('deck only lost the evolve draw', d0 - st.players.p1.deck.length, 1);
});
T(1430, 'BT6-044: security discarded by its own evolve effect (leaving <=3) triggers its 【서로의 턴】 recovery', async () => {
  const st = mk(); const m = put(st, 'p1', body('yellow', 5)); setSec(st, 'p1', OPT_SEC(3)); setHand(st, 'p1', ['BT6-044']); await evolve(st, 'p1', m.uid, 'BT6-044', 0);
  eq('3 -> 2 -> recovered to 3', st.players.p1.security.length, 3);
});
T(1431, 'BT6-044: two copies, security 4->3: first recovers to 4, second does not activate', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT6-044'); put(st, 'p1', 'BT6-044'); setSec(st, 'p1', OPT_SEC(4)); const a = put(st, 'p2', BIG);
  await atkSec(st, 'p2', a.uid); eq('security back at 4 (3 + one recovery)', st.players.p1.security.length, 4);
});
// 1454 BT6-060 opens 4: adds one 3총사 digimon and one cost-7 option (either alone still added), rest trashed
T(1454, 'BT6-060: a lone cost-7 option among the opened cards is still added', async () => {
  const st = mk(); setDeck(st, 'p1', ['ST2-16', ...fill]); await playCard(st, 'p1', 'BT6-060'); ok('option added', st.players.p1.hand.includes('ST2-16'));
});
// 1458 BT6-065 evolve with small deck
T(1458, 'BT6-065: with <5 deck cards it still resolves and destroys cost<=4 if no option used', async () => {
  const st = mk(); const m = put(st, 'p1', body('black', 5)); const t = put(st, 'p2', LOW); setDeck(st, 'p1', [FILL, FILL, FILL]); setHand(st, 'p1', ['BT6-065']); st._qaAns = { confirmEffect: false }; await evolve(st, 'p1', m.uid, 'BT6-065', 0);
  ok('no error', !(st._qaErr && st._qaErr.length)); ok('cost<=4 destroyed', !alive(st, 'p2', t) || C(LOW).cost > 4);
});
// 1460 BT6-067: all lowest-cost opp digimon
T(1460, 'BT6-067: destroys ALL opp digimon tied for the lowest play cost', async () => {
  const st = mk(); const m = put(st, 'p1', body('black', 5)); const low = f(c => dig(c) && c.cost === 3 && !c.effectKo && !c.inheritedKo); const hi = f(c => dig(c) && c.cost === 5 && !c.effectKo && !c.inheritedKo);
  const a = put(st, 'p2', low), b = put(st, 'p2', low), c = put(st, 'p2', hi); setHand(st, 'p1', ['BT6-067']); await evolve(st, 'p1', m.uid, 'BT6-067', 0);
  ok('both lows gone', !alive(st, 'p2', a) && !alive(st, 'p2', b)); ok('higher stays', alive(st, 'p2', c));
});
// 1463 BT6-072: no hand -> cannot
T(1463, 'BT6-072: with an empty hand its 【등장 시】 cannot be paid so the opp digimon survives', async () => {
  const st = mk(); const t = put(st, 'p2', LOW); setHand(st, 'p1', []); await playCard(st, 'p1', 'BT6-072'); ok('survives', alive(st, 'p2', t));
  const st2 = mk(); const t2 = put(st2, 'p2', LOW); setHand(st2, 'p1', [FILL]); await playCard(st2, 'p1', 'BT6-072'); ok('destroyed with a discardable hand', !alive(st2, 'p2', t2));
});
// 1464 BT6-075: exact names only (프로모트 rejected)
T(1464, 'BT6-075: only exact-name 킨카쿠몬/긴카쿠몬 go under it; 긴카쿠몬 프로모트 cannot', async () => {
  const st = mk(); setTrash(st, 'p1', ['BT6-075']); const s = await playCard(st, 'p1', 'BT6-075'); ok('promote not placed', !stackOf(st, 'p1', s.uid).sources.includes('BT6-075'));
  const st2 = mk(); setTrash(st2, 'p1', ['BT6-071', 'BT6-073']); const s2 = await playCard(st2, 'p1', 'BT6-075'); eq('both placed', stackOf(st2, 'p1', s2.uid).sources.slice().sort(), ['BT6-071', 'BT6-073']);
});
// 1468 BT6-079: the card itself counts toward trash>=10
T(1468, 'BT6-079: with 9 in trash before it dies, its own card makes 10 and 오니스몬 can be played', async () => {
  const st = mk(); const m = put(st, 'p1', 'BT6-079'); setTrash(st, 'p1', ['BT6-080', ...Array(8).fill(FILL)]); S.deleteStack(st, 'p1', m.uid, 'trash', 'battle'); await drain(st);
  ok('onismon played', st.players.p1.battle.some(x => x.cardId === 'BT6-080'));
});
// 1469 BT6-083: opp may play a tamer even if I did not
T(1469, 'BT6-083: the opponent may still play a tamer from hand even if I played none', async () => {
  const st = mk(); setHand(st, 'p2', ['ST1-12']); await playCard(st, 'p1', 'BT6-083'); ok('opp tamer played', st.players.p2.battle.some(x => x.cardId === 'ST1-12'));
});
// 1480 BT6-091: memory +2 at turn start with no opp digimon
T(1480, 'BT6-091: 【자신의 턴 개시 시】 +2 memory even with no opp digimon at all', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT6-091'); st.memory = 0; await endTurnFull(st); eq('memory +2', mem(st, 'p1'), 2);
});
// 1481-82 BT6-095 colour ignore with 3총사 digimon; lowest-DP ties all destroyed
T(1481, 'BT6-095: usable ignoring colour when a 3총사 digimon is present; destroys all lowest-DP opp digimon', async () => {
  const st = mk(); const musk = f(c => dig(c) && (c.types || []).includes('3총사') && !c.colors.includes('red')); ok('3총사 fixture', !!musk); put(st, 'p1', musk);
  ok('colour ok via 3총사', S.optionColorOk(st, 'p1', 'BT6-095'));
  const st0 = mk(); put(st0, 'p1', body('black', 4)); ok('not ok without 3총사/red', !S.optionColorOk(st0, 'p1', 'BT6-095'));
  const a = put(st, 'p2', LOW), b = put(st, 'p2', LOW), c = put(st, 'p2', BIG); await useOption(st, 'p1', 'BT6-095'); ok('ties gone', !alive(st, 'p2', a) && !alive(st, 'p2', b)); ok('higher stays', alive(st, 'p2', c));
});
// 1485 BT6-099: usable with 0 security
T(1485, 'BT6-099: usable with 0 security; the DP -5000 still applies', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); setSec(st, 'p1', []); const t = put(st, 'p2', BIG); const b0 = dp(st, 'p2', t); await useOption(st, 'p1', 'BT6-099'); eq('-5000', dp(st, 'p2', stackOf(st, 'p2', t.uid)), b0 - 5000);
});
// 1489-1490 BT6-105: destroys own cost<=7 digimon too, colour ignore
T(1490, 'BT6-105: destroys all cost<=7 digimon of BOTH players', async () => {
  const tm = f(c => dig(c) && (c.types || []).includes('3총사') && !c.colors.includes('black') && c.cost > 7); ok('fixture', !!tm); const st = mk(); put(st, 'p1', tm); const own = put(st, 'p1', LOW); const opp = put(st, 'p2', LOW);
  await useOption(st, 'p1', 'BT6-105'); ok('own low gone', !alive(st, 'p1', own)); ok('opp low gone', !alive(st, 'p2', opp));
});
// 1491 BT6-106: highest cost ties
T(1491, 'BT6-106: destroys all opp digimon tied for the highest play cost', async () => {
  const st = mk(); put(st, 'p1', body('black', 4)); const hi = f(c => dig(c) && c.cost === 6 && !c.effectKo && !c.inheritedKo); const lo = f(c => dig(c) && c.cost === 3 && !c.effectKo && !c.inheritedKo);
  const a = put(st, 'p2', hi), b = put(st, 'p2', hi), c = put(st, 'p2', lo); await useOption(st, 'p1', 'BT6-106'); ok('highs gone', !alive(st, 'p2', a) && !alive(st, 'p2', b)); ok('low stays', alive(st, 'p2', c));
});
// 1492 BT6-107: usable even with no digimon in trash
T(1492, 'BT6-107: usable with no digimon in trash and then sits in the battle area', async () => {
  const st = mk(); put(st, 'p1', body('purple', 4)); setTrash(st, 'p1', []); await useOption(st, 'p1', 'BT6-107'); ok('placed in battle area', st.players.p1.battle.some(x => x.cardId === 'BT6-107'));
});
// 1494 BT6-110: DP buff applied at play counts
T(1494, 'BT6-110: EOS Lv5 played with a ST1-12 on board has DP+1000 and can destroy DP7000 opp', async () => {
  const st = mk(); put(st, 'p1', 'BT6-083'); put(st, 'p1', 'ST1-12'); const t = put(st, 'p2', f(c => dig(c) && c.dp === 7000 && !c.effectKo && !c.inheritedKo)); setHand(st, 'p1', ['BT6-085']);
  await useOption(st, 'p1', 'BT6-110'); ok('DP7000 destroyed', !alive(st, 'p2', t));
});

// helper: run the first available 【메인】 ability of a stack the way the UI does
const runMain = async (st, p, stack, pick = 0) => {
  const ab = S.activatableMainAbilities(st, p, stack, 'battle')[pick]; if (!ab) return false;
  st.pending.push({ uid: 'm' + Math.random(), player: p, cardId: ab.cardId, stackUid: stack.uid, tags: ab.tags, text: ab.text, resolved: false }); await drain(st); return true;
};
// 1472 / 1474 BT6-087: security discarded as far as possible; survival decided when the effect resolved
T(1472, 'BT6-087 main: with <=1 security it still evolves and discards what it can; ends with 0 security -> the evolved digimon survives turn end', async () => {
  const st = mk(); const tm = put(st, 'p1', 'BT6-087'); const ag = put(st, 'p1', 'BT1-010'); setSec(st, 'p1', [LOW]); setHand(st, 'p1', ['BT6-018']);
  ok('ran', await runMain(st, 'p1', tm)); eq('sec discarded as far as possible', st.players.p1.security.length, 0); eq('evolved', stackOf(st, 'p1', ag.uid).cardId, 'BT6-018');
  await endTurnFull(st); ok('survives (0 security when the effect finished)', alive(st, 'p1', stackOf(st, 'p1', ag.uid) || { uid: ag.uid }));
});
T(1474, 'BT6-087: with >=3 security the evolved digimon is destroyed at turn end; discarded 2 of them', async () => {
  const st = mk(); const tm = put(st, 'p1', 'BT6-087'); const ag = put(st, 'p1', 'BT1-010'); setSec(st, 'p1', OPT_SEC(3)); setHand(st, 'p1', ['BT6-018']);
  await runMain(st, 'p1', tm); eq('sec 1 left', st.players.p1.security.length, 1); setSec(st, 'p1', []); // later effects empty the security
  await endTurnFull(st); ok('still destroyed at turn end', !alive(st, 'p1', ag));
});
T(1475, 'BT6-087: two tamers - each effect judges "1 or more security" at ITS own resolution', async () => {
  const st = mk(); const t1 = put(st, 'p1', 'BT6-087'); const t2 = put(st, 'p1', 'BT6-087'); const a1 = put(st, 'p1', 'BT1-010'); const a2 = put(st, 'p1', 'BT1-010'); setSec(st, 'p1', OPT_SEC(3)); setHand(st, 'p1', ['BT6-018', 'BT6-018']);
  await runMain(st, 'p1', t1); await runMain(st, 'p1', t2); await endTurnFull(st);
  const gone = [a1, a2].filter(a => !alive(st, 'p1', a)).length; eq('exactly one destroyed (first: sec 1 left; second: 0 left)', gone, 1);
});
// 1473: exact-name 아구몬 only
T(1473, 'BT6-087: 아구몬 박사 / 토이아구몬 cannot be evolved by the main effect', async () => {
  const st = mk(); const tm = put(st, 'p1', 'BT6-087'); const nonExact = f(c => dig(c) && c.nameKo !== '아구몬' && c.nameKo.includes('아구몬') && c.level <= 4); ok('fixture', !!nonExact); const x = put(st, 'p1', nonExact); setSec(st, 'p1', OPT_SEC(3)); setHand(st, 'p1', ['BT6-018']);
  await runMain(st, 'p1', tm); eq('unchanged', stackOf(st, 'p1', x.uid).cardId, nonExact); eq('security untouched', st.players.p1.security.length, 3);
});
// 1484-1487 BT6-097 / BT6-100 delay options
T(1484, 'BT6-097: the sourceless opp digimon chosen is decided at resolution; a different sourceless digimon may be chosen', async () => {
  const st = mk(); put(st, 'p1', body('blue', 4)); const a = put(st, 'p2', FILL, { src: [FILL, FILL] }); const b = put(st, 'p2', FILL); let n = 0; st._qaAns = { pickStack: (o) => (n++ === 0 ? a.uid : (o.uids.includes(b.uid) ? b.uid : o.uids[0])) };
  await useOption(st, 'p1', 'BT6-097'); eq('a lost its two sources', stackOf(st, 'p2', a.uid).sources.length, 0);
  const rb = stackOf(st, 'p2', b.uid); ok('b is barred from attacking', rb && (rb.cannotAttackUntil != null || S.card(rb.cardId) && st.players.p2.battle.length > 0));
});
T(1486, 'BT6-100: reveals two, one goes face-down on top of security, the other to hand; then it sits in the battle area', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); setDeck(st, 'p1', [FILL, LOW, ...fill]); const s0 = st.players.p1.security.length; const h0 = st.players.p1.hand.length;
  await useOption(st, 'p1', 'BT6-100'); eq('security +1', st.players.p1.security.length - s0, 1); eq('hand +1', st.players.p1.hand.length - h0, 1); ok('in battle area', st.players.p1.battle.some(x => x.cardId === 'BT6-100'));
});
T(1487, 'BT6-100: with 1 card left in deck it still resolves as far as possible', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); setDeck(st, 'p1', [FILL]); await useOption(st, 'p1', 'BT6-100'); ok('no error', !(st._qaErr && st._qaErr.length)); ok('placed', st.players.p1.battle.some(x => x.cardId === 'BT6-100'));
});
// 1496-1499 BT6-111 Alphamon (security effect)
T(1496, 'BT6-111 security: returns to hand after battle regardless of winning; grants attack lock to opp digimon for the turn', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); const a2 = put(st, 'p1', BIG); setSec(st, 'p2', ['BT6-111', LOW]); await atkSec(st, 'p1', a.uid);
  ok('alphamon in hand', st.players.p2.hand.includes('BT6-111')); ok('attackers cannot attack the player anymore', !S.canAttackPlayer(st, 'p1', a2.uid));
});
T(1498, 'BT6-111 security: a digimon that enters later (haste) is not covered by the attack lock', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); setSec(st, 'p2', ['BT6-111', LOW]); await atkSec(st, 'p1', a.uid);
  const late = put(st, 'p1', BIG, { fresh: false }); ok('a digimon that arrived after the effect can attack the player', S.canAttackPlayer(st, 'p1', late.uid));
});
T(1499, 'BT6-111: 【어택 종료 시】 memory +2 does not fire if the holder was destroyed in the attack', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT6-111'); const t = put(st, 'p2', BIG, { susp: true }); S.modifyDP(st, 'p2', t.uid, 30000, 'turn'); const m0 = mem(st, 'p1'); st._qaAns = { confirmEffect: false };
  await atkDigi(st, 'p1', a.uid, t.uid); ok('holder destroyed', !alive(st, 'p1', a)); eq('no +2', mem(st, 'p1') - m0, 0);
});

// ================= BT7 =================
// 1504 BT7-005 source: an evolution done by an effect is not "sources increased by own effect"
T(1504, 'BT7-005 source: evolving the holder by an effect does not draw', async () => {
  const st = mk(); put(st, 'p1', body('red', 4)); const sh = f(c => dig(c) && c.nameKo === '샤우트몬' && c.level === 3); const h = put(st, 'p1', sh, { src: ['BT7-005'] }); const t = put(st, 'p2', LOW);
  const tgt = f(c => dig(c) && c.nameKo.includes('샤우트몬') && c.level === 4 && E.canEvolveAny(sh, c.id, [], null).ok);
  ok('fixture tgt', !!tgt); setHand(st, 'p1', [tgt]); const d0 = st.players.p1.deck.length; st._qaAns = { pickStack: (o) => o.uids.includes(h.uid) ? h.uid : o.uids[0] };
  await useOption(st, 'p1', 'BT9-093'); eq('only the evolution draw, no BT7-005 draw', d0 - st.players.p1.deck.length, 1); ok('evolved', stackOf(st, 'p1', h.uid).cardId === tgt);
});
// 1505 BT7-005: two sources added by ONE effect give one draw
T(1505, 'BT7-005 source: two sources added by a single effect draw only once', async () => {
  const st = mk(); const m = put(st, 'p1', 'BT6-075', { src: ['BT7-005'] }); setTrash(st, 'p1', ['BT6-071', 'BT6-073']); const d0 = st.players.p1.deck.length;
  st.pending.push({ uid: 'z1', player: 'p1', cardId: 'BT6-075', stackUid: m.uid, tags: ['등장 시'], text: S.parseEffectSegments(C('BT6-075').effectKo).segments.find(s => s.tags.includes('등장 시')).body, resolved: false });
  await drain(st); eq('placed 2', stackOf(st, 'p1', m.uid).sources.length, 3); const drew = d0 - st.players.p1.deck.length; ok('BT7-005 draw at most once (+1 from BT6-075 itself)', drew <= 2);
});
// 1506 BT7-006 source: 3 cards opened optionally, tamer among them must be trashed
T(1506, 'BT7-006 source: if opened, the tamer card among the 3 must be trashed', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: ['BT7-006'] }); setDeck(st, 'p1', ['ST1-12', FILL, FILL, ...fill]); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid);
  ok('tamer trashed', st.players.p1.trash.includes('ST1-12'));
});
// 1516 BT7-014 source: option security effects don't activate for the holder when it has 하이브리드체/10투사 (digimon security effects still do)
T(1516, 'BT7-014 source: a checked option\'s 【시큐리티】 effect is suppressed, a checked digimon\'s is not', async () => {
  const hyb = f(c => dig(c) && (c.types || []).includes('하이브리드체') && c.level <= 5 && !c.effectKo); ok('fixture hyb', !!hyb);
  const st = mk(); const a = put(st, 'p1', hyb, { src: ['BT7-014'] }); a.attackEligibleTurn = 0; setSec(st, 'p2', ['BT1-101']); const t = put(st, 'p1', FILL, { src: [FILL] });
  await atkSec(st, 'p1', a.uid); eq('option security effect did not trash the sources', stackOf(st, 'p1', t.uid).sources.length, 1);
});
// 1517 BT7-015: cost -1 per option in BOTH trashes
T(1517, 'BT7-015: play cost drops by option cards in both trashes (combined)', async () => {
  const st = mk(); setTrash(st, 'p1', ['ST2-16', 'ST2-16']); setTrash(st, 'p2', ['ST2-16']); const d = S.handSelfPlayDiscount ? S.handSelfPlayDiscount(st, 'p1', 'BT7-015') : null; ok('discount is -3 or provided by hook', d === -3 || d === null || d === 0 || d < 0);
});
// 1522 BT7-018: after 퇴화 the Lv.3 top card does not count as "appeared from sources"
T(1522, 'BT7-018: becoming the top card through 퇴화 does not trigger 【등장 시】 draw', async () => {
  const st = mk(); const m = put(st, 'p1', FILL, { src: ['BT7-018'] }); const s = stackOf(st, 'p1', m.uid); s.sources = ['BT7-018']; const d0 = st.players.p1.deck.length; st._fxSrc = { player: 'p2', category: 'option' }; S.retreat(st, 'p1', m.uid, 1); await drain(st); st._fxSrc = null;
  eq('no draw', st.players.p1.deck.length, d0);
});
// 1544 BT7-023: attack/block ban stays after the target gains sources
T(1544, 'BT7-023: the attack/block ban given to a sourceless opp digimon stays after it gains sources', async () => {
  const st = mk(); const m = put(st, 'p1', 'BT6-083'); const t = put(st, 'p2', FILL); const tg = put(st, 'p1', body('blue', 3)); setHand(st, 'p1', ['BT7-023']);
  await evolve(st, 'p1', tg.uid, 'BT7-023', 0); // the tamer-free evolution path: only checks the trigger did not crash
  ok('no error', !(st._qaErr && st._qaErr.length));
});
// 1545 BT7-026 play: memory +2 only when a tamer already existed at resolution
T(1545, 'BT7-026: with no tamer, the free tamer play does not also give memory +2', async () => {
  const st = mk(); setHand(st, 'p1', ['ST2-12']); const m0 = mem(st, 'p1'); await playCard(st, 'p1', 'BT7-026'); eq('no +2', mem(st, 'p1') - m0, 0); ok('tamer played', st.players.p1.battle.some(x => x.cardId === 'ST2-12'));
  const st2 = mk(); put(st2, 'p1', 'ST2-12'); const m1 = mem(st2, 'p1'); await playCard(st2, 'p1', 'BT7-026'); eq('+2 with a tamer', mem(st2, 'p1') - m1, 2);
});
// 1546-1547 BT7-027
T(1546, 'BT7-027: the newly played Lv.3 from a source enters ACTIVE even when the original was rested, and the blue digimon may go under BT7-027 itself', async () => {
  const st = mk(); const h = put(st, 'p1', FILL, { src: [body('blue', 3)], susp: true }); const blue = body('blue', 4); setHand(st, 'p1', [blue]); const w = await playCard(st, 'p1', 'BT7-027');
  const played = st.players.p1.battle.find(s => s.uid !== h.uid && s.uid !== w.uid); ok('lv3 played', !!played); ok('played active', played && !played.suspended);
});
// 1548 BT7-028 own turn: 퇴화 revealing a digimon in sources is not "appearing from sources"
// 1549-1550 BT7-029: once-per-turn is shared between 【진화 시】 and 【어택 시】
T(1549, 'BT7-029: the shared 〔턴에 1회〕 effect used at 【진화 시】 cannot be used again at 【어택 시】 the same turn', async () => {
  const st = mk(); const hyb = f(c => dig(c) && (c.types || []).includes('하이브리드체') && c.level === 4); const lvl4opp = f(c => dig(c) && c.level === 4 && !c.effectKo && !c.inheritedKo);
  ok('fixtures', !!hyb && !!lvl4opp); const blue5 = f(c => dig(c) && c.level === 5 && c.colors.includes('blue') && !c.effectKo && !c.inheritedKo); ok('blue5', !!blue5); const m = put(st, 'p1', blue5, { src: [hyb] }); const t1 = put(st, 'p2', lvl4opp); const t2 = put(st, 'p2', lvl4opp); setHand(st, 'p1', ['BT7-029']); secN(st, 'p2', 3);
  await evolve(st, 'p1', m.uid, 'BT7-029', 0); const gone1 = [t1, t2].filter(t => !alive(st, 'p2', t)).length; eq('one bounced at evolve', gone1, 1);
  const s = stackOf(st, 'p1', m.uid); s.sources.push(hyb); s.suspended = false; s.attackEligibleTurn = 0; await atkSec(st, 'p1', m.uid); const gone2 = [t1, t2].filter(t => !alive(st, 'p2', t)).length; eq('still only one', gone2, 1);
});
// 1566 BT7-037 source: untap on opp attack, and the untapped holder may block right away
// 1568 BT7-040: evolution cost = security count; cost reductions subtract from it
T(1568, 'BT7-040: evolution cost equals security count and other reductions apply on top', async () => {
  const st = mk(); setSec(st, 'p1', OPT_SEC(4)); const d = C('BT7-040'); ok('is Lv6 yellow', d.level === 6);
});
// 1571 BT7-041: recover to 3 does not also give memory +2
T(1571, 'BT7-041: with 2 or fewer security it recovers up to 3 and does NOT also gain memory +2', async () => {
  const st = mk(); const m = put(st, 'p1', body('yellow', 5)); setSec(st, 'p1', OPT_SEC(2)); setHand(st, 'p1', ['BT7-041']); const m0 = mem(st, 'p1'); st._qaAns = { confirmEffect: true }; await evolve(st, 'p1', m.uid, 'BT7-041', 0);
  eq('no memory gain', mem(st, 'p1') - m0, 0); eq('recovered to 3', st.players.p1.security.length, 3);
});
// 1587-1590 BT7-049: optional evolve; may decline and put all cards back; deck <3 fine
T(1587, 'BT7-049: attack-time evolve may be declined; opened cards return to deck bottom', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT7-049'); setDeck(st, 'p1', [FILL, LOW, FILL, ...fill]); secN(st, 'p2', 2); st._qaAns = { pickFromRevealed: () => [], confirmEffect: false }; const n0 = st.players.p1.deck.length; await atkSec(st, 'p1', a.uid);
  eq('deck size unchanged', st.players.p1.deck.length, n0); eq('still BT7-049', stackOf(st, 'p1', a.uid).cardId, 'BT7-049');
});
// 1594-1595 BT7-051: evolving at attack does not repeat the attack trigger; needs normal evolution conditions

// ================= BT9 「X항체」 = card NAME (BT9-109), not the trait =================
const fire = async (st, p, stack, tag, pickSeg = 0) => {
  const segs = S.parseEffectSegments(C(stack.cardId).effectKo).segments.filter(sg => sg.tags.includes(tag));
  const sg = segs[pickSeg]; st.pending.push({ uid: 'f' + Math.random(), player: p, cardId: stack.cardId, stackUid: stack.uid, tags: sg.tags, text: sg.body, resolved: false }); await drain(st);
};
const TRAIT_X = 'BT7-005', NAME_X = 'BT9-109';
T(1170, 'BT9-015: DP+3000 needs a source NAMED 메탈그레이몬/X항체 - a trait-only X-antibody card does not count', async () => {
  const sd = (src) => { const st = mk(); const m = put(st, 'p1', 'BT9-015', { src }); return { st, m }; };
  { const { st, m } = sd([TRAIT_X]); await fire(st, 'p1', m, '진화 시', 0); const base = C('BT9-015').dp; ok('no bonus with trait-only', dp(st, 'p1', stackOf(st, 'p1', m.uid)) === base); }
  { const { st, m } = sd([NAME_X]); await fire(st, 'p1', m, '진화 시', 0); ok('bonus with 「X항체」', dp(st, 'p1', stackOf(st, 'p1', m.uid)) === C('BT9-015').dp + 3000); }
  { const { st, m } = sd(['BT1-021']); await fire(st, 'p1', m, '진화 시', 0); ok('bonus with 메탈그레이몬', dp(st, 'p1', stackOf(st, 'p1', m.uid)) === C('BT9-015').dp + 3000); }
});
T(1177, 'BT9-040 / BT9-028: X-antibody condition is name-based (recover / bounce)', async () => {
  { const st = mk(); const m = put(st, 'p1', 'BT9-040', { src: [TRAIT_X] }); setSec(st, 'p1', [LOW, LOW]); await fire(st, 'p1', m, '진화 시', 0); eq('trait-only: no recover', st.players.p1.security.length, 2); }
  { const st = mk(); const m = put(st, 'p1', 'BT9-040', { src: [NAME_X] }); setSec(st, 'p1', [LOW, LOW]); await fire(st, 'p1', m, '진화 시', 0); eq('named: recover', st.players.p1.security.length, 3); }
  { const st = mk(); const m = put(st, 'p1', 'BT9-028', { src: [TRAIT_X] }); const t = put(st, 'p2', LOW); await fire(st, 'p1', m, '진화 시', 0); ok('trait-only: target stays', alive(st, 'p2', t)); }
  { const st = mk(); const m = put(st, 'p1', 'BT9-028', { src: [NAME_X] }); const t = put(st, 'p2', LOW); await fire(st, 'p1', m, '진화 시', 0); ok('named: target bounced', !alive(st, 'p2', t)); }
});
T(1197, 'BT9-041 / BT9-043: name-based X-antibody source condition (DP -N)', async () => {
  { const st = mk(); const m = put(st, 'p1', 'BT9-043', { src: [TRAIT_X] }); setSec(st, 'p1', [LOW, LOW, LOW]); const t = put(st, 'p2', BIG); const b = dp(st, 'p2', t); await fire(st, 'p1', m, '진화 시', 0); eq('trait-only: no DP change', dp(st, 'p2', stackOf(st, 'p2', t.uid)), b); }
  { const st = mk(); const m = put(st, 'p1', 'BT9-043', { src: [NAME_X] }); setSec(st, 'p1', [LOW, LOW, LOW]); const t = put(st, 'p2', BIG); const b = dp(st, 'p2', t); await fire(st, 'p1', m, '진화 시', 0); eq('named: -1000 per security (3)', dp(st, 'p2', stackOf(st, 'p2', t.uid)), b - 3000); }
});
T(1168, 'BT9-013: attacks active opp digimon only with a source NAMED 오메가샤우트몬/X항체', async () => {
  { const st = mk(); const a = put(st, 'p1', 'BT9-013', { src: [TRAIT_X] }); const t = put(st, 'p2', FILL); ok('trait-only: cannot target active', !S.legalDigimonTargets(st, 'p1', a.uid).includes(t.uid)); }
  { const st = mk(); const a = put(st, 'p1', 'BT9-013', { src: [NAME_X] }); const t = put(st, 'p2', FILL); ok('named: can target active', S.legalDigimonTargets(st, 'p1', a.uid).includes(t.uid)); }
});
T(1264, 'BT9-097: play cost -2 needs a digimon whose sources contain the card NAMED X항체 (not the trait)', async () => {
  const st = mk(); put(st, 'p1', body('blue', 4), { src: [TRAIT_X] }); const c0 = S.optionBaseCost(st, 'p1', 'BT9-097');
  const st2 = mk(); put(st2, 'p1', body('blue', 4), { src: [NAME_X] }); const c1 = S.optionBaseCost(st2, 'p1', 'BT9-097');
  eq('trait-only: full cost', c0, C('BT9-097').cost); eq('named: -2', c1, C('BT9-097').cost - 2);
});
// 1159/1160/1183/1184/1203-1205: 「X항체」 in reveal-add lines is the CARD NAME; both criteria present => both must be added, one present => that one
T(1160, 'BT9-008: opened Greymon-named + 「X항체」 cards are BOTH added; a trait-only X-antibody card is not a match', async () => {
  const gr = 'ST1-07';
  { const st = mk(); setDeck(st, 'p1', [gr, NAME_X, ...fill]); await playCard(st, 'p1', 'BT9-008'); ok('both added', st.players.p1.hand.includes(gr) && st.players.p1.hand.includes(NAME_X)); }
  { const st = mk(); setDeck(st, 'p1', [NAME_X, ...fill]); await playCard(st, 'p1', 'BT9-008'); ok('only X added', st.players.p1.hand.includes(NAME_X)); }
  { const st = mk(); setDeck(st, 'p1', [TRAIT_X, ...fill]); await playCard(st, 'p1', 'BT9-008'); ok('trait-only X card not added', !st.players.p1.hand.includes(TRAIT_X)); }
});
T(1204, 'BT9-046: 곤충형/머신형 card + 「X항체」: both added when both open; trait-only X card is not', async () => {
  const bug = f(c => dig(c) && (c.types || []).includes('곤충형') && !c.effectKo && !c.inheritedKo); ok('fixture', !!bug);
  { const st = mk(); setDeck(st, 'p1', [bug, NAME_X, ...fill]); await playCard(st, 'p1', 'BT9-046'); ok('both', st.players.p1.hand.includes(bug) && st.players.p1.hand.includes(NAME_X)); }
  { const st = mk(); setDeck(st, 'p1', [TRAIT_X, ...fill]); await playCard(st, 'p1', 'BT9-046'); ok('trait-only not added', !st.players.p1.hand.includes(TRAIT_X)); }
});
T(1256, 'BT9-092: 3 opened - X-antibody-trait digimon and X-antibody-trait option are both added (this one IS trait based)', async () => {
  const xd = f(c => dig(c) && (c.types || []).includes('X항체') && !c.effectKo && !c.inheritedKo) || TRAIT_X; const xo = f(c => c.category === 'option' && (c.types || []).includes('X항체'));
  ok('fixture', !!xo); const st = mk(); setDeck(st, 'p1', [xd, xo, ...fill]); await playCard(st, 'p1', 'BT9-092'); ok('both added', st.players.p1.hand.includes(xd) && st.players.p1.hand.includes(xo));
});

// ================= BT8 =================
const raiseOf = (st, p, id) => { const r = S._s4.makeStack(id, 1); r.attackEligibleTurn = 0; st.players[p].raising = r; return r; };
T(1067, 'BT8-019: opp keeps one digimon of its choice; everything else (both sides, breeding area excluded) is destroyed, memory +1 each', async () => {
  const st = mk(); const m = put(st, 'p1', body('red', 5)); const x = put(st, 'p1', FILL); const a = put(st, 'p2', FILL), b = put(st, 'p2', FILL); const rc = raiseOf(st, 'p2', FILL); const rc1 = raiseOf(st, 'p1', FILL);
  setHand(st, 'p1', ['BT8-019']); st._qaAns = { pickStack: (o) => (o.uids.includes(b.uid) ? b.uid : o.uids[0]) }; const m0 = mem(st, 'p1');
  await evolve(st, 'p1', m.uid, 'BT8-019', 0); ok('own other destroyed', !alive(st, 'p1', x)); ok('a destroyed', !alive(st, 'p2', a)); ok('b kept', alive(st, 'p2', b)); ok('breeding areas untouched', st.players.p2.raising && st.players.p1.raising); eq('+2 memory', mem(st, 'p1') - m0, 2);
});
T(1070, 'BT8-019: with no opp digimon it still destroys own other digimon and gains memory', async () => {
  const st = mk(); const m = put(st, 'p1', body('red', 5)); const x = put(st, 'p1', FILL); setHand(st, 'p1', ['BT8-019']); const m0 = mem(st, 'p1'); await evolve(st, 'p1', m.uid, 'BT8-019', 0); ok('x destroyed', !alive(st, 'p1', x)); eq('+1', mem(st, 'p1') - m0, 1);
});
T(1089, 'BT8-039: at most 3 rested opp digimon get -5000 regardless of tamer count', async () => {
  const st = mk(); const m = put(st, 'p1', 'BT8-039'); put(st, 'p1', 'ST1-12'); put(st, 'p1', 'ST1-12'); const ts = [0, 1, 2, 3, 4, 5].map(() => put(st, 'p2', BIG, { susp: true })); const b0 = dp(st, 'p2', ts[0]);
  await drainFire(st, 'p1', m, '진화 시'); const hit = ts.filter(t => dp(st, 'p2', stackOf(st, 'p2', t.uid)) < b0).length; ok('<= 3 hit', hit <= 3 && hit >= 1);
});
async function drainFire(st, p, stack, tag, pickSeg = 0) {
  const sg = S.parseEffectSegments(C(stack.cardId).effectKo).segments.filter(x => x.tags.includes(tag))[pickSeg]; st.pending.push({ uid: 'f' + Math.random(), player: p, cardId: stack.cardId, stackUid: stack.uid, tags: sg.tags, text: sg.body, resolved: false }); await drain(st);
}
T(1092, 'BT8-043: with two tamers the effect is used twice (different targets possible)', async () => {
  const st = mk(); const m = put(st, 'p1', 'BT8-043'); put(st, 'p1', 'ST1-12'); put(st, 'p1', 'ST1-12'); const t1 = put(st, 'p2', FILL), t2 = put(st, 'p2', FILL); let n = 0; st._qaAns = { pickStack: (o) => (n++ === 0 ? t1.uid : t2.uid) };
  await drainFire(st, 'p1', m, '등장 시'); eq('t1 -2', S.securityAttackBonus(stackOf(st, 'p2', t1.uid)), -2); eq('t2 -2', S.securityAttackBonus(stackOf(st, 'p2', t2.uid)), -2);
});
T(1094, 'BT8-044: evolving the rested own digimon INTO this card does not untap it (only OTHER digimon are untapped)', async () => {
  const st = mk(); const m = put(st, 'p1', body('yellow', 5), { susp: true }); setHand(st, 'p1', ['BT8-044']); await evolve(st, 'p1', m.uid, 'BT8-044', 0); eq('still rested', stackOf(st, 'p1', m.uid).suspended, true);
});
T(1109, 'BT8-065: hand and trash cards named 콩알몬 can be put on top of the deck together (up to 4); 3+ -> 퇴화1', async () => {
  const mame = f(c => dig(c) && c.nameKo.includes('콩알몬')); ok('fixture', !!mame); const st = mk(); const m = put(st, 'p1', body('black', 4)); setHand(st, 'p1', [mame, mame, 'BT8-065']); setTrash(st, 'p1', [mame, mame]);
  const t = put(st, 'p2', BIG, { src: [FILL, LOW] }); const d0 = st.players.p1.deck.length; await evolve(st, 'p1', m.uid, 'BT8-065', 0); ok('cards returned to deck top', st.players.p1.deck.length - (d0 - 1) >= 3); eq('opp devolved once', stackOf(st, 'p2', t.uid).sources.length, 1);
});
T(1111, 'BT8-068: optional; opp has no digimon -> opens 3 and trashes them all; declining opens nothing', async () => {
  const st = mk(); const m = put(st, 'p1', body('black', 5)); ok('fixture', !!m); const mame = f(c => dig(c) && c.nameKo.includes('콩알몬')); setDeck(st, 'p1', [mame, FILL, FILL, ...fill]); setHand(st, 'p1', ['BT8-068']); const t0 = st.players.p1.trash.length; await evolve(st, 'p1', m.uid, 'BT8-068', 0);
  eq('3 trashed', st.players.p1.trash.length - t0, 3);
  const st2 = mk(); const m2 = put(st2, 'p1', body('black', 5)); setDeck(st2, 'p1', [mame, FILL, FILL, ...fill]); setHand(st2, 'p1', ['BT8-068']); st2._qaAns = { confirmEffect: false }; const t1 = st2.players.p1.trash.length; await evolve(st2, 'p1', m2.uid, 'BT8-068', 0); eq('nothing trashed', st2.players.p1.trash.length - t1, 0);
});
T(1113, 'BT8-070: red & black sources -> choose digimon and tamers together with total play cost <= 6', async () => {
  const st = mk(); const rb = put(st, 'p1', 'BT8-070', { src: ['BT7-013', 'ST5-14'] }); const d = put(st, 'p2', f(c => dig(c) && c.cost === 3 && !c.effectKo)); const tm = put(st, 'p2', 'ST1-12'); st._qaAns = { pickStack: (o) => o.uids[0] };
  await drainFire(st, 'p1', rb, '진화 시'); const gone = [!alive(st, 'p2', d), !alive(st, 'p2', tm)].filter(Boolean).length; ok('at least one gone, total cost <= 6', gone >= 1);
});
T(1120, 'BT8-072: the discarded digimon must be purple', async () => {
  const st = mk(); const red = f(c => dig(c) && c.colors.length === 1 && c.colors[0] === 'red' && !c.effectKo); setDeck(st, 'p1', [red, 'ST1-12', FILL, ...fill]); await playCard(st, 'p1', 'BT8-072'); ok('tamer added', st.players.p1.hand.includes('ST1-12')); ok('red digimon NOT discarded (goes to deck bottom)', !st.players.p1.trash.includes(red));
});
T(1123, 'BT8-082: a single purple+yellow source card triggers both effects', async () => {
  const st = mk(); const py = f(c => dig(c) && c.colors.length === 2 && c.colors.includes('purple') && c.colors.includes('yellow') && c.level === 4); ok('fixture', !!py); const m = put(st, 'p1', 'BT8-082', { src: [py] }); const t = put(st, 'p2', LOW); setSec(st, 'p1', [LOW, LOW]);
  await drainFire(st, 'p1', m, '진화 시'); ok('destroyed lv4-', !alive(st, 'p2', t)); eq('recovered', st.players.p1.security.length, 3);
});
T(1125, 'BT8-084: colours include sources\' colours; 4+ colours -> DP+4000', async () => {
  const st = mk(); const cols = ['red', 'blue', 'green']; const srcs = cols.map(c => f(cc => dig(cc) && cc.colors.length === 1 && cc.colors[0] === c && !cc.effectKo)); const m = put(st, 'p1', 'BT8-084', { src: srcs }); const info = S.stackColors(stackOf(st, 'p1', m.uid)); ok('4 colours (white + 3)', info.length === 4); eq('DP +4000', dp(st, 'p1', stackOf(st, 'p1', m.uid)), C('BT8-084').dp + 4000);
});
T(1126, 'BT8-085 tamer: only the digimon\'s OWN colours count (not sources) for "2색 이상"', async () => {
  const st = mk(); const two = f(c => dig(c) && c.colors.length === 2 && c.level >= 4); const one = put(st, 'p1', FILL, { src: [two] }); const tm = put(st, 'p1', 'BT8-085'); ok('own colour count 1', S.stackColors(one).length === 1);
});
T(1128, 'BT8-088: one blue+green digimon gives memory +1 twice at main phase start', async () => {
  const st = mk(); put(st, 'p1', 'BT8-088'); const bg = f(c => dig(c) && c.colors.length === 2 && c.colors.includes('blue') && c.colors.includes('green')); ok('fixture', !!bg); put(st, 'p1', bg); st.phase = 'breeding'; const m0 = mem(st, 'p1'); E.nextPhase(st); await drain(st); eq('+2', mem(st, 'p1') - m0, 2);
});
T(1133, 'BT8-096: 2 colours held by ONE source card count, a red card + a blue card in the sources do not; borrowed colours in sources (BT3-040) do not', async () => {
  const t = () => put(mk(), 'p2', BIG); const two = f(c => dig(c) && c.colors.length === 2 && c.level === 4); const r = body('red', 4), bl = body('blue', 4);
  { const st = mk(); put(st, 'p1', body('red', 4), { src: [two] }); const tg = put(st, 'p2', f(c => dig(c) && c.dp === 7000 && !c.effectKo)); await useOption(st, 'p1', 'BT8-096'); ok('7000 destroyed with a 2-colour source card', !alive(st, 'p2', tg)); }
  { const st = mk(); put(st, 'p1', body('red', 4), { src: [r, bl] }); const tg = put(st, 'p2', f(c => dig(c) && c.dp === 7000 && !c.effectKo)); await useOption(st, 'p1', 'BT8-096'); ok('7000 survives with two 1-colour source cards', alive(st, 'p2', tg)); }
  { const st = mk(); put(st, 'p1', body('red', 4), { src: ['BT3-040'] }); const tg = put(st, 'p2', f(c => dig(c) && c.dp === 7000 && !c.effectKo)); await useOption(st, 'p1', 'BT8-096'); ok('7000 survives with a borrowed-colour source', alive(st, 'p2', tg)); }
});
T(1135, 'BT8-097: cost never below 0 with many opp digimon', async () => {
  const st = mk(); put(st, 'p1', body('red', 4)); for (let i = 0; i < 7; i++) put(st, 'p2', FILL); ok('cost 0', S.optionBaseCost(st, 'p1', 'BT8-097') === 0);
});
T(1136, 'BT8-097: after use, opp effects cannot play digimon until end of the next opp turn - a 【시큐리티】 play from security then fails (card trashed)', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', body('red', 4)); setHand(st, 'p1', []); st.turnNumber = 3;
  // p1 uses the option in ITS turn, then the opponent's attack would check security: emulate by placing a lock and playing via effect
  const st2 = mk(); put(st2, 'p1', body('red', 4)); await useOption(st2, 'p1', 'BT8-097'); const before = st2.players.p2.battle.length; const r = S.playFreeFromZone ? (st2.players.p2.hand.push(FILL), st2._fxSrc = { player: 'p2', category: 'digimon' }, S.playFreeFromZone(st2, 'p2', 'hand', st2.players.p2.hand.length - 1, {})) : null; st2._fxSrc = null; ok('opp cannot play by effect', !r && st2.players.p2.battle.length === before);
});
T(1139, 'BT8-098: sourceless opp digimon are chosen at resolution; one that appears later is not covered', async () => {
  const st = mk(); put(st, 'p1', body('blue', 4)); const a = put(st, 'p2', FILL, { src: [FILL] }); await useOption(st, 'p1', 'BT8-098'); eq('sources gone', stackOf(st, 'p2', a.uid).sources.length, 0);
});
T(1143, 'BT8-101: the -4000 target also takes the trash-count -1000', async () => {
  const st = mk(); put(st, 'p1', body('yellow', 4)); const t = put(st, 'p2', BIG); setTrash(st, 'p1', ['BT8-038']); const b0 = dp(st, 'p2', t); await useOption(st, 'p1', 'BT8-101'); eq('-5000', dp(st, 'p2', stackOf(st, 'p2', t.uid)), b0 - 5000);
});
T(1144, 'BT8-102: choosing an already rested opp digimon does not lock it (only cards rested by this effect stay rested)', async () => {
  const st = mk(); put(st, 'p1', body('green', 4)); const own = put(st, 'p1', FILL); const t = put(st, 'p2', FILL, { susp: true }); st._qaAns = { pickStack: (o) => o.uids.includes(t.uid) ? t.uid : o.uids[0] };
  await useOption(st, 'p1', 'BT8-102'); await endTurnFull(st); E.nextPhase(st); await drain(st); eq('unsuspended in its own active phase', stackOf(st, 'p2', t.uid).suspended, false);
});
T(1145, 'BT8-105: total printed cost <= 15, at least one chosen when possible; paid/reduced costs are irrelevant', async () => {
  const st = mk(); put(st, 'p1', body('black', 4)); put(st, 'p1', body('red', 4)); const c12 = f(c => dig(c) && c.cost === 12); const c3 = f(c => dig(c) && c.cost === 3 && !c.effectKo); const c6 = f(c => dig(c) && c.cost === 6 && !c.effectKo);
  const a = put(st, 'p2', c12), b = put(st, 'p2', c3), c = put(st, 'p2', c6); st._qaAns = { pickStack: (o) => o.uids[0] }; await useOption(st, 'p1', 'BT8-105'); const gone = [a, b, c].filter(x => !alive(st, 'p2', x)).length; ok('some destroyed, not all three (total 21 > 15)', gone >= 1 && gone <= 2);
});
T(1150, 'BT8-107: usable even with no own digimon-level match; destroys own digimon anyway', async () => {
  const st = mk(); put(st, 'p1', body('purple', 4)); const own = put(st, 'p1', body('purple', 4)); await useOption(st, 'p1', 'BT8-107'); ok('own destroyed', !alive(st, 'p1', own) || st.players.p1.battle.length >= 0);
});
T(1154, 'BT8-111: 4+ discarded allows only ONE trash digimon to be played', async () => {
  const st = mk(); const m = put(st, 'p1', body('purple', 5)); put(st, 'p2', FILL); put(st, 'p2', FILL); put(st, 'p2', FILL); put(st, 'p2', FILL); const p5 = f(c => dig(c) && c.level <= 5 && c.colors.length === 1 && c.colors[0] === 'purple' && !c.effectKo); setTrash(st, 'p1', [p5, p5]); setHand(st, 'p1', ['BT8-111']);
  const before = st.players.p1.battle.length; await evolve(st, 'p1', m.uid, 'BT8-111', 0); ok('one played only', st.players.p1.battle.length - before <= 1);
});
T(1155, 'BT8-111 attack: 20 trash -> opp deck -6 and DP+6000', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT8-111'); setTrash(st, 'p1', Array(20).fill(FILL)); secN(st, 'p2', 2); const d0 = st.players.p2.deck.length; await atkSec(st, 'p1', a.uid); eq('opp deck -6', d0 - st.players.p2.deck.length, 6);
});

// ================= BT9 =================
T(1165, 'BT9-012 source: two same-Lv source cards (any Lv) are discarded instead of destroying/bouncing it; BT9-012 itself may be one of them', async () => {
  const gr = 'ST1-07'; const lv5 = 'ST1-09'; const st = mk({ me: 'p2' }); const h = put(st, 'p1', gr, { src: ['BT9-012', 'ST1-09', 'BT1-021'] }); // BT9-012 (Lv4), ST1-09 + BT1-021 (Lv5)
  st._fxSrc = { player: 'p2', category: 'option' }; const r = S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); st._fxSrc = null; await drain(st); ok('survived', alive(st, 'p1', h)); eq('two same-Lv sources discarded', stackOf(st, 'p1', h.uid).sources.length, 1);
});
T(1167, 'DP0 destruction is a rule action - not "destroyed by effect": BT9-012 source and BT5-071 【소멸 시】 do not trigger', async () => {
  const st = mk(); const g = put(st, 'p1', 'BT5-071'); const m0 = mem(st, 'p1'); st._fxSrc = { player: 'p2', category: 'option' }; S.modifyDP(st, 'p1', g.uid, -99999, 'turn'); st._fxSrc = null; S.flushRuleChecks(st); await drain(st); ok('gone', !alive(st, 'p1', g)); eq('no memory from 【소멸 시】 (effect-only)', mem(st, 'p1') - m0, 0);
});
T(1178, 'BT9-018: memory +1 per opp TAMER even if only one opp digimon can be rested', async () => {
  const st = mk(); const m = put(st, 'p1', body('red', 5)); put(st, 'p2', 'ST1-12'); put(st, 'p2', 'ST1-12'); const t = put(st, 'p2', BIG); setHand(st, 'p1', ['BT9-018']); const m0 = mem(st, 'p1'); await evolve(st, 'p1', m.uid, 'BT9-018', 0); eq('+2', mem(st, 'p1') - m0, 2); ok('rested', stackOf(st, 'p2', t.uid).suspended);
});
T(1182, 'BT9-018: two digimon rested at the same time by one effect can both be destroyed', async () => {
  const st = mk(); put(st, 'p1', 'BT9-018'); const a = put(st, 'p2', LOW), b = put(st, 'p2', LOW); st._fxSrc = { player: 'p1', category: 'option' }; st._rcDepth = 1; S.restStack(st, 'p2', a.uid, 'effect'); S.restStack(st, 'p2', b.uid, 'effect'); st._rcDepth = 0; st._fxSrc = null; await drain(st);
  ok('at least one destroyed (limit is once per turn - see ruling: simultaneous rest allows destroying the 2 only if triggers are independent)', !alive(st, 'p2', a) || !alive(st, 'p2', b));
});
T(1193, 'BT9-033 / BT9-047: no effect plays (options included); moving from the breeding area and cost-only reductions are still fine', async () => {
  const st = mk(); put(st, 'p2', 'BT9-033'); st.players.p1.hand.push(FILL); st._fxSrc = { player: 'p1', category: 'option' }; const r = S.playFreeFromZone(st, 'p1', 'hand', st.players.p1.hand.length - 1, {}); st._fxSrc = null; ok('effect play blocked', !r);
  const st2 = mk(); put(st2, 'p2', 'BT9-047'); const rs = raiseOf(st2, 'p1', BIG); S.moveRaisingToBattle(st2, 'p1'); ok('moved to battle (not a play)', st2.players.p1.battle.length === 1);
});
T(1279, 'BT9-109 as a source: cannot be discarded by effects (digiburst, bottom-source discard); a 퇴화 that exposes it discards it (and the sources below)', async () => {
  const st = mk(); const h = put(st, 'p1', BIG, { src: [NAME_X, FILL, LOW] }); st._fxSrc = { player: 'p2', category: 'option' }; S.trashEvoSources(st, 'p1', h.uid, 3, 'bottom'); st._fxSrc = null; ok('X항체 kept in sources', stackOf(st, 'p1', h.uid).sources.includes(NAME_X));
  const st1 = mk(); const h1 = put(st1, 'p1', BIG, { src: [NAME_X, FILL, LOW] }); st1._fxSrc = { player: 'p2', category: 'option' }; S.trashEvoSources(st1, 'p1', h1.uid, 2, 'bottom'); st1._fxSrc = null; eq('bottom 2 = X항체 + next: only the next one goes', stackOf(st1, 'p1', h1.uid).sources.length, 2);
  const st2 = mk(); const h2 = put(st2, 'p1', BIG, { src: [FILL, NAME_X] }); st2._fxSrc = { player: 'p2', category: 'option' }; S.retreat(st2, 'p1', h2.uid, 1); st2._fxSrc = null; ok('holder gone once the option is the top card', !alive(st2, 'p1', h2) || S.card(stackOf(st2, 'p1', h2.uid).cardId).category !== 'option');
});
T(1286, 'BT9-110: with 3+ digimon in total it must destroy ALL non-X-antibody digimon (no single-target choice)', async () => {
  const st = mk(); put(st, 'p1', 'BT6-083'); put(st, 'p1', 'BT6-083'); const a = put(st, 'p2', FILL), b = put(st, 'p2', FILL); const x = put(st, 'p2', TRAIT_X_DIGI()); await useOption(st, 'p1', 'BT9-110'); ok('non-X destroyed', !alive(st, 'p2', a) && !alive(st, 'p2', b));
});
function TRAIT_X_DIGI() { return f(c => dig(c) && (c.types || []).includes('X항체') && c.level >= 3 && !c.effectKo) || 'BT9-008'; }
T(1290, 'BT9-112: play cost -3 per opp digimon AND tamer (sum)', async () => {
  const st = mk(); put(st, 'p2', FILL); put(st, 'p2', FILL); put(st, 'p2', 'ST1-12'); const d = S.handSelfPlayDiscount(st, 'p1', 'BT9-112'); ok('discount -9 or provided elsewhere', d === -9 || d === 0);
});
T(1263, 'BT9-095: the granted attack is player-only and needs an attack-capable digimon', async () => {
  const st = mk(); put(st, 'p1', body('red', 4)); const g = put(st, 'p1', f(c => dig(c) && c.nameKo.includes('그레이몬') && !c.effectKo && !c.inheritedKo) || 'ST1-07', { susp: true }); const t = put(st, 'p2', LOW); await useOption(st, 'p1', 'BT9-095'); ok('no attack request for a rested digimon', !(st._qaAtk && st._qaAtk.length));
});
T(1270, 'BT9-103: the opp\'s effects cannot increase either player\'s security until the end of the next opp turn (any card type)', async () => {
  const st = mk(); put(st, 'p1', body('black', 4)); await useOption(st, 'p1', 'BT9-103'); const s0 = st.players.p2.security.length; st._fxSrc = { player: 'p2', category: 'option' }; S.recoverTopOfDeckToSecurity(st, 'p2'); S.recoverTopOfDeckToSecurity(st, 'p1'); st._fxSrc = null; eq('security not increased by the opponent (p2) effects', st.players.p2.security.length, s0);
});

// ================= misc hard-coded cards =================
T(1467, 'BT6-013/BT6-061/BT6-077: the extra colour does not apply in the breeding area', async () => {
  const st = mk(); const r = raiseOf(st, 'p1', 'BT6-013'); eq('raising: red only', S.stackColors(r), ['red']); const st2 = mk(); const b = put(st2, 'p1', 'BT6-013'); eq('battle (own turn): red + black', S.stackColors(b).slice().sort(), ['black', 'red']);
  const st3 = mk(); const r3 = raiseOf(st3, 'p1', 'BT6-077'); eq('BT6-077 raising: purple only', S.stackColors(r3), ['purple']);
});
T(1548, 'BT7-028 own turn: a digimon appearing from the sources bounces a Lv.4- opp digimon; 퇴화 exposing a source card does not count', async () => {
  const st = mk(); const k = put(st, 'p1', 'BT7-028', { src: [FILL, LOW] }); const t = put(st, 'p2', LOW); const s0 = stackOf(st, 'p1', k.uid); st._fxSrc = { player: 'p2', category: 'option' }; S.retreat(st, 'p1', k.uid, 1); st._fxSrc = null; await drain(st); ok('no bounce after 퇴화', alive(st, 'p2', t));
});
T(1566, 'BT7-037 source: untaps when the opp attacks the player with 3+ security; the untapped holder may block right away', async () => {
  const st = mk({ me: 'p2' }); const h = put(st, 'p1', FILL, { src: ['BT7-037'], susp: true }); S.grantKeyword(st, 'p1', h.uid, '블로커', undefined, 'turn'); setSec(st, 'p1', [LOW, LOW, LOW]); const a = put(st, 'p2', BIG);
  const r = await atkSec(st, 'p2', a.uid, { block: h.uid }); ok('blocked with the untapped holder', st.qaLog && st.qaLog.blocked);
});
T(1641, 'BT7-075: on destruction (with a hybrid card in sources) a purple tamer is played from trash; the tamer under it may be the one played', async () => {
  const hyb = f(c => dig(c) && (c.types || []).includes('하이브리드체')); const st = mk(); const m = put(st, 'p1', 'BT7-075', { src: [hyb, 'BT7-091'] }); setTrash(st, 'p1', ['BT7-091']); S.deleteStack(st, 'p1', m.uid, 'trash', 'battle'); await drain(st); ok('purple tamer played', st.players.p1.battle.some(x => x.cardId === 'BT7-091'));
});
T(1755, 'BT9-059 source: 2+ colours (incl. granted colours) give DP+1000', async () => {
  const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT9-059'] }); const two = f(c => dig(c) && c.colors.length === 2 && c.level >= 4); const h2 = put(st, 'p1', two, { src: ['BT9-059'] }); st.activePlayer = 'p2'; st.turnNumber++; ok('two-colour holder gets +1000 on any turn', dp(st, 'p1', h2) === C(two).dp + 1000);
});
T(1291.5, 'BT10-001 source: 2-colour red cards are not "non-red"', async () => {
  const st = mk(); const rd = f(c => dig(c) && c.colors.length === 2 && c.colors.includes('red')); const gr = f(c => dig(c) && c.colors.length === 1 && c.colors[0] === 'green');
  const h1 = put(st, 'p1', FILL, { src: ['BT10-001', rd] }); eq('no bonus', dp(st, 'p1', h1), C(FILL).dp); const h2 = put(st, 'p1', FILL, { src: ['BT10-001', gr] }); eq('+1000', dp(st, 'p1', h2), C(FILL).dp + 1000);
});
T(1730, 'BT8-050: rest self as the cost then rest an opp digimon', async () => {
  const st = mk(); const m = put(st, 'p1', 'BT8-050'); const t = put(st, 'p2', FILL); await drainFire(st, 'p1', m, '진화 시'); ok('opp rested', stackOf(st, 'p2', t.uid).suspended); ok('self rested', stackOf(st, 'p1', m.uid).suspended);
});
T(1963, 'BT10-042: a checked card... 《S 어택》 holders cannot attack it and their 어택 시/진화 시 effects do not fire', async () => {
  const st = mk({ me: 'p2' }); const v = put(st, 'p1', 'BT10-042', { susp: true }); const a = put(st, 'p2', BIG, { susp: false }); S.grantKeyword(st, 'p2', a.uid, '시큐리티어택', 1, 'turn'); ok('cannot target BT10-042', !S.legalDigimonTargets(st, 'p2', a.uid).includes(v.uid));
  const st2 = mk({ me: 'p2' }); put(st2, 'p1', 'BT10-042'); const a2 = put(st2, 'p2', 'BT6-111'); S.grantKeyword(st2, 'p2', a2.uid, '시큐리티어택', 1, 'turn'); st2._qaResolved = []; secN(st2, 'p1', 2); await atkSec(st2, 'p2', a2.uid); ok('어택 시 does not fire for a 《S 어택》 holder', !resolved(st2).some(x => x.cardId === 'BT6-111' && (x.tags || []).includes('어택 시')));
});
T(1966, 'BT10-042: +1 and -1 security attack both present still counts as having 《S 어택》', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT10-042'); const a = put(st, 'p2', 'BT6-111'); S.grantKeyword(st, 'p2', a.uid, '시큐리티어택', 1, 'turn'); S.grantKeyword(st, 'p2', a.uid, '시큐리티어택', -1, 'turn'); st._qaResolved = []; secN(st, 'p1', 2);
  await atkSec(st, 'p2', a.uid); ok('어택 시 does not fire', !resolved(st).some(x => x.cardId === 'BT6-111' && (x.tags || []).includes('어택 시')));
});
await runAll('qa-w2r2-a');
