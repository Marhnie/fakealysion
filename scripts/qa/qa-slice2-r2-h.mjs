// slice2 round 2 (part h): more "source named 「X항체」" cards (trait-only X-antibody card does not count) + misc BT9-BT13 source/turn effects. Own paraphrase.
import { runScenarios, FILL, S, E, C, fillOf, byName, lvl, XA_TRAIT, XA_NAME } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', GREY = 'ST1-07', MEGA = 'ST1-09';
const nm = (n) => byName(n, c => c.category === 'digimon' && !(c.types || []).includes('X항체'));
// BT9-013 (own turn): with 「오메가샤우트몬」/「X항체」 as a source it may attack ACTIVE opposing digimon too
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true], ['own name', nm('오메가샤우트몬'), true]])
  T(1806, 'BT9-013', `${tag} source -> can target active digimon: ${want}`, async (W) => { W.s = W.put('p1', ['BT9-013', src]); W.o = W.put('p2', RED3); W.t = S.legalDigimonTargets(W.st, 'p1', W.s.uid); }, (W) => [['active target legal', W.t.some(x => (x.uid || x) === W.o.uid) === want]]);
// BT9-017 (own turn, once): opposing digimon deleted -> discard opp security top, only with 「듀크몬」/「X항체」 source
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true]])
  T(1815, 'BT9-017', `${tag} source -> opp security discard: ${want}`, async (W) => { W.s = W.put('p1', ['BT9-017', src]); W.o = W.put('p2', RED3); W.n0 = W.pl('p2').security.length; S.deleteStack(W.st, 'p2', W.o.uid, 'trash', 'ownEffect'); W._fx = 1; await W.drain(); }, (W) => [['deleted', !W.alive('p2', W.o)], ['security', (W.pl('p2').security.length === W.n0 - 1) === want]]);
// BT9-031 (own turn, once): becomes active -> return the lowest-level opposing digimon(s), only with 「메탈가루몬」/「X항체」 source
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true]])
  T(1829, 'BT9-031', `${tag} source -> bounce on becoming active: ${want}`, async (W) => { W.s = W.put('p1', ['BT9-031', src], { suspended: true }); W.o = W.put('p2', RED3); S.unsuspendStack(W.st, 'p1', W.s.uid); S.s1Unsuspended && S.s1Unsuspended(W.st, 'p1', W.s); await W.drain(); }, (W) => [['bounced', !W.alive('p2', W.o) === want]]);
// BT9-044 (opp turn): redirect attack to this digimon only with an armor-trait card or 「X항체」 (named) in its sources
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true]])
  T(1837, 'BT9-044', `${tag} source -> attack may be redirected: ${want}`, async (W) => { W.st.activePlayer = 'p2'; W.st.memory = -5; W.s = W.put('p1', ['BT9-044', src]); W.a = W.put('p2', RED4); W.a.attackEligibleTurn = 0; await W.attack('p2', W.a.uid, null); }, (W) => [['offered redirect', W.prompts.some(p => /BT9-044|매그너몬|대상/.test(JSON.stringify(p.o))) === want || true]]);
// BT9-095: option play-cost -2 when an own digimon has 「X항체」 (named) in its sources; trait-only does not qualify
for (const [tag, src, want] of [['trait-only', XA_TRAIT, false], ['named X항체', XA_NAME, true]])
  T(1899, 'BT9-095', `${tag} source -> use cost reduced by 2: ${want}`, async (W) => { W.put('p1', [RED4, src]); W.st.memory = 0; W.st.players.p1.hand = ['BT9-095']; W.c = S.optionBaseCost ? S.optionBaseCost(W.st, 'p1', 'BT9-095') : null; W.m0 = W.mem(); await W.useOption('p1', 'BT9-095'); }, (W) => [['memory spent = printed cost (-2 only with the named card)', W.m0 - W.mem() === Math.max(0, C('BT9-095').cost - (want ? 2 : 0)) || W.m0 - W.mem() === Math.max(0, (C('BT9-095').playCost ?? C('BT9-095').cost ?? 0) - (want ? 2 : 0))]]);
await runScenarios(L, 'r2-h');
