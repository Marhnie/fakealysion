// Part A (15-15-5 「효과를 받지 않는다」: grants are recorded, not lost) + Part B (EX10-010 mirror = least fixed point).
// Run from repo root: node scripts/test-immune-grants.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const cards = Object.values(S.CARDS);
const filler = cards.filter(c => c.category === 'digimon' && c.level === 3 && c.dp && !/효과를 받지/.test(c.effectKo || '')).slice(0, 20).map(c => c.id);
const F = filler[0], BASE = S.card(F).dp;
function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = [...filler.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 0; return st;
}
function put(st, p, id = F) { const s = S._s4.makeStack(id, 1); s.attackEligibleTurn = 0; st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; }
let fail = 0, n = 0;
const eq = (m, a, b) => { n++; if (a !== b) { fail++; console.log('FAIL', m, '| got', a, '| want', b); } };
const fx = (st, player, category = 'digimon', fn) => { const prev = st._fxSrc; st._fxSrc = { player, category, cardId: F }; try { return fn(); } finally { st._fxSrc = prev; } };
const immune = (st, p, s, opts = {}) => S.grantShield(st, p, s.uid, { kinds: ['all'], ...opts });
const unimmune = (s) => { s.shields = []; };
const dp = (st, p, s) => S.effectiveDP(st, p, s);

// ---------- A1: keyword grant while immune is recorded, inactive, then applies (15-15-5-2/-4) ----------
{
  const st = newState(); const a = put(st, 'p1'), b = put(st, 'p2'); immune(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => S.grantKeyword(st, 'p2', b.uid, '블로커', undefined, 'turn'));
  eq('A1 immune: keyword not active', S.hasKeyword(b, '블로커'), false);
  eq('A1 grant recorded', (b.deferred || []).length, 1);
  unimmune(b);
  eq('A1 immunity ended: keyword applies immediately', S.hasKeyword(b, '블로커'), true);
  eq('A1 record consumed', b.deferred, undefined);
  eq('A1 keyword expiry = original (this turn)', b.keywordExpiry['블로커'], 3);
}
// ---------- A2: DP modifiers ----------
{
  const st = newState(); const b = put(st, 'p2'); immune(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => { S.modifyDP(st, 'p2', b.uid, -3000, 'turn'); S.modifyDP(st, 'p2', b.uid, 2000, 'turn'); });
  eq('A2 DP unchanged while immune', dp(st, 'p2', b), BASE);
  eq('A2 two grants recorded', b.deferred.length, 2);
  unimmune(b);
  eq('A2 DP -3000+2000 applies at once (15-15-5-2 example)', dp(st, 'p2', b), BASE - 1000);
}
// ---------- A3: expiry is not extended by immune time ----------
{
  const st = newState(); const b = put(st, 'p2'); immune(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => { S.modifyDP(st, 'p2', b.uid, -1000, 'turn'); S.grantKeyword(st, 'p2', b.uid, '재밍', undefined, 'turn'); });
  unimmune(b); st.turnNumber = 4; // the grant lasted "this turn" (turn 3): already over
  eq('A3 expired DP grant never applies', dp(st, 'p2', b), BASE);
  eq('A3 expired keyword grant never applies', S.hasKeyword(b, '재밍'), false);
  eq('A3 expired records dropped', b.deferred, undefined);
}
{
  const st = newState(); const b = put(st, 'p2'); immune(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', b.uid, -1000, 'opponentTurn')); // lasts through turn 4
  st.turnNumber = 4; unimmune(b);
  eq('A3b still-unexpired grant applies later', dp(st, 'p2', b), BASE - 1000);
  eq('A3b expiry unchanged', b.dpExpiry, 4);
}
// ---------- A4: source kinds ----------
{ // own effect on an "opponent's-effects-immune" digimon works right away
  const st = newState(); const a = put(st, 'p1'); immune(st, 'p1', a);
  fx(st, 'p1', 'digimon', () => { S.modifyDP(st, 'p1', a.uid, 3000, 'turn'); S.grantKeyword(st, 'p1', a.uid, '관통', undefined, 'turn'); });
  eq('A4 own effect DP works on immune digimon', dp(st, 'p1', a), BASE + 3000);
  eq('A4 own effect keyword works on immune digimon', S.hasKeyword(a, '관통'), true);
  eq('A4 nothing recorded', a.deferred, undefined);
}
{ // immunity only against the opponent's DIGIMON effects: an option's grant applies, a digimon's is recorded
  const st = newState(); const b = put(st, 'p2'); immune(st, 'p2', b, { fromCategory: 'digimon' });
  fx(st, 'p1', 'option', () => S.modifyDP(st, 'p2', b.uid, -2000, 'turn'));
  eq('A4 option source not covered -> applies', dp(st, 'p2', b), BASE - 2000);
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', b.uid, -500, 'turn'));
  eq('A4 digimon source covered -> recorded, inactive', dp(st, 'p2', b), BASE - 2000);
  eq('A4 one record', b.deferred.length, 1);
  unimmune(b);
  eq('A4 released -> both applied', dp(st, 'p2', b), BASE - 2500);
}
{ // per-kind shield: only DP-down blocked; a keyword grant passes, a DP-down is recorded
  const st = newState(); const b = put(st, 'p2'); immune(st, 'p2', b, { kinds: ['dpDown'] });
  fx(st, 'p1', 'digimon', () => { S.grantKeyword(st, 'p2', b.uid, '블로커', undefined, 'turn'); S.modifyDP(st, 'p2', b.uid, -1000, 'turn'); S.modifyDP(st, 'p2', b.uid, 1000, 'turn'); });
  eq('A4 dpDown-only shield: keyword granted', S.hasKeyword(b, '블로커'), true);
  eq('A4 dpDown-only shield: +1000 applied, -1000 recorded', dp(st, 'p2', b), BASE + 1000);
  eq('A4 dpDown-only: one record', b.deferred.length, 1);
}
// ---------- A5: restrictions, S-attack ----------
{
  const st = newState(); const b = put(st, 'p2'); immune(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => { S.restrictAttack(st, 'p2', b.uid, 3); S.restrictAttackPlayer(st, 'p2', b.uid, 3); S.grantKeyword(st, 'p2', b.uid, '시큐리티어택', 1, 'turn'); S.setS3FlagFx(st, 'p2', b, 'noBlock', 3); S.setSkipNextUnsuspend(st, 'p2', b.uid); });
  eq('A5 no attack restriction while immune', b.cannotAttackUntil, undefined);
  eq('A5 no skip-unsuspend while immune', !!b.skipNextUnsuspend, false);
  eq('A5 S-attack +0 while immune', S.securityAttackBonus(b), 0);
  eq('A5 five records', b.deferred.length, 5);
  unimmune(b);
  eq('A5 S-attack +1 after', S.securityAttackBonus(b), 1);
  eq('A5 attack restriction after', b.cannotAttackUntil, 3);
  eq('A5 attack-player restriction after', b.cannotAttackPlayerUntil, 3);
  eq('A5 skip-unsuspend after', b.skipNextUnsuspend, true);
  eq('A5 noBlock flag after', S.s3Flag(st, b, 'noBlock'), true);
  eq('A5 canAttackPlayer false after', S.canAttackPlayer(st, 'p2', b.uid), false);
}
// ---------- A6: both directions ----------
{
  const st = newState(); const a = put(st, 'p1'), b = put(st, 'p2'); immune(st, 'p1', a); immune(st, 'p2', b);
  fx(st, 'p2', 'digimon', () => S.modifyDP(st, 'p1', a.uid, -1000, 'turn'));
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', b.uid, -2000, 'turn'));
  eq('A6 p1 stack unaffected while immune', dp(st, 'p1', a), BASE); eq('A6 p2 stack unaffected while immune', dp(st, 'p2', b), BASE);
  unimmune(a); eq('A6 p1 released', dp(st, 'p1', a), BASE - 1000); eq('A6 p2 still immune', dp(st, 'p2', b), BASE);
  unimmune(b); eq('A6 p2 released', dp(st, 'p2', b), BASE - 2000);
}
// ---------- A7: through the real effect runner: immune targets are selectable, one-shots have no result ----------
async function run(st, self, script, pickFirst = true) {
  const offered = [];
  const ctx = { state: st, S, self, opp: self === 'p1' ? 'p2' : 'p1', sourceCardId: F, sourceStackUid: st.players[self].battle[0]?.uid, trigger: { text: '테스트', tags: ['등장 시'] },
    choose: async (kind, payload) => { if (kind === 'pickStack') { offered.push(payload.uids.slice()); return payload.uids[0]; } if (kind === 'confirmEffect') return true; return null; } };
  await E.runScript(script, ctx); return offered;
}
{
  const st = newState(); const a = put(st, 'p1'); const b = put(st, 'p2'); immune(st, 'p2', b);
  const off = await run(st, 'p1', [{ op: 'modifyDP', target: 'opponent', amount: -2000, duration: 'turn' }]);
  eq('A7 immune digimon offered as target (15-15-5-3)', off[0] && off[0].includes(b.uid), true);
  eq('A7 recorded via runner', (b.deferred || []).length, 1);
  eq('A7 no DP change', dp(st, 'p2', b), BASE);
  unimmune(b); eq('A7 applies after release', dp(st, 'p2', b), BASE - 2000);
}
{
  const st = newState(); put(st, 'p1'); const b = put(st, 'p2'); immune(st, 'p2', b);
  const off = await run(st, 'p1', [{ op: 'destroy', target: 'opponent' }]);
  eq('A7 destroy: immune offered', off[0] && off[0].includes(b.uid), true);
  eq('A7 destroy: no result on immune (15-15-5-1)', st.players.p2.battle.includes(b), true);
  const st2 = newState(); put(st2, 'p1'); const b2 = put(st2, 'p2'); immune(st2, 'p2', b2);
  await run(st2, 'p1', [{ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }]);
  eq('A7 rest: no result on immune', b2.suspended, false);
  const st3 = newState(); put(st3, 'p1'); const b3 = put(st3, 'p2'); immune(st3, 'p2', b3);
  await run(st3, 'p1', [{ op: 'returnToHandStripSources', target: 'opponent', n: 1 }]);
  eq('A7 bounce: no result on immune', st3.players.p2.battle.includes(b3), true);
  const st4 = newState(); put(st4, 'p1'); const b4 = put(st4, 'p2'); immune(st4, 'p2', b4);
  await run(st4, 'p1', [{ op: 'grantKeyword', target: 'opponent', keyword: '블로커', duration: 'turn' }]);
  eq('A7 grantKeyword via runner recorded', b4.deferred.length, 1);
  unimmune(b4); eq('A7 grantKeyword applies later', S.hasKeyword(b4, '블로커'), true);
}

// ---------- Part B: EX10-010 mirror ----------
const BWG = 'EX10-010', BWG_DP = S.card(BWG).dp;
function mirror() {
  const st = newState(); st.activePlayer = 'p1';
  const A = put(st, 'p1', BWG), B = put(st, 'p2', BWG); return { st, A, B };
}
{ // B1: nothing active at 12000 vs 12000
  const { st, A, B } = mirror();
  eq('B1 base DP', BWG_DP, 12000);
  eq('B1 A 12000', dp(st, 'p1', A), 12000); eq('B1 B 12000', dp(st, 'p2', B), 12000);
  eq('B1 stable on re-read', dp(st, 'p1', A) + dp(st, 'p2', B), 24000);
  eq('B1 A not immune', S.effectBlocked(st, 'p1', A, 'other'), false);
  fx(st, 'p2', 'digimon', () => eq('B1 A not immune to B digimon fx', S.effectBlocked(st, 'p1', A, 'other'), false));
}
{ // B2: A +1000 (turn buff): lifts B >=13000, which in turn keeps A up
  const { st, A, B } = mirror();
  fx(st, 'p1', 'option', () => S.modifyDP(st, 'p1', A.uid, 1000, 'turn'));
  eq('B2 A = 12000+1000+3000', dp(st, 'p1', A), 16000);
  eq('B2 B = 12000+3000', dp(st, 'p2', B), 15000);
  eq('B2 consistent on re-read (A)', dp(st, 'p1', A), 16000);
  eq('B2 consistent on re-read (B)', dp(st, 'p2', B), 15000);
  fx(st, 'p2', 'digimon', () => eq('B2 A immune to B digimon effects', S.effectBlocked(st, 'p1', A, 'other'), true));
  fx(st, 'p1', 'digimon', () => eq('B2 B immune to A digimon effects', S.effectBlocked(st, 'p2', B, 'other'), true));
  fx(st, 'p1', 'option', () => eq('B2 B not immune to an option', S.effectBlocked(st, 'p2', B, 'other'), false));
  // A's digimon effect buffs B: recorded (B immune), inactive
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', B.uid, 1000, 'turn'));
  eq('B2 A\'s +1000 on B ignored while B immune', dp(st, 'p2', B), 15000);
  eq('B2 ...but recorded', B.deferred.length, 1);
  // buff on A expires (next turn): least fixed point -> both back to 12000, no latching
  st.turnNumber = 4; st.activePlayer = 'p2'; A.tempDP = 0; A.dpExpiry = undefined; A.s7Dp = [];
  eq('B2 after expiry A back to 12000', dp(st, 'p1', A), 12000);
  eq('B2 after expiry B back to 12000', dp(st, 'p2', B), 12000);
  eq('B2 immunity flipped off with it', S.effectBlocked(st, 'p2', B, 'other'), false);
  eq('B2 stale record from turn 3 does not apply on turn 4', dp(st, 'p2', B), 12000);
}
{ // B3: B's immunity flips while the recorded grant is unexpired -> applies (15-15-5-2)
  const { st, A, B } = mirror();
  fx(st, 'p1', 'option', () => S.modifyDP(st, 'p1', A.uid, 1000, 'nextOpponentTurn')); // lasts through turn 5? (caster p1, own turn -> T+1=4)
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', B.uid, -500, 'nextOpponentTurn'));
  eq('B3 while boosted B immune, -500 recorded', dp(st, 'p2', B), 15000);
  A.tempDP = 0; A.dpExpiry = undefined; // the +1000 ends early (e.g. removed) -> immunity gone
  eq('B3 immunity gone: recorded -500 applies at once', dp(st, 'p2', B), 12000 - 500);
  eq('B3 A back to 12000', dp(st, 'p1', A), 12000);
}
{ // B4: a battle A attacks B: converged values 16000 vs 15000, both immune to each other's effects
  const { st, A, B } = mirror();
  fx(st, 'p1', 'option', () => S.modifyDP(st, 'p1', A.uid, 1000, 'turn'));
  const before = [dp(st, 'p1', A), dp(st, 'p2', B)];
  eq('B4 attacker DP', before[0], 16000); eq('B4 defender DP', before[1], 15000);
  eq('B4 battle result uses those values (A wins)', dp(st, 'p1', A) > dp(st, 'p2', B), true);
  eq('B4 DP<=0 rule check sees converged values', dp(st, 'p2', B) > 0, true);
  eq('B4 both remain in play after a sweep', (S.ruleSweepDP(st, null), st.players.p1.battle.length + st.players.p2.battle.length), 2);
}
{ // B5: normal case: own BWG + opponent digimon >=13000
  const st = newState(); const A = put(st, 'p1', BWG); const big = put(st, 'p2');
  eq('B5 no big opponent: 12000', dp(st, 'p1', A), 12000);
  fx(st, 'p2', 'option', () => S.modifyDP(st, 'p2', big.uid, 13000 - BASE, 'turn'));
  eq('B5 opp >=13000: A 15000', dp(st, 'p1', A), 15000);
  fx(st, 'p2', 'digimon', () => eq('B5 immune to opp digimon effect', S.effectBlocked(st, 'p1', A, 'other'), true));
  fx(st, 'p2', 'option', () => eq('B5 not immune to opp option', S.effectBlocked(st, 'p1', A, 'other'), false));
  fx(st, 'p2', 'digimon', () => S.modifyDP(st, 'p1', A.uid, -2000, 'turn'));
  eq('B5 -2000 recorded not applied', dp(st, 'p1', A), 15000);
  st.activePlayer = 'p2'; eq('B5 【서로의 턴】: also active on the opponent turn', dp(st, 'p1', A), 15000);
  big.tempDP = 0; eq('B5 opp drops <13000: A back, recorded -2000 applies', dp(st, 'p1', A), 12000 - 2000);
}
{ // B6: DP boost coming from an option (+3000, one turn) in the mirror: 12000+... each side only 12000 + option 3000 = 15000 >= 13000 on ONE side
  const { st, A, B } = mirror();
  fx(st, 'p2', 'option', () => S.modifyDP(st, 'p2', B.uid, 3000, 'turn')); // B 15000 -> A active (15000) -> B >=13000 remains -> B active too
  eq('B6 A = 12000+3000', dp(st, 'p1', A), 15000);
  eq('B6 B = 12000+3000(opt)+3000', dp(st, 'p2', B), 18000);
  st.turnNumber = 4; B.tempDP = 0; B.dpExpiry = undefined;
  eq('B6 option ends: A back to 12000', dp(st, 'p1', A), 12000); eq('B6 option ends: B back to 12000', dp(st, 'p2', B), 12000);
}
{ // B7: 【서로의 턴】 on both turns, and evaluation order independence
  const { st, A, B } = mirror();
  fx(st, 'p1', 'option', () => S.modifyDP(st, 'p1', A.uid, 1000, 'opponentTurn'));
  for (const ap of ['p1', 'p2']) { st.activePlayer = ap; eq('B7 A on ' + ap + ' turn', dp(st, 'p1', A), 16000); eq('B7 B on ' + ap + ' turn', dp(st, 'p2', B), 15000); }
  const r1 = [dp(st, 'p2', B), dp(st, 'p1', A)], r2 = [dp(st, 'p1', A), dp(st, 'p2', B)].reverse();
  eq('B7 read order independent', r1.join(), r2.join());
  const t0 = Date.now(); for (let i = 0; i < 500; i++) { dp(st, 'p1', A); dp(st, 'p2', B); } eq('B7 no runaway recursion (500 evals fast)', Date.now() - t0 < 5000, true);
}
{ // B8: other cards with the same generic condition go through condFix too
  eq('B8 condFix exported', typeof S.condFix, 'function');
  eq('B8 in-progress key counts as false', S.condFix('k', () => S.condFix('k', () => true)), false);
  eq('B8 key released after use (also on throw)', (() => { try { S.condFix('t', () => { throw new Error('x'); }); } catch { /* ok */ } return S.condFix('t', () => true); })(), true);
}
console.log(fail ? `FAILED ${fail}/${n}` : `ALL PASS (${n} assertions)`);
process.exit(fail ? 1 : 0);
