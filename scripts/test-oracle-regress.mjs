// Regression assertions for the bugs found by scripts/rule-oracle.mjs.   node scripts/test-oracle-regress.mjs < /dev/null
// Engine bugs the oracle found (all fixed):
//  1. Effects.lookupCardSpecific ran the bare "ID::tag" script (authored for the card's OWN effect) for an INHERITED (진화원) effect with the same 【tag】 (LM-003, EX5-029, BT15-064 …) -> `inherited` argument.
//  2. state.js ruleCheckDP tried the DP<=0 deletion once: a 《아머 퍼지》 survivor stayed in play at DP<=0 -> repeat while it changes something.
//  3. Conditional DP bonuses lapsing on a state change (security decrease, effect end) and 15-15-5-2 recorded DP penalties were never rule-checked -> ruleSweepDP in stepSecurityCheck / flushRuleChecks,
//     flushRuleChecks at cpusim.drain and main.js render().
// Oracle limits: CPU games never DigiXros/burst/app-fuse/link (fuzz.mjs covers their conservation); effect post-conditions only for ~20 single-sentence templates; DP recomputation is not independently verified.
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };

// ---- 1. an INHERITED 【tag】 effect must not run the bare "ID::tag" script authored for the card's OWN effect (rule-oracle FX-cond-draw, LM-003 / EX5-029 / BT15-064)
{
  const inh = (id) => S.parseEffectSegments(S.card(id).inheritedKo).segments.find((s) => s.tags[0] === '어택 시');
  const own = (id) => S.parseEffectSegments(S.card(id).effectKo).segments.find((s) => s.tags[0] === '어택 시');
  for (const id of ['LM-003', 'EX5-029', 'BT15-064']) {
    const i = inh(id), o = own(id);
    ok(Fx.lookupCardSpecific(id, o.tags, o.body, false) != null, `${id}: own 【어택 시】 keeps its bespoke script`);
    ok(Fx.lookupCardSpecific(id, i.tags, i.body, true) == null, `${id}: inherited 【어택 시】 does NOT reuse the own script`);
    ok(Fx.lookupCardSpecific(id, i.tags, i.body, false) != null, `${id}: (legacy call without the flag is unchanged)`);
  }
}

// ---- 2. 17-1-3-1: a Digimon that survives a DP<=0 deletion (《아머 퍼지》) is rule-checked again until it dies (was left as a DP<=0 zombie once its sources ran out)
{
  const mk = (ids) => { const m = {}; for (const id of ids) m[id] = (m[id] || 0) + 1; return m; };
  const deck = { name: 't', main: mk([...Array(50)].map(() => 'ST17-06')), digitama: mk(['ST1-01']) };
  const state = S.newGame(deck, deck);
  E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2'); E.setSecurityStacks(state); E.beginGame(state, 'p1');
  state.phase = 'main';
  const pl = state.players.p1;
  pl.hand.push('ST17-06');
  const idx = pl.hand.lastIndexOf('ST17-06');
  const st = S.playDigimonFresh(state, 'p1', idx);
  st.sources.push('ST1-01', 'ST1-02'); S.recomputeStackGrants(st);
  ok(S.hasKeyword(st, '아머퍼지') || S.card('ST17-06').effectKo.includes('아머 퍼지'), 'ST17-06 has 《아머 퍼지》');
  const trash0 = pl.trash.length;
  S.modifyDP(state, 'p1', st.uid, -20000, 'turn');
  ok(!pl.battle.includes(st), 'DP<=0 Digimon with 《아머 퍼지》 ends up deleted after its sources are used up');
  ok(pl.trash.length >= trash0 + 3, `all cards of the stack reach the trash (${pl.trash.length - trash0} new)`);
}

console.log(fail ? `RESULT: ${fail} FAILED` : 'RESULT: OK');
process.exit(fail ? 1 : 0);
