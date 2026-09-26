// unres-c audit, part 2: (b) text-compiler strays + already-fixed / triaged watcher families must keep working.
//  - a bare static-keyword line printed AFTER a tagged segment must not become part of that segment (AD1-005 counter compiled a stray 《S 어택 +1》 grant; BT15-081 / BT26-079 same),
//    while the card still HAS those keywords (parseStaticGrants reads the whole text)
//  - 《디지버스트》 payoff family (queueDigiburstTrashed) and prior-fixed watchers (BT6-044, AD1-021, AD1-025, BT25-058, BT25-060, EX9-069, BT11-069) still fire
//  - the scanner (scripts/qa/scan-unwired-watchers.mjs --strict) reports no untriaged suspect
// Run: node scripts/qa/qa-unres-c-stray.mjs < /dev/null
import { execFileSync } from 'node:child_process';
import { S, E, Fx, C, mk, put, FILL, LOW, secN, setHand, setDeck, dp, drain, resolved, makeChoose, stackOf, alive, mem, T, eq, ok, runAll } from './lib-s1.mjs';

const ctxFor = (st, p, extra = {}) => ({ state: st, S, E, self: p, opp: S.opponentOf(p), sourceCardId: 'X', choose: makeChoose(st), ...extra });
const fired = (st, id, tag = null) => resolved(st).filter((r) => r.cardId.split('~')[0] === id && (!tag || (r.tags || []).includes(tag))).length;
const grantsOf = (script) => JSON.stringify(script).match(/"op":"grantKeyword"[^}]*/g) || [];

T('stray-1', 'AD1-005: the 【카운터】 segment is only 《블래스트 진화》 (no stray S-attack grant)', async () => {
  const seg = S.parseEffectSegments(C('AD1-005').effectKo).segments.find((x) => x.tags.includes('카운터'));
  eq('body', seg.body, '《블래스트 진화》'); eq('no grantKeyword', grantsOf(Fx.compileToScript(seg.body)).length, 0);
});
T('stray-2', 'AD1-005 still HAS 《S 어택 +1》 / 《블로커》 (static keywords are read from the whole text)', async () => {
  const st = mk(); const a = put(st, 'p1', 'AD1-005');
  ok('blocker', S.hasKeyword(a, '블로커')); eq('S attack +1', S.hookSecurityAttackBonus(st, 'p1', a), 1);
});
T('stray-3', 'BT15-081 / BT26-079: trailing keyword lines are not part of the 【서로의 턴】/[트래시]【메인】 segment', async () => {
  for (const [id, tag] of [['BT15-081', '서로의 턴'], ['BT26-079', '메인']]) {
    const seg = S.parseEffectSegments(C(id).effectKo).segments.find((x) => x.tags.includes(tag));
    ok(id + ' body has no 《S 어택》 line', !/《S\s*어택/.test(seg.body));
  }
  const st = mk(); const a = put(st, 'p1', 'BT15-081'); eq('BT15-081 still has S attack +2', S.hookSecurityAttackBonus(st, 'p1', a), 2);
});
T('stray-4', 'first-line keyword bodies are kept (only lines AFTER the first are stripped)', async () => {
  const seg = S.parseEffectSegments('【메인】 《블래스트 진화》\n《돌진》').segments[0]; eq('kept first line', seg.body, '《블래스트 진화》');
  const seg2 = S.parseEffectSegments('【메인】 《1 드로우》\n《리커버리 +1《덱》》').segments[0]; ok('effect keywords (드로우/리커버리) are NOT stripped', /리커버리/.test(seg2.body));
});
T('stray-5', 'no generic-compiled script carries a grantKeyword whose keyword appears only in a trailing keyword line', async () => {
  const out = execFileSync(process.execPath, ['scripts/qa/scan-unwired-watchers.mjs', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env } });
  const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  eq('stray ops', j.b.length, 0); eq('untriaged unwired watchers', j.suspectsA.length, 0);
});

// ---- the 《디지버스트》 payoff family ("이 디지몬이 발휘한 《디지버스트》로 이 카드가 파기되었을 때") — inherited effects queued by queueDigiburstTrashed ----
for (const id of ['BT4-008', 'BT4-021', 'BT4-052', 'BT4-064', 'BT4-077', 'BT7-031']) {
  T('digiburst-' + id, id + ': digiburst-trashed -> returns to hand', async () => {
    const st = mk(); const h = put(st, 'p1', FILL, { src: [id] });
    await Fx.runScript([{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, digiburst: true }], ctxFor(st, 'p1', { sourceStackUid: h.uid })); await drain(st);
    ok('in hand', st.players.p1.hand.includes(id));
  });
}
T('digiburst-BT5-004', 'BT5-004: own digimon DP +2000', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT5-004'] }), b = dp(st, 'p1', h);
  await Fx.runScript([{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, digiburst: true }], ctxFor(st, 'p1', { sourceStackUid: h.uid })); await drain(st); eq('+2000', dp(st, 'p1', h) - b, 2000); });
T('digiburst-BT5-050', 'BT5-050: memory +1', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT5-050'] });
  await Fx.runScript([{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, digiburst: true }], ctxFor(st, 'p1', { sourceStackUid: h.uid })); await drain(st); eq('+1', mem(st, 'p1'), 1); });
T('digiburst-BT7-003', 'BT7-003: opponent digimon DP -1000', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT7-003'] }), o = put(st, 'p2', FILL), b = dp(st, 'p2', o);
  await Fx.runScript([{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, digiburst: true }], ctxFor(st, 'p1', { sourceStackUid: h.uid })); await drain(st); eq('-1000', dp(st, 'p2', o) - b, -1000); });
T('digiburst-BT7-039', 'BT7-039: 《S 어택 +1》 granted', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT7-039'] });
  await Fx.runScript([{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, digiburst: true }], ctxFor(st, 'p1', { sourceStackUid: h.uid })); await drain(st); eq('S attack', h.keywords['시큐리티어택'], 1); });
T('digiburst-P-032', 'P-032: 《재밍》 granted', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['P-032'] });
  await Fx.runScript([{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, digiburst: true }], ctxFor(st, 'p1', { sourceStackUid: h.uid })); await drain(st); ok('jamming', !!h.keywords['재밍']); });

// ---- watchers fixed by earlier audit passes (BT6-044, AD1-021, AD1-025, BT25-058/060, EX9-069, BT11-069) must keep firing ----
T('prev-BT6-044', 'BT6-044: own security decreased with <= 3 left -> recovery +1', async () => {
  const st = mk(); put(st, 'p1', 'BT6-044'); secN(st, 'p1', 3); const n0 = st.players.p1.security.length;
  S.emitGameEvent(st, 'securityDecrease', { owner: 'p1', stack: null, cause: 'effect' }); await drain(st); eq('fired', fired(st, 'BT6-044', '서로의 턴'), 1); eq('recovered', st.players.p1.security.length, n0 + 1);
});
T('prev-AD1-021', 'AD1-021: tamer rested -> draw 1', async () => {
  const st = mk(); const t = put(st, 'p1', 'AD1-021'); S.restStack(st, 'p1', t.uid, 'effect'); await drain(st); eq('fired', fired(st, 'AD1-021', '자신의 턴'), 1); ok('drew', st.players.p1.hand.length >= 1);
});
T('prev-AD1-025', 'AD1-025: opponent digimon leaves the battle area -> fires, opponent security -1', async () => {
  const st = mk(); put(st, 'p1', 'AD1-025'); const d = put(st, 'p2', FILL); secN(st, 'p2', 3);
  S.deleteStack(st, 'p2', d.uid, 'trash', 'effect'); await drain(st); eq('fired', fired(st, 'AD1-025', '서로의 턴'), 1); eq('opp security -1', st.players.p2.security.length, 2);
});
T('prev-BT25-058', 'BT25-058: digimon played by an effect -> fires', async () => {
  const st = mk(); put(st, 'p1', 'BT25-058'); put(st, 'p2', FILL); const x = put(st, 'p1', FILL);
  S.emitGameEvent(st, 'play', { owner: 'p1', stack: x, cause: 'effect' }); await drain(st); eq('fired', fired(st, 'BT25-058', '서로의 턴'), 1);
});
T('prev-BT25-060', 'BT25-060: this digimon becomes active -> fires', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT25-060', { susp: true }); S.unsuspendStack(st, 'p1', a.uid); await drain(st); eq('fired', fired(st, 'BT25-060', '서로의 턴'), 1);
});
T('prev-EX9-069', 'EX9-069: face-down source placed -> memory +1 (tamer rested)', async () => {
  const st = mk(); put(st, 'p1', 'EX9-069'); const d = put(st, 'p1', FILL);
  S.emitGameEvent(st, 'faceDownSource', { owner: 'p1', stack: d, cause: 'effect' }); await drain(st); eq('fired', fired(st, 'EX9-069', '자신의 턴'), 1);
});
T('prev-BT11-069', 'BT11-069: (inherited) opponent turn, a digimon becomes active -> fires', async () => {
  const st = mk(); st.activePlayer = 'p2'; const g = { id: 'ST1-07' }; // 그레이몬 (name contains 「그레이몬」)
  put(st, 'p1', g.id, { src: ['BT11-069'] }); const d = put(st, 'p2', FILL, { susp: true }); secN(st, 'p2', 3); S.unsuspendStack(st, 'p2', d.uid); await drain(st);
  eq('fired', fired(st, 'BT11-069', '상대의 턴'), 1); eq('opp security -1', st.players.p2.security.length, 2);
});

await runAll('qa-unres-c-stray');
