// 유니크 엠블럼(딜레이 옵션) 전체 흐름: 메인 사용 → 배틀 에어리어에 놓임 → 같은 턴 트리거는 불가 → 이후 자신의 턴 트리거 시 딜레이 발동. Run: node scripts/qa/qa-emblem-flow.mjs < /dev/null
import { S, E, Fx, mk, put, drain, T, eq, ok, runAll, makeChoose, useOption } from './lib-s1.mjs';
const C = (id) => S.CARDS[id];
const CARDS = ['BT22-096','BT22-098','EX10-069','BT23-098','BT24-089','EX11-072','P-227','P-228','P-229','P-230','P-231','P-232','P-237'];
const NAME = (id) => { const t = C(id).effectKo; const m = t.match(/【(?:자신의|서로의) 턴】\s*자신의 「([^」]+)」\s*(?:가|이)\s*(레스트했을 때|등장했을 때)/); return { nm: m[1], kind: m[2] }; };
const findTrig = (nm, want) => Object.values(S.CARDS).filter(x => x.nameKo === nm && x.category === 'tamer' && !x.isParallel).find(x => want.includes(x.id)) || Object.values(S.CARDS).find(x => x.nameKo === nm && x.category === 'tamer');
// headless mirror of main.js runPendingScript's delay branch; returns 'noplan' | why | 'declined' | 'ran'
async function runDelayPending(st, t, confirm) {
  const plan = Fx.delayBulletPlan(S, t.cardId, t.tags, t.text); if (!plan) return 'noplan';
  const dst = st.players[t.player].battle.find(s => s.uid === t.stackUid);
  const ctx = { state: st, S, E, self: t.player, opp: S.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, attack: () => st.attackCtx, endAttack() {}, choose: makeChoose(st) };
  if (!dst || C(dst.cardId).category !== 'option') return 'gone';
  if (st.turnNumber <= dst.placedTurn) return 'sameTurn';
  if (!confirm) return 'declined';
  S.discardForDelay(st, t.player, dst.uid); ctx.sourceStackUid = null;
  await Fx.runScript(plan.script, ctx); return 'ran';
}
for (const id of CARDS) {
  T(id, `${id} ${C(id).nameKo}: 사용→배치→딜레이`, async () => {
    const { nm, kind } = NAME(id);
    const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 3; st.memory = 10;
    const trg = Object.values(S.CARDS).find(x => x.nameKo === nm && x.category === 'tamer');
    // main effect setup: free-play targets in hand (or a deck to reveal)
    const pl = st.players.p1; for (const cc of C(id).colors) put(st, 'p1', Object.values(S.CARDS).find(x => x.category === 'digimon' && x.colors[0] === cc && x.level === 4 && !x.effectKo && !x.inheritedKo && !x.isParallel).id);
    if (/코스트를 지불하지 않고 등장/.test(C(id).effectKo)) { pl.hand = [trg.id]; if (/「([^」]+)」\/「([^」]+)」/.test(C(id).effectKo)) pl.trash = []; }
    else pl.deck = [C(id).id === id ? Object.values(S.CARDS).find(x => (x.types||[]).includes('리버레이터') && x.category === 'digimon').id : '', ...pl.deck].filter(Boolean);
    const r = await useOption(st, 'p1', id); await drain(st);
    ok('옵션이 배틀 에어리어에 놓임', pl.battle.some(s => s.cardId === id));
    const holder = pl.battle.find(s => s.cardId === id);
    // same turn: trigger
    const evolveTarget = put(st, 'p1', Object.values(S.CARDS).find(x => x.category === 'digimon' && x.level === 4 && !x.effectKo && !x.inheritedKo && x.colors.length === 1).id);
    const fire = async () => { st.pending = []; if (kind === '레스트했을 때') { let tm = pl.battle.find(s => C(s.cardId).nameKo === nm); if (!tm) tm = put(st, 'p1', trg.id); tm.suspended = false; S.restStack(st, 'p1', tm.uid, 'effect'); pl.battle = pl.battle.filter(s => s.uid !== tm.uid || true); } else { pl.hand.push(trg.id); S.playDigimonFresh(st, 'p1', pl.hand.length - 1); } return st.pending.filter(x => x.cardId === id); };
    let q = await fire(); const same = q.length ? await runDelayPending(st, q[0], true) : 'notqueued';
    ok(`같은 턴: 딜레이 불가 (got ${same})`, same === 'sameTurn' || same === 'notqueued'); ok('같은 턴 옵션 유지', pl.battle.some(s => s.uid === holder.uid));
    // later own turn
    st.turnNumber = 5; st.activePlayer = 'p1'; for (const s of pl.battle) s.suspended = false;
    q = await fire(); ok('나중 턴: 딜레이 트리거 큐잉', q.length === 1);
    eq('거절 시 유지', await runDelayPending(st, q[0], false), 'declined'); ok('거절→옵션 잔류', pl.battle.some(s => s.uid === holder.uid));
    st._qaErr = [];
    const res = await runDelayPending(st, q[0], true); eq('발동', res, 'ran'); ok('옵션 트래시로', !pl.battle.some(s => s.uid === holder.uid) && pl.trash.includes(id));
    ok('오류 없음 ' + JSON.stringify(st._qaErr), !(st._qaErr || []).length);
    // opponent's turn / opponent's tamer must not queue
    st.turnNumber = 6; st.activePlayer = 'p2';
  });
}
await runAll('qa-emblem-flow');
