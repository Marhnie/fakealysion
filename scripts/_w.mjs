import * as fs from 'fs';
import * as S from '../src/state.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
let tot = 0, man = 0; const rows = [];
for (const c of Object.values(S.CARDS)) for (const [k, inh] of [['effectKo', false], ['inheritedKo', true]]) {
  if (!c[k]) continue;
  for (const seg of S.parseEffectSegments(c[k]).segments) {
    if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
    let ab = S.parseWatcherTrigger(seg.body); let eff = ab && ab.effect;
    if (!ab) { const ew = S.parseEventWatcher(seg.body); if (ew) eff = ew.effect; else continue; }
    tot++;
    const sp = Fx.lookupCardSpecific(c.id, seg.tags, eff);
    const sc = sp || Fx.compileToScript(eff);
    if (!sc || !sc.length) { man++; rows.push([c.id, inh ? 'inh' : 'own', eff.replace(/\s+/g, ' ').slice(0, 110)]); }
  }
}
console.log('watchers', tot, 'manual', man);
for (const r of rows) console.log(r.join(' | '));
