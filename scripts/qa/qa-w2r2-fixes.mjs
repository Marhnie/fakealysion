// Regression tests for the bugs found in the recheck round 2 (wave 2, rulings idx 667-1333). Q ids refer to data/rulings/all.json (gitignored); outcomes are paraphrased.
// Run: node scripts/qa/qa-w2r2-fixes.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, playCard, useOption, evolve, endTurnFull, atkSec, T, eq, ok, runAll } from './lib-s1.mjs';
const all = Object.values(S.CARDS).filter(c => !c.id.includes('~') && !c.isParallel);
const f = (pred) => all.find(pred)?.id; const dig = (c) => c.category === 'digimon';

// ---- Q1291 / Q1342 / Q1385 (+ BT2-111 Q1042): the hand card's "ignore the evolution conditions" alternative does not cover a breeding-area digimon ----
T(1291, 'alt-evolution text on the target (BT5-014/BT5-067/BT5-111/BT2-111) is not available to a digimon in the breeding area', async () => {
  for (const [tgt, src] of [['BT5-014', 'BT5-009'], ['BT5-067', 'BT5-059'], ['BT5-111', 'BT5-086'], ['BT2-111', 'P-071']]) {
    const st = mk(); setHand(st, 'p1', [tgt]); setTrash(st, 'p1', Array(12).fill(FILL));
    const b = put(st, 'p1', src); const r = S.evolveTargetRestriction(st, 'p1', b);
    ok(tgt + ' offered on the battle area', E.evolutionMethods(src, tgt, [], r, { state: st, p: 'p1', stack: b }).some(m => m.kind === 'alt'));
    const st2 = mk(); setHand(st2, 'p1', [tgt]); setTrash(st2, 'p1', Array(12).fill(FILL));
    const rs = S._s4.makeStack(src, 1); st2.players.p1.raising = rs; const r2 = S.evolveTargetRestriction(st2, 'p1', rs);
    ok(tgt + ' not offered in the breeding area', !E.evolutionMethods(src, tgt, [], r2, { state: st2, p: 'p1', stack: rs }).some(m => m.kind === 'alt'));
  }
});

// ---- Q1430 / Q1431: BT6-044 【서로의 턴】 recovery on "security decreased" (conditional text used to be filtered out of the event-watcher path) ----
T(1430, 'BT6-044: security discarded by its own evolve effect (3 -> 2) triggers the recovery back to 3', async () => {
  const st = mk(); const m = put(st, 'p1', body('yellow', 5)); setSec(st, 'p1', Array(3).fill(LOW)); setHand(st, 'p1', ['BT6-044']); await evolve(st, 'p1', m.uid, 'BT6-044', 0);
  eq('recovered', st.players.p1.security.length, 3);
});
T(1431, 'BT6-044: two copies, security 4 -> 3 by a check: only the first recovers (4), the second sees 4 and does nothing', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT6-044'); put(st, 'p1', 'BT6-044'); setSec(st, 'p1', Array(4).fill(LOW)); const a = put(st, 'p2', BIG);
  await atkSec(st, 'p2', a.uid); eq('4 again', st.players.p1.security.length, 4);
});

// ---- Q1481 / Q1489 / Q1493 (BT6-095/105/109), Q1041 (BT7-110), EX1-071: "…있을 때, 이 옵션 카드는 색 조건을 무시하고 사용할 수 있다" ----
T(1481, 'options that print "이 옵션 카드는 색 조건을 무시" work when the named digimon/tamer exists, and not otherwise', async () => {
  const m3 = (col) => f(c => dig(c) && (c.types || []).includes('3총사') && !c.colors.includes(col));
  for (const [opt, col] of [['BT6-095', 'red'], ['BT6-105', 'black'], ['BT6-109', 'purple']]) {
    const musk = m3(col); ok('3총사 fixture for ' + opt, !!musk); const st = mk(); put(st, 'p1', musk); ok(opt + ' usable with a 3총사 digimon of another colour', S.optionColorOk(st, 'p1', opt));
    const st0 = mk(); const other = f(c => dig(c) && c.level === 4 && !c.colors.includes(col) && !(c.types || []).includes('3총사') && !c.effectKo); put(st0, 'p1', other); ok(opt + ' not usable without a 3총사 / matching colour', !S.optionColorOk(st0, 'p1', opt));
  }
  const hyb = f(c => dig(c) && (c.types || []).includes('하이브리드체') && !c.colors.includes('white')); const st1 = mk(); put(st1, 'p1', hyb); ok('BT7-110 (white) usable with a 하이브리드체 digimon', S.optionColorOk(st1, 'p1', 'BT7-110'));
  const st2 = mk(); put(st2, 'p1', FILL); ok('BT7-110 not usable without one', !S.optionColorOk(st2, 'p1', 'BT7-110'));
  const st3 = mk(); put(st3, 'p1', 'ST5-14'); ok('EX1-071 (white) usable with any own tamer', S.optionColorOk(st3, 'p1', 'EX1-071')); const st4 = mk(); put(st4, 'p1', FILL); ok('EX1-071 not usable with no tamer/white', !S.optionColorOk(st4, 'p1', 'EX1-071'));
});
T(1490, 'BT6-105 (via 3총사 colour ignore) destroys all cost<=7 digimon of both players', async () => {
  const musk = f(c => dig(c) && (c.types || []).includes('3총사') && !c.colors.includes('black') && c.cost > 7); ok('fixture', !!musk); const st = mk(); put(st, 'p1', musk); const own = put(st, 'p1', LOW); const opp = put(st, 'p2', LOW);
  await useOption(st, 'p1', 'BT6-105'); ok('own low gone', !alive(st, 'p1', own)); ok('opp low gone', !alive(st, 'p2', opp));
});

// ---- Q1600: BT7-055 — every copy is its own "discard 1 or stay rested" ----
T(1600, 'BT7-055 x2: an opp rested digimon needs TWO discards to become active in the active phase', async () => {
  const st = mk(); put(st, 'p1', 'BT7-055'); put(st, 'p1', 'BT7-055'); const d = put(st, 'p2', FILL, { susp: true }); setHand(st, 'p2', [FILL, FILL, FILL]);
  await endTurnFull(st); E.nextPhase(st); await drain(st); eq('two discarded', st.players.p2.hand.length, 1); eq('active', stackOf(st, 'p2', d.uid).suspended, false);
  const st2 = mk(); put(st2, 'p1', 'BT7-055'); put(st2, 'p1', 'BT7-055'); const d2 = put(st2, 'p2', FILL, { susp: true }); setHand(st2, 'p2', [FILL]);
  await endTurnFull(st2); E.nextPhase(st2); await drain(st2); eq('cannot pay both -> stays rested', stackOf(st2, 'p2', d2.uid).suspended, true); eq('hand untouched', st2.players.p2.hand.length, 1);
});

// ---- Q1623 (BT7-063) / Q1465 (BT6-075): "each of A and B" optional effects are all-or-nothing when both exist ----
T(1623, 'BT7-063 leaving: with both Skullknightmon and Deadlyaxemon in the sources both are played (or none)', async () => {
  const st = mk({ me: 'p2' }); const m = put(st, 'p1', 'BT7-063', { src: ['BT7-058', 'BT7-059'] }); const a = put(st, 'p2', BIG);
  st._fxSrc = { player: 'p2', category: 'option' }; S.deleteStack(st, 'p1', m.uid, 'trash', 'effect'); st._fxSrc = null; await drain(st);
  const names = st.players.p1.battle.map(s => s.cardId).sort(); eq('both appeared', names, ['BT7-058', 'BT7-059']);
});
T(1465, 'BT6-075: with both in trash, once one is chosen the other is mandatory (no placing just one)', async () => {
  const st = mk(); setTrash(st, 'p1', ['BT6-071', 'BT6-073']); let n = 0; st._qaAns = { pickFromRevealed: (o) => (++n === 1 ? [o.eligible[0].i] : []) };
  const s = await playCard(st, 'p1', 'BT6-075'); eq('both placed', stackOf(st, 'p1', s.uid).sources.length, 2);
  const st2 = mk(); setTrash(st2, 'p1', ['BT6-071', 'BT6-073']); st2._qaAns = { pickFromRevealed: () => [] }; const s2 = await playCard(st2, 'p1', 'BT6-075'); eq('declining the first declines all', stackOf(st2, 'p1', s2.uid).sources.length, 0);
});

// ---- Q1652 / Q1653: BT7-085 — the 5 cards can be placed without evolving; with only 4 the effect cannot be used ----
const runMain = async (st, p, stack) => { const ab = S.activatableMainAbilities(st, p, stack, 'battle')[0]; if (!ab) return false; st.pending.push({ uid: 'm' + Math.random(), player: p, cardId: ab.cardId, stackUid: stack.uid, tags: ab.tags, text: ab.text, resolved: false }); await drain(st); return true; };
const hybrids = all.filter(c => dig(c) && (c.types || []).includes('하이브리드체')).slice(0, 8).map(c => c.id);
T(1652, 'BT7-085: 5 hybrid cards from trash go under the tamer even without 카이젤그레이몬 in hand', async () => {
  ok('fixtures', hybrids.length >= 5); const st = mk(); const tm = put(st, 'p1', 'BT7-085'); setTrash(st, 'p1', hybrids.slice(0, 5)); setHand(st, 'p1', []);
  ok('ran', await runMain(st, 'p1', tm)); eq('5 sources under the tamer', stackOf(st, 'p1', tm.uid).sources.length, 5); eq('still a tamer', C(stackOf(st, 'p1', tm.uid).cardId).category, 'tamer');
});
T(1653, 'BT7-085: with only 4 hybrid cards in the trash nothing happens', async () => {
  const st = mk(); const tm = put(st, 'p1', 'BT7-085'); setTrash(st, 'p1', hybrids.slice(0, 4)); setHand(st, 'p1', ['BT7-016']); await runMain(st, 'p1', tm); eq('no sources', stackOf(st, 'p1', tm.uid).sources.length, 0); eq('trash untouched', st.players.p1.trash.length, 4);
});
T(1652.1, 'BT7-085: with 카이젤그레이몬 in hand the tamer evolves (5 cards placed, then evolution); declining the evolution keeps the tamer', async () => {
  const st = mk(); const tm = put(st, 'p1', 'BT7-085'); setTrash(st, 'p1', hybrids.slice(0, 5)); setHand(st, 'p1', ['BT7-016']); await runMain(st, 'p1', tm); eq('evolved', stackOf(st, 'p1', tm.uid).cardId, 'BT7-016');
  const st2 = mk(); const tm2 = put(st2, 'p1', 'BT7-085'); setTrash(st2, 'p1', hybrids.slice(0, 5)); setHand(st2, 'p1', ['BT7-016']); let n = 0; st2._qaAns = { confirmEffect: () => (++n === 1) }; await runMain(st2, 'p1', tm2);
  eq('declined evolution: still the tamer', stackOf(st2, 'p1', tm2.uid).cardId, 'BT7-085'); eq('5 placed anyway', stackOf(st2, 'p1', tm2.uid).sources.length, 5);
});


// ---- Q1180 / Q1431: a declined / never-activated optional watcher effect gives its 〔턴에 1회〕 back ----
T(1180, 'BT9-018: a declined destroy (refundOnceUse) leaves the once-per-turn available for the next rest', async () => {
  const st = mk(); put(st, 'p1', 'BT9-018'); const t = put(st, 'p2', LOW); st._fxSrc = { player: 'p1', category: 'option' }; S.restStack(st, 'p2', t.uid, 'effect'); st._fxSrc = null;
  const pend = st.pending.find(x => !x.resolved && x.cardId === 'BT9-018'); ok('queued with a once key', pend && pend.onceKey); S.refundOnceUse(st, pend); S.resolvePending(st, pend.uid);
  const t2 = put(st, 'p2', LOW); st._fxSrc = { player: 'p1', category: 'option' }; S.restStack(st, 'p2', t2.uid, 'effect'); st._fxSrc = null; ok('queues again', st.pending.some(x => !x.resolved && x.cardId === 'BT9-018'));
  const st2 = mk(); put(st2, 'p1', 'BT9-018'); const u1 = put(st2, 'p2', LOW); st2._fxSrc = { player: 'p1', category: 'option' }; S.restStack(st2, 'p2', u1.uid, 'effect'); S.restStack(st2, 'p2', put(st2, 'p2', LOW).uid, 'effect'); st2._fxSrc = null;
  eq('without a refund the once-per-turn holds: a single trigger', st2.pending.filter(x => !x.resolved && x.cardId === 'BT9-018').length, 1);
});
T(1431.1, 'BT6-044: the second copy (condition no longer met) keeps its once-per-turn', async () => {
  const st = mk({ me: 'p2' }); const c1 = put(st, 'p1', 'BT6-044'); const c2 = put(st, 'p1', 'BT6-044'); setSec(st, 'p1', Array(4).fill(LOW)); const a = put(st, 'p2', BIG); await atkSec(st, 'p2', a.uid);
  const used = [c1, c2].map(c => Object.values(stackOf(st, 'p1', c.uid).turnEffectUses || {}).reduce((x, y) => x + y, 0)).sort(); eq('one copy used its once, the other did not', used, [0, 1]);
});

// ---- Q1100-1103: BT8-059 - no ignoring of evolution conditions (whole or Lv. only); tamer-as-digimon still allowed ----
T(1100, 'BT8-059 on the board voids "진화조건을 무시" alternatives (BT5-014) and "Lv.을 무시" evolutions (BT6-087)', async () => {
  const st = mk(); put(st, 'p2', 'BT8-059'); setHand(st, 'p1', ['BT5-014']); const b = put(st, 'p1', 'BT5-009'); const r = S.evolveTargetRestriction(st, 'p1', b); ok('no alt evolution', !E.evolutionMethods('BT5-009', 'BT5-014', [], r, { state: st, p: 'p1', stack: b }).some(m => m.kind === 'alt'));
  const st1 = mk(); setHand(st1, 'p1', ['BT5-014']); const b1 = put(st1, 'p1', 'BT5-009'); const r1 = S.evolveTargetRestriction(st1, 'p1', b1); ok('alt evolution without the lock', E.evolutionMethods('BT5-009', 'BT5-014', [], r1, { state: st1, p: 'p1', stack: b1 }).some(m => m.kind === 'alt'));
  const st2 = mk(); put(st2, 'p2', 'BT8-059'); const tm = put(st2, 'p1', 'BT6-087'); const ag = put(st2, 'p1', 'BT1-010'); setSec(st2, 'p1', Array(3).fill(LOW)); setHand(st2, 'p1', ['BT6-018']); await runMain(st2, 'p1', tm); eq('no Lv-ignoring evolution', stackOf(st2, 'p1', ag.uid).cardId, 'BT1-010'); eq('no security discarded (그렇게 했을 때)', st2.players.p1.security.length, 3);
  const st3 = mk(); put(st3, 'p2', 'BT8-059'); const t3 = put(st3, 'p1', 'ST1-12'); ok('tamer-as-digimon evolution still offered (BT4-011)', E.evolutionMethods('ST1-12', 'BT4-011', [], S.evolveTargetRestriction(st3, 'p1', t3), { state: st3, p: 'p1', stack: t3 }).some(m => m.id === 'tamer-as-digimon'));
});

// ---- Q1660: BT8-068 with no opp digimon still opens 3 and discards them ----
T(1660, 'BT8-068: with no opp digimon it opens 3 and discards all; declining opens nothing', async () => {
  const b5 = f(c => dig(c) && c.level === 5 && c.colors.length === 1 && c.colors[0] === 'black' && !c.effectKo && !c.inheritedKo); const st = mk(); const m = put(st, 'p1', b5); const mame = f(c => dig(c) && c.nameKo.includes('콩알몬'));
  setDeck(st, 'p1', [mame, FILL, FILL, ...Array(12).fill(FILL)]); setHand(st, 'p1', ['BT8-068']); const t0 = st.players.p1.trash.length; await evolve(st, 'p1', m.uid, 'BT8-068', 0); eq('3 trashed', st.players.p1.trash.length - t0, 3);
  const st2 = mk(); const m2 = put(st2, 'p1', b5); setDeck(st2, 'p1', [mame, FILL, FILL, ...Array(12).fill(FILL)]); setHand(st2, 'p1', ['BT8-068']); st2._qaAns = { confirmEffect: false }; const t1 = st2.players.p1.trash.length; await evolve(st2, 'p1', m2.uid, 'BT8-068', 0); eq('nothing trashed', st2.players.p1.trash.length - t1, 0);
});

// ---- Q1284 / Q1285: BT9-109 source protection - the positions are fixed first, the protected card is skipped ----
T(1284, 'BT9-109 as the bottom source: "bottom 2" discards only the card above it; EX2-055 can declare 8 to discard 7', async () => {
  const st = mk(); const h = put(st, 'p1', BIG, { src: ['BT9-109', FILL, LOW] }); st._fxSrc = { player: 'p2', category: 'option' }; const r = S.trashEvoSources(st, 'p1', h.uid, 2, 'bottom'); st._fxSrc = null; eq('one card discarded', r.length, 1); eq('two sources remain', stackOf(st, 'p1', h.uid).sources.length, 2);
  const st2 = mk(); put(st2, 'p1', 'EX2-007', { src: ['BT9-109', ...Array(7).fill(FILL)] }); const opts = S.hookPlayCostOptions ? S.hookPlayCostOptions(st2, 'p1', 'EX2-055') : []; ok('EX2-055 free-play option offered (7 discardable of 8)', opts.length >= 1);
});


// ---- Q1641 (BT7-075) / Q1006: 【소멸 시】 conditions on the destroyed digimon's own sources use last-known information ----
T(1641, 'BT7-075: destroyed with a 하이브리드체 source -> a purple tamer is played from trash right away', async () => {
  const hyb = f(c => dig(c) && (c.types || []).includes('하이브리드체')); const st = mk(); const m = put(st, 'p1', 'BT7-075', { src: [hyb, 'BT7-091'] }); setTrash(st, 'p1', ['BT7-091']);
  S.deleteStack(st, 'p1', m.uid, 'trash', 'battle'); await drain(st); ok('purple tamer played', st.players.p1.battle.some(x => x.cardId === 'BT7-091'));
  const st2 = mk(); const m2 = put(st2, 'p1', 'BT7-075', { src: [FILL, 'BT7-091'] }); setTrash(st2, 'p1', ['BT7-091']); S.deleteStack(st2, 'p1', m2.uid, 'trash', 'battle'); await drain(st2); ok('no hybrid source -> not played', !st2.players.p1.battle.some(x => x.cardId === 'BT7-091'));
});
// ---- Q1328: BT10-042 - +1 and -1 security attack cancelling out still counts as "having 《S 어택》" ----
T(1328, 'BT10-042: an opp digimon with 《S 어택 +1》 and 《S 어택 -1》 is still restricted', async () => {
  const st = mk({ me: 'p2' }); put(st, 'p1', 'BT10-042'); const a = put(st, 'p2', 'BT6-111'); S.grantKeyword(st, 'p2', a.uid, '시큐리티어택', 1, 'turn'); S.grantKeyword(st, 'p2', a.uid, '시큐리티어택', -1, 'turn'); st._qaResolved = []; secN(st, 'p1', 2);
  await atkSec(st, 'p2', a.uid); ok('어택 시 does not fire', !(st._qaResolved || []).some(x => x.cardId === 'BT6-111' && (x.tags || []).includes('어택 시')));
});


// ---- Q1354 (BT5-085) / BT8-043: hand-play "sacrifice for -N cost" options ----
T(1354, 'BT5-085 / BT8-043: a Diablomon (incl. token) / purple Cherubimon on the board offers the optional -12 / -8 play-cost sacrifice', async () => {
  const st = mk(); ok('none without the sacrifice', S.hookPlayCostOptions(st, 'p1', 'BT5-085').length === 0); put(st, 'p1', 'BT5-084'); ok('BT5-085 offered', S.hookPlayCostOptions(st, 'p1', 'BT5-085').length === 1);
  const st2 = mk(); put(st2, 'p1', 'BT7-079'); ok('BT8-043 offered', S.hookPlayCostOptions(st2, 'p1', 'BT8-043').length === 1);
  const o = S.hookPlayCostOptions(st, 'p1', 'BT5-085')[0]; const d = await o.apply(async () => null); eq('delta -12', d, -12); ok('Diablomon destroyed', st.players.p1.battle.length === 0);
});
// ---- Q1600 etc. covered above; token: BT5-084 token counts as Diablomon by name ----
await runAll('qa-w2r2-fixes');
