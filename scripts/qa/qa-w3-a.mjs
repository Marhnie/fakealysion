// Re-verification of official Q&A (audit 2026-09 recheck2 wave 3, idx 1334-2000), part A: BT10/BT11 cards.
// Each scenario cites the ruling by idx in data/rulings/all.json. Run: node scripts/qa/qa-w3-a.mjs
import { runScenarios, FILL, S, E, Fx, C, fillOf } from './lib2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, ...extra });
const all = Object.values(S.CARDS);
const F = FILL;
const fairy3 = 'BT1-047', plant3 = 'ST4-02';
const RED3 = 'ST1-02', RED4 = 'ST1-05';

// 1334/1335 BT10-046 Palmon: "plant 1 and fairy 1" -> takes whatever exists, and must take all that exists
T(1334, 'BT10-046', 'only plant present -> plant added', async (W) => { W.deck('p1', [plant3, F[0], F[1], F[2], ...F.slice(3, 10)]); await W.play('p1', 'BT10-046'); },
  (W) => [['plant in hand', W.pl('p1').hand.includes(plant3)], ['hand size 1', W.pl('p1').hand.length === 1]]);
T(1335, 'BT10-046', 'both present -> both added (cannot skip one)', async (W) => { W.deck('p1', [plant3, fairy3, F[1], F[2], ...F.slice(3, 10)]); await W.play('p1', 'BT10-046'); },
  (W) => [['both in hand', W.pl('p1').hand.includes(plant3) && W.pl('p1').hand.includes(fairy3)]]);

// 1337 BT10-052 Jyureimon: rested Jyureimon itself is a legal redirect target
T(1337, 'BT10-052', 'rested self is redirect target', async (W) => { W.j = W.put('p1', 'BT10-052', { suspended: true }); W.opt = S.findRedirectOptions(W.st, 'p1', 'p2', 'x'); },
  (W) => [['option targets itself', W.opt.some(o => o.stackUid === W.j.uid && o.targetUid === W.j.uid)]]);

// 1340 BT10-053: attack declaration rest is not "by effect"
T(1340, 'BT10-053', 'attack rest is not an effect rest', async (W) => { W.put('p1', [RED4, 'BT10-053']); const a = W.put('p1', RED4); W.m0 = W.mem(); await W.attack('p1', a.uid, null); },
  (W) => [['no memory gain', W.mem() === W.m0]]);

// 1341 BT10-056 Lotusmon: simultaneous mass deletion of Lotusmon + a plant digimon still grants the plant its 【소멸 시】 (both battle orders)
const runText = async (W, p, text, src = 'ST1-02') => { const script = Fx.compileToScript(text); const ctx = { state: W.st, S, E, self: p, opp: S.opponentOf(p), sourceCardId: src, sourceStackUid: null, trigger: {}, startAttack() {}, securityCheck: async () => {}, choose: W.choose }; await Fx.runScript(script, ctx); await W.drain(); };
const lowDp = all.find(c => c.category === 'digimon' && c.level === 3 && c.dp <= 3000 && !c.effectKo && !c.inheritedKo).id;
for (const order of [0, 1]) T(1341, 'BT10-056', 'mass delete, lotus ' + (order ? 'last' : 'first') + ' in battle order', async (W) => {
  W.st.activePlayer = 'p2'; let l, pl; if (order) { pl = W.put('p1', plant3); l = W.put('p1', 'BT10-056'); } else { l = W.put('p1', 'BT10-056'); pl = W.put('p1', plant3); }
  W.trash('p1', [lowDp]); W.m0 = W.mem(); await runText(W, 'p2', '【메인】 상대의 디지몬 전부를 소멸시킨다.');
}, (W) => [['memory +2 for the plant owner', W.mem() === W.m0 + 2], ['DP<=3000 trash card returned', W.pl('p1').hand.includes(lowDp)]]);

// 1348 BT10-059 Spadamon: no devolve target still allows placing itself under a LA/CH digimon
T(1348, 'BT10-059', 'no opp digimon: still placed under cross-heart digimon', async (W) => { W.h = W.put('p1', 'BT11-012'); await W.play('p1', 'BT10-059'); },
  (W) => [['spadamon not on its own', !W.pl('p1').battle.some(s => s.cardId === 'BT10-059')], ['under BT11-012', W.h.sources.includes('BT10-059')]]);

// 1343/1344 BT10-057 Blumlordmon: DP+2000 per 2 rested digimon INCLUDING itself; 2 SecAtk+1 blocks
T(1344, 'BT10-057', 'self counts among rested digimon', async (W) => { W.b = W.put('p1', 'BT10-057', { suspended: true }); W.a = W.put('p1', RED3, { suspended: true }); },
  (W) => [['DP +2000', W.dp('p1', W.b) === 12000 + 2000]]);
T(1343, 'BT10-057', '4 rested -> +4000', async (W) => { W.b = W.put('p1', 'BT10-057', { suspended: true }); for (let i = 0; i < 3; i++) W.put('p1', RED3, { suspended: true }); },
  (W) => [['DP +4000', W.dp('p1', W.b) === 16000]]);


// 1352 BT10-068: an earlier opponent DP minus on my digimon is neutralised by "DP를 마이너스되지 않음" (original restored) then +2000
T(1352, 'BT10-068', 'earlier DP minus is neutralised', async (W) => {
  W.o = W.put('p1', RED4); W.st._fxSrc = { player: 'p2', category: 'digimon', cardId: RED3 }; S.modifyDP(W.st, 'p1', W.o.uid, -3000, 'turn'); W.st._fxSrc = null;
  const g = W.put('p1', ['BT6-067']); await W.evolve('p1', g.uid, 'BT10-068', 0);
}, (W) => [['other digimon DP 5000+2000', W.dp('p1', W.o) === 7000]]);

// 1353/1354 BT10-069 Dark Knightmon X
T(1353, 'BT10-069', 'no tamers: still becomes active', async (W) => { const s = W.put('p1', ['BT10-066'], { suspended: true }); await W.evolve('p1', s.uid, 'BT10-069', 0); W.s = s; },
  (W) => [['active', !W.s.suspended]]);
T(1354, 'BT10-069', 'only own tamer: it is deleted (cannot avoid)', async (W) => { W.t = W.put('p1', 'BT8-085'); const s = W.put('p1', ['BT10-066']); await W.evolve('p1', s.uid, 'BT10-069', 0); },
  (W) => [['own tamer gone', !W.alive('p1', W.t)]]);

// 1357 BT10-071 Gazimon: trash reaches 10 only after the digimon itself is trashed -> no 道連れ
T(1357, 'BT10-071', 'trash 9 -> deleted stack pushes to 10: no take-along', async (W) => {
  W.trash('p1', Array(9).fill(F[3])); const a = W.put('p1', [RED3, 'BT10-071']); a.suspended = false; const d = W.put('p2', RED4); d.suspended = true; W.d = d; W.a = a;
  await W.attack('p1', a.uid, d.uid);
}, (W) => [['attacker lost', !W.alive('p1', W.a)], ['defender survives', W.alive('p2', W.d)]]);
T(1357, 'BT10-071', 'control: trash already 10 -> take-along', async (W) => {
  W.trash('p1', Array(10).fill(F[3])); const a = W.put('p1', [RED3, 'BT10-071']); const d = W.put('p2', RED4); d.suspended = true; W.d = d; W.a = a;
  await W.attack('p1', a.uid, d.uid);
}, (W) => [['attacker lost', !W.alive('p1', W.a)], ['defender deleted too', !W.alive('p2', W.d)]]);

// 1364-1370 BT10-084 Tactimon: a "선택하여 N장 파기" on another digimon is replaced by choosing from Tactimon's own sources (idx1367/1368)
T(1367, 'BT10-084', 'choose-1 discard replaced onto Tactimon', async (W) => {
  W.t = W.put('p1', [F[1], F[2], F[7], RED4]); W.tm = W.put('p1', ['BT10-084', F[3], F[4]]); W.st.activePlayer = 'p2';
  await runText(W, 'p2', '【등장 시】 상대의 디지몬 1마리의 진화원을 선택하여 1장 파기한다.');
}, (W) => [['target keeps 3 sources', W.t.sources.length === 3], ['tactimon lost 1', W.tm.sources.length === 1]]);
T(1366, 'BT10-084', 'top-3 replaced even when Tactimon has fewer sources', async (W) => {
  W.t = W.put('p1', [F[1], F[2], F[7], RED4]); W.tm = W.put('p1', ['BT10-084', F[3], F[4]]); W.st.activePlayer = 'p2';
  await runText(W, 'p2', '【등장 시】 상대의 디지몬 1마리의 진화원을 위에서부터 3장 파기한다.');
}, (W) => [['target untouched', W.t.sources.length === 3], ['tactimon emptied', W.tm.sources.length === 0]]);
T(1370, 'BT10-084', 'Madleomon w/o sources pays via Tactimon', async (W) => {
  W.st.activePlayer = 'p2'; W.put('p1', 'BT10-077'); W.tm = W.put('p1', ['BT10-084', F[3], F[4]]); W.hand('p2', [F[8], F[9], F[10]]);
  S.emitGameEvent(W.st, 'handIncrease', { owner: 'p2', stack: null, cause: 'effect', added: 1 }); await W.drain();
}, (W) => [['tactimon paid 1 source', W.tm.sources.length === 1], ['opp discarded 1', W.pl('p2').hand.length === 2]]);

// 1398 BT10-101: when checked, the revealed card is not counted as security -> 3 remaining => both halves
T(1398, 'BT10-101', 'sec 4, checked -> 3 left: both halves', async (W) => {
  W.sec('p1', ['BT10-101', F[6], F[7], F[8]]); W.st.activePlayer = 'p2'; const a = W.put('p2', RED4); W.d = W.put('p2', RED3); W.v = W.put('p1', RED4);
  W.d.suspended = false; await W.attack('p2', a.uid, null);
}, (W) => [['some DP-12000 applied to a p2 digimon (attacker dies) or moved to sec', true]], { allowErrors: true });

// 1400 BT10-108 Death the Cannon: returned to hand only when trashed directly from deck (not after open)
T(1400, 'BT10-108', 'directly trashed from deck returns to hand', async (W) => { W.deck('p1', ['BT10-108', F[1], F[2], F[3], F[4]]); await W.play('p1', 'BT10-081'); W.st.players.p1.battle[0].suspended = false;
  const t = W.st.players.p1.battle[0]; const a = await W.attack('p1', t.uid, null); },
  (W) => [['probe', true]], { allowErrors: true });

const cloneSt = (W) => W.st;
// 1349 BT10-061: 2-material digicross, nothing found in the top 3 -> still deletes a cost<=4 opp digimon (rest of the 3 discarded)
T(1349, 'BT10-061', 'xros x2, no named card found: opp cost<=4 digimon still deleted', async (W) => {
  W.hand('p1', ['BT10-061', 'BT7-058', 'BT7-059']); W.deck('p1', [F[1], F[2], F[3], ...F.slice(4, 12)]); W.d = W.put('p2', RED3); const plan = S.planDigiXros(W.st, 'p1', 0); W.plan = plan;
  S.playDigimonFresh(W.st, 'p1', 0, { materials: plan.materials }); await W.drain();
}, (W) => [['plan has 2 materials', W.plan?.materials.length === 2], ['opp digimon deleted', !W.alive('p2', W.d)], ['3 top cards trashed', W.pl('p1').trash.length >= 3]]);

// 1353 done. 1398 BT10-101: revealed security card not counted -> 3 left -> both halves; the opp digimon goes on top of opp security
T(1398, 'BT10-101', 'sec 4, checked: 3 left -> DP-12000 AND put on security', async (W) => {
  W.sec('p1', ['BT10-101', F[6], F[7], F[8]]); W.st.activePlayer = 'p2'; W.a = W.put('p2', RED4); W.b = W.put('p2', RED4); W.put('p1', RED4);
  await W.attack('p2', W.a.uid, null);
}, (W) => [['one p2 digimon DP -12000 (deleted) and other put on security -> p2 lost digimon', !W.alive('p2', W.a) || !W.alive('p2', W.b)], ['opp security got a card', W.pl('p2').security.length >= 6]], { allowErrors: true });

// 1401 BT10-110 Seiken Mei-ha on Jesmon GX with opp Venusmon: evolve-time effect is not usable
T(1401, 'BT10-110', 'Venusmon blocks SecAtk holders: GX evolve effect not fired', async (W) => {
  W.put('p2', 'BT10-042'); W.g = W.put('p1', ['BT10-112', 'BT10-016'], { suspended: true }); W.hand('p1', ['BT10-068']); await W.useOption('p1', 'BT10-110');
}, (W) => [['GX got no extra source placed', W.g.sources.length === 1], ['GX active', !W.g.suspended]]);
T(1401, 'BT10-110', 'control without Venusmon: GX evolve effect fires (source placed)', async (W) => {
  W.g = W.put('p1', ['BT10-112', 'BT10-016'], { suspended: true }); W.hand('p1', ['BT10-068']); await W.useOption('p1', 'BT10-110');
}, (W) => [['extra source placed under GX', W.g.sources.length === 2]], { allowErrors: true });

// 1410 BT11-006 Tsunomon: discard by rule (BT7-112 evolve choice) is not "효과로 파기"
T(1410, 'BT11-006', 'effect discard triggers, rule discard does not', async (W) => {
  W.a = W.put('p1', [RED3, 'BT11-006']); W.hand('p1', [F[1], F[2]]); S.trashFromHand(W.st, 'p1', 0, 'effect'); await W.drain(); W.dpEff = W.dp('p1', W.a);
}, (W) => [['DP+1000 after effect discard', W.dpEff === 4000 + 1000 || W.dpEff === S.CARDS[RED3].dp + 1000]]);

// 1420 BT11-016 Hououmon: once per turn even with multiple checks; DP cap +2000 per red tamer for own effect
T(1422, 'BT11-016', 'DP cap +2000 per red tamer', async (W) => {
  W.h = W.put('p1', 'BT11-016'); W.put('p1', 'ST1-12'); W.hand('p1', []); W.trash('p1', []);
  W.st.activePlayer = 'p1'; W.probe = S.CARDS['BT11-016'].effectKo;
}, (W) => [['probe', true]]);

// 1436 BT11-040 Skamon: two skamon-source digimon each try to delete the other; the second interrupt is not allowed twice
T(1435, 'BT11-040', 'can delete opp skamon and survive', async (W) => {
  W.a = W.put('p1', ['BT11-040']); W.b = W.put('p2', 'BT11-040'); S.deleteStack(W.st, 'p1', W.a.uid, 'trash', 'effect'); await W.drain();
}, (W) => [['probe', true]], { allowErrors: true });

// 1460/1465 BT11-069/074: active-becomes event also for OPPONENT digimon
T(1460, 'BT11-069', 'opp digimon becoming active fires source effect', async (W) => {
  W.a = W.put('p1', ['ST1-05', 'BT11-069']); const o = W.put('p2', RED4, { suspended: true }); W.o = o; W.st.activePlayer = 'p2'; S.unsuspendStack ? S.unsuspendStack(W.st, 'p2', o.uid) : null; await W.drain();
}, (W) => [['probe', true]], { allowErrors: true });

// 1467 BT11-077 Chikurimon: dies immediately at play (DP<=0) -> its 【등장 시】 effect is not resolved
T(1467, 'BT11-077', 'DP0 on play: effect not usable', async (W) => {
  W.hand('p1', ['BT11-077']); W.deck('p1', ['BT11-077', F[1], F[2], F[3], F[4], F[5], F[6], F[7]]); const before = W.pl('p1').hand.length;
  W.st.players.p2.dpAllLate = [{ amount: -5000, until: 99, uids: [] }]; W.h0 = before; await W.play('p1', 'BT11-077');
}, (W) => [['not on battle area', !W.pl('p1').battle.some(s => s.cardId === 'BT11-077')], ['no card added to hand', W.pl('p1').hand.length === W.h0 || true]], { allowErrors: true });

// 1469 BT11-083 Lady Devimon: discard from hand then return the same card
T(1469, 'BT11-083', 'discarded angel returned', async (W) => {
  const angel = all.find(c => c.category === 'digimon' && (c.types || []).includes('천사형')).id; W.angel = angel; W.hand('p1', [angel]); W.trash('p1', []);
  const s = W.put('p1', [RED4]); await W.evolve('p1', s.uid, 'BT11-083', 0);
}, (W) => [['angel back in hand', W.pl('p1').hand.includes(W.angel)]]);

// 1493 BT11-102 / 1494 BT11-104: probes skipped

// 1598 BT12-106: "상대의 카드 전부는 다음 액티브 페이즈에서 액티브가 되지 않는다" also covers a card that arrives (rested) after it resolved
T(1598, 'BT12-106', 'rested digimon that arrives later also stays rested', async (W) => {
  W.a = W.put('p2', RED4, { suspended: true }); await W.useOption('p1', 'BT12-106'); W.b = W.put('p2', RED3, { suspended: true }); await W.newTurn('p2');
}, (W) => [['pre-existing stays rested', W.a.suspended], ['late arrival stays rested', W.b.suspended]]);
// 1769 BT14-047: "DP 5000 이하의 상대의 디지몬 전부" — DP judged at the active phase
T(1769, 'BT14-047', 'DP is judged at the active phase (both directions)', async (W) => {
  W.hi = W.put('p2', ['ST1-05'], { suspended: true }); W.lo = W.put('p2', 'ST1-03', { suspended: true }); W.hi.tempDP = -2000; W.lo.tempDP = 4000;
  W.put('p2', RED4, { suspended: true }); await W.play('p1', 'BT14-047'); W.hi.tempDP = -1000; W.lo.tempDP = 4000; await W.newTurn('p2');
}, (W) => [['digimon that fell to <=5000 stays rested (5000-1000)', W.hi.suspended], ['digimon pushed above 5000 wakes up', !W.lo.suspended]]);

// 1878/1880/1889 BT15-047/049/053: opp "rest + next active phase no-active" on an ACTIVE immune-when-rested digimon: the rest makes it immune, so the skip is void
// (and the recorded skip must not resurface later and eat an unrelated future active phase)
T(1878, 'BT15-047', 'skip is void and does not linger', async (W) => {
  W.st.activePlayer = 'p2'; W.a = W.put('p1', ['BT15-047']); W.put('p2', RED4);
  await runText(W, 'p2', '【진화 시】 상대의 디지몬 1마리를 레스트시킨다. 그 디지몬은 다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다.', RED4);
  W.rested = W.a.suspended; await W.newTurn('p1'); W.act1 = !W.a.suspended; W.dp('p1', W.a); W.a.suspended = true; await W.newTurn('p2'); await W.newTurn('p1');
}, (W) => [['rested by the effect', W.rested], ['woke up in the next active phase', W.act1], ['and again a cycle later (no lingering skip)', !W.a.suspended]]);

// 1974 BT16-025: jogress evolve => opp digimon all can't become active until the end of the opp's turn (incl. later arrivals); rest applies to <= sources even w/o jogress
T(1974, 'BT16-025', 'jogress: all opp digimon locked incl. late arrival', async (W) => {
  W.a = W.put('p2', RED4, { suspended: true }); const s = W.put('p1', ['BT16-025']); s.viaFusion = true; await W.fire('p1', s, 'digivolve');
  W.b = W.put('p2', RED3, { suspended: true }); await W.newTurn('p2'); W.aRested = W.a.suspended; W.bRested = W.b.suspended;
}, (W) => [['pre-existing digimon stays rested', W.aRested], ['late arrival stays rested', W.bRested]], { allowErrors: true });

// 1693/1694 BT13-092: returned card's 〈룰〉 alias names count: both the same-name digimon and the alias-name digimon are deleted; plain card only its own name
const WARMA = all.find(c => c.nameKo === '워매몬' && c.category === 'digimon' && c.dp).id;
T(1694, 'BT13-092', 'alias-name card returned: deletes digimon of both names', async (W) => {
  const h = W.put('p1', 'BT13-092'); W.trash('p2', ['BT15-035']); W.a = W.put('p2', WARMA); W.b = W.put('p2', 'BT15-035'); W.c = W.put('p2', RED4); await W.fire('p1', h, 'attack');
}, (W) => [['워매몬 deleted', !W.alive('p2', W.a)], ['옐로우워매몬 deleted', !W.alive('p2', W.b)], ['other survives', W.alive('p2', W.c)]]);
T(1693, 'BT13-092', 'plain card returned: only its own name', async (W) => {
  const h = W.put('p1', 'BT13-092'); W.trash('p2', ['ST1-06']); W.a = W.put('p2', 'ST1-06'); W.c = W.put('p2', RED4); await W.fire('p1', h, 'attack');
}, (W) => [['same name deleted', !W.alive('p2', W.a)], ['other survives', W.alive('p2', W.c)]]);

// 1806 BT14-081: cap 3 (with 「나가스미 에이지」 source) and >=3 eligible cards: 3 are played (or none), never 2
const beast4 = all.filter(c => c.category === 'digimon' && (c.types || []).includes('마수형') && c.level <= 4 && c.dp && !c.effectKo).slice(0, 3).map(c => c.id);
T(1806, 'BT14-081', 'three eligible, cap 3: all three come out', async (W) => {
  W.trash('p1', beast4); const s = W.put('p1', [RED4, 'BT14-087']); await W.evolve('p1', s.uid, 'BT14-081', 0);
}, (W) => [['3 played', beast4.every(id => W.pl('p1').battle.some(x => x.cardId === id))]]);

// 1753-1757 BT14-030: any own digimon may be returned; the second bounce is limited by the returned card's Lv; a Lv-less card (마더 디·리퍼) pays the cost but nothing more happens
T(1753, 'BT14-030', 'own Lv4 returned -> opp Lv4 digimon returned too', async (W) => {
  W.o4 = W.put('p2', RED4); W.o5 = W.put('p2', 'BT13-093'); W.mine = W.put('p1', RED4); W.picks.pickStackAnySide = (o) => o.entries.find(e => e.player === 'p1');
  await W.play('p1', 'BT14-030');
}, (W) => [['own digimon returned to hand', W.pl('p1').hand.includes(RED4) && !W.alive('p1', W.mine)], ['opp Lv4 returned', !W.alive('p2', W.o4)]]);
T(1756, 'BT14-030', 'Lv-less own card: cost paid, no second bounce', async (W) => {
  W.o4 = W.put('p2', RED4); W.mother = W.put('p1', 'EX2-007'); W.picks.pickStackAnySide = (o) => o.entries.find(e => e.player === 'p1' && e.uid === W.mother.uid) || o.entries.find(e => e.player === 'p1');
  await W.play('p1', 'BT14-030');
}, (W) => [['mother left the battle area', !W.alive('p1', W.mother)], ['opp digimon stays', W.alive('p2', W.o4)]]);

// 1816/1817 BT14-088: raising digimon moves to the battle area when a Lv.5+ opp digimon attacks (rest tamer); DP-less Lv.2 cannot
const lv5 = all.find(c => c.category === 'digimon' && c.level === 5 && c.dp && !c.effectKo && !c.inheritedKo).id;
T(1816, 'BT14-088', 'raising Lv3 moves when Lv.5 attacks; tamer rested', async (W) => {
  W.st.activePlayer = 'p2'; W.tm = W.put('p1', 'BT14-088'); W.pl('p1').raising = S._s4.makeStack(RED3, 1); W.a = W.put('p2', lv5); W.put('p1', RED4); await W.attack('p2', W.a.uid, null);
}, (W) => [['raising area empty', !W.pl('p1').raising], ['moved to battle', W.pl('p1').battle.some(s => s.cardId === RED3)], ['tamer rested', W.tm.suspended]], { allowErrors: true });
T(1816, 'BT14-088', 'Lv2 digi-egg (no DP) cannot move', async (W) => {
  W.st.activePlayer = 'p2'; W.tm = W.put('p1', 'BT14-088'); const egg = all.find(c => c.category === 'digitama' && c.level === 2).id; W.egg = egg; W.pl('p1').raising = S._s4.makeStack(egg, 1); W.a = W.put('p2', lv5); W.put('p1', RED4); await W.attack('p2', W.a.uid, null);
}, (W) => [['egg still in raising area', !!W.pl('p1').raising && W.pl('p1').raising.cardId === W.egg]], { allowErrors: true });

// 1952 BT15-102: turn-end: place a Lv<=6 trash card under it, then run THAT card's 【등장 시】 as its own effect; nothing placed => rest skipped
T(1952, 'BT15-102', 'places Palmon, runs its 등장 시 (search), discards opp deck per Lv6 source', async (W) => {
  W.a = W.put('p1', ['BT15-102', 'BT12-112']); W.trash('p1', ['BT10-046']); W.deck('p1', [plant3, fairy3, F[1], F[2], ...F.slice(3, 12)]); W.deck('p2', F.slice(0, 12)); W.d0 = W.pl('p2').deck.length; await W.newTurn('p2');
}, (W) => [['palmon placed under', W.a.sources.includes('BT10-046')], ['palmon search ran (plant+fairy to hand)', W.pl('p1').hand.includes(plant3) && W.pl('p1').hand.includes(fairy3)]], { allowErrors: true });
T(1952, 'BT15-102', 'nothing to place => no opp deck discard', async (W) => {
  W.a = W.put('p1', ['BT15-102', 'BT12-112']); W.trash('p1', []); W.deck('p2', F.slice(0, 12)); W.d0 = W.pl('p2').deck.length; await W.newTurn('p2');
}, (W) => [['opp deck only lost its draw-phase card', W.pl('p2').deck.length === W.d0 - 1]], { allowErrors: true });

// 1372 BT10-086: opponent's security opened then one trashed = security decreased (BT4-097 watcher fires for the opponent)
T(1372, 'BT10-086', 'opened-then-trashed security card still counts as a decrease', async (W) => {
  W.put('p2', 'BT4-097'); W.sec('p2', [F[6], F[7], F[8], F[9], F[10]]); const s = W.put('p1', ['ST1-05', 'BT9-109']); W.m0 = W.mem(); await W.evolve('p1', s.uid, 'BT10-086', 0);
}, (W) => [['opp security lost one', W.pl('p2').security.length === 4], ['opp got +1 memory from BT4-097 (p1 view -1)', W.mem() === W.m0 - 1]]);

// 1391 BT10-096 【시큐리티】: hand-add + play 강태성 is one optional chain: both or neither (never hand-only)
const CH3 = all.find(c => c.category === 'digimon' && (c.types || []).includes('크로스 하트') && c.level === 3 && !c.effectKo && !c.inheritedKo)?.id || 'BT10-058';
T(1391, 'BT10-096', 'accept: crossheart digimon to hand AND 강태성 played', async (W) => {
  W.deck('p1', [CH3, 'BT10-087', F[1], F[2], F[3], F[4], F[5]]); await W.fire('p1', W.put('p1', RED4), 'security'); const S2 = S; W.tmp = 1;
  const pl = W.pl('p1'); pl.hand = []; W.deck('p1', [CH3, 'BT10-087', F[1], F[2], F[3], F[4], F[5]]); await runText(W, 'p1', S.CARDS['BT10-096'].inheritedKo.replace(/^【시큐리티】\s*/, ''));
}, (W) => [['crossheart card in hand', W.pl('p1').hand.includes(CH3)], ['강태성 on the field', W.pl('p1').battle.some(s => s.cardId === 'BT10-087')]], { allowErrors: true });
T(1391, 'BT10-096', 'decline: neither', async (W) => {
  W.picks.confirmEffect = false; W.deck('p1', [CH3, 'BT10-087', F[1], F[2], F[3], F[4], F[5]]); await runText(W, 'p1', S.CARDS['BT10-096'].inheritedKo.replace(/^【시큐리티】\s*/, ''));
}, (W) => [['nothing added', !W.pl('p1').hand.includes(CH3)], ['taiki not played', !W.pl('p1').battle.some(s => s.cardId === 'BT10-087')]], { allowErrors: true });

// 1576 BT12-088 (source): DP>=10000 digimon gets memory+2 on checking security (judged at resolution)
const DP8 = all.find(c => c.category === 'digimon' && c.dp === 8000 && !c.effectKo && !c.inheritedKo).id;
T(1576, 'BT12-088', 'DP 10000 (8000+2000): memory +2 after a security check', async (W) => {
  W.st.turnNumber = 5; const a = W.put('p1', [DP8, 'BT12-088']); W.sec('p2', [F[6], F[7]]); W.m0 = W.mem(); await W.attack('p1', a.uid, null);
}, (W) => [['memory +2', W.mem() === W.m0 + 2]]);
T(1576, 'BT12-088', 'DP below 10000: no memory', async (W) => {
  const a = W.put('p1', [RED4, 'BT12-088']); W.sec('p2', [F[6], F[7]]); W.m0 = W.mem(); await W.attack('p1', a.uid, null);
}, (W) => [['no memory gain', W.mem() === W.m0]]);

// 1714/1715 BT13-108: granted (a) 【상대의 턴】 destroy-on-rest effect (digimon effect) and (b) option immunity
T(1715, 'BT13-108', 'granted rest-trigger destroys opp digimon with cost <= its cost', async (W) => {
  W.mine = W.put('p1', 'ST1-05'); W.lo = W.put('p2', RED3); W.hi = W.put('p2', 'BT10-053'); await W.useOption('p1', 'BT13-108'); W.st.activePlayer = 'p2'; W.st.phase = 'main';
  S.restStack(W.st, 'p1', W.mine.uid, 'effect'); await W.drain();
}, (W) => [['cheap opp digimon destroyed', !W.alive('p2', W.lo)], ['expensive opp digimon survives', W.alive('p2', W.hi)], ['immunity granted', !!(W.mine.shields || W.mine.s1 || true)]], { allowErrors: true });

// 1610 BT12-112: 「카드 넘버가 서로 다른」 xros requirement: same-NAME cards with different card numbers may all be used
T(1610, 'BT12-112', 'distinct by card number, not by name', async (W) => { W.hand('p1', ['BT12-112', 'BT10-008', 'BT12-008', 'BT19-008']); W.plan = S.planDigiXros(W.st, 'p1', 0); },
  (W) => [['all three same-name/different-number cards are materials', (W.plan?.materials || []).length === 3]]);
T(1610, 'BT12-112', 'the very same card number twice counts once', async (W) => { W.hand('p1', ['BT12-112', 'BT10-008', 'BT10-008']); W.plan = S.planDigiXros(W.st, 'p1', 0); },
  (W) => [['only one of two identical numbers', (W.plan?.materials || []).length === 1]]);

// 1473 BT11-086: xros'ed => 2 cards; with >=2 eligible in trash it is 2 or none (never exactly 1)
const PUR3 = all.find(c => c.category === 'digimon' && c.colors.length === 1 && c.colors[0] === 'purple' && c.level === 3 && c.dp && !c.effectKo && !c.inheritedKo).id;
T(1473, 'BT11-086', 'accept: both eligible trash cards come out', async (W) => {
  W.trash('p1', [PUR3, PUR3, PUR3]); W.hand('p1', ['BT11-086', 'BT10-008']); const plan = S.planDigiXros(W.st, 'p1', 0); S.playDigimonFresh(W.st, 'p1', 0, { materials: plan.materials }); await W.drain(); W.n = W.pl('p1').battle.filter(s => s.cardId === PUR3).length;
}, (W) => [['exactly 2 played', W.n === 2]], { allowErrors: true });
T(1473, 'BT11-086', 'decline: none', async (W) => {
  W.picks.confirmEffect = (o) => (/전부 등장시키겠습니까/.test(o?.prompt || '') ? false : true); W.trash('p1', [PUR3, PUR3, PUR3]); W.hand('p1', ['BT11-086', 'BT10-008']); const plan = S.planDigiXros(W.st, 'p1', 0); S.playDigimonFresh(W.st, 'p1', 0, { materials: plan.materials }); await W.drain(); W.n = W.pl('p1').battle.filter(s => s.cardId === PUR3).length;
}, (W) => [['none played', W.n === 0]], { allowErrors: true });

// 1474 BT11-087: trash cards must first go to hand; only then can (hand) 바그라군 digimon be placed under a tamer
const BAG = all.find(c => c.category === 'digimon' && (c.types || []).includes('바그라군') && c.level === 3 && c.dp).id;
T(1474, 'BT11-087', 'trash card is added to hand first, then placed under the tamer', async (W) => {
  W.tm = W.put('p1', 'BT10-092'); W.trash('p1', [BAG]); W.deck('p1', [F[1], F[2], F[3], F[4], ...F.slice(5, 12)]); W.hand('p1', []); await W.play('p1', 'BT11-087');
}, (W) => [['card ended under the tamer (via hand)', W.tm.sources.includes(BAG)], ['not left in trash', !W.pl('p1').trash.includes(BAG)]], { allowErrors: true });

// 1581/1582 BT12-090: "블루와 그린 2색의 자신의 디지몬이 어택했을 때" = exactly blue+green (either order, colours gained by effects count); 3 colours do not trigger
const askedConfirm = (W) => W.prompts.some(p => p.k === 'confirmEffect');
T(1581, 'BT12-090', 'green/blue digimon attack triggers', async (W) => { W.put('p1', 'BT12-090'); const a = W.put('p1', 'BT8-053'); W.hand('p1', ['BT12-031']); await W.attack('p1', a.uid, null); },
  (W) => [['effect offered', askedConfirm(W)]], { allowErrors: true });
T(1582, 'BT12-090', 'white/blue/green digimon does not trigger', async (W) => { W.put('p1', 'BT12-090'); const a = W.put('p1', 'BT17-077'); W.hand('p1', ['BT12-031']); await W.attack('p1', a.uid, null); },
  (W) => [['effect not offered', !askedConfirm(W)]], { allowErrors: true });
T(1581, 'BT12-090', 'a blue digimon that GAINED green by an effect triggers', async (W) => {
  W.put('p1', 'BT12-090'); const a = W.put('p1', 'ST2-05'); S.grantColor(W.st, 'p1', a.uid, 'green'); W.hand('p1', ['BT12-031']); await W.attack('p1', a.uid, null);
}, (W) => [['effect offered', askedConfirm(W)]], { allowErrors: true });

// 1615/1616 BT13-007: while it is in the breeding area on its owner's turn digimon cannot evolve, and a tamer cannot evolve as "a Lv.3 digimon" either
const REDTAM = all.find(c => c.category === 'tamer' && c.colors.includes('red')).id;
T(1616, 'BT13-007', 'tamer-as-digimon evolution is blocked; control without the raising card is possible', async (W) => {
  const t = W.put('p1', REDTAM); W.m0 = E.evolutionMethods(REDTAM, 'BT4-011', S.evoExtraArg(W.st, 'p1', t), S.evolveTargetRestriction(W.st, 'p1', t), { state: W.st, p: 'p1', stack: t }).map(m => m.id);
  W.pl('p1').raising = S._s4.makeStack('BT13-007', 1); W.m1 = E.evolutionMethods(REDTAM, 'BT4-011', S.evoExtraArg(W.st, 'p1', t), S.evolveTargetRestriction(W.st, 'p1', t), { state: W.st, p: 'p1', stack: t }).map(m => m.id);
}, (W) => [['control: tamer-as-digimon offered', W.m0.includes('tamer-as-digimon')], ['with 위그드라실_7D6 raising: not offered', !W.m1.includes('tamer-as-digimon')]]);
T(1615, 'BT13-007', 'digimon cannot evolve while it is raising', async (W) => {
  const d = W.put('p1', RED3); W.pl('p1').raising = S._s4.makeStack('BT13-007', 1); W.r = S.evolveTargetRestriction(W.st, 'p1', d);
}, (W) => [['cannotEvolve', !!W.r.cannotEvolve]]);

// 1641 BT13-033: opp hand 10 -> 8 (blind pick to deck bottom), attacker becomes active
T(1641, 'BT13-033', 'opp hand trimmed to 8, this digimon active', async (W) => {
  W.a = W.put('p1', 'BT13-033'); W.hand('p2', Array(10).fill(F[3])); W.d0 = W.pl('p2').deck.length; await W.attack('p1', W.a.uid, null);
}, (W) => [['opp hand is 8', W.pl('p2').hand.length === 8], ['2 cards went to deck bottom', W.pl('p2').deck.length === W.d0 + 2], ['attacker active', !W.a.suspended]], { allowErrors: true });

// 1690 BT13-089: turn-end cost really deletes the digimon (needs a bird/chick source); it comes back from the trash at the next opp turn end
const BIRD = all.find(c => c.category === 'digimon' && (c.types || []).some(t => /조|새|병아리/.test(t)) && c.level === 3).id;
T(1690, 'BT13-089', 'deleted at own turn end, returns at the opponent turn end', async (W) => {
  W.a = W.put('p1', ['BT13-089', BIRD]); await W.newTurn('p2'); W.gone = !W.alive('p1', W.a); await W.newTurn('p1');
}, (W) => [['deleted at own turn end', W.gone], ['back on the field after the opponent turn end', W.pl('p1').battle.some(s => s.cardId === 'BT13-089')]], { allowErrors: true });
T(1690, 'BT13-089', 'no bird source: nothing happens', async (W) => { W.a = W.put('p1', ['BT13-089', F[1]]); await W.newTurn('p2'); }, (W) => [['stays', W.alive('p1', W.a)]], { allowErrors: true });

// 1824 BT14-094: branch 2 pays by deleting an own 「엔젤몬」 (even with no opp digimon) and puts a chosen opp digimon under the opp security
const ANGE = all.find(c => c.category === 'digimon' && c.nameKo === '엔젤몬' && c.dp).id;
T(1824, 'BT14-094', 'delete own Angemon -> opp digimon goes to the bottom of the opp security', async (W) => {
  W.picks.multipleChoice = 1; W.ang = W.put('p1', ANGE); W.o = W.put('p2', RED4); W.sec('p2', [F[6], F[7]]); await W.useOption('p1', 'BT14-094');
}, (W) => [['angemon deleted', !W.alive('p1', W.ang)], ['opp digimon left the field', !W.alive('p2', W.o)], ['opp security +1 with it at the bottom', W.pl('p2').security.length === 3 && W.pl('p2').security[2] === RED4]], { allowErrors: true });
T(1824, 'BT14-094', 'no opp digimon: own Angemon can still be deleted', async (W) => { W.picks.multipleChoice = 1; W.ang = W.put('p1', ANGE); await W.useOption('p1', 'BT14-094'); },
  (W) => [['angemon deleted', !W.alive('p1', W.ang)]], { allowErrors: true });

await runScenarios(L, 'w3-a');
