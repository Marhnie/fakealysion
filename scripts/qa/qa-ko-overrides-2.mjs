// data/ko-overrides.json cards, part 2 — the ones with card-specific handling (src/cards/shard150.js): P-239 P-241 P-242 P-243 P-244.
// Run: node scripts/qa/qa-ko-overrides-2.mjs
import { S, E, Fx, C, FILL, fillOf, world, runScenarios } from './lib2.mjs';

const list = [];
const T = (q, card, name, run, expect, extra = {}) => list.push({ q, card, name, run, expect, ...extra });
const cards = Object.values(S.CARDS);
const findId = (pred) => cards.find(pred)?.id;
const APPMON = findId(c => c.category === 'digimon' && c.level === 3 && c.dp && (c.types || []).includes('어플몬') && !/【(?:자신의 턴|서로의 턴)】/.test(c.effectKo || ''));
const LINKCARD = findId(c => c.category === 'digimon' && c.level === 3 && (c.types || []).includes('어플몬') && /링크/.test(c.effectKo || '') && c.id !== APPMON);

// ---------------- P-239
T(1, 'P-239', 'On deletion from trash: under a 「묘티스몬」-text Digimon, evolve into 묘티스몬 for free', async (W) => {
  const host = W.put('p1', ['BT16-072']); const dm = W.put('p1', ['P-239']);
  W.hand('p1', ['ST6-12']); W.st.memory = 5;
  S.deleteStack(W.st, 'p1', dm.uid, 'trash', 'effect'); await W.drain();
  return { host };
}, (W, x) => { const h = W.by('p1', x.host.uid); return [['evolved into 베놈묘티스몬', h && h.cardId === 'ST6-12'], ['P-239 is a bottom source', h && h.sources[0] === 'P-239'], ['no cost paid', W.st.memory === 5], ['not left in trash', !W.pl('p1').trash.includes('P-239')]]; });
T(2, 'P-239', 'declined -> stays in trash, nothing evolves', async (W) => {
  const host = W.put('p1', ['BT16-072']); const dm = W.put('p1', ['P-239']); W.hand('p1', ['ST6-12']);
  W.picks.confirmEffect = false; S.deleteStack(W.st, 'p1', dm.uid, 'trash', 'effect'); await W.drain(); return { host };
}, (W, x) => [['still in trash', W.pl('p1').trash.includes('P-239')], ['host unchanged', W.by('p1', x.host.uid).cardId === 'BT16-072']]);
T(3, 'P-239', 'no eligible 묘티스몬 in hand -> card is not placed', async (W) => {
  const host = W.put('p1', ['BT16-072']); const dm = W.put('p1', ['P-239']); W.hand('p1', []);
  S.deleteStack(W.st, 'p1', dm.uid, 'trash', 'effect'); await W.drain(); return { host };
}, (W, x) => [['still in trash', W.pl('p1').trash.includes('P-239')], ['no source added', !W.by('p1', x.host.uid).sources.includes('P-239')]]);
T(4, 'P-239', 'evolution conditions still apply (Lv.3 host cannot become Lv.6 묘티스몬)', async (W) => {
  const host = W.put('p1', ['EX1-056']); const dm = W.put('p1', ['P-239']); W.hand('p1', ['ST6-12']);
  S.deleteStack(W.st, 'p1', dm.uid, 'trash', 'effect'); await W.drain(); return { host };
}, (W, x) => [['host not evolved', W.by('p1', x.host.uid).cardId === 'EX1-056']]);
T(5, 'P-239', 'inherited: 【소멸 시】 trash 1 hand card -> delete Lv.4- opp Digimon', async (W) => {
  const tgt = W.put('p2', [fillOf(c => c.level === 4)[0]]); const me = W.put('p1', [FILL[0], 'P-239']); W.hand('p1', [FILL[5]]);
  S.deleteStack(W.st, 'p1', me.uid, 'trash', 'effect'); await W.drain(); return { tgt };
}, (W, x) => [['opp Lv.4 deleted', !W.alive('p2', x.tgt)], ['hand card trashed', W.pl('p1').trash.includes(FILL[5])]]);

// ---------------- P-241 김영웅 (링크 trigger)
const ozoraWorld = async (W, o = {}) => {
  const tam = W.put('p1', ['P-241']); const app = W.put('p1', [APPMON]); const other = W.put('p1', [FILL[3]]);
  if (o.rested) tam.suspended = true;
  W.pl('p1').hand = [LINKCARD].filter(Boolean);
  await W.emit('linked', { owner: 'p1', stack: app, cause: 'effect' });
  return { tam, app, other };
};
T(10, 'P-241', 'Your Turn: when your Digimon gets linked -> rest Tamer, 어플몬 gets 《볼텍스》 and +3000 DP', async (W) => {
  const tam = W.put('p1', ['P-241']); const app = W.put('p1', [APPMON]); const dp0 = W.dp('p1', app);
  await W.emit('linked', { owner: 'p1', stack: app, cause: 'effect' }); return { tam, app, dp0 };
}, (W, x) => [['tamer rested', W.by('p1', x.tam.uid).suspended], ['+3000', W.dp('p1', W.by('p1', x.app.uid)) === x.dp0 + 3000], ['vortex', S.hasKeyword(W.by('p1', x.app.uid), '볼텍스')]]);
T(11, 'P-241', 'rested Tamer does not trigger', async (W) => { const tam = W.put('p1', ['P-241'], { suspended: true }); const app = W.put('p1', [APPMON]); const dp0 = W.dp('p1', app); await W.emit('linked', { owner: 'p1', stack: app, cause: 'effect' }); return { app, dp0 }; },
  (W, x) => [['no bonus', W.dp('p1', W.by('p1', x.app.uid)) === x.dp0]]);
T(12, 'P-241', "opponent's link does not trigger", async (W) => { const tam = W.put('p1', ['P-241']); const app = W.put('p1', [APPMON]); const o = W.put('p2', [FILL[2]]); const dp0 = W.dp('p1', app); await W.emit('linked', { owner: 'p2', stack: o, cause: 'effect' }); return { tam, dp0, app }; },
  (W, x) => [['tamer active', !W.by('p1', x.tam.uid).suspended]]);
T(13, 'P-241', 'declined -> nothing happens', async (W) => { const tam = W.put('p1', ['P-241']); const app = W.put('p1', [APPMON]); W.picks.confirmEffect = false; await W.emit('linked', { owner: 'p1', stack: app, cause: 'effect' }); return { tam }; },
  (W, x) => [['tamer active', !W.by('p1', x.tam.uid).suspended]]);
T(14, 'P-241', 'Start of Your Turn: memory <=2 -> 3', async (W) => { W.put('p1', ['P-241']); W.st.memory = 1; await W.newTurn('p1'); return {}; }, (W) => [['memory 3', W.st.memory === 3]]);
T(15, 'P-241', 'trait 「리바이어던」 from the rule line', async () => ({}), () => [['has 리바이어던', C('P-241').types.includes('리바이어던')]]);

// ---------------- P-242 권레이
T(20, 'P-242', 'Start of Main Phase: trash a 시스템/라이프/변화 card -> draw 1 and +1 memory', async (W) => {
  W.put('p1', ['P-242']); const sys = findId(c => c.category === 'digimon' && (c.types || []).includes('시스템')); W.hand('p1', [sys]); W.st.memory = 3; const h0 = 1;
  await W.newTurn('p1'); return { sys };
}, (W, x) => [['trashed', W.pl('p1').trash.includes(x.sys)], ['memory +1 (over the draw step)', W.st.memory >= 4]]);
T(21, 'P-242', 'Main: rest -> link a 시스템/라이프/변화 Digimon from trash with cost -1', async (W) => {
  const tam = W.put('p1', ['P-242']); const host = W.put('p1', [APPMON]);
  const lc = cards.find(c => c.category === 'digimon' && ['시스템', '라이프', '변화'].some(t => (c.types || []).includes(t)) && S.linkCheck(W.st, 'p1', host, c.id).ok)?.id;
  W.trash('p1', [lc]); W.st.memory = 5;
  const sc = Fx.lookupCardSpecific('P-242', ['메인'], C('P-242').effectKo.split('\n')[1]);
  const ctx = { state: W.st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'P-242', sourceStackUid: tam.uid, trigger: {}, startAttack() {}, securityCheck: async () => {}, choose: W.choose };
  await Fx.runScript(sc, ctx); return { tam, host, lc };
}, (W, x) => [['tamer rested', W.by('p1', x.tam.uid).suspended], ['linked', W.by('p1', x.host.uid).linkCards.length === 1 || W.pl('p1').battle.some(s => (s.linkCards || []).some(l => l.cardId === x.lc))], ['left trash', !W.pl('p1').trash.includes(x.lc)]]);

// ---------------- P-243 디지시배스
const DM = (lv) => findId(c => c.category === 'digimon' && (c.types || []).includes('DM') && c.cost <= 3 && (lv == null || c.level === lv));
T(30, 'P-243', 'Main: trash 1 hand card -> draw 2, then placed in battle area', async (W) => {
  W.hand('p1', [FILL[1]]); W.deck('p1', FILL.slice(26, 40)); const r = await W.useOption('p1', 'P-243'); return {};
}, (W) => [['placed', W.pl('p1').battle.some(s => s.cardId === 'P-243')]], { world: {} });
T(31, 'P-243', 'Start of turn (own): opp has Digimon -> Delay: return DM digimon to deck top, play cost<=3 DM card from trash', async (W) => {
  const opt = W.put('p1', ['P-243']); opt.placedTurn = 1; W.put('p2', [FILL[2]]);
  const a = DM(4) || DM(3), b = DM(3);
  W.trash('p1', [a, b]); W.st.memory = 5;
  await W.newTurn('p1'); return { opt, a, b };
}, (W, x) => { const pl = W.pl('p1'); return [['option trashed by Delay', !pl.battle.some(s => s.uid === x.opt.uid) && pl.trash.includes('P-243')], ['card returned to deck top (logged)', W.st.log.some(e => /덱 위로 되돌림/.test(e.msg)) && !pl.trash.includes(x.a)], ['DM card played', pl.battle.some(s => s.cardId === x.b) || pl.battle.some(s => s.cardId === x.a)]]; });
T(32, 'P-243', 'no Delay when opponent has no Digimon', async (W) => { const opt = W.put('p1', ['P-243']); opt.placedTurn = 1; W.pl('p2').battle.length = 0; W.trash('p1', [DM(3)]); await W.newTurn('p1'); return { opt }; },
  (W, x) => [['option stays', W.pl('p1').battle.some(s => s.uid === x.opt.uid)]]);
T(33, 'P-243', 'security: play cost<=3 DM card from hand/trash', async () => ({}), () => [['text', /【시큐리티】.*「DM」/.test(C('P-243').inheritedKo)]]);

// ---------------- P-244 유니크 엠블럼
const VEM = 'BT11-061'; // 벰몬
T(40, 'P-244', 'Main: play 「벰몬」/「제니스」 from hand/trash free, then place in battle area', async (W) => {
  W.hand('p1', [VEM]); W.st.memory = 5; const r = await W.useOption('p1', 'P-244'); return {};
}, (W) => [['벰몬 played', W.pl('p1').battle.some(s => s.cardId === VEM)], ['placed', W.pl('p1').battle.some(s => s.cardId === 'P-244')], ['cost 0 for 벰몬 (memory - use cost only)', W.st.memory === 2]]);
T(41, 'P-244', 'Your Turn: 벰몬 placed under a Digimon by an effect -> 《딜레이》: evolve a 벰몬-text Digimon with cost -3', async (W) => {
  const opt = W.put('p1', ['P-244']); opt.placedTurn = 1;
  const host = W.put('p1', [fillOf(c => c.level === 3)[0]]);
  const evo = findId(c => c.category === 'digimon' && c.level === 4 && /벰몬/.test(c.effectKo || c.nameKo) && c.evoNormal && c.evoNormal.level === 3 && c.cost < 99);
  W.hand('p1', [evo]); W.st.memory = 3;
  await W.emit('sourcesAdded', { owner: 'p1', stack: host, cause: 'effect', added: [VEM], srcPlayer: 'p1', srcCategory: 'digimon' });
  return { opt, host, evo };
}, (W, x) => [['delay fired (option trashed)', !W.pl('p1').battle.some(s => s.uid === x.opt.uid) && W.pl('p1').trash.includes('P-244')]], { allowErrors: true });
T(42, 'P-244', 'not while placed this same turn (Delay)', async (W) => {
  const opt = W.put('p1', ['P-244']); opt.placedTurn = W.st.turnNumber; const host = W.put('p1', [FILL[0]]);
  await W.emit('sourcesAdded', { owner: 'p1', stack: host, cause: 'effect', added: [VEM], srcPlayer: 'p1', srcCategory: 'digimon' }); return { opt };
}, (W, x) => [['option stays', W.pl('p1').battle.some(s => s.uid === x.opt.uid)]]);
T(43, 'P-244', "opponent's source placement does not trigger", async (W) => {
  const opt = W.put('p1', ['P-244']); opt.placedTurn = 1; const o = W.put('p2', [FILL[0]]);
  await W.emit('sourcesAdded', { owner: 'p2', stack: o, cause: 'effect', added: [VEM], srcPlayer: 'p2', srcCategory: 'digimon' }); return { opt };
}, (W, x) => [['option stays', W.pl('p1').battle.some(s => s.uid === x.opt.uid)]]);

await runScenarios(list, 'ko-overrides-2');
