// Enumerates every effect segment whose text has a "…하는 것으로" (optional processing condition) and classifies how it is executed.
import fs from 'node:fs';
import * as S from '../src/state.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const has = (script, pred) => Array.isArray(script) && script.some(o => o && (pred(o) || has(o.then, pred) || has(o.else, pred) || has(o.cost, pred)));
export const rows = [];
for (const c of Object.values(S.CARDS)) {
  for (const [src, text] of [['effect', c.effectKo], ['inherited', c.inheritedKo]]) {
    if (!text) continue;
    const { segments } = S.parseEffectSegments(text);
    for (const seg of segments) {
      const body = seg.body.replace(/\([^()]*\)/g, '');
      if (!/[가-힣》≫」\]]\s*것으로/.test(body)) continue;
      const specific = Fx.lookupCardSpecific(c.id, seg.tags, seg.body, src === 'inherited');
      let script = specific; let kind = typeof specific === 'function' ? 'bespoke-fn' : specific ? 'bespoke' : 'compiled';
      if (!script) { try { script = Fx.compileToScript(seg.body); } catch (e) { script = []; } }
      if (typeof script === 'function') script = [{ op: '__fn' }]; const cg = has(script, o => o.op === 'costGroup'), man = has(script, o => o.op === 'manualCost');
      rows.push({ id: c.id, src, tags: seg.tags.join('/'), kind, costGroup: cg, manual: man, empty: !script.length, text: body.slice(0, 120) });
    }
  }
}
if (process.argv[1].endsWith('enum-optional-cost.mjs')) {
  const g = {}; for (const r of rows) { const k = `${r.kind}/${r.costGroup ? 'costGroup' : r.empty ? 'empty' : 'NO-costGroup'}${r.manual ? '+manual' : ''}`; (g[k] ||= []).push(r); }
  for (const [k, v] of Object.entries(g)) console.log(k, v.length);
  if (process.argv[2]) for (const r of (g[process.argv[2]] || [])) console.log(r.id, r.src, r.tags, '|', r.text);
}
