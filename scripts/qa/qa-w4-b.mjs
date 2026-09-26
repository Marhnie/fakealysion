// w4 recheck2 (rulings idx 2001-2667) batch B: BT17 cards. Run: node scripts/qa/qa-w4-b.mjs < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const anyTamer = () => Object.values(S.CARDS).find((c) => c.category === "tamer" && !(c.inheritedKo || "").includes("자신의 턴")).id;
const cards = Object.values(S.CARDS);
const tamerOf = (pred) => cards.find(c => c.category === 'tamer' && pred(c));

scenario('2129', 'BT17-030: no 「레온 알렉산더」 in hand -> nothing after "것으로" (no recover even with <=2 security)', async () => {
  const w = W({ p1: { security: [plain(3, 0)], hand: [plain(3, 3)], battle: [{ id: 'BT17-030', src: [plain(3, 1)] }] }, p2: {}, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '자신의 메인 페이즈 개시 시');
  w.eq(w.pl('p1').security.length, 1, 'no recovery');
  w.eq(w.st.memory, 3, 'no memory');
  return w;
});
scenario('2129b', 'BT17-030: with 레온 in hand and 2 security: places, no memory (<3), recovers', async () => {
  const leon = 'BT16-086';
  const w = W({ p1: { security: [plain(3, 0), plain(3, 0)], hand: [leon], battle: [{ id: 'BT17-030', src: [plain(3, 1)] }] }, p2: {}, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '자신의 메인 페이즈 개시 시');
  w.eq(w.pl('p1').security.length, 3, 'recovered');
  w.eq(w.st.memory, 3, 'no memory');
  return w;
});
scenario('2128', 'BT17-028 【소멸 시】: no trash cards to return -> still may play tamer from hand', async () => {
  const t = anyTamer();
  const w = W({ p1: { hand: [t], trash: [], battle: [{ id: 'BT17-028' }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.ok(w.pl('p1').battle.some(s => s.cardId === t), 'tamer played');
  return w;
});
scenario('2146', 'BT17-040 end of turn with security 3: -6000 AND recover, then attack allowed', async () => {
  const w = W({ p1: { security: [plain(3, 0), plain(3, 0), plain(3, 0)], battle: [{ id: 'BT17-040' }, { id: plain(3, 2) }] }, p2: { battle: [plain(3, 1)] } });
  await w.run('p1', w.p1.stacks[0].uid, '자신의 턴 종료 시');
  w.eq(w.pl('p1').security.length, 4, 'recovered');
  w.ok(w.pl('p2').battle.length === 0 || w.dp('p2', w.pl('p2').battle[0]) < C(w.pl('p2').battle[0].cardId).dp, 'opp DP reduced (or deleted by DP<=0)');
  w.ok(w.prompts.some(p => p.k === 'pickStack' && /어택/.test(p.o.prompt || '')) || (w.attackReqs || []).length, 'attack offered after recover (security 4)');
  return w;
});
scenario('2144', 'BT17-040 진화 시 gives 《S 어택 -1》 to opp digimon that appear later this turn', async () => {
  const w = W({ p1: { battle: [{ id: 'BT17-040', src: ['BT16-086'] }] }, p2: { battle: [plain(3, 1)] } });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  const late = w.mk('p2', plain(3, 4));
  w.eq(S.securityAttackBonus(late), -1, 'late digimon has S-attack -1');
  return w;
});
scenario('2155', 'BT17-050 main: without Lv5+ own digimon cannot pay 4 (nothing happens, memory unchanged)', async () => {
  const w = W({ p1: { hand: [], battle: [{ id: 'BT17-050' }] }, p2: { battle: [plain(3, 1)] }, memory: 5 });
  await w.run('p1', w.p1.stacks[0].uid, '메인');
  w.eq(w.st.memory, 5, 'no cost paid');
  return w;
});
scenario('2159', 'BT17-051: Lv.- opp digimon cannot be picked for the "Lv total 4" delete', async () => {
  const noLv = cards.find(c => c.category === 'digimon' && c.level == null && c.dp);
  const w = W({ p1: { trash: [], battle: [{ id: 'BT17-051' }] }, p2: {} });
  if (noLv) w.mk('p2', noLv.id);
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.pl('p2').battle.length, noLv ? 1 : 0, 'Lv.- digimon survives (' + (noLv && noLv.id) + ')');
  return w;
});
scenario('2152', 'BT17-048 【소멸 시】: own top card counts toward 4 argomon in trash', async () => {
  const lv6 = cards.find(c => c.category === 'digimon' && c.level === 6 && c.nameKo === '아르고몬');
  const w = W({ p1: { hand: [lv6.id], trash: ['BT17-051','BT17-051'], battle: [{ id: 'BT17-048', src: ['BT17-051', 'BT17-051'] }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'battle'); await w.drain();
  w.ok(w.pl('p1').battle.some(s => s.cardId === lv6.id), 'lv6 argomon played: ' + lv6.id);
  return w;
});
scenario('2201', 'BT17-077: two white Lv.7 returned -> memory only +3', async () => {
  const w7 = cards.filter(c => c.category === 'digimon' && c.level === 7 && (c.colors || []).includes('white')).slice(0, 2).map(c => c.id);
  const w = W({ p1: { trash: [...w7], battle: [{ id: 'BT17-077' }] }, p2: {}, memory: 0 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(w.st.memory, 3, 'memory +3 not +6');
  w.eq(w.pl('p1').trash.length, 0, 'trash returned');
  return w;
});
scenario('2206', 'BT17-081: greymon + garurumon both present -> +2 memory', async () => {
  const gr = cards.find(c => c.category === 'digimon' && c.nameKo.includes('그레이몬') && c.level === 4);
  const ga = cards.find(c => c.category === 'digimon' && c.nameKo.includes('가루몬') && c.level === 4);
  const w = W({ p1: { battle: [{ id: 'BT17-081' }, { id: gr.id }, { id: ga.id }] }, p2: {}, active: 'p2', memory: 0 });
  const t = w.p1.stacks[0];
  const pf = w.p1.stacks[1];
  S.emitGameEvent(w.st, 'digivolve', { owner: 'p1', stack: pf, cause: null }); await w.drain();
  w.eq(w.st.memory, 2, 'memory +2 (p1 side)');
  w.eq(t.suspended, true, 'tamer rested');
  return w;
});
const eosLow = cards.find(c => c.category === 'digimon' && c.nameKo === '에오스몬' && c.level <= 4 && c.dp);
for (const [q, variant, expectDeleted] of [['2197', 'dpUp', true], ['2198', 'left', false], ['2198b', 'normal', false]]) {
  scenario(q, 'BT17-076 【서로의 턴】: DP of the freshly played 에오스몬 is read when the effect resolves (' + variant + ') -> delete opp digimon ' + (expectDeleted ? 'happens' : 'does NOT happen (subject left the battle area)'), async () => {
    const opp = plain(4, 0); // DP 5000 > printed 4000; only a +1000 buff (DP 5000) reaches it
    const w = W({ p1: { hand: [eosLow.id], battle: [{ id: 'BT17-076' }] }, p2: { battle: [{ id: opp }, { id: plain(5, 0) }] }, memory: 10 });
    const s = S.playDigimonFresh(w.st, 'p1', 0);
    if (variant === 'left') { const b = w.st.players.p1.battle; b.splice(b.indexOf(s), 1); }
    if (variant === 'dpUp') s.tempDP = 1000;
    await w.drain();
    const left = w.pl('p2').battle.some(x => x.cardId === opp);
    w.eq(!left, expectDeleted, 'opp DP<=… digimon deleted? ');
    return w;
  });
}
await run('w4-b');
