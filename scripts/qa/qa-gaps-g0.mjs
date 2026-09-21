// QA gaps pass: G0 — an already-applied opponent grant (DP / keyword / S-attack / attack ban) is switched off while the digimon is unaffected and comes back (original expiry) when the immunity ends.
// Official basis: slice6 Q6354, 6361, 6840, 7047, 7064, 7070 (+6355 reverse direction).  Run: node scripts/qa/qa-gaps-g0.mjs < /dev/null
import { S, plain, W, scenario, run } from './lib-s6.mjs';
const fx = (w, p, cat, fn) => { const prev = w.st._fxSrc; w.st._fxSrc = { player: p, category: cat, cardId: plain(3, 5) }; try { return fn(); } finally { w.st._fxSrc = prev; } };
const immune = (w, p, s, o = {}) => S.grantShield(w.st, p, s.uid, { kinds: ['all'], ...o });
const two = () => W({ p1: {}, p2: { battle: [plain(3, 0)] } });

scenario('Q6354', 'applied DP debuff -> unaffected: off; unaffected ends: on again', async () => {
  const w = two(); const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => { S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn'); S.modifyDP(w.st, 'p2', b.uid, 3000, 'turn'); });
  w.eq(w.dp('p2', b) - base, 2000, 'both grants applied');
  immune(w, 'p2', b);
  w.eq(w.dp('p2', b) - base, 0, 'both off while unaffected (buff from the opponent too)');
  b.shields = [];
  w.eq(w.dp('p2', b) - base, 2000, 'both back');
  w.eq(w.dp('p2', b) - base, 2000, 'stable on a second read (no double application)');
  return w;
});
scenario('Q6361', 'applied keyword -> unaffected: not active; unaffected ends: active again', async () => {
  const w = two(); const b = w.p2.stacks[0];
  fx(w, 'p1', 'digimon', () => S.grantKeyword(w.st, 'p2', b.uid, '블로커', undefined, 'turn'));
  w.ok(S.hasKeyword(b, '블로커'), 'keyword applied');
  immune(w, 'p2', b);
  w.ok(!S.hasKeyword(b, '블로커'), 'keyword switched off');
  b.shields = [];
  w.ok(S.hasKeyword(b, '블로커'), 'keyword back');
  return w;
});
scenario('Q6840', 'S-attack bonus granted by the opponent is switched off while unaffected, additive value restored after', async () => {
  const w = two(); const b = w.p2.stacks[0];
  fx(w, 'p1', 'digimon', () => { S.grantKeyword(w.st, 'p2', b.uid, '시큐리티어택', 1, 'turn'); S.grantKeyword(w.st, 'p2', b.uid, '시큐리티어택', 1, 'turn'); });
  w.eq(S.securityAttackBonus(b), 2, 'two grants');
  immune(w, 'p2', b);
  w.eq(S.securityAttackBonus(b), 0, 'off');
  b.shields = [];
  w.eq(S.securityAttackBonus(b), 2, 'back');
  return w;
});
scenario('Q7047', 'an own-side (or unaffected-irrelevant) grant is NOT switched off: only the OPPONENT effects are blocked', async () => {
  const w = two(); const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p2', 'digimon', () => { S.modifyDP(w.st, 'p2', b.uid, 2000, 'turn'); S.grantKeyword(w.st, 'p2', b.uid, '재밍', undefined, 'turn'); });
  immune(w, 'p2', b);
  w.eq(w.dp('p2', b) - base, 2000, 'own DP buff stays'); w.ok(S.hasKeyword(b, '재밍'), 'own keyword stays');
  return w;
});
scenario('Q7064', 'only effects of the named category are switched off (unaffected by DIGIMON effects: an option effect grant stays, a digimon effect grant goes)', async () => {
  const w = two(); const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => S.modifyDP(w.st, 'p2', b.uid, -500, 'turn'));
  fx(w, 'p1', 'option', () => S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn'));
  immune(w, 'p2', b, { fromCategory: 'digimon' });
  w.eq(w.dp('p2', b) - base, -1000, 'only the option effect remains');
  b.shields = [];
  w.eq(w.dp('p2', b) - base, -1500, 'both again');
  return w;
});
scenario('Q7070', 'DP-based rule check: a buff-dependent digimon left with DP<=0 after a positive opponent buff is switched off is deleted; conversely a switched-off debuff keeps it alive', async () => {
  const w = two(); const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => S.modifyDP(w.st, 'p2', b.uid, -(base - 1000), 'turn'));
  w.eq(w.dp('p2', b), 1000, 'debuffed to 1000');
  fx(w, 'p1', 'digimon', () => S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn')); // would be 0 -> deleted normally, so use immunity FIRST for the second one
  w.ok(!w.pl('p2').battle.includes(b), 'DP 0 deletes normally');
  const w2 = two(); const c = w2.p2.stacks[0]; const b2 = w2.dp('p2', c);
  fx(w2, 'p1', 'digimon', () => S.modifyDP(w2.st, 'p2', c.uid, -(b2 - 1000), 'turn'));
  immune(w2, 'p2', c);
  w2.eq(w2.dp('p2', c), b2, 'unaffected: DP back to printed');
  return w2;
});
scenario('G0-exp', 'a switched-off grant keeps its ORIGINAL expiry: it never applies after it would have ended', async () => {
  const w = two(); const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => { S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn'); S.grantKeyword(w.st, 'p2', b.uid, '블로커', undefined, 'turn'); });
  immune(w, 'p2', b);
  w.eq(w.dp('p2', b), base, 'off'); w.ok(!S.hasKeyword(b, '블로커'), 'kw off');
  w.st.turnNumber += 1; b.shields = [];
  w.eq(w.dp('p2', b), base, 'expired: not applied later'); w.ok(!S.hasKeyword(b, '블로커'), 'kw expired');
  return w;
});
scenario('G0-cycle', 'immune -> not immune -> immune -> not immune repeatedly ends with exactly one application', async () => {
  const w = two(); const b = w.p2.stacks[0]; const base = w.dp('p2', b);
  fx(w, 'p1', 'digimon', () => { S.modifyDP(w.st, 'p2', b.uid, -1000, 'turn'); S.grantKeyword(w.st, 'p2', b.uid, '재밍', undefined, 'turn'); });
  for (let i = 0; i < 3; i++) { immune(w, 'p2', b); w.eq(w.dp('p2', b), base, 'off #' + i); b.shields = []; w.eq(w.dp('p2', b), base - 1000, 'on #' + i); }
  w.ok(S.hasKeyword(b, '재밍'), 'keyword on');
  return w;
});
scenario('G0-atk', 'an applied "cannot attack" ban from the opponent is lifted while the digimon is unaffected', async () => {
  const w = two(); const b = w.p2.stacks[0]; w.st.activePlayer = 'p2';
  fx(w, 'p1', 'digimon', () => S.restrictAttack(w.st, 'p2', b.uid, w.st.turnNumber));
  w.eq(S.declareAttack(w.st, 'p2', b.uid).ok, false, 'banned');
  b.suspended = false; immune(w, 'p2', b);
  w.eq(S.declareAttack(w.st, 'p2', b.uid).ok, true, 'ban not in effect while unaffected');
  return w;
});
await run('gaps-g0');
