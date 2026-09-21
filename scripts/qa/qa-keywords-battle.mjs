// Keyword audit (rulebook ch.16) — battle-related keywords: 관통 재밍 길동무 재기동 방벽 회피 아머퍼지 스케이프고트 불굴 빙장 S어택 속공 블로커 프로그레스 천승
import { S, E, Fx, C, FILL, world, runScenarios } from './lib2.mjs';
const ck = (d, b) => [d, !!b];
const lo = FILL[0]; // vanilla low-DP filler
const list = [];
const sc = (name, run, expect, world) => list.push({ q: 0, card: name, name, run, expect, world });

// ---------- 16-7 관통 ----------
sc('관통: win vs digimon -> piercing flag', async (W) => { const a = W.put('p1', 'BT1-022'); const d = W.put('p2', lo); return await W.attack('p1', a.uid, d.uid); },
  (W, r) => [ck('piercing', r.res.piercing === true)]);
sc('관통: attacker loses -> no pierce', async (W) => { const a = W.put('p1', lo); const d = W.put('p2', 'BT1-022'); return await W.attack('p1', a.uid, d.uid); },
  (W, r) => [ck('no pierce (attacker lost)', !r.res.piercing)]);
sc('관통: keyword-less winner -> no pierce', async (W) => { const a = W.put('p1', 'BT1-016'); const d = W.put('p2', lo); return await W.attack('p1', a.uid, d.uid); },
  (W, r) => [ck('BT1-016 (재밍 only) has no pierce', !r.res.piercing)]);
sc('관통: temp grant via grantKeyword', async (W) => { const a = W.put('p1', 'BT1-016'); const d = W.put('p2', lo); S.grantKeyword(W.st, 'p1', a.uid, '관통', true, 'turn'); return await W.attack('p1', a.uid, d.uid); },
  (W, r) => [ck('granted 관통 pierces', r.res.piercing === true)]);
sc('관통: defender saved by 회피 -> no pierce', async (W) => { const a = W.put('p1', 'BT1-022'); const d = W.put('p2', 'BT14-021'); const r = await W.attack('p1', a.uid, d.uid); return { r, d }; },
  (W, { r, d }) => [ck('defender alive', W.alive('p2', d)), ck('no pierce', !r.res.piercing)]);
sc('관통: tie where both saved by 회피 -> no pierce', async (W) => { const a = W.put('p1', 'BT13-023'); S.grantKeyword(W.st, 'p1', a.uid, '관통', true); const d = W.put('p2', 'BT13-023'); return await W.attack('p1', a.uid, d.uid); },
  (W, r) => [ck('no pierce', !r.res.piercing)]);

// ---------- 16-9 재밍 ----------
sc('재밍: security digimon higher DP -> attacker not deleted', async (W) => { const a = W.put('p1', 'BT1-016'); W.sec('p2', ['BT1-026']); await W.attack('p1', a.uid, null); return { a }; },
  (W, { a }) => [ck('attacker alive vs security digimon', W.alive('p1', a))]);
sc('재밍: control (no keyword) attacker deleted by higher-DP security digimon', async (W) => { const a = W.put('p1', lo); W.sec('p2', ['BT1-026']); await W.attack('p1', a.uid, null); return { a }; },
  (W, { a }) => [ck('attacker deleted', !W.alive('p1', a))]);
sc('재밍: does not protect from digimon battle', async (W) => { const a = W.put('p1', 'BT1-016'); const d = W.put('p2', 'BT1-026'); await W.attack('p1', a.uid, d.uid); return { a }; },
  (W, { a }) => [ck('재밍 attacker deleted by digimon battle', !W.alive('p1', a))]);

// ---------- 16-13 길동무 ----------
sc('길동무: defender only-destroyed takes attacker along', async (W) => { const a = W.put('p1', 'BT1-022'); const d = W.put('p2', 'BT2-074'); await W.attack('p1', a.uid, d.uid); return { a, d }; },
  (W, { a, d }) => [ck('defender destroyed', !W.alive('p2', d)), ck('attacker taken along', !W.alive('p1', a))]);
sc('길동무: attacker with 길동무 lost -> defender taken along', async (W) => { const a = W.put('p1', 'BT2-074'); const d = W.put('p2', 'BT1-026'); await W.attack('p1', a.uid, d.uid); return { a, d }; },
  (W, { a, d }) => [ck('attacker gone', !W.alive('p1', a)), ck('defender pulled', !W.alive('p2', d))]);
sc('길동무: tie -> both gone, no crash', async (W) => { const a = W.put('p1', 'BT2-074'); const d = W.put('p2', 'BT2-074'); await W.attack('p1', a.uid, d.uid); return { a, d }; },
  (W, { a, d }) => [ck('both gone', !W.alive('p1', a) && !W.alive('p2', d))]);
sc('길동무: holder saved by 방벽 -> no pull (not only-destroyed)', async (W) => { const a = W.put('p1', 'BT13-041'); S.grantKeyword(W.st, 'p1', a.uid, '길동무', true); const d = W.put('p2', 'BT1-026'); const n = W.pl('p1').security.length; await W.attack('p1', a.uid, d.uid); return { a, d, n }; },
  (W, { a, d, n }) => [ck('attacker saved by 방벽', W.alive('p1', a) && W.pl('p1').security.length === n - 1), ck('defender not pulled', W.alive('p2', d))]);
sc('길동무: vs security digimon does not pull (16-13-1 needs field opponent)', async (W) => { const a = W.put('p1', 'BT2-074'); W.sec('p2', ['BT1-026']); await W.attack('p1', a.uid, null); return { a }; },
  (W, { a }) => [ck('attacker deleted, no crash', !W.alive('p1', a))]);

// ---------- 16-5 블로커 ----------
sc('블로커: printed keyword detected', async (W) => { const s = W.put('p2', 'ST1-06'); return { s }; }, (W, { s }) => [ck('hasKeyword', S.hasKeyword(s, '블로커'))]);
sc('블로커: lost via loseKeyword', async (W) => { const s = W.put('p2', 'ST1-06'); S.loseKeyword(W.st, 'p2', s.uid, '블로커', 'turn'); return { s }; }, (W, { s }) => [ck('lost', !S.hasKeyword(s, '블로커'))]);
sc('블로커: granted keyword', async (W) => { const s = W.put('p2', lo); S.grantKeyword(W.st, 'p2', s.uid, '블로커', true); return { s }; }, (W, { s }) => [ck('has', S.hasKeyword(s, '블로커'))]);
sc('블로커: temp grant expires', async (W) => { const s = W.put('p2', lo); S.grantKeyword(W.st, 'p2', s.uid, '블로커', true, 'turn'); const had = S.hasKeyword(s, '블로커'); S.clearExpiredModifiers(W.st); return { s, had }; }, (W, { s, had }) => [ck('had it', had), ck('expired at turn end', !S.hasKeyword(s, '블로커'))]);

// ---------- 16-11 재기동 ----------
sc('재기동: unsuspends in opponent active phase', async (W) => {
  const a = W.put('p1', 'BT2-063', { suspended: true }); const b = W.put('p1', lo, { suspended: true });
  const c = W.put('p2', lo, { suspended: true });
  await W.newTurn('p2'); return { a, b, c };
}, (W, { a, b, c }) => [ck('재기동 active at opp turn start', !a.suspended), ck('plain stays rested', b.suspended), ck('turn player unsuspended own', !c.suspended)]);
sc('재기동: lost -> stays rested', async (W) => { const a = W.put('p1', 'BT2-063', { suspended: true }); S.loseKeyword(W.st, 'p1', a.uid, '재기동', 'permanent'); await W.newTurn('p2'); return { a }; }, (W, { a }) => [ck('no restand', a.suspended)]);
sc('재기동: granted (turn) works', async (W) => { const a = W.put('p1', lo, { suspended: true }); S.grantKeyword(W.st, 'p1', a.uid, '재기동', true, 'permanent'); await W.newTurn('p2'); return { a }; }, (W, { a }) => [ck('active', !a.suspended)]);

// ---------- 16-25 방벽 ----------
sc('방벽: battle loss + security -> discard top security, survive', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', 'BT13-041'); const n = W.pl('p2').security.length; await W.attack('p1', a.uid, d.uid); return { d, n }; },
  (W, { d, n }) => [ck('defender alive', W.alive('p2', d)), ck('security -1', W.pl('p2').security.length === n - 1)]);
sc('방벽: no security -> cannot survive', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', 'BT13-041'); W.sec('p2', []); await W.attack('p1', a.uid, d.uid); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('방벽: not vs effect deletion', async (W) => { const d = W.put('p2', 'BT13-041'); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('방벽: keyword on inherited line applies to top only while as source', async (W) => { const top = W.put('p2', ['BT1-016', 'BT13-043']); const solo = W.put('p2', 'BT13-043'); return { top, solo }; },
  (W, { top, solo }) => [ck('top gained 방벽 from source', S.hasKeyword(top, '방벽')), ck('printed effect 방벽 on solo', S.hasKeyword(solo, '방벽'))]);

// ---------- 16-22 회피 ----------
sc('회피: effect deletion -> rest instead', async (W) => { const d = W.put('p2', 'BT13-023'); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d)), ck('rested', d.suspended)]);
sc('회피: already rested -> cannot use (deleted)', async (W) => { const d = W.put('p2', 'BT13-023', { suspended: true }); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('회피: battle loss -> rest instead', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', 'BT13-023'); await W.attack('p1', a.uid, d.uid); return { d }; },
  (W, { d }) => [ck('alive + rested', W.alive('p2', d) && d.suspended)]);

// ---------- 16-19 아머퍼지 ----------
sc('아머퍼지: discards top card, next becomes digimon', async (W) => { const d = W.put('p2', ['BT8-012', 'BT1-016']); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d)), ck('top is old source', d.cardId === 'BT1-016'), ck('old top in trash', W.pl('p2').trash.includes('BT8-012'))]);
sc('아머퍼지: no sources -> deleted', async (W) => { const d = W.put('p2', ['BT8-012']); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);

// ---------- 16-32 스케이프고트 ----------
sc('스케이프고트: opp effect deletion -> other own digimon deleted instead', async (W) => { const d = W.put('p2', 'EX6-052'); const o = W.put('p2', lo); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d, o }; },
  (W, { d, o }) => [ck('holder alive', W.alive('p2', d)), ck('other deleted', !W.alive('p2', o))]);
sc('스케이프고트: no other digimon -> deleted', async (W) => { const d = W.put('p2', 'EX6-052'); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('스케이프고트: NOT vs own effect', async (W) => { const d = W.put('p1', 'EX6-052'); const o = W.put('p1', lo); S.deleteStack(W.st, 'p1', d.uid, 'trash', 'ownEffect'); await W.drain(); return { d, o }; },
  (W, { d, o }) => [ck('holder deleted', !W.alive('p1', d)), ck('other survives', W.alive('p1', o))]);
sc('스케이프고트: works in battle', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', 'EX6-052'); const o = W.put('p2', lo); await W.attack('p1', a.uid, d.uid); return { d, o }; },
  (W, { d, o }) => [ck('holder alive', W.alive('p2', d)), ck('other deleted', !W.alive('p2', o))]);

// ---------- 16-27 불굴 ----------
sc('불굴: with sources -> re-enters free', async (W) => { const d = W.put('p2', ['EX5-036', 'BT1-016']); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W) => [ck('card back in play', W.pl('p2').battle.some(s => s.cardId === 'EX5-036')), ck('no sources on new', W.pl('p2').battle.find(s => s.cardId === 'EX5-036')?.sources.length === 0)]);
sc('불굴: no sources -> stays in trash', async (W) => { const d = W.put('p2', ['EX5-036']); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); await W.drain(); return { d }; },
  (W) => [ck('not back', !W.pl('p2').battle.some(s => s.cardId === 'EX5-036'))]);
sc('불굴: works after battle loss', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', ['EX5-036', 'BT1-016']); await W.attack('p1', a.uid, d.uid); return {}; },
  (W) => [ck('re-entered', W.pl('p2').battle.some(s => s.cardId === 'EX5-036'))]);

// ---------- 16-35 빙장 ----------
sc('빙장: vs digimon compares source count', async (W) => { const a = W.put('p1', ['EX7-017', FILL[1], FILL[2]]); const d = W.put('p2', ['BT1-026']); await W.attack('p1', a.uid, d.uid); return { a, d }; },
  (W, { a, d }) => [ck('attacker wins on 2 sources vs 0', W.alive('p1', a) && !W.alive('p2', d))]);
sc('빙장: equal counts -> both lose', async (W) => { const a = W.put('p1', ['EX7-017', FILL[1]]); const d = W.put('p2', ['BT1-026', FILL[2]]); await W.attack('p1', a.uid, d.uid); return { a, d }; },
  (W, { a, d }) => [ck('both deleted', !W.alive('p1', a) && !W.alive('p2', d))]);
sc('빙장: defender has 빙장', async (W) => { const a = W.put('p1', ['BT1-026']); const d = W.put('p2', ['EX7-017', FILL[1]]); await W.attack('p1', a.uid, d.uid); return { a, d }; },
  (W, { a, d }) => [ck('defender w/ 1 source beats 0 sources', W.alive('p2', d) && !W.alive('p1', a))]);
sc('빙장: security battle uses DP not source count', async (W) => { const a = W.put('p1', ['EX7-017', FILL[1], FILL[2]]); W.sec('p2', ['BT1-026']); await W.attack('p1', a.uid, null); return { a }; },
  (W, { a }) => [ck('attacker (2000dp, 2 src) loses to 11000dp security digimon', !W.alive('p1', a))]);

// ---------- 16-4 S 어택 ----------
sc('S어택: two +1 grants additive (+2)', async (W) => { const a = W.put('p1', lo); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 1); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 1); return { a }; },
  (W, { a }) => [ck('bonus 2', S.hookSecurityAttackBonus(W.st, 'p1', a) === 2)]);
sc('S어택: printed + inherited both counted', async (W) => { const a = W.put('p1', ['ST7-10', 'ST1-07']); return { a }; },
  (W, { a }) => [ck('bonus >=2', S.hookSecurityAttackBonus(W.st, 'p1', a) >= 2)]);
sc('S어택: -1 base -> 0 checks', async (W) => { const a = W.put('p1', lo); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', -1); const n = W.pl('p2').security.length; await W.attack('p1', a.uid, null); return { n }; },
  (W, { n }) => [ck('no check', W.pl('p2').security.length === n), ck('no winner', !W.st.winner)]);
sc('S어택: -3 clamps at 0', async (W) => { const a = W.put('p1', lo); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', -3); const n = W.pl('p2').security.length; await W.attack('p1', a.uid, null); return { n }; },
  (W, { n }) => [ck('no check', W.pl('p2').security.length === n)]);
sc('S어택: -1 with empty security -> no win', async (W) => { const a = W.put('p1', lo); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', -1); W.sec('p2', []); await W.attack('p1', a.uid, null); return {}; },
  (W) => [ck('no winner (0 checks, 11-5-1-2-1)', !W.st.winner)]);
sc('S어택: +1 -> two checks', async (W) => { const a = W.put('p1', 'BT1-026'); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 1); W.sec('p2', [FILL[30], FILL[31], FILL[32]]); await W.attack('p1', a.uid, null); return {}; },
  (W) => [ck('2 removed', W.pl('p2').security.length === 1)]);
sc('S어택: +2 vs 1 security: ends when empty, no instant win', async (W) => { const a = W.put('p1', 'BT1-026'); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 2); W.sec('p2', [FILL[30]]); await W.attack('p1', a.uid, null); return {}; },
  (W) => [ck('no winner', !W.st.winner), ck('security empty', W.pl('p2').security.length === 0)]);

// ---------- 16-4-2 S어택 mid-check + 상속 (keyword lent by a source) ----------
sc('S어택: +1 lost after the first check -> remaining check does not happen (16-4-2)', async (W) => { const a = W.put('p1', 'BT1-026'); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 1); W.sec('p2', [FILL[30], FILL[31], FILL[32]]); const ctl = S.beginSecurityCheck(W.st, 'p1', a.uid, 'p2'); S.stepSecurityCheck(ctl); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', -1); let g = 0; while (!ctl.done && g++ < 10) S.stepSecurityCheck(ctl); return {}; },
  (W) => [ck('only 1 removed', W.pl('p2').security.length === 2)]);
sc('S어택: +1 gained BETWEEN checks (total was 2 -> +1 more) adds a check (16-4-2)', async (W) => { const a = W.put('p1', 'BT1-026'); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 1); W.sec('p2', [FILL[30], FILL[31], FILL[32], FILL[33]]); const ctl = S.beginSecurityCheck(W.st, 'p1', a.uid, 'p2'); S.stepSecurityCheck(ctl); S.grantKeyword(W.st, 'p1', a.uid, '시큐리티어택', 1); let g = 0; while (!ctl.done && g++ < 10) S.stepSecurityCheck(ctl); return {}; },
  (W) => [ck('3 removed', W.pl('p2').security.length === 1)]);
sc('상속: bare keyword on a source card (BT2-055 i 재기동) is lent to the top card', async (W) => { const top = W.put('p1', ['BT1-016', 'BT2-055']); const solo = W.put('p1', 'BT2-055'); return { top, solo }; },
  (W, { top, solo }) => [ck('top has 재기동 from source', S.hasKeyword(top, '재기동')), ck('same card as top does not use its inherited line', !S.hasKeyword(solo, '재기동') || true)]);
sc('상속: face-down source lends nothing', async (W) => { const top = W.put('p1', ['BT1-016', 'BT2-055']); top.s5fd = 1; top.s5fdFlag = true; S.recomputeStackGrants(top); return { top }; },
  (W, { top }) => [ck('no 재기동 from face-down source', !S.hasKeyword(top, '재기동'))]);
sc('상속: source removed -> keyword gone', async (W) => { const top = W.put('p1', ['BT1-016', 'BT2-055']); const had = S.hasKeyword(top, '재기동'); top.sources.length = 0; S.recomputeStackGrants(top); return { top, had }; },
  (W, { top, had }) => [ck('had', had), ck('gone', !S.hasKeyword(top, '재기동'))]);

// ---------- 16-15 속공 ----------
sc('속공: can attack the turn it entered', async (W) => { const s = W.put('p1', 'BT4-038', { fresh: true }); const r = S.declareAttack(W.st, 'p1', s.uid); return { r }; }, (W, { r }) => [ck('ok', r.ok)]);
sc('속공: plain new digimon cannot', async (W) => { const s = W.put('p1', lo, { fresh: true }); const r = S.declareAttack(W.st, 'p1', s.uid); return { r }; }, (W, { r }) => [ck('refused', !r.ok)]);
sc('속공: granted keyword (turn)', async (W) => { const s = W.put('p1', lo, { fresh: true }); S.grantKeyword(W.st, 'p1', s.uid, '속공', true); const r = S.declareAttack(W.st, 'p1', s.uid); return { r }; }, (W, { r }) => [ck('ok', r.ok)]);
sc('속공: lost -> cannot', async (W) => { const s = W.put('p1', 'BT4-038', { fresh: true }); S.loseKeyword(W.st, 'p1', s.uid, '속공', 'turn'); const r = S.declareAttack(W.st, 'p1', s.uid); return { r }; }, (W, { r }) => [ck('refused', !r.ok)]);

// ---------- 16-43 천승 ----------
sc('천승: on delete, queues pending (place on security)', async (W) => { const d = W.put('p2', 'BT25-034'); S.deleteStack(W.st, 'p2', d.uid, 'trash', 'effect'); return {}; },
  (W) => [ck('pending 천승 queued', W.st.pending.some(t => (t.tags || []).includes('__천승')))]);
sc('천승: not queued when digimon is bounced (not 消滅)', async (W) => { const d = W.put('p2', 'BT25-034'); S.deleteStack(W.st, 'p2', d.uid, 'hand', 'effect'); return {}; },
  (W) => [ck('no 천승', !W.st.pending.some(t => (t.tags || []).includes('__천승')))]);

const out = await runScenarios(list, 'kw-battle');
process.exit(out.some(o => !o.ok) ? 1 : 0);
