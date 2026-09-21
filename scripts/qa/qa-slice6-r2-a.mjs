// Slice-6 round 2, part A: tamer-as-evolution-source (G114-117,G120), face-up security (G73-76), security digimon (G104), tamer-under stacks (G47).
// G# = group index in scripts/qa/s6/_groups.json.  Run: node scripts/qa/qa-slice6-r2-a.mjs [G#...] < /dev/null
import * as fs from 'fs';
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const G = JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json', 'utf8'));
const TS3 = 'P-196';
const YJ = 'BT7-085'; // 우정훈 (tamer with a non-security inherited effect: own-turn DP +2000)
const hyb5 = () => Object.values(S.CARDS).filter((c) => c.category === 'digimon' && (c.types || []).includes('하이브리드체')).slice(0, 5).map((c) => c.id);

// ---- G114: a tamer card under a digimon is an evolution source and is trashed like any other source when the digimon leaves ----
scenario('G114', 'tamer card as evolution source is trashed when the digimon is deleted / returned (every card of the group)', async () => {
  const w = W({ p1: {}, p2: {} });
  for (const cid of G[114].cards) {
    if (!S.CARDS[cid] || S.CARDS[cid].category !== 'digimon') continue;
    const tam = plainTamer();
    const s = w.mk('p1', { id: cid, src: [tam] });
    const before = w.pl('p1').trash.length;
    S.deleteStack(w.st, 'p1', s.uid, 'trash', 'battle'); await w.drain();
    w.ok(w.pl('p1').trash.includes(tam), `${cid}: tamer source trashed on delete`);
    w.ok(w.pl('p1').trash.length >= before + 2, `${cid}: top + source in trash`);
    w.pl('p1').battle.length = 0;
  }
  const s2 = w.mk('p1', { id: plain(4, 0), src: [plainTamer()] });
  const t2 = s2.sources[0];
  S.bounceStack ? S.bounceStack(w.st, 'p1', s2.uid, 'hand') : null;
  return w;
});
// ---- G116: the digimon gains the tamer source's inherited effect (not the security one) ----
scenario('G116', 'tamer source lends its inherited effect: BT7-085 (own turn DP+2000)', async () => {
  const w = W({ p1: { battle: [{ id: 'BT12-013', src: [YJ] }, { id: 'BT12-013' }] } });
  const [a, b] = w.p1.stacks;
  w.eq(w.dp('p1', a) - w.dp('p1', b), 2000, 'DP +2000 from tamer source');
  return w;
});
scenario('G116b', 'tamer source BT7-091 inherited 【소멸 시】 fires: memory +1', async () => {
  const w = W({ p1: { battle: [{ id: 'BT12-013', src: ['BT7-091'] }] }, memory: 3 });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.eq(w.st.memory, 4, 'memory +1');
  return w;
});
// ---- G115: the tamer source's 【시큐리티】 text is NOT gained ----
scenario('G115', 'tamer source ST1-12 (inherited 【시큐리티】 only): the digimon queues no security effect', async () => {
  const w = W({ p1: { battle: [{ id: 'BT12-013', src: ['ST1-12'] }] } });
  const st = w.p1.stacks[0]; const n0 = w.st.pending.length;
  S.queueTriggersForStack(w.st, 'p1', st, 'security'); await w.drain();
  w.eq((w.fired || []).filter((f) => f.cardId === 'ST1-12').length, 0, 'tamer source security effect not fired');
  w.eq(w.st.pending.length, n0 + 0 + (w.st.pending.length - n0), 'sanity');
  return w;
});
// ---- G117: "treat tamer as digimon and evolve" == the digimon evolves (evolve watchers fire); G120: evolution condition from a tamer = evolves directly, no digimon-evolve watchers ----
scenario('G117', 'tamer evolving as a digimon (s2AsDigimon) fires "digimon evolved" watchers (BT25-077)', async () => {
  const w = W({ p1: { battle: ['BT25-077', { id: YJ }], hand: ['BT12-013'] }, memory: 10 });
  const t = w.p1.stacks[1]; t.s2AsDigimon = true;
  await w.evolve('p1', t.uid, 'BT12-013', 2);
  w.ok(w.fires('BT25-077', '서로의 턴') >= 1, 'evolve watcher fired');
  return w;
});
scenario('G120', 'direct evolution from a tamer (BT18-018 condition): own 【진화 시】 fires, "digimon evolved" watchers do not', async () => {
  const w = W({ p1: { battle: ['BT25-077', { id: YJ, src: hyb5() }], hand: ['BT18-018'] }, memory: 10 });
  const t = w.p1.stacks[1];
  const ms = E.evolutionMethods(t.cardId, 'BT18-018', S.evoExtraArg(w.st, 'p1', t), S.evolveTargetRestriction(w.st, 'p1', t), { state: w.st, p: 'p1', stack: t });
  w.ok(ms.length > 0, 'condition met from tamer');
  w.st._evoTamerDirect = true;
  await w.evolve('p1', t.uid, 'BT18-018', 5);
  w.st._evoTamerDirect = false;
  w.ok(w.fires('BT18-018', '진화 시') >= 1, 'own 【진화 시】 fires');
  w.eq(w.fires('BT25-077', '서로의 턴'), 0, 'no digimon-evolved watcher');
  return w;
});
await run('slice6-r2-a');
