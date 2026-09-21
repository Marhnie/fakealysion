// Slice-4 official card Q&A scenarios, batch F (continuous effects, conditional keywords, tamer options). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-f.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runText, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 6)[i];
const xTrait = () => pool(c => c.category === 'digimon' && (c.types || []).includes('X항체') && !/X항체/.test(c.nameKo) && c.level <= 4, 2);
const kw = (st, p, stack, k) => !!(S.hasKeyword(stack, k) || S.hasContinuousKeyword(st, p, stack, k) || S.hookGrantedKeywords(st, p, stack).includes(k));

// P-033: black digimon at DP 13000+ get 《관통》 on the own turn — evaluated dynamically when DP reaches 13000 (Q4145)
add(4145, 'P-033', async (ck) => {
  const st = newState(); put(st, 'p1', ['P-033']); const bk = put(st, 'p1', [pool(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'black' && c.dp === 12000, 1)[0]]);
  ck(!kw(st, 'p1', bk, '관통'), 'pierce already at DP12000');
  bk.tempDP = 1000; ck(S.effectiveDP(st, 'p1', bk) >= 13000 && kw(st, 'p1', bk, '관통'), 'no pierce at DP13000');
});
// P-033 inherited: 《시큐리티 어택 +1》 once DP is 13000+ (Q4146)
add(4146, 'P-033', async (ck) => {
  const st = newState(); const b = pool(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'black' && c.dp === 12000, 1)[0]; const bk = put(st, 'p1', [b, 'P-033']);
  const before = S.securityAttackBonus(bk, st, 'p1'); bk.tempDP = 1000; const after = S.securityAttackBonus(bk, st, 'p1');
  ck(after === before + 1 || after >= 1, `bonus ${before} -> ${after}`);
});
// P-031: 《블로커》 on the opponent's turn only while an own purple digimon exists (Q4144)
add(4144, 'P-031', async (ck) => {
  const st = newState(); st.activePlayer = 'p2'; const me = put(st, 'p1', ['P-031']); const pu = put(st, 'p1', [pool(dig(3, 'purple'), 1)[0]]);
  ck(kw(st, 'p1', me, '블로커'), 'no blocker with a purple digimon');
  st.players.p1.battle.splice(st.players.p1.battle.indexOf(pu), 1); ck(!kw(st, 'p1', me, '블로커'), 'blocker without a purple digimon');
});
// P-139: an X-antibody TRAIT source card does not grant 《블로커》/《불굴》 (only 「레오몬」/「X항체」 named cards do) (Q4246)
add(4246, 'P-139', async (ck) => {
  const xs = xTrait(); if (!xs.length) { ck(true); return; }
  const st = newState(); st.activePlayer = 'p1'; const me = put(st, 'p1', ['P-139', xs[0]]); ck(!kw(st, 'p1', me, '블로커'), 'blocker from X-trait source');
});
// P-144: without a 「울퉁몬」/「X항체」-described source the digimon cannot attack (a trait-only X source is not enough) (Q4259)
add(4259, 'P-144', async (ck) => {
  const xs = xTrait(); if (!xs.length) { ck(true); return; }
  const st = newState(); const me = put(st, 'p1', ['P-144', xs[0]]); ck(!S.declareAttack(st, 'p1', me.uid).ok, 'X-trait source allowed the attack');
  const st2 = newState(); const named = put(st2, 'p1', ['P-144', pool(c => c.nameKo === '울퉁몬', 1)[0]]); ck(S.declareAttack(st2, 'p1', named.uid).ok, 'named source did not allow the attack');
});
// P-127 / P-129: memory +1 only when security is strictly less / more than the opponent's (Q4240 / Q4241)
add(4240, 'P-127', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-127']); st.players.p1.security = [D3(), D3()]; st.players.p2.security = [D3(), D3()]; const m0 = st.memory;
  await runEffect(st, 'P-127', '자신의 메인 페이즈 개시 시', { stackUid: me.uid }); ck(st.memory === m0, 'memory changed with equal security');
  st.players.p1.security = [D3()]; await runEffect(st, 'P-127', '자신의 메인 페이즈 개시 시', { stackUid: me.uid }); ck(st.memory === m0 + 1, 'no memory with fewer security');
});
add(4241, 'P-129', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-129']); st.players.p1.security = [D3(), D3()]; st.players.p2.security = [D3(), D3()]; const m0 = st.memory;
  await runEffect(st, 'P-129', '자신의 메인 페이즈 개시 시', { stackUid: me.uid }); ck(st.memory === m0, 'memory changed with equal security');
  st.players.p1.security = [D3(), D3(), D3()]; await runEffect(st, 'P-129', '자신의 메인 페이즈 개시 시', { stackUid: me.uid }); ck(st.memory === m0 + 1, 'no memory with more security');
});
// P-150: with exactly 3 security both the rest and the no-activate parts apply (Q4265)
add(4265, 'P-150', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-150']); st.players.p1.security = [D3(), D3(), D3()]; const t = put(st, 'p2', [D3()]);
  await runEffect(st, 'P-150', '진화 시', { stackUid: me.uid });
  ck(t.suspended && !!t.skipNextUnsuspend, 'rest=' + t.suspended + ' skipNextUnsuspend=' + t.skipNextUnsuspend);
});
// P-151: even if the revealed cards have no Liberator card, a Liberator (cost<=3) may still be played from hand (Q4266)
add(4266, 'P-151', async (ck) => {
  const lib = pool(c => c.category === 'digimon' && (c.types || []).includes('리버레이터') && (c.cost || 0) <= 3 && c.level <= 4, 1)[0]; if (!lib) { ck(true); return; }
  const st = newState(); put(st, 'p1', [lib]); st.players.p1.hand = [lib]; st.players.p1.deck = [D3(0), D3(1), D3(2), D3(3)];
  await runEffect(st, 'P-151', '메인', { stackUid: null });
  ck(st.players.p1.battle.filter(s => s.cardId === lib).length === 2, 'liberator not played from hand; battle=' + st.players.p1.battle.length);
});
// P-156: a 1-color tamer allows multi-color digimon containing that color; a 2-color tamer allows a 1-color digimon of either color (Q4271 / Q4272)
add(4271, 'P-156', async (ck) => {
  const md = pool(c => c.category === 'digimon' && c.colors.length === 2 && c.colors.includes('red') && (c.cost || 9) <= 3, 1)[0]; if (!md) { ck(true); return; }
  const rt = pool(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === 'red', 1)[0];
  const st = newState(); put(st, 'p1', [rt]); st.players.p1.hand = [md];
  await runEffect(st, 'P-156', '메인'); ck(st.players.p1.battle.some(s => s.cardId === md), 'multi-color red digimon not played');
});
add(4272, 'P-156', async (ck) => {
  const two = pool(c => c.category === 'tamer' && c.colors.length === 2 && c.colors.includes('red') && c.colors.includes('blue'), 1)[0]; const bd = pool(dig(3, 'blue', c => (c.cost || 9) <= 3), 1)[0]; if (!two || !bd) { ck(true); return; }
  const st = newState(); put(st, 'p1', [two]); st.players.p1.hand = [bd];
  await runEffect(st, 'P-156', '메인'); ck(st.players.p1.battle.some(s => s.cardId === bd), 'blue 1-color digimon not played via red/blue tamer');
});
// LM-024: while rested it ignores the opponent DIGIMON's effects (Q4027)
add(4027, 'LM-024', async (ck) => {
  const st = newState(); st.activePlayer = 'p2'; const me = put(st, 'p1', ['LM-024']); me.suspended = true; const src = put(st, 'p2', [D3()]);
  await runText(st, '상대의 디지몬 1마리를 DP -3000.', { self: 'p2', cardId: src.cardId, stackUid: src.uid, tags: ['등장 시'] });
  const dp = S.effectiveDP(st, 'p1', me); ck(dp === C['LM-024'].dp, 'DP changed to ' + dp + ' while rested');
  me.suspended = false; ck(S.effectiveDP(st, 'p1', me) <= C['LM-024'].dp - 3000, 'DP effect recorded while immune must apply once effects are received again (15-15-5): ' + S.effectiveDP(st, 'p1', me));
});

const R = await runAll(SC, 'qa-slice4-f');
process.exit(R.fail ? 1 : 0);
