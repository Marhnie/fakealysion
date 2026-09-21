// slice2 round 2 (part xros): DigiXros / jogress / burst-digivolve official Q&As. Q ids cited; outcomes paraphrased in our own words.
import { runScenarios, FILL, S, C, fillOf } from './lib2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, ...extra });
const XH = 'BT10-007'; // cross-heart Lv3 digimon (plain enough to be a material)
const TAM = 'P-242';   // effect-less tamer (holder of sources)
const kinds = (pl) => (pl ? pl.materials.map(m => m.kind) : []);
// Q1757: cost-lock digimon: DigiXros is still declarable (plan exists), but the reduction is void
T(1757, 'BT8-071', 'cost lock: xros allowed, discount void', async (W) => { W.put('p2', 'BT8-071'); W.hand('p1', ['BT10-111', XH]); W.pl_ = S.planDigiXros(W.st, 'p1', 0); }, (W) => [['plan exists', !!W.pl_], ['play cost locked', S.isPlayCostLocked(W.st) === true]]);
// Q2012/2017/2126: a tamer that lets tamer-underneath cards be used lets you use cards under OTHER tamers too
for (const [q, card] of [[2012, 'BT10-087'], [2017, 'BT10-088'], [2126, 'BT11-095']])
  T(q, card, "material may come from another tamer's stack", async (W) => { W.put('p1', card); const o = W.put('p1', [TAM, XH]); W.o = o; W.hand('p1', ['BT10-111']); W.pl_ = S.planDigiXros(W.st, 'p1', 0); }, (W) => [['plan uses a tamer-under card', kinds(W.pl_).includes('tamer')], ['taken from the other tamer', !!W.pl_?.materials?.some(m => m.tamerUid === W.o.uid)]]);
// Q2013/2018/2127: sources of a digimon that evolved from a tamer are NOT candidates
for (const [q, card] of [[2013, 'BT10-087'], [2018, 'BT10-088'], [2127, 'BT11-095']])
  T(q, card, 'digimon sources are not material candidates', async (W) => { W.put('p1', card); W.put('p1', ['ST1-03', XH]); W.hand('p1', ['BT10-111']); W.pl_ = S.planDigiXros(W.st, 'p1', 0); }, (W) => [['no tamer-kind material', !kinds(W.pl_).includes('tamer')], ['no plan at all', !W.pl_]]);
// Q2255: DigiXros with 0 material does not count as xros
T(2255, 'BT12-112', 'zero materials = no xros', async (W) => { W.hand('p1', ['BT12-112']); W.pl_ = S.planDigiXros(W.st, 'p1', 0); }, (W) => [['no plan with 0 materials', !W.pl_]]);
// Q2810: BT17-057 xros: one of each listed name
T(2810, 'BT17-057', 'material count is 1 per listed slot', async (W) => { W.hand('p1', ['BT17-057', 'BT8-005', 'BT8-005']); W.pl_ = S.planDigiXros(W.st, 'p1', 0); }, (W) => [['at most one of each listed card type', (W.pl_?.materials || []).length <= 1]], { allowErrors: true });
// Q2352: BT13-102 (opp turn): normal main-phase play by the opponent does not trigger it
T(2352, 'BT13-102', 'normal play does not trigger it', async (W) => { W.st.activePlayer = 'p2'; W.put('p1', 'BT13-102'); W.m0 = W.mem('p1'); W.st.players.p2.hand.unshift(FILL[0]); S.playDigimonFresh(W.st, 'p2', 0, { byEffect: false }); await W.drain(); W.m1 = W.mem('p1'); }, (W) => [['no extra memory', W.m1 === W.m0]]);
// ---- jogress ----
const jog = (W, a, b, id, cost = 0) => { W.hand('p1', [id]); return S.fuseStacks(W.st, 'p1', a.uid, b.uid, id, cost, 'hand'); };
T(2185, 'BT12-057', 'jogress result is active', async (W) => { W.put('p1', 'BT12-057'); const a = W.put('p1', 'ST1-05', { suspended: true }), b = W.put('p1', 'ST1-05', { suspended: true }); W.f = jog(W, a, b, 'BT16-025'); await W.drain(); }, (W) => [['result active', !!W.f && !W.f.suspended]], { allowErrors: true });
T(2622, 'BT16-025', 'non-jogress digivolve: rest part happens', async (W) => {
  const a = W.put('p1', fillOf(c => c.level === 4 && c.colors.includes('blue'))[0]); W.o = W.put('p2', FILL[0]); W.hand('p1', ['BT16-025']); await W.evolve('p1', a.uid, 'BT16-025', 0);
}, (W) => [['opp digimon rested', W.o.suspended === true]], { allowErrors: true });
T(2651, 'BT16-063', 'non-jogress digivolve still evolves', async (W) => { const a = W.put('p1', fillOf(c => c.level === 4 && c.colors.includes('black'))[0]); W.hand('p1', ['BT16-063']); W.f = await W.evolve('p1', a.uid, 'BT16-063', 0); }, (W) => [['evolved', !!W.f && W.f.cardId === 'BT16-063']], { allowErrors: true });
// ---- burst ----
T(2284, 'BT13-033', 'burst needs OWN tamer', async (W) => { W.put('p2', 'BT9-010'); const a = W.put('p1', 'BT13-027'); W.r = S.burstCheck(W.st, 'p1', a, 'BT13-033'); }, (W) => [['not ok without own tamer', !!W.r && W.r.ok === false]], { allowErrors: true });
T(2305, 'BT13-060', 'burst needs OWN tamer', async (W) => { W.put('p2', 'BT13-089'); const a = W.put('p1', 'BT13-050'); W.r = S.burstCheck(W.st, 'p1', a, 'BT13-060'); }, (W) => [['not ok without own tamer', !!W.r && W.r.ok === false]], { allowErrors: true });
await runScenarios(L, 'r2-xros');
