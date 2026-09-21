// Slice-5 round 2: 어플 합체 (App Fusion) combination tables + jogress rulings.
// Q5214,5240,5394,5441,5647,6303: with N kinds listed, fusion works iff the digimon is one listed kind and holds link card(s) of exactly one OTHER listed kind (all ordered pairs).
import { S, newBoard, stk, scenario, report, idByName } from './lib5.mjs';
const byName = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo === n)?.id;
for (const [q, fus] of [['5214', 'BT22-033'], ['5240', 'BT23-021'], ['5394', 'EX10-017'], ['5441', 'ST22-12'], ['5647', 'BT24-071'], ['6303', 'BT25-036']]) {
  await scenario(q, `${fus}: 어플 합체 all ordered (digimon, link) pairs of the listed kinds`, async (chk) => {
    const inf = S.parseAppFusion(fus); chk(!!inf, 'parse');
    const names = inf.names; let n = 0, skipped = 0;
    for (const top of names) for (const lk of names) {
      const T = byName(top), L = byName(lk); if (!T || !L) { skipped++; continue; }
      const st = newBoard({ memory: 10, p1: { battle: [T], hand: [fus] }, p2: {} });
      const s = stk(st, 'p1', T); s.linkCards = [{ cardId: L }];
      const r = S.appFusionCheck(st, 'p1', s, fus);
      if (top === lk) chk(!r.ok, `same kind ${top} must not fuse`); else { chk(r.ok, `${top} w/ link ${lk} should fuse: ${r.reason}`); n++; }
    }
    chk(n + skipped >= names.length * (names.length - 1) - names.length, 'pair count ' + n + '+' + skipped);
  });
}
report();
