// slice2 round 2 (part n): jogress option cards (BT16-091/092/097) and the BT16 tamers whose 「~하는 것으로」 cost gates the jogress bonus. Own paraphrase.
import { runScenarios, FILL, S, E, C, fillOf, byName, lvl } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED4 = 'ST1-05', MEGA = 'ST1-09';
// [option, play-target names, jogress card, materials, Q play-no-jogress, Q jogress-no-play, Q must-attack]
const OPT = [['BT16-091', ['가트몬', '아큐라몬'], 'P-172', ['ST1-09', 'ST4-09'], 2689, 2690, 2691], ['BT16-092', ['스팅몬', '엑스브이몬'], 'ST9-11', ['ST4-06', 'ST2-05'], 2692, 2693, null], ['BT16-097', ['엔젤몬', '황금아르마몬'], 'BT16-063', ['ST5-06', 'ST3-05'], 2694, 2695, null]];
for (const [opt, names, J, mats, qPlay, qJog, qAtk] of OPT) {
  const tgt = names.map(n => byName(n, c => c.category === 'digimon')).find(Boolean);
  T(qPlay, opt, 'play the digimon and decline the jogress', async (W) => { W.hand('p1', [tgt, J]); for (const m of mats) W.put('p1', m); W.picks.pickFromZoneIndex = (o) => o.eligibleIdxs?.[0]; W.picks.confirmEffect = false; await W.useOption('p1', opt); }, (W) => [['target digimon entered', W.st.players.p1.battle.some(x => x.cardId === tgt)], ['no jogress', !W.st.players.p1.battle.some(x => x.cardId === J)]]);
  T(qJog, opt, 'jogress the two digimon already in play without playing one', async (W) => { W.hand('p1', [J]); for (const m of mats) W.put('p1', m); W.picks.confirmEffect = true; await W.useOption('p1', opt); }, (W) => [['jogress result in play', W.st.players.p1.battle.some(x => x.cardId === J)]]);
}
T(2691, 'BT16-091', 'jogress digimon: security attack +1 only together with the attack (declining the attack gives neither)', async (W) => { W.hand('p1', ['P-172']); for (const m of ['ST1-09', 'ST4-09']) W.put('p1', m); W.picks.confirmEffect = (o) => (/어택/.test(String(o.prompt)) ? false : true); await W.useOption('p1', 'BT16-091'); W.f = W.st.players.p1.battle.find(x => x.cardId === 'P-172'); }, (W) => [['fused', !!W.f], ['no security attack +1 keyword', !!W.f && !/시큐리티s*어택/.test(JSON.stringify(W.f.keywords || []))]]);
// BT16 tamers: the memory +1 cost (resting the tamer) gates the jogress follow-up
const TAM = [[2676, 'BT16-084', 'P-172', ['ST1-09', 'ST4-09']], [2678, 'BT16-085', 'ST9-11', ['ST4-06', 'ST2-05']], [2682, 'BT16-088', 'BT16-063', ['ST5-06', 'ST3-05']]];
for (const [q, tam, J, mats] of TAM) {
  for (const [pay, label] of [[false, 'tamer not rested -> nothing after the "~ことで" cost happens'], [true, 'tamer rested -> memory +1 and the follow-up applies']]) {
    T(q, tam, label, async (W) => { W.put('p1', tam); W.o = W.put('p2', ['BT9-067', RED4, RED4, RED4, RED4]); W.d0 = W.dp('p2', W.o); W.n0 = W.o.sources.length; W.top0 = W.o.cardId; const a = W.put('p1', mats[0]), b = W.put('p1', mats[1]); W.hand('p1', [J]); W.picks.confirmEffect = pay; W.picks.pickStack = (o) => o.uids?.[0]; W.m0 = W.mem(); S.fuseStacks(W.st, 'p1', a.uid, b.uid, J, 0, 'hand'); await W.drain(); },
      (W) => { const follow = W.dp('p2', W.o) < W.d0 || W.o.sources.length < W.n0 || W.o.cardId !== W.top0; const memUp = W.mem() > W.m0; return [['follow-up effect', follow === pay], ['memory bonus', memUp === pay]]; });
  }
}
await runScenarios(L, 'r2-n');
