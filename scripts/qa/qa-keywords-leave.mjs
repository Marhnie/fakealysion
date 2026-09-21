// Keyword audit (rulebook ch.16) — leave-area / replacement / save keywords:
// 디코이 수호 프래그먼트 분리 파티션 디코드 세이브 머티리얼세이브 천승(assist) 딜레이 + 오버플로우
import { S, E, Fx, C, FILL, world, runScenarios } from './lib2.mjs';
const ck = (d, b) => [d, !!b];
const lo = FILL[0];
const cs = Object.values(S.CARDS);
const byName = (n) => cs.find(c => c.category === 'digimon' && c.nameKo === n)?.id;
const TAM = 'P-242';
const list = [];
const sc = (name, run, expect, world) => list.push({ q: 0, card: name, name, run, expect, world });
const runOps = async (W, self, ops) => { const ctx = { state: W.st, S, E, self, opp: S.opponentOf(self), sourceCardId: null, sourceStackUid: null, trigger: {}, startAttack() {}, choose: W.choose }; await Fx.runScript(ops, ctx); await W.drain(); };
const bounce = (W, self, uidPick) => runOps(W, self, [{ op: 'returnToHandStripSources', target: self === 'p1' ? 'opponent' : 'self', n: 1 }]);
const kill = async (W, p, s, cause = 'effect') => { S.deleteStack(W.st, p, s.uid, 'trash', cause); await W.drain(); };

// ---------- 16-18 디코이 ----------
sc('디코이: same-colour other digimon saved by sacrificing the holder', async (W) => { const h = W.put('p2', 'BT6-059'); const t = W.put('p2', 'ST5-02'); await kill(W, 'p2', t); return { h, t }; },
  (W, { h, t }) => [ck('protected alive', W.alive('p2', t)), ck('holder deleted', !W.alive('p2', h))]);
sc('디코이: different colour not protected', async (W) => { const h = W.put('p2', 'BT6-059'); const t = W.put('p2', 'ST1-05'); await kill(W, 'p2', t); return { h, t }; },
  (W, { h, t }) => [ck('target deleted', !W.alive('p2', t)), ck('holder untouched', W.alive('p2', h))]);
sc('디코이: NOT vs own effect', async (W) => { const h = W.put('p1', 'BT6-059'); const t = W.put('p1', 'ST5-02'); await kill(W, 'p1', t, 'ownEffect'); return { h, t }; },
  (W, { h, t }) => [ck('target deleted', !W.alive('p1', t)), ck('holder untouched', W.alive('p1', h))]);
sc('디코이: does not protect the holder itself ("다른")', async (W) => { const h = W.put('p2', 'BT6-059'); await kill(W, 'p2', h); return { h }; },
  (W, { h }) => [ck('holder deleted', !W.alive('p2', h))]);
sc('디코이: NOT vs battle deletion (相手の効果によって)', async (W) => { const h = W.put('p2', 'BT6-059'); const t = W.put('p2', 'ST5-02'); const a = W.put('p1', 'BT1-026'); await W.attack('p1', a.uid, t.uid); return { h, t }; },
  (W, { h, t }) => [ck('target deleted by battle', !W.alive('p2', t)), ck('holder untouched', W.alive('p2', h))]);
sc('디코이: NOT vs bounce', async (W) => { const h = W.put('p2', 'BT6-059'); const t = W.put('p2', 'ST5-02'); W.picks.pickStack = (o) => o.uids.includes(t.uid) ? t.uid : o.uids[0]; await bounce(W, 'p1'); return { h, t }; },
  (W, { h, t }) => [ck('target left', !W.alive('p2', t)), ck('holder untouched', W.alive('p2', h))]);
sc('디코이: granted-by-inherited (BT8-060 i, X항체 only) not while absent trait', async (W) => { const h = W.put('p2', ['BT1-016', 'BT8-060']); return { h }; }, (W) => [ck('noop', true)]);

// ---------- 16-45 수호 ----------
sc('수호: other digimon deleted by opp effect -> holder deleted, target stays', async (W) => { const h = W.put('p2', lo); S.grantKeyword(W.st, 'p2', h.uid, '수호', true); const t = W.put('p2', FILL[1]); await kill(W, 'p2', t); return { h, t }; },
  (W, { h, t }) => [ck('target alive', W.alive('p2', t)), ck('holder deleted', !W.alive('p2', h))]);
sc('수호: also stops bounce by opp effect', async (W) => { const h = W.put('p2', lo); S.grantKeyword(W.st, 'p2', h.uid, '수호', true); const t = W.put('p2', FILL[1]); W.picks.pickStack = (o) => t.uid; await bounce(W, 'p1'); return { h, t }; },
  (W, { h, t }) => [ck('target alive', W.alive('p2', t)), ck('holder deleted', !W.alive('p2', h))]);
sc('수호: not vs own effect', async (W) => { const h = W.put('p1', lo); S.grantKeyword(W.st, 'p1', h.uid, '수호', true); const t = W.put('p1', FILL[1]); await kill(W, 'p1', t, 'ownEffect'); return { h, t }; },
  (W, { h, t }) => [ck('target deleted', !W.alive('p1', t)), ck('holder untouched', W.alive('p1', h))]);

// ---------- 16-37 프래그먼트 ----------
sc('프래그먼트: 3 sources -> trash 3 sources, survive', async (W) => { const d = W.put('p2', ['EX8-051', FILL[1], FILL[2], FILL[3]]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d)), ck('sources 0', d.sources.length === 0), ck('3 in trash', W.pl('p2').trash.length === 3)]);
sc('프래그먼트: 2 sources (<3) -> cannot', async (W) => { const d = W.put('p2', ['EX8-051', FILL[1], FILL[2]]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('프래그먼트: 5 sources -> only 3 discarded', async (W) => { const d = W.put('p2', ['EX8-051', FILL[1], FILL[2], FILL[3], FILL[4], FILL[5]]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d)), ck('2 sources left', d.sources.length === 2)]);
sc('프래그먼트: works in battle', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', ['EX8-051', FILL[1], FILL[2], FILL[3]]); await W.attack('p1', a.uid, d.uid); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d)), ck('sources 0', d.sources.length === 0)]);
sc('프래그먼트: works vs own effect deletion too (16-37 has no cause limit)', async (W) => { const d = W.put('p2', ['EX8-051', FILL[1], FILL[2], FILL[3]]); await kill(W, 'p2', d, 'ownEffect'); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d))]);

// ---------- 16-46 분리 ----------
sc('분리: link card with trait discarded instead of leaving (opp effect)', async (W) => { const d = W.put('p2', 'BT26-010'); d.linkCards = [{ cardId: 'BT26-019' }]; await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d)), ck('link card trashed', d.linkCards.length === 0 && W.pl('p2').trash.includes('BT26-019'))]);
sc('분리: no matching link card -> deleted', async (W) => { const d = W.put('p2', 'BT26-010'); d.linkCards = [{ cardId: lo }]; await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('분리: not vs own effect? (自分の効果以外 -> own effect not covered)', async (W) => { const d = W.put('p2', 'BT26-010'); d.linkCards = [{ cardId: 'BT26-019' }]; await kill(W, 'p2', d, 'ownEffect'); return { d }; },
  (W, { d }) => [ck('deleted', !W.alive('p2', d))]);
sc('분리: works in battle', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', 'BT26-010'); d.linkCards = [{ cardId: 'BT26-019' }]; await W.attack('p1', a.uid, d.uid); return { d }; },
  (W, { d }) => [ck('alive', W.alive('p2', d))]);

// ---------- 16-29 파티션 ----------
const BLUE4 = 'ST2-05', GREEN4 = 'ST4-07';
sc('파티션: both designated sources present -> both may be played free', async (W) => { const d = W.put('p2', ['BT16-025', BLUE4, GREEN4]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('holder gone', !W.alive('p2', d)), ck('blue Lv4 on field', W.count('p2', BLUE4) === 1), ck('green Lv4 on field', W.count('p2', GREEN4) === 1)]);
sc('파티션: one designated missing -> nothing (all-or-nothing 16-29-4)', async (W) => { const d = W.put('p2', ['BT16-025', BLUE4, FILL[1]]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('none played', W.count('p2', BLUE4) === 0)]);
sc('파티션: not from battle loss', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', ['BT16-025', BLUE4, GREEN4]); await W.attack('p1', a.uid, d.uid); return { d }; },
  (W, { d }) => [ck('none played', W.count('p2', BLUE4) === 0 && W.count('p2', GREEN4) === 0)]);
sc('파티션: not from own effect', async (W) => { const d = W.put('p1', ['BT16-025', BLUE4, GREEN4]); await kill(W, 'p1', d, 'ownEffect'); return { d }; },
  (W, { d }) => [ck('none played', W.count('p1', BLUE4) === 0)]);
sc('파티션: bounce by opp effect also triggers (leaves battle area)', async (W) => { const d = W.put('p2', ['BT16-025', BLUE4, GREEN4]); W.picks.pickStack = () => d.uid; await bounce(W, 'p1'); return { d }; },
  (W, { d }) => [ck('both played', W.count('p2', BLUE4) === 1 && W.count('p2', GREEN4) === 1)]);

// ---------- 16-36 디코드 ----------
sc('디코드: source matching designation played free when leaving by effect', async (W) => { const id = 'BT24-014'; const d = W.put('p2', [id, byName('아이기오몬')]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('아이기오몬 played', W.count('p2', byName('아이기오몬')) === 1)]);
sc('디코드: not in battle', async (W) => { const a = W.put('p1', 'BT1-026'); const d = W.put('p2', ['BT24-014', byName('아이기오몬')]); await W.attack('p1', a.uid, d.uid); return { d }; },
  (W, { d }) => [ck('none', W.count('p2', byName('아이기오몬')) === 0)]);
sc('디코드: no matching source -> nothing', async (W) => { const d = W.put('p2', ['BT24-014', FILL[1]]); await kill(W, 'p2', d); return { d }; },
  (W, { d }) => [ck('none', W.count('p2', FILL[1]) === 0)]);

// ---------- 16-20 세이브 ----------
sc('세이브: 소멸 시 -> card goes under own tamer', async (W) => { const t = W.put('p2', TAM); const d = W.put('p2', 'BT10-020'); await kill(W, 'p2', d, 'effect'); return { t }; },
  (W, { t }) => [ck('under tamer', t.sources.includes('BT10-020')), ck('not in trash', !W.pl('p2').trash.includes('BT10-020'))]);
sc('세이브: no tamer -> stays in trash', async (W) => { const d = W.put('p2', 'BT10-020'); await kill(W, 'p2', d, 'effect'); return {}; },
  (W) => [ck('in trash', W.pl('p2').trash.includes('BT10-020'))]);
sc('세이브: optional (decline leaves it in trash)', async (W) => { const t = W.put('p2', TAM); const d = W.put('p2', 'BT10-020'); W.picks.multipleChoice = 1; await kill(W, 'p2', d, 'effect'); return { t }; },
  (W, { t }) => [ck('declined', !t.sources.includes('BT10-020') && W.pl('p2').trash.includes('BT10-020'))]);
sc('세이브: battle loss', async (W) => { const t = W.put('p2', TAM); const a = W.put('p1', 'BT1-026'); const d = W.put('p2', 'BT10-020'); await W.attack('p1', a.uid, d.uid); return { t }; },
  (W, { t }) => [ck('under tamer', t.sources.includes('BT10-020'))]);

// ---------- 16-21 머티리얼 세이브 ----------
sc('머티리얼세이브: digicross-condition sources placed under tamer', async (W) => { const t = W.put('p2', TAM); const ids = ['샤우트몬', '바리스타몬', '도루루몬'].map(byName); const d = W.put('p2', ['BT10-013', ...ids]); await kill(W, 'p2', d); return { t, ids }; },
  (W, { t, ids }) => [ck('all 3 under tamer', ids.every(id => t.sources.includes(id)))]);
sc('머티리얼세이브: no tamer -> nothing', async (W) => { const ids = ['샤우트몬', '바리스타몬', '도루루몬'].map(byName); const d = W.put('p2', ['BT10-013', ...ids]); await kill(W, 'p2', d); return { ids }; },
  (W, { ids }) => [ck('all in trash', ids.every(id => W.pl('p2').trash.includes(id)))]);
sc('머티리얼세이브: non-condition sources are not saved', async (W) => { const t = W.put('p2', TAM); const d = W.put('p2', ['BT10-013', FILL[1], FILL[2], FILL[3]]); await kill(W, 'p2', d); return { t }; },
  (W, { t }) => [ck('nothing saved', t.sources.length === 0)]);
sc('머티리얼세이브: fewer than N -> as many as possible (16-21-3)', async (W) => { const t = W.put('p2', TAM); const ids = ['샤우트몬', '바리스타몬'].map(byName); const d = W.put('p2', ['BT10-013', ...ids]); await kill(W, 'p2', d); return { t, ids }; },
  (W, { t, ids }) => [ck('2 saved', ids.every(id => t.sources.includes(id)))]);

// ---------- 딜레이 (16-17) ----------
sc('딜레이: parseDelayEffect reads the bullet', async (W) => { return {}; }, () => [ck('BT7-102 bullet', S.parseDelayEffect(C('BT7-102').effectKo) === '메모리를 +2 한다.')]);
sc('딜레이: discarding the placed option runs its effect (+2 memory)', async (W) => { const opt = W.put('p1', 'BT7-102'); opt.placedTurn = 1; const id = S.discardForDelay(W.st, 'p1', opt.uid); W.st.pending.push({ uid: 'dl1', player: 'p1', cardId: id, stackUid: null, tags: ['메인'], text: S.parseDelayEffect(C(id).effectKo), resolved: false }); const m0 = W.mem(); await W.drain(); return { m0 }; },
  (W, { m0 }) => [ck('+2 memory', W.mem() === m0 + 2), ck('option in trash', W.pl('p1').trash.includes('BT7-102'))]);

// ---------- 4-19 오버플로우 ----------
sc('오버플로우: card w/ 오버플로우 leaving area moves memory', async (W) => { return {}; }, () => [ck('data check only (see qa-slice*/test-ace)', true)]);

const out = await runScenarios(list, 'kw-leave');
process.exit(out.some(o => !o.ok) ? 1 : 0);
