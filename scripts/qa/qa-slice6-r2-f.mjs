// Slice-6 round 2, part F: 「レスト + アクティブにならない」 may target a different card than the rested one (G196, G192, G268).
// Run: node scripts/qa/qa-slice6-r2-f.mjs [G#...] < /dev/null
import * as fs from 'fs';
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const G = JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json', 'utf8'));
for (const id of G[196].cards) {
  scenario('G196', `${id}: rest one opposing card, give "does not become active" to a DIFFERENT one`, async () => {
    const w = W({ p1: { battle: [id] }, p2: { battle: [plain(3, 0), plain(3, 1)] }, memory: 10 });
    let n = 0;
    w.answers.pickStack = (o) => o.uids[Math.min(n++, o.uids.length - 1)];
    w.answers.pickStackAnySide = (o) => { const e = o.entries.filter((x) => x.player === 'p2'); const r = e[Math.min(n++, e.length - 1)]; return { player: r.player, uid: r.uid }; };
    await w.run('p1', w.p1.stacks[0].uid, '등장 시');
    const [a, b] = w.pl('p2').battle;
    w.ok(a.suspended && !b.suspended, 'first rested, second not rested');
    w.ok(b.skipNextUnsuspend || b.cannotUnsuspendUntil != null, 'second (a different card) got the no-activate mark');
    return w;
  });
}
// ---- G192 / G268 / G267: 「레스트시키고, 상대의 카드 N마리는 액티브가 되지 않는다」 may pick different cards; BT26-050 can rest cards of either side ----
const noAct = (s) => s.skipNextUnsuspend || s.cannotUnsuspendUntil != null;
for (const id of ['EX12-052', 'BT26-032']) {
  scenario('G192', `${id} (option side 【메인】): the no-activate targets may be different from the rested ones`, async () => {
    const seg = S.parseEffectSegments(C(id).optionKo || C(id).inheritedKo).segments.find((s) => s.tags.includes('메인'));
    const w = W({ p1: { battle: [plain(3, 2)] }, p2: { battle: [plain(3, 0), plain(3, 1), plain(3, 3), plain(3, 4)] }, memory: 10 });
    let n = 0;
    w.answers.pickStack = (o) => { const k = n++; const late = k >= (id === 'EX12-052' ? 3 : 2); return late ? o.uids[o.uids.length - 1] : o.uids[0]; };
    await w.exec('p1', seg.body, id, null, { tags: seg.tags });
    const b = w.pl('p2').battle;
    w.ok(b[0].suspended && b[1].suspended, 'two rested'); w.ok(noAct(b[3]), 'a card that was NOT rested received the no-activate mark');
    return w;
  });
}
scenario('G268', 'BT26-050 【진화 시】: after resting, the no-activate mark goes to other cards; rest may hit either side (G267)', async () => {
  const w = W({ p1: { battle: ['BT26-050', plain(3, 2)] }, p2: { battle: [plain(3, 0), plain(3, 1)] }, memory: 10 });
  const sides = [];
  w.answers.pickStackAnySide = (o) => { sides.push([...new Set(o.entries.map((e) => e.player))].sort().join('')); const e = o.entries[0]; return { player: e.player, uid: e.uid }; };
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.ok(sides.some((s) => s === 'p1p2'), 'rest candidates include both sides (G267)');
  const rested = [...w.pl('p1').battle, ...w.pl('p2').battle].filter((s) => s.suspended);
  w.eq(rested.length, 2, 'two rested'); w.ok(w.pl('p2').battle.some(noAct), 'opponent cards marked no-activate');
  return w;
});
scenario('G267', 'BT26-050 【진화 시】 can rest own or opponent digimon/tamers (candidates of both sides offered)', async () => {
  const w = W({ p1: { battle: ['BT26-050', plain(3, 2)] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
  const sides = [];
  w.answers.pickStackAnySide = (o) => { sides.push([...new Set(o.entries.map((e) => e.player))].sort().join('')); const e = o.entries[0]; return { player: e.player, uid: e.uid }; };
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.ok(sides.includes('p1p2'), 'both sides offered');
  return w;
});
scenario('G264', 'BT26-047 【자신의 메인 페이즈 개시 시】: the digimon to rest may be an own or an opponent card', async () => {
  const seg = S.parseEffectSegments(C('BT26-047').effectKo).segments.find((s) => s.tags.includes('자신의 메인 페이즈 개시 시'));
  const w = W({ p1: { battle: ['BT26-047', plain(3, 2)] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
  const sides = [];
  w.answers.pickStackAnySide = (o) => { sides.push([...new Set(o.entries.map((e) => e.player))].sort().join('')); const e = o.entries[0]; return { player: e.player, uid: e.uid }; };
  await w.exec('p1', seg.body, 'BT26-047', w.p1.stacks[0].uid, { tags: seg.tags });
  w.ok(sides.includes('p1p2'), 'both sides offered'); return w;
});
await run('slice6-r2-f');
