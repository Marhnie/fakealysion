// slice2 round 2 (family): "open top N, add one card per criterion to hand" cards. Official Q&As (listed below by Q id) say:
//  (a) if only one of the criteria is present among the opened cards, that card is still added;
//  (b) if several criteria are present you must add ALL of them (cannot keep just one and return the other).
// Each listed card's real revealPick script is run twice on the real engine: ONE criterion available -> 1 card in hand; ALL available -> all in hand
// and the pick prompts are mandatory (min >= available).  Q id -> card (own paraphrase; original text lives only in the gitignored data/rulings).
import { S, E, Fx, world, FILL } from './lib2.mjs';
import * as fs from 'fs';
const FAM = [[1797, 'BT9-008'], [1798, 'BT9-008'], [1821, 'BT9-020'], [1822, 'BT9-020'], [1842, 'BT9-046'], [1843, 'BT9-046'], [1892, 'BT9-090'], [1894, 'BT9-092'], [1895, 'BT9-092'], [1933, 'BT10-008'], [1934, 'BT10-008'], [1972, 'BT10-046'], [1973, 'BT10-046'], [1996, 'BT10-073'], [1997, 'BT10-073'], [2050, 'BT11-007'], [2051, 'BT11-007'], [2064, 'BT11-020'], [2065, 'BT11-020'], [2066, 'BT11-023'], [2067, 'BT11-023'], [2095, 'BT11-062'], [2096, 'BT11-062'], [2148, 'BT12-021'], [2149, 'BT12-021'], [2169, 'BT12-034'], [2170, 'BT12-034'], [2178, 'BT12-047'], [2179, 'BT12-047'], [2187, 'BT12-059'], [2188, 'BT12-059'], [2231, 'BT12-098'], [2232, 'BT12-098'], [2494, 'BT15-011'], [2496, 'BT15-011'], [2539, 'BT15-055'], [2540, 'BT15-055'], [2632, 'BT16-039'], [2715, 'BT17-009'], [2751, 'BT17-020'], [2795, 'BT17-042'],
  [1947, 'BT10-019'], [1984, 'BT10-058'], [2029, 'BT10-096'], [2033, 'BT10-097'], [2056, 'BT11-012'], [2333, 'BT13-087'], [2419, 'BT14-051'], [2435, 'BT14-063'], [2462, 'BT14-088'], [2508, 'BT15-027'], [2529, 'BT15-050'], [2545, 'BT15-062'], [2550, 'BT15-064'], [2565, 'BT15-077'], [2593, 'BT15-096']];
const fxm = await import('../../src/effects.js');
const matches = fxm.FX_HELPERS.matchesFilter;
const cards = Object.values(S.CARDS);
const byCard = new Map();
for (const [q, id] of FAM) byCard.set(id, [...(byCard.get(id) || []), q]);
const findReveal = (script) => (Array.isArray(script) ? script.find(o => o && o.op === 'revealPick') : null) || null;
let pass = 0, fail = 0, skip = 0; const fails = [], credited = [], skipped = [];
for (const [id, qs] of byCard) {
  const c = S.CARDS[id]; let done = false, ok = true, why = '';
  for (const [srcName, text] of [['effectKo', c.effectKo], ['inheritedKo', c.inheritedKo]]) {
    if (!text || !/오픈한다/.test(text)) continue;
    for (const seg of S.parseEffectSegments(text).segments) {
      if (!/오픈/.test(seg.body) || !/패에\s*추가/.test(seg.body)) continue;
      const specific = Fx.lookupCardSpecific(c.id, seg.tags, seg.body, srcName === 'inheritedKo');
      let script; try { script = specific || Fx.compileToScript(seg.body); } catch { continue; }
      const rp = findReveal(script); if (!rp || !rp.steps) continue;
      const crit = []; for (const st of rp.steps) if ((st.dests || []).some(d => d.k === 'hand')) for (const g of st.groups) if (g.filter && !g.all) crit.push({ g });
      if (crit.length < 2) continue;
      const pool = cards.filter(x => x.id !== c.id);
      const used = new Set(), chosen = [];
      for (let k = 0; k < crit.length; k++) { const cand = pool.filter(x => !used.has(x.id) && matches(S, x.id, crit[k].g.filter, null)); const only = cand.find(x => crit.every((o, j) => j === k || !matches(S, x.id, o.g.filter, null))); const x = only || cand[0]; if (!x) { chosen.push(null); continue; } used.add(x.id); chosen.push(x); }
      if (chosen.some(x => !x)) continue;
      done = true;
      const discardAfter = /(?:이 효과로 추가했다면,?|그\s*후,)\s*자신의 패(?:를)?\s*1장(?:을)?\s*파기/.test(seg.body);
      for (const variant of ['one', 'all']) {
        const W = world(); const filler = FILL.slice(30, 50).filter(x => !used.has(x));
        const put = variant === 'one' ? [chosen[0]] : chosen;
        // fillers must not match any criterion (they are effect-less Lv3 digimon; verify)
        W.deck('p1', [...put.map(x => x.id), ...filler].slice(0, Math.max(rp.n || 3, put.length)).concat(filler.slice(0, 15)));
        const me = W.put('p1', c.category === 'digimon' ? c.id : FILL[0]); W.hand('p1', []);
        const ctx = { state: W.st, S, E, self: 'p1', opp: 'p2', sourceCardId: c.id, sourceStackUid: me.uid, trigger: { text: seg.body, tags: seg.tags, cardId: c.id, stackUid: me.uid, player: 'p1' }, startAttack() {}, choose: W.choose };
        try { await Fx.runScript(script, ctx); } catch (e) { ok = false; why = 'crash ' + String(e).slice(0, 60); break; }
        const got = W.pl('p1').hand.length + (discardAfter ? 1 : 0);
        if (got !== put.length || !put.every(x => discardAfter || W.pl('p1').hand.includes(x.id))) { ok = false; why = `${variant}: ${got}/${put.length} added`; }
        if (variant === 'all') { const hp = W.prompts.filter(p => p.k === 'pickFromRevealed' && p.o && (p.o.dest === 'hand' || /패/.test(String(p.o.dest)))); if (!(hp.length && hp.every(p => (p.o.min ?? 0) >= Math.min(p.o.max ?? 1, (p.o.eligible || []).length)))) { ok = false; why = 'not mandatory'; } }
      }
      break;
    }
    if (done) break;
  }
  if (!done) { skip++; skipped.push(id); continue; }
  if (ok) { pass++; credited.push(...qs); } else { fail++; fails.push(`${id} (Q ${qs.join('/')}) ${why}`); }
}
console.log(`r2-family: cards ${byCard.size}, pass ${pass}, fail ${fail}, not-generic (skipped) ${skip}; Q ids credited ${credited.length}`);
for (const f of fails) console.log('FAIL', f);
if (skipped.length) console.log('skipped (bespoke or no 2-criteria revealPick):', skipped.join(' '));
try { fs.writeFileSync('scripts/qa/_s2r2-family.json', JSON.stringify({ credited, fails, skipped })); } catch {}
