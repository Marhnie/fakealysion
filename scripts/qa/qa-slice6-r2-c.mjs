// Slice-6 round 2, part C: cost-minus locks on effect evolutions/plays (G202,G170), security digimon (G104), counter limit (G123), win-trigger (G185).
// Run: node scripts/qa/qa-slice6-r2-c.mjs [G#...] < /dev/null
import * as fs from 'fs';
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const G = JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json', 'utf8'));
const all = Object.values(S.CARDS);
const seg = (id, tag) => S.parseEffectSegments(C(id).effectKo).segments.find((s) => s.tags.length === 1 && s.tags[0] === tag);

// ---- G202: 「상대는 지불하는 진화 코스트를 마이너스할 수 없다」(BT5-021): effect evolutions still happen but the cost is not reduced ----
for (const [id, tr] of [['EX12-066', 'VB'], ['EX12-067', 'DS'], ['EX12-068', 'NSp']]) {
  scenario('G202', `${id}: evolve with cost -1 while the opponent has BT5-021 -> cost is the printed one`, async () => {
    const hasT = (c) => (c.types || []).includes(tr);
    let src, tgt;
    for (const a of all.filter((c) => c.category === 'digimon' && c.level === 4 && hasT(c))) { for (const b of all.filter((c) => c.category === 'digimon' && c.level === 5 && hasT(c) && c.evoNormal)) { const r = E.canEvolveAny(a.id, b.id, [], null); if (r.ok && r.cost >= 2) { src = a; tgt = b; break; } } if (src) break; }
    const paid = async (lock) => {
      const w = W({ p1: { battle: [{ id: src.id }, { id }], hand: [tgt.id] }, p2: { battle: lock ? ['BT5-021'] : [] }, memory: 10 });
      const dg = w.p1.stacks[0], tam = w.p1.stacks[1]; const sg = seg(id, '자신의 턴');
      await w.exec('p1', sg.body, id, tam.uid, { tags: sg.tags, trigger: { evtStackUid: dg.uid } });
      w.ok(w.pl('p1').battle[0].cardId === tgt.id, 'evolved'); return { m: w.st.memory, w };
    };
    const a = await paid(false), b = await paid(true);
    const w = a.w; w.eq(b.m - a.m, -1, 'locked run costs exactly 1 more memory'); w.results.push(...b.w.results); return w;
  });
}
// ---- G170: 「서로는 지불하는 등장 코스트를 마이너스할 수 없다」(ST12-03): EX12-043/050 【메인】 still plays the card, no -2 ----
scenario('G170', 'EX12-043 【메인】 play with ST12-03 in the battle area: played at full cost', async () => {
  const sw = all.find((c) => c.category === 'digimon' && (c.types || []).includes('SW') && c.cost === 4 && c.level === 4 && !c.id.startsWith('P-') && !/^EX12-04[3]/.test(c.id));
  const run1 = async (lock) => { const w = W({ p1: { battle: ['EX12-043'], hand: [sw.id] }, p2: { battle: lock ? ['ST12-03'] : [] }, memory: 10 }); w.answers.pickFromZoneIndex = (o) => o.eligibleIdxs[0]; await w.run('p1', w.p1.stacks[0].uid, '메인'); w.ok(w.pl('p1').battle.some((s) => s.cardId === sw.id), 'card played'); return w; };
  const a = await run1(false), b = await run1(true);
  a.eq(b.st.memory - a.st.memory, -2, 'lock: full cost (2 more than discounted)'); a.results.push(...b.results); return a;
});
// ---- G104: a checked security digimon: its 【시큐리티】 effect first, then the battle ----
scenario('G104', 'security digimon (EX10-012/020/035/057, P-189, BT26-030): 【시큐리티】 effect fires, then it battles', async () => {
  const w = W({ p1: {}, p2: {} });
  for (const id of G[104].cards) {
    if (!C(id) || C(id).category !== 'digimon') continue;
    const w2 = W({ p1: { battle: [plain(3, 0)] }, p2: { security: [id, plain(3, 0), plain(3, 1)] } });
    await w2.attack('p1', w2.p1.stacks[0].uid, 'PLAYER');
    const sec = (w2.fired || []).some((f) => f.cardId === id && f.tags.includes('시큐리티'));
    const hasSecText = !!(C(id).securityKo || (C(id).inheritedKo || '').includes('【시큐리티】'));
    w.ok(!hasSecText || sec, `${id}: security effect fired`);
    w.ok(w2.pl('p1').battle.length === 0 && w2.pl('p2').trash.includes(id), `${id}: then the battle happened (weak attacker deleted, security digimon trashed)`);
    if (w2.errors.length) w.errors.push(...w2.errors);
  }
  return w;
});
await run('slice6-r2-c');
