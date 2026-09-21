// Slice-6 round 2, part D: counter limit (G123), 【진화 시】 suppression (G161/163/164), all-or-nothing "~하는 것으로" costs (G77,G283).
// Run: node scripts/qa/qa-slice6-r2-d.mjs [G#...] < /dev/null
import * as fs from 'fs';
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const G = JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json', 'utf8'));
const by = (n, cat = 'digimon') => Object.values(S.CARDS).filter((c) => c.nameKo === n && c.category === cat);

// ---- G123: only one 【카운터】 effect per attack ----
scenario('G123', 'after one 【카운터】 effect in an attack no other 【카운터】 can be activated (11-3-2)', async () => {
  const w = W({ p1: { battle: [plain(4, 0)] }, p2: { battle: [plain(4, 1)], hand: ['EX12-017', 'EX12-017'] } });
  const pa = { attacker: 'p1', opp: 'p2', uid: w.p1.stacks[0].uid, targetKind: 'player' };
  w.st.attackCtx = pa;
  const opts = S.findCounterOptions(w.st, 'p2');
  w.ok(opts.length >= 0, 'findCounterOptions ran');
  const opt = { zone: 'hand', cardId: 'EX12-017', handIdx: 0 };
  const r1 = S.activateCounter(w.st, 'p2', opt, pa); const r2 = S.activateCounter(w.st, 'p2', opt, pa);
  w.eq([r1.ok, r2.ok], [true, false], 'first counter ok, second refused');
  return w;
});
// ---- G161/G163/G164: 「【진화 시】 효과는 발휘하지 않는다」: own trigger, borrowed resolution and the cost part are all off ----
scenario('G161', 'suppressed 【진화 시】: the digimon\'s own evolve trigger does not resolve', async () => {
  const w = W({ p1: { battle: [{ id: 'EX12-064' }], hand: [] }, p2: {}, memory: 10 });
  const s = w.p1.stacks[0]; s.noEvoTrigUntil = w.st.turnNumber;
  const n0 = w.st.pending.length; S.queueTriggersForStack(w.st, 'p1', s, 'digivolve'); await w.drain();
  w.eq((w.fired || []).filter((f) => f.tags.includes('진화 시')).length, 0, 'no 【진화 시】 pending');
  return w;
});
for (const g of ['G163', 'G164']) scenario(g, 'EX12-064 borrowing 【진화 시】 of a suppressed digimon: nothing resolves and no cost is even asked', async () => {
  const w = W({ p1: { battle: ['EX12-064'] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
  const s = w.p1.stacks[0]; s.noEvoTrigUntil = w.st.turnNumber;
  const sg = S.parseEffectSegments(C('EX12-064').effectKo).segments.find((x) => x.tags.includes('서로의 턴'));
  await w.exec('p1', sg.body, 'EX12-064', s.uid, { tags: sg.tags });
  w.eq(w.pl('p2').battle.length, 1, 'opponent digimon untouched'); w.eq(w.prompts.length, 0, 'no prompts');
  return w;
});
// ---- G77: 「~하는 것으로」 needs the whole cost: only one of the two specified cards -> nothing happens ----
scenario('G77', 'BT25-096: only one of 가오가몬/마하가오가몬 in trash -> no evolution', async () => {
  const gaomon = by('가오몬')[0], gaoga = by('가오가몬')[0], mahaga = by('마하가오가몬')[0], mira = by('미라쥬가오가몬')[0];
  const go = async (trash) => { const w = W({ p1: { battle: [{ id: gaomon.id }], hand: ['BT25-096', mira.id], trash }, p2: {}, memory: 10 }); await w.useOption('p1', 'BT25-096'); return w; };
  const full = await go([gaoga.id, mahaga.id]); full.eq(full.pl('p1').battle[0].cardId, mira.id, 'both -> evolves');
  for (const one of [[gaoga.id], [mahaga.id]]) { const w = await go(one); full.eq(w.pl('p1').battle[0].cardId, gaomon.id, 'only one -> stays'); full.eq(w.pl('p1').trash.some((x) => one.includes(x)), true, 'card not moved'); }
  return full;
});
scenario('G77', 'BT26-098: only one of 해바라기몬/라일라몬 -> no evolution', async () => {
  const lara = by('라라몬')[0], hae = by('해바라기몬')[0], lai = by('라일라몬')[0], rose = by('로제몬')[0];
  const go = async (trash) => { const w = W({ p1: { battle: [{ id: lara.id }], hand: ['BT26-098', rose.id], trash }, p2: {}, memory: 10 }); await w.useOption('p1', 'BT26-098'); return w; };
  const full = await go([hae.id, lai.id]); full.eq(full.pl('p1').battle[0].cardId, rose.id, 'both -> evolves');
  const one = await go([hae.id]); full.eq(one.pl('p1').battle[0].cardId, lara.id, 'only one -> stays');
  return full;
});
await run('slice6-r2-d');
