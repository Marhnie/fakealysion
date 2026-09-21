// Slice-5 official Q&A: "as many as possible" selections (no partial picking): EX10-061 (Q5785/5786 sources with different names), AD1-003 (Q6053/6054), EX4-060 (Q6031/6032).
// Expected (own words): every eligible distinct-name card from the sources is played (one of each) - you cannot stop at one when two qualify; with only one qualifying card, that one is played.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, nm, runOn, zoneNames, idByName } from './lib5.mjs';
const kings = []; for (const c of Object.values(S.CARDS)) if (c.category === 'digimon' && (c.types || []).includes('어둠의 4천왕') && c.level <= 6 && c.cost != null && !kings.some(k => k.nameKo === c.nameKo)) kings.push(c);
console.log('kings', kings.map(k => k.id + ':' + k.nameKo).join(' '));
for (const [srcs, want, q] of [[[kings[0].id, kings[1].id], 2, '5786'], [[kings[0].id], 1, '5785'], [[kings[0].id, kings[0].id], 1, '5786-same-name']]) {
  await scenario(q, `EX10-061: sources ${srcs.map(nm).join('+')} -> ${want} played`, async (chk) => {
    const st = newBoard({ p1: { battle: [{ id: 'EX10-061', src: [...srcs, F3[0]] }] }, p2: { battle: [] } });
    await runOn(st, 'p1', 'EX10-061', 'digivolve', { answer: (k, o) => (k === 'pickSourcesMulti' ? [...Array(1).keys()] : undefined) });
    const n = st.players.p1.battle.length - 1;
    chk(n === want, `played ${n}, want ${want}: ` + zoneNames(st, 'p1', 'battle'));
  });
}
await scenario('5786/turn-end', 'EX10-061: the digimon played from the sources are deleted at turn end; all 4-kings digimon got 속공', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: 'EX10-061', src: [kings[0].id, kings[1].id] }] }, p2: { battle: [F3[0]] }, memory: 3 });
  await runOn(st, 'p1', 'EX10-061', 'digivolve', {});
  const pl = st.players.p1; chk(pl.battle.length === 3, 'two played'); chk(pl.battle.filter(x => x.cardId !== 'EX10-061').every(x => S.hasKeyword(x, '속공')), '속공 for the played 4-kings digimon');
  const ch = mkChoose(st); E.endTurn(st, false); let g = 0; while (st.turnEnding && g++ < 10) { await drain(st, ch); E.settleTurnEnd(st); }
  chk(st.players.p1.battle.length === 1, 'played digimon deleted at turn end: ' + zoneNames(st, 'p1', 'battle'));
});
const cres = idByName('크레스가루몬'), blitz = idByName('블리츠그레이몬');
for (const [srcs, want, q] of [[[cres, blitz], 2, '6031'], [[blitz], 1, '6032']]) {
  await scenario(q, `EX4-060 leaves by an opp effect: sources ${srcs.map(nm).join('+')} -> ${want} played (all of them), then EX4-060 goes under the security`, async (chk) => {
    const st = newBoard({ p1: { battle: [{ id: 'EX4-060', src: srcs }] }, p2: { battle: [F3[0]] }, active: 'p2' });
    const s = stk(st, 'p1', 'EX4-060'); const sec0 = st.players.p1.security.length;
    st._fxSrc = { player: 'p2', category: 'digimon', cardId: F3[0] }; S.deleteStack(st, 'p1', s.uid, 'trash', 'effect'); st._fxSrc = null;
    await drain(st, mkChoose(st));
    chk(st.players.p1.battle.length === want, `played ${st.players.p1.battle.length} want ${want}`);
    chk(st.players.p1.security.length === sec0 + 1, 'EX4-060 placed under security');
  });
}
report();
