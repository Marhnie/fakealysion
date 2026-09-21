// Template scenario for the many official Q&As of the form "open top N, add one card per criterion to hand" (BT8-BT13 x-antibody/trait/tamer pickers):
//  - if only one criterion is met, that card is still added; if several are met, ALL of them must be added ("hand" = mandatory, cannot add just one).
// Instead of one hand-made scenario per card, every generic-compiled revealPick with >=2 hand-destined criteria in the whole card DB is exercised: a deck top is built from real DB
// cards matching each criterion (via the engine's own filter matcher) and the effect is run and the prompts are checked to be MANDATORY (min = number available) since the UI enforces min. Cited Q ids are examples of the family.
import { S, E, Fx, world, FILL } from './lib2.mjs';
import * as fs from 'fs';
const fxm = await import('../../src/effects.js');
const matches = fxm.FX_HELPERS.matchesFilter;
const cards = Object.values(S.CARDS);
let tested = 0, pass = 0, skipped = 0; const fails = [];
const results = [];
function findReveal(script) { if (!Array.isArray(script)) return null; return script.find(o => o && o.op === 'revealPick') || null; }
for (const c of cards) {
  for (const [srcName, text] of [['effectKo', c.effectKo], ['inheritedKo', c.inheritedKo]]) {
    if (!text || !/오픈한다/.test(text)) continue;
    let segs; try { segs = S.parseEffectSegments(text).segments; } catch { continue; }
    for (const seg of segs) {
      if (!/오픈/.test(seg.body) || !/패에\s*추가/.test(seg.body)) continue;
      if (Fx.lookupCardSpecific(c.id, seg.tags, seg.body, srcName === 'inheritedKo')) { skipped++; continue; } // bespoke scripts are not the generic compiler
      let script; try { script = Fx.compileToScript(seg.body); } catch { continue; }
      const rp = findReveal(script); if (!rp || !rp.steps) continue;
      // criteria = every group of every step that goes to hand
      const crit = []; for (const st of rp.steps) if ((st.dests || []).some(d => d.k === 'hand')) for (const g of st.groups) if (g.filter && !g.all) crit.push({ g, max: g.max || 1 });
      if (crit.length < 2 || !matches) continue;
      // find one real card per criterion, distinct, preferring cards matching only that criterion
      const pool = cards.filter(x => x.id !== c.id);
      const pickFor = (k, used) => {
        const cand = pool.filter(x => !used.has(x.id) && matches(S, x.id, crit[k].g.filter, null));
        const only = cand.find(x => crit.every((o, j) => j === k || !matches(S, x.id, o.g.filter, null)));
        return only || cand[0] || null;
      };
      const used = new Set(), chosen = [];
      for (let k = 0; k < crit.length; k++) { const x = pickFor(k, used); if (!x) { chosen.push(null); continue; } used.add(x.id); chosen.push(x); }
      if (chosen.some(x => !x)) { skipped++; continue; }
      tested++;
      const W = world();
      const filler = FILL.slice(30, 50).filter(id => !used.has(id));
      const n = rp.n || 3;
      W.deck('p1', [...chosen.map(x => x.id), ...filler].slice(0, Math.max(n, chosen.length)).concat(filler.slice(0, 15)));
      const me = W.put('p1', c.category === 'digimon' ? c.id : FILL[0]);
      W.hand('p1', []);
      const ctxT = { text: seg.body, tags: seg.tags, cardId: c.id, stackUid: me.uid, player: 'p1' };
      const ctx = { state: W.st, S, E, self: 'p1', opp: 'p2', sourceCardId: c.id, sourceStackUid: me.uid, trigger: ctxT, startAttack() {}, choose: W.choose };
      try { await Fx.runScript(script, ctx); } catch (e) { fails.push(`${c.id} crash ${String(e).slice(0, 80)}`); results.push({ card: c.id, ok: false }); continue; }
      const discardAfter = /(?:이 효과로 추가했다면,?|그\s*후,)\s*자신의 패(?:를)?\s*1장(?:을)?\s*파기/.test(seg.body); // follow-up discards one card of the hand
      const got = W.pl('p1').hand.length + (discardAfter ? 1 : 0), want = chosen.length;
      const hp = W.prompts.filter(p => p.k === 'pickFromRevealed' && p.o && (p.o.dest === 'hand' || /패/.test(String(p.o.dest))));
      const mandatory = hp.length > 0 && hp.every(p => (p.o.min ?? 0) >= Math.min(p.o.max ?? 1, (p.o.eligible || []).length));
      const ok = got === want && (discardAfter || chosen.every(x => W.pl('p1').hand.includes(x.id))) && mandatory;
      if (ok) pass++; else fails.push(`${c.id} [${seg.tags.join('/')}] added ${got}/${want} mandatoryPrompts=${mandatory} prompts=${hp.length}`);
      results.push({ card: c.id, ok });
    }
  }
}
console.log(`tpl: reveal-to-hand mandatory-add template over ${tested} generic cards, pass ${pass}, fail ${tested - pass}, skipped(bespoke/unmatchable) ${skipped}`);
for (const f of fails.slice(0, 40)) console.log('FAIL', f);
try { fs.writeFileSync('scripts/qa/_s2-result-tpl.json', JSON.stringify(results)); } catch {}
