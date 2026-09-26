// unres-c audit: watchers whose printed trigger the generic parsers could not read (never queued) — each must now fire and do its printed effect.
// Fixes live in src/cards/shard170.js (see docs/audit-2026-09-unresolved-c.md). Run: node scripts/qa/qa-unres-c-watchers.mjs < /dev/null
import { S, E, Fx, C, mk, put, FILL, LOW, secN, setHand, setTrash, dp, drain, atkSec, atkDigi, resolved, makeChoose, stackOf, alive, mem, T, eq, ok, runAll } from './lib-s1.mjs';

const ctxFor = (st, p, extra = {}) => ({ state: st, S, E, self: p, opp: S.opponentOf(p), sourceCardId: 'X', choose: makeChoose(st), ...extra });
const run = async (st, p, script, extra) => { await Fx.runScript(script, ctxFor(st, p, extra)); await drain(st); };
const fired = (st, id, tag = null) => resolved(st).filter((r) => r.cardId.split('~')[0] === id && (!tag || (r.tags || []).includes(tag))).length; // (raising-area contributors carry a synthetic "<id>~육성i" card id)
const lv5 = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.level === 5 && !c.effectKo && !c.inheritedKo && c.dp).id;
const lv3 = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.level === 3 && !c.effectKo && !c.inheritedKo && c.dp && c.id !== FILL && c.id !== LOW).id;

T('BT12-041', 'opponent digimon deleted by DP 0 -> draw 1 (소멸됐을 spelling)', async () => {
  const st = mk(); put(st, 'p1', 'BT12-041'); const t = put(st, 'p2', FILL);
  S.modifyDP(st, 'p2', t.uid, -99999, 'turn'); await drain(st);
  ok('target gone', !alive(st, 'p2', t)); eq('drew 1', st.players.p1.hand.length, 1);
});
T('BT12-041b', 'BT12-041: a non-DP-0 deletion does not draw', async () => {
  const st = mk(); put(st, 'p1', 'BT12-041'); const t = put(st, 'p2', FILL);
  S.deleteStack(st, 'p2', t.uid, 'trash', 'effect'); await drain(st); eq('no draw', st.players.p1.hand.length, 0);
});
T('BT14-030', 'a digimon returned to hand (either side) -> recovery +1 once per turn; a deletion does not', async () => {
  const st = mk(); put(st, 'p1', 'BT14-030'); put(st, 'p1', FILL); const a = put(st, 'p2', FILL), b = put(st, 'p2', FILL);
  const sec0 = st.players.p1.security.length;
  S.deleteStack(st, 'p2', a.uid, 'trash', 'effect'); await drain(st); eq('deleted: no recovery', st.players.p1.security.length, sec0);
  await run(st, 'p1', [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, dest: 'hand' }]);
  eq('bounced: recovery +1', st.players.p1.security.length, sec0 + 1);
  ok('opp got the card back', st.players.p2.hand.length === 1);
});
T('EX5-025', 'opponent digimon source trashed by an effect -> this digimon becomes active', async () => {
  const st = mk(); const h = put(st, 'p1', 'EX5-025', { susp: true }); put(st, 'p2', FILL, { src: [FILL, FILL] });
  await run(st, 'p1', [{ op: 'trashEvoSources', target: 'opponent', count: 1, stacks: 1 }]);
  eq('active', stackOf(st, 'p1', h.uid).suspended, false);
});
T('EX7-034', 'inherited: attacking an opponent digimon -> may become active (once/turn)', async () => {
  const st = mk(); const a = put(st, 'p1', lv5, { src: ['EX7-034'] }); const t = put(st, 'p2', LOW, { susp: true });
  await atkDigi(st, 'p1', a.uid, t.uid); eq('fired', fired(st, 'EX7-034'), 1); eq('attacker active again', stackOf(st, 'p1', a.uid)?.suspended, false);
});
T('AD1-016', 'own 「최건우」 played -> may delete an opponent digimon with DP <= this digimon', async () => {
  const st = mk(); put(st, 'p1', 'AD1-016'); const t = put(st, 'p2', LOW); setHand(st, 'p1', ['BT4-092']);
  S.playDigimonFresh(st, 'p1', 0); await drain(st); eq('fired', fired(st, 'AD1-016'), 1); ok('opp digimon deleted', !alive(st, 'p2', t));
});
T('AD1-016b', 'AD1-016: own 「최건우」 resting also triggers', async () => {
  const st = mk(); put(st, 'p1', 'AD1-016'); const t = put(st, 'p2', LOW); const g = put(st, 'p1', 'BT4-092');
  S.restStack(st, 'p1', g.uid, 'effect'); await drain(st); eq('fired', fired(st, 'AD1-016'), 1); ok('opp digimon deleted', !alive(st, 'p2', t));
});
T('BT26-057', 'attack target changed OR tamer source trashed by effect -> active', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT26-057', { susp: true });
  S.emitGameEvent(st, 'redirect', { owner: 'p2', stack: put(st, 'p2', FILL), cause: null, targetUid: 'x' }); await drain(st);
  eq('fired on redirect', fired(st, 'BT26-057'), 1); eq('active', stackOf(st, 'p1', h.uid).suspended, false);
  const st2 = mk(); const h2 = put(st2, 'p1', 'BT26-057', { susp: true }); const tm = put(st2, 'p1', 'BT4-092', { src: [FILL] });
  S.emitGameEvent(st2, 'sourcesTrashed', { owner: 'p1', stack: tm, cause: 'effect', ids: [FILL] }); await drain(st2);
  eq('fired on tamer-source trash', fired(st2, 'BT26-057'), 1); eq('active (2)', stackOf(st2, 'p1', h2.uid).suspended, false);
});
T('BT9-085', 'blue/red own digimon becomes active -> rest tamer: bounce Lv.3 opponent digimon', async () => {
  const st = mk(); const tam = put(st, 'p1', 'BT9-085'); const d = put(st, 'p1', 'ST1-02', { susp: true }); const o = put(st, 'p2', lv3);
  const other = S.card(lv3).level; eq('lv', other, 3);
  S.unsuspendStack(st, 'p1', d.uid); await drain(st);
  eq('fired', fired(st, 'BT9-085'), 1); ok('tamer rested (cost)', stackOf(st, 'p1', tam.uid).suspended); ok('opp lv3 bounced', !alive(st, 'p2', o));
});
T('BT9-085b', 'BT9-085: a non blue/red digimon does not trigger', async () => {
  const st = mk(); put(st, 'p1', 'BT9-085'); const g = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'green' && !c.effectKo && !c.inheritedKo).id;
  const d = put(st, 'p1', g, { susp: true }); put(st, 'p2', lv3); S.unsuspendStack(st, 'p1', d.uid); await drain(st); eq('not fired', fired(st, 'BT9-085'), 0);
});
T('BT10-076', 'opponent digimon/tamer played on their turn -> trash a source: memory +1', async () => {
  const st = mk(); st.activePlayer = 'p2'; const h = put(st, 'p1', 'BT10-076', { src: [FILL] }); setHand(st, 'p2', [FILL]);
  S.playDigimonFresh(st, 'p2', 0); await drain(st); eq('fired', fired(st, 'BT10-076'), 1); eq('source paid', stackOf(st, 'p1', h.uid).sources.length, 0); eq('memory (p1 view)', mem(st, 'p1'), 1);
});
T('RB1-011', 'inherited: own hand discarded by own effect -> memory +1 (not by a plain rule discard)', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['RB1-011'] }); setHand(st, 'p1', [FILL, FILL]);
  await run(st, 'p1', [{ op: 'trashHand', who: 'self', n: 1 }]); eq('fired', fired(st, 'RB1-011'), 1); eq('memory +1', mem(st, 'p1'), 1);
});
T('RB1-033a', 'own turn: tamer becomes active -> memory +1', async () => {
  const st = mk(); const t = put(st, 'p1', 'RB1-033', { susp: true }); S.unsuspendStack(st, 'p1', t.uid); await drain(st);
  eq('fired', fired(st, 'RB1-033'), 1); eq('memory +1', mem(st, 'p1'), 1);
});
T('RB1-033b', 'opponent Lv.5+ digimon attacks, hand <= 7 -> rest tamer: draw 1', async () => {
  const st = mk(); st.activePlayer = 'p2'; const t = put(st, 'p1', 'RB1-033'); const a = put(st, 'p2', lv5);
  S.emitGameEvent(st, 'attack', { owner: 'p2', stack: a, cause: null }); await drain(st);
  eq('fired', fired(st, 'RB1-033'), 1); eq('drew', st.players.p1.hand.length, 1); ok('tamer rested', stackOf(st, 'p1', t.uid).suspended);
});
T('RB1-033c', 'RB1-033: a Lv.4 opponent digimon does not trigger', async () => {
  const st = mk(); st.activePlayer = 'p2'; put(st, 'p1', 'RB1-033'); const a = put(st, 'p2', FILL);
  S.emitGameEvent(st, 'attack', { owner: 'p2', stack: a, cause: null }); await drain(st); eq('not fired', fired(st, 'RB1-033'), 0);
});
T('BT24-020', 'inherited: this digimon becomes active -> hand <= 7: draw 1 (EW_UNSAFE was dropping it)', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT24-020'], susp: true }); S.unsuspendStack(st, 'p1', a.uid); await drain(st);
  eq('fired', fired(st, 'BT24-020'), 1); eq('drew', st.players.p1.hand.length, 1);
  const st2 = mk(); const a2 = put(st2, 'p1', FILL, { src: ['BT24-020'], susp: true }); setHand(st2, 'p1', Array(8).fill(FILL)); S.unsuspendStack(st2, 'p1', a2.uid); await drain(st2);
  eq('hand 8: no draw', st2.players.p1.hand.length, 8);
});
T('BT26-068', 'opponent hand increased by an effect -> discard 1 of mine: opponent discards 1', async () => {
  const st = mk(); put(st, 'p1', 'BT26-068'); setHand(st, 'p1', [FILL, FILL]); setHand(st, 'p2', [FILL, FILL]);
  await run(st, 'p2', [{ op: 'draw', who: 'self', n: 1 }]); eq('fired', fired(st, 'BT26-068'), 1);
  eq('mine discarded 1', st.players.p1.hand.length, 1); eq('theirs: +1 draw -1 discard', st.players.p2.hand.length, 2);
});
T('BT11-087', 'opponent digimon moves from breeding area -> trash own source: it gains 「【어택 시】 메모리 -3」', async () => {
  const st = mk(); st.activePlayer = 'p2'; const h = put(st, 'p1', 'BT11-087', { src: [FILL] }); const d = put(st, 'p2', FILL);
  S.emitGameEvent(st, 'move', { owner: 'p2', stack: d, cause: null }); await drain(st);
  eq('fired', fired(st, 'BT11-087'), 1); eq('source paid', stackOf(st, 'p1', h.uid).sources.length, 0);
  ok('granted attack-trigger', (d.s2Granted || []).some((g) => g.trigger === 'attack' && /메모리 -3/.test(g.label)));
});
T('BT7-016', 'blocked -> becomes active (script was never wired)', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT7-016'); const b = put(st, 'p2', FILL); b.keywords['블로커'] = true; secN(st, 'p2', 3);
  await atkSec(st, 'p1', a.uid, { block: b.uid }); eq('fired', fired(st, 'BT7-016'), 1);
});
T('BT23-059', 'a placed Option leaves the battle area -> this digimon becomes active', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT23-059', { susp: true }); const o = put(st, 'p2', Object.values(S.CARDS).find((c) => c.category === 'option').id);
  S.deleteStack(st, 'p2', o.uid, 'trash', 'effect'); await drain(st);
  eq('fired', fired(st, 'BT23-059'), 1); eq('active', stackOf(st, 'p1', h.uid).suspended, false);
});
T('BT13-007', 'inherited [육성]: a Royal Knights option placed -> memory +1', async () => {
  const st = mk(); const rk = Object.values(S.CARDS).find((c) => c.category === 'option' && (c.types || []).includes('로얄 나이츠'))?.id;
  const r = S._s4.makeStack(FILL, 1); r.sources = ['BT13-007']; st.players.p1.raising = r; S.recomputeStackGrants(r);
  const o = put(st, 'p1', rk); S.emitGameEvent(st, 'optionPlaced', { owner: 'p1', stack: o, cause: 'effect' }); await drain(st);
  eq('fired', fired(st, 'BT13-007'), 1); eq('memory +1', mem(st, 'p1'), 1);
});
T('BT15-081', '[트래시]: opponent digimon played by an effect -> evolve my 「리바이어몬」 into this card from the trash', async () => {
  const st = mk(); const h = put(st, 'p1', 'EX5-063'); setTrash(st, 'p1', ['BT15-081']); const x = put(st, 'p2', FILL);
  S.emitGameEvent(st, 'play', { owner: 'p2', stack: x, cause: 'effect' }); await drain(st);
  eq('fired', fired(st, 'BT15-081', '서로의 턴'), 1); eq('evolved', stackOf(st, 'p1', h.uid).cardId, 'BT15-081'); eq('trash card used', st.players.p1.trash.includes('BT15-081'), false);
});
T('BT17-037', 'inherited: own yellow/red tamer deleted -> place 「최건우」 from trash on security', async () => {
  const st = mk(); put(st, 'p1', lv5, { src: ['BT17-037'] }); const t = put(st, 'p1', 'BT4-092'); setTrash(st, 'p1', ['BT12-092']); const sec0 = st.players.p1.security.length;
  S.deleteStack(st, 'p1', t.uid, 'trash', 'effect'); await drain(st);
  eq('fired', fired(st, 'BT17-037'), 1); eq('security +1', st.players.p1.security.length, sec0 + 1);
});
T('BT26-069', 'inherited: own hand discarded -> evolve this Titan into a Titan from trash (cost -1)', async () => {
  const st = mk(); let pair = null;
  const l3 = Object.values(S.CARDS).filter((c) => c.category === 'digimon' && (c.types || []).includes('타이탄족') && c.level === 3);
  const l4 = Object.values(S.CARDS).filter((c) => c.category === 'digimon' && (c.types || []).includes('타이탄족') && c.level === 4);
  outer: for (const a of l3) for (const b of l4) { const h = put(mk(), 'p1', a.id); try { if (E.canEvolveAny(a.id, b.id, S.evoExtraArg(st, null, h), null).ok) { pair = [a.id, b.id]; break outer; } } catch { /* next */ } }
  ok('found a Titan pair', !!pair);
  const h = put(st, 'p1', pair[0], { src: ['BT26-069'] }); setTrash(st, 'p1', [pair[1]]); setHand(st, 'p1', [FILL]);
  st.memory = 10;
  await run(st, 'p1', [{ op: 'trashHand', who: 'self', n: 1 }]);
  eq('fired', fired(st, 'BT26-069'), 1); eq('evolved from trash', stackOf(st, 'p1', h.uid).cardId, pair[1]);
});
T('BT12-083', 'Lv cap +1 per differently-coloured own tamer (max matching of tamers to distinct colours, Q&A 2216)', async () => {
  const cardsBy = (cols) => Object.values(S.CARDS).find((c) => c.category === 'tamer' && !c.isParallel && c.colors.length === cols.length && cols.every((x) => c.colors.includes(x)));
  const cap = (ids) => { const st = mk(); for (const id of ids) put(st, 'p1', id); const sc = Fx.lookupCardSpecific('BT12-083', ['진화 시'], 'x'); return sc[0].maxLv(ctxFor(st, 'p1')); };
  const R = cardsBy(['red']), B = cardsBy(['blue']), RB = cardsBy(['red', 'blue']), BY = cardsBy(['blue', 'yellow']);
  ok('fixtures', R && B && RB && BY);
  eq('no tamer', cap([]), 3);
  eq('lone red-blue tamer counts once', cap([RB.id]), 4);
  eq('red + red-blue + blue-yellow = red, blue, yellow (Q&A example)', cap([R.id, RB.id, BY.id]), 6);
  eq('red + blue + red-blue: the red-blue tamer adds no colour', cap([R.id, B.id, RB.id]), 5);
  eq('two identical red tamers count once', cap([R.id, R.id]), 4);
});

T('BT25-065', 'own turn: attacking the player -> memory -2 (only its 【서로의 턴】 line was wired)', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT25-065'); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid);
  eq('memory -2', mem(st, 'p1'), -2); eq('the other line still draws', st.players.p1.hand.length, 1);
  const st2 = mk(); const a2 = put(st2, 'p1', 'BT25-065'); const t = put(st2, 'p2', LOW, { susp: true }); await atkDigi(st2, 'p1', a2.uid, t.uid);
  eq('attacking a digimon: no memory loss', mem(st2, 'p1'), 0);
});
T('BT26-049', 'two-clause trigger: opponent digimon rests OR own tamer source trashed by effect', async () => {
  const st = mk(); put(st, 'p1', 'BT26-049'); const o = put(st, 'p2', FILL); S.restStack(st, 'p2', o.uid, 'effect'); await drain(st);
  eq('clause A (rest)', fired(st, 'BT26-049', '서로의 턴'), 1);
  const st2 = mk(); put(st2, 'p1', 'BT26-049'); const tm = put(st2, 'p1', 'BT4-092', { src: [FILL] });
  S.emitGameEvent(st2, 'sourcesTrashed', { owner: 'p1', stack: tm, cause: 'effect', ids: [FILL] }); await drain(st2);
  eq('clause B (tamer source trashed)', fired(st2, 'BT26-049', '서로의 턴'), 1);
});
T('BT17-099', 'placed Option: own tamer deleted OR returned to hand -> 《딜레이》 (option is discarded, effect resolves)', async () => {
  for (const how of ['delete', 'bounce']) {
    const st = mk(); const opt = put(st, 'p1', 'BT17-099'); const tm = put(st, 'p1', 'BT4-092');
    if (how === 'delete') S.deleteStack(st, 'p1', tm.uid, 'trash', 'effect'); else await run(st, 'p2', [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { category: 'tamer' }, dest: 'hand' }]);
    await drain(st);
    eq(how + ': fired once', fired(st, 'BT17-099', '서로의 턴'), 1); ok(how + ': option discarded by 《딜레이》', !alive(st, 'p1', opt));
  }
});

await runAll('qa-unres-c-watchers');
