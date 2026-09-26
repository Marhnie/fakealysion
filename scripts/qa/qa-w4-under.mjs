// w4 recheck2, official Q&A 2892/2893 (BT17-098), family 1247/1712/4958/6497: a lone card has no "겹쳐져 있는 카드" -> the effect can't use it.
// Run: node scripts/qa/qa-w4-under.mjs < /dev/null
import { S, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const anyTamer = () => Object.values(S.CARDS).find((c) => c.category === "tamer" && !(c.inheritedKo || "").includes("자신의 턴")).id;
const T = '「펄스몬」이 기술되어 있는 Lv.4 이상의 자신의 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 시큐리티 위에 놓는 것으로, 메모리 +2.';
const PULSE = 'BT16-074'; // Lv.5, 「펄스몬」 in text
scenario('2892', 'BT17-098 Delay: Pulsemon digimon with NO evolution sources cannot be placed on the security (no memory, stays)', async () => {
  const w = W({ p1: { battle: [{ id: PULSE, src: [] }] }, p2: {}, memory: 0 });
  await w.exec('p1', T, 'BT17-098', null, { tags: ['메인'] });
  w.eq(w.st.memory, 0, 'no memory');
  w.eq(w.pl('p1').battle.map(s => s.cardId), [PULSE], 'digimon stays');
  w.eq(w.pl('p1').security.length, 5, 'security unchanged');
  return w;
});
scenario('2893', 'BT17-098 Delay: only a tamer card under the digimon -> the top card goes to security, the tamer stays as a tamer', async () => {
  const tam = anyTamer();
  const w = W({ p1: { battle: [{ id: PULSE, src: [tam] }] }, p2: {}, memory: 0 });
  await w.exec('p1', T, 'BT17-098', null, { tags: ['메인'] });
  w.eq(w.st.memory, 2, 'memory +2');
  w.eq(w.pl('p1').battle.map(s => s.cardId), [tam], 'tamer remains in the battle area');
  w.eq(w.pl('p1').security.length, 6, 'top card added to security');
  w.eq(w.pl('p1').security[0], PULSE, 'on top');
  return w;
});
scenario('2645b', 'BT16-056 On Play: an opp Vaccine digimon with no sources is not a valid pick (lone card is not "overlaid")', async () => {
  const vac = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('백신종') && !c.effectKo && !c.inheritedKo);
  const w = W({ p1: { battle: [{ id: 'BT16-056' }] }, p2: { battle: [{ id: vac.id, src: [] }] } });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, 1, 'stays');
  w.eq(w.pl('p2').security.length, 5, 'security unchanged');
  return w;
});
await run('w4-under');
