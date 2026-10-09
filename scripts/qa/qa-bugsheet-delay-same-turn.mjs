// Bug sheet 2026-10 (2): "딜레이 옵션 카드 효과를 쓴 턴에 바로 발동이 가능 합니다" -- rule 16-17-3: a ≪딜레이≫ effect can NOT be activated on the turn the card was placed in the battle area.
// Every path that can fire a Delay must refuse in that turn: the shared S.discardForDelay gate (manual 🗑 button / CPU / bespoke scripts), the CPU driver, event-triggered
// options (EX5-069, BT15-098 had no gate at all), script-level gates (EX10-070, P-204), turn-start options (LM-027, P-243).  Run: node scripts/qa/qa-bugsheet-delay-same-turn.mjs < /dev/null
import { S, E, Fx, newBoard, stk, mkChoose, ctxFor, drain, scenario, report, fillerLv, nm } from './lib5.mjs';
import { createSim } from '../../src/cpusim.js';
const lv3 = fillerLv(3), lv4 = fillerLv(4);
const sim = (st) => createSim(st, { cfgOf: () => ({ level: 'hard', banned: new Set() }), onError: (w, e) => { throw e; } });
const bodyOf = (col) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.colors?.length === 1 && c.colors[0] === col && c.level === 4 && !c.effectKo && !c.inheritedKo)?.id || lv4[0];
const placeOpt = (st, p, id, placedTurn) => { const o = S._s4.makeStack(id, st.turnNumber); o.placedTurn = placedTurn; st.players[p].battle.push(o); return o; };
const hasStack = (st, p, s) => st.players[p].battle.includes(s);

await scenario('sheet-2a', 'S.discardForDelay (the shared gate): refuses on the placement turn, works from the next turn', async (chk) => {
  const st = newBoard({ p1: { battle: [lv3[0]] }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const o = placeOpt(st, 'p1', 'P-038', st.turnNumber);
  chk(S.discardForDelay(st, 'p1', o.uid) === null && hasStack(st, 'p1', o), 'same turn refused, option stays');
  st.turnNumber += 2; // my next turn
  chk(S.discardForDelay(st, 'p1', o.uid) === 'P-038' && !hasStack(st, 'p1', o) && st.players.p1.trash.includes('P-038'), 'next own turn: discarded');
});

// every plain "【메인】 … 이 카드를 배틀 에어리어에 놓는다. 【메인】 《딜레이》 ·…" option, used for real (S.useOptionCard + pending drain), then Delay attempted by the CPU driver
const stdOptions = Object.values(S.CARDS).filter(c => c.category === 'option' && S.parseDelayEffect(c.effectKo)).map(c => c.id);
await scenario('sheet-2b', `${stdOptions.length} 【메인】《딜레이》 options: after USING one, the Delay cannot be activated in that same turn (CPU driver 🗑 action), but can from the next turn`, async (chk) => {
  let placed = 0; const badSame = [], badNext = [];
  for (const id of stdOptions) {
    const cols = S.card(id).colors || [];
    const bodies = cols.map(bodyOf);
    const st = newBoard({ p1: { battle: [...bodies, lv3[2]], hand: [id, lv3[4], lv3[5]], deck: lv3.slice(10, 30), trash: lv3.slice(30, 34), security: lv3.slice(40, 45) }, p2: { battle: [lv3[3], lv3[6]], security: lv3.slice(46, 50) }, memory: 10, active: 'p1' });
    if (S.useOptionCard(st, 'p1', 0) !== id) continue;
    await drain(st, mkChoose(st));
    const o = st.players.p1.battle.find(s => s.cardId === id);
    if (!o) continue; // this card does not place itself (e.g. the Delay is on another effect)
    placed++;
    const sm = sim(st);
    await sm.exec('p1', { type: 'delay', uid: o.uid });
    if (!hasStack(st, 'p1', o)) badSame.push(id);
    st.turnNumber += 2; // own next turn
    await sm.exec('p1', { type: 'delay', uid: o.uid });
    if (hasStack(st, 'p1', o)) badNext.push(id);
  }
  chk(placed >= 40, 'enough options placed to be meaningful: ' + placed);
  chk(badSame.length === 0, 'Delay fired in the placement turn: ' + badSame.join(','));
  chk(badNext.length === 0, 'Delay NOT usable from the next turn: ' + badNext.join(','));
});

await scenario('sheet-2c', 'EX5-069 (event-triggered Delay, bespoke): opponent\'s effect-play on the placement turn does nothing; from the next turn the option is offered and discarded', async (chk) => {
  for (const [same, expectGone] of [[true, false], [false, true]]) {
    const st = newBoard({ p1: { battle: [lv3[0]], trash: ['BT7-001'] }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p2' });
    const o = placeOpt(st, 'p1', 'EX5-069', same ? st.turnNumber : st.turnNumber - 1);
    st.pending.length = 0;
    S.emitGameEvent(st, 'play', { owner: 'p2', stack: st.players.p2.battle[0], cause: 'effect' });
    const queued = st.pending.some(t => t.cardId === 'EX5-069');
    await drain(st, mkChoose(st));
    chk(queued === !same, `${same ? 'placement turn' : 'later turn'}: trigger queued=${queued}`);
    chk(hasStack(st, 'p1', o) === !expectGone, `${same ? 'placement turn' : 'later turn'}: option ${hasStack(st, 'p1', o) ? 'kept' : 'discarded'}`);
  }
});
await scenario('sheet-2d', 'BT15-098 (event-triggered Delay, bespoke): own 묘티스몬 deleted on the placement turn -> no Delay; later turn -> discarded', async (chk) => {
  const myotis = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo === '묘티스몬')?.id;
  for (const [same, expectGone] of [[true, false], [false, true]]) {
    const st = newBoard({ p1: { battle: [myotis, lv3[0]], trash: ['BT7-001'] }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p2' });
    const o = placeOpt(st, 'p1', 'BT15-098', same ? st.turnNumber : st.turnNumber - 1);
    st.pending.length = 0;
    S.deleteStack(st, 'p1', st.players.p1.battle[0].uid, 'trash', 'effect');
    await drain(st, mkChoose(st));
    chk(hasStack(st, 'p1', o) === !expectGone, `${same ? 'placement turn' : 'later turn'}: option ${hasStack(st, 'p1', o) ? 'kept' : 'discarded'}`);
  }
});

// sweep: for EVERY event-/turn-triggered Delay option with a bespoke script, run the trigger when the option was placed THIS turn -> it must never be discarded
await scenario('sheet-2e', 'sweep: no bespoke/generic event-triggered Delay option is discarded by its trigger on the placement turn', async (chk) => {
  const leaks = []; let n = 0;
  for (const c of Object.values(S.CARDS)) {
    const t = c.effectKo || ''; if (c.category !== 'option' || !/딜레이/.test(t) || S.parseDelayEffect(t)) continue;
    for (const seg of S.parseEffectSegments(t).segments.filter(s => /딜레이/.test(s.body))) {
      const st = newBoard({ p1: { battle: [lv3[2], lv3[7]], hand: [lv3[4], lv3[5]], deck: lv3.slice(10, 30), trash: lv3.slice(30, 34), security: lv3.slice(40, 45) }, p2: { battle: [lv3[3], lv3[6]], security: lv3.slice(46, 50) }, memory: 5, active: 'p1' });
      const opt = placeOpt(st, 'p1', c.id, st.turnNumber); opt.hookEvt = { stackUid: st.players.p1.battle[0].uid, kind: 'x' };
      const trig = { player: 'p1', cardId: c.id, stackUid: opt.uid, topId: c.id, tags: seg.tags, text: seg.body.trim(), resolved: false, uid: 'tt' };
      const spec = Fx.lookupCardSpecific(c.id, seg.tags, trig.text, false);
      if (spec) { n++; try { await Fx.runScript(spec, ctxFor(st, trig, mkChoose(st))); } catch (e) { /* a script that needs real event data may throw: it did not discard */ } }
      if (!hasStack(st, 'p1', opt)) leaks.push(c.id + '[' + seg.tags.join('|') + ']');
    }
  }
  chk(n >= 30, 'scripts exercised: ' + n);
  chk(leaks.length === 0, 'discarded on the placement turn: ' + leaks.join(', '));
});

await scenario('sheet-2f', 'turn-start Delay options (LM-027 【자신의 턴 개시 시】, P-243): not usable when placed this very turn, usable when placed on an earlier turn', async (chk) => {
  for (const id of ['LM-027', 'P-243']) {
    for (const [same, expectGone] of [[true, false], [false, true]]) {
      const st = newBoard({ p1: { battle: [lv3[0]], trash: [...lv3.slice(30, 34)] }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
      const o = placeOpt(st, 'p1', id, same ? st.turnNumber : st.turnNumber - 2);
      st.pending.length = 0;
      S.queueTriggersForStack(st, 'p1', o, 'turnStart');
      await drain(st, mkChoose(st));
      chk(hasStack(st, 'p1', o) === !expectGone, `${id} ${same ? 'placement turn' : 'later turn'}: option ${hasStack(st, 'p1', o) ? 'kept' : 'discarded'}`);
    }
  }
});

await scenario('sheet-2g', 'EX10-070 / P-204 scripts re-check the placement turn themselves (defence in depth) and respect a refused discard', async (chk) => {
  for (const [id, tag, text] of [['EX10-070', '서로의 턴', '링크 카드가 효과로 파기되었을 때'], ['P-204', '서로의 턴', '디지몬이 플레이어에게 어택했을 때']]) {
    const st = newBoard({ p1: { battle: [lv3[0]], hand: [lv3[4]], trash: lv3.slice(30, 34) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p2' });
    const o = placeOpt(st, 'p1', id, st.turnNumber); o.hookEvt = { stackUid: st.players.p1.battle[0].uid };
    const trig = { player: 'p1', cardId: id, stackUid: o.uid, topId: id, tags: [tag], text, resolved: false, uid: 'tt' };
    const spec = Fx.lookupCardSpecific(id, [tag], text, false);
    chk(!!spec, id + ' has a bespoke script');
    if (spec) await Fx.runScript(spec, ctxFor(st, trig, mkChoose(st)));
    chk(hasStack(st, 'p1', o), id + ' not discarded on the placement turn');
  }
});
report();
