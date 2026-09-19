// UI-driving playtest bot (dev tool). Load in the page: await import('/scripts/uibot.js'); then await bots.run(300)
// Drives the real DOM: click() on buttons/chips, synthetic HTML5 drag events for hand->board, evolve, attack.
window.__errs = window.__errs || [];
window.addEventListener('error', e => __errs.push('E:' + e.message));
window.addEventListener('unhandledrejection', e => __errs.push('R:' + (e.reason && e.reason.message || e.reason)));
window.wait = (ms = 250) => new Promise(r => setTimeout(r, ms));
window.dnd = (from, to) => { const dt = new DataTransfer(); const f = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })); f('dragstart', from); f('dragenter', to); f('dragover', to); f('drop', to); f('dragend', from); };
window.snap = () => { const s = __dbg().state; return JSON.stringify({ t: s.turnNumber, ap: s.activePlayer, ph: s.phase, m: s.memory, w: s.winner, sec: [s.players.p1.security.length, s.players.p2.security.length], pend: s.pending.filter(x => !x.resolved).length, modal: document.querySelector('.modal-panel')?.textContent.slice(0, 120) }); };
const B = window.bots = { trace: [], tried: new Set(), turn: -1, pw: 0, n: 0, cfg: { surrenderAt: 0 } };
B.btn = (re, root = document) => [...root.querySelectorAll('button')].find(b => !b.disabled && re.test(b.textContent));
B.w = (ms = 350) => wait(ms);
B.step = async () => {
  const { state: s, S, E } = __dbg(); if (s.winner) return 'WIN ' + s.winner;
  if (s.turnNumber !== B.turn) { B.turn = s.turnNumber; B.tried = new Set(); }
  const log = (m) => { B.trace.push(s.turnNumber + s.activePlayer + ' ' + m); return m; };
  const mod = document.querySelector('.modal-panel');
  if (mod) {
    const bs = [...mod.querySelectorAll('button')].filter(b => !b.disabled);
    const pri = (re) => bs.find(b => re.test(b.textContent));
    if (/블로커≫로 막을|충돌/.test(mod.textContent) && !B.nob) { const bc = mod.querySelector('.stack-list .card-chip'); if (bc) { bc.click(); return log('BLOCK with ' + bc.textContent.slice(0, 12)); } }
    let b = pri(/^다음 단계|^바로 진행/) || pri(/카운터 단계로/) || pri(/^넘기기/);
    if (!b) {
      const ok = pri(/^확인/);
      const chip = mod.querySelector('.stack-list .card-chip:not(.selected), .hand-list .card-chip:not(.selected)');
      if (ok) b = ok; else if (chip) { chip.click(); return log('modalChip[' + mod.textContent.slice(0, 40) + ']'); }
    }
    if (!b) b = pri(/본체 공격/) || pri(/^예|발동한다|체크|닫기/) || bs[0];
    if (b) { const t = b.textContent; b.click(); return log('modal[' + mod.textContent.slice(0, 40).replace(/\s+/g, ' ') + '] ' + t.slice(0, 25)); }
    return log('MODAL-NOBTN ' + mod.textContent.slice(0, 80));
  }
  const keep = B.btn(/이 핸드 유지/); if (keep && !s.phase) { keep.click(); return log('keep'); }
  const pend = s.pending.filter(t => !t.resolved);
  if (pend.length) { B.pw++; if (B.pw > 14) { B.pw = 0; const x = B.btn(/처리 완료/); if (x) { x.click(); return log('FORCE-CLOSE pending ' + pend[0].text.slice(0, 50)); } } return 'wait pending'; } B.pw = 0;
  if (s.turnEnding) return 'turnEnding';
  const p = s.activePlayer, pl = s.players[p], me = p === 'p1' ? s.memory : -s.memory, hzi = p === 'p1' ? 1 : 0;
  const raisingChip = () => [...document.querySelectorAll('.hex-field:not(.drop-zone)')][hzi].querySelector('.card-chip');
  if (s.phase === 'breeding') {
    const hb = document.querySelector('.pile-digitama.clickable');
    if (hb && hb.offsetParent) { hb.click(); await B.w(); return log('hatch'); }
    if (pl.raising && S.canMoveFromRaising(pl.raising) && !s.breedingActionTaken && pl.battle.length < 6 && B.n % 2 === 0) { raisingChip().click(); await B.w(); return log('raising->battle'); }
    const nb = B.btn(/다음 페이즈/); if (nb) { nb.click(); return log('nextphase'); }
    return log('breeding-stuck');
  }
  if (s.phase !== 'main') { const nb = B.btn(/다음 페이즈/); if (nb) { nb.click(); return log('nextphase ' + s.phase); } return 'phase ' + s.phase; }
  B.n++;
  const hand = [...document.querySelectorAll('.hand-zone')][hzi].querySelectorAll('.card-chip');
  const bzone = document.querySelectorAll('.drop-zone .stack-list')[hzi];
  const myStacks = [...bzone.querySelectorAll('.card-chip')];
  const key = (k) => { if (B.tried.has(k)) return false; B.tried.add(k); return true; };
  for (let i = 0; i < pl.hand.length; i++) {
    const cid = pl.hand[i]; const c = S.card(cid); if (c.category !== 'digimon') continue;
    const targets = [pl.raising, ...pl.battle].filter(Boolean).filter(st => ['digimon', 'digitama'].includes(S.card(st.cardId).category));
    for (const st of targets) {
      let ck; try { ck = E.canEvolveAny(st.cardId, cid, S.evoExtraArg(s, p, st), S.evolveTargetRestriction(s, p, st)); } catch (e) { continue; }
      if (ck && ck.ok && ck.cost <= me && key('ev' + cid + st.uid)) {
        const to = st === pl.raising ? raisingChip() : myStacks[pl.battle.indexOf(st)];
        if (to) { dnd(hand[i], to); await B.w(); return log(`evolve ${c.nameKo} on ${S.card(st.cardId).nameKo} cost${ck.cost}`); }
      }
    }
  }
  for (let i = 0; i < pl.hand.length; i++) {
    const c = S.card(pl.hand[i]); if (c.cost == null) continue;
    if (c.cost <= me && (c.category !== 'digimon' || pl.battle.length < 6) && key('pl' + pl.hand[i] + i)) { dnd(hand[i], bzone); await B.w(); return log('play ' + c.category + ' ' + c.nameKo + ' c' + c.cost); }
  }
  const opp = S.opponentOf(p);
  const oppChips = [...document.querySelectorAll('.drop-zone .stack-list')][1 - hzi].querySelectorAll('.card-chip');
  const hdr = [...document.querySelectorAll('.player-header')].find(h => h.textContent.trim().startsWith(opp.toUpperCase()));
  for (let i = 0; i < pl.battle.length; i++) {
    const st = pl.battle[i]; if (S.card(st.cardId).category !== 'digimon' || st.suspended) continue;
    if (!(s.turnNumber >= st.attackEligibleTurn || S.hasKeyword(st, '속공'))) continue;
    if (!key('atk' + st.uid)) continue;
    const dt = S.legalDigimonTargets(s, p, st.uid); const legal = S.canAttackPlayer(s, p, st.uid);
    const pickDigi = dt.length && (!legal || B.n % 3 === 0);
    if (pickDigi) { const oi = s.players[opp].battle.findIndex(x => x.uid === dt[0]); if (oppChips[oi]) { dnd(myStacks[i], oppChips[oi]); await B.w(); return log('attack digi ' + S.card(st.cardId).nameKo); } }
    if (legal && hdr) { dnd(myStacks[i], hdr); await B.w(); return log('attack player ' + S.card(st.cardId).nameKo); }
  }
  const pass = B.btn(/^패스/); if (pass) { pass.click(); await B.w(); return log('pass'); }
  return log('main-stuck');
};
B.run = async (max = 200, ms = 200) => {
  let last = '', same = 0;
  for (let i = 0; i < max; i++) {
    const r = await B.step(); const s = __dbg().state; if (/^WIN/.test(r)) return r;
    const sig = JSON.stringify([s.turnNumber, s.phase, s.memory, s.log.length, !!document.querySelector('.modal-panel'), document.querySelector('.modal-panel')?.textContent.length]);
    if (sig === last) { same++; if (same > 25) return 'STALL ' + r + ' | ' + snap(); } else same = 0; last = sig; await wait(ms);
  }
  return 'max ' + snap();
};
// Start a fresh game through the real setup UI (from game-over screen or setup screen), keep both opening hands.
B.newGame = async (d1, d2) => {
  const nb = [...document.querySelectorAll('button')].find(b => /새 게임 \(덱 선택으로\)/.test(b.textContent)); if (nb) { nb.click(); await wait(250); }
  const sels = [...document.querySelectorAll('select')];
  sels[0].value = 'saved:' + d1; sels[0].dispatchEvent(new Event('change', { bubbles: true }));
  sels[1].value = 'saved:' + d2; sels[1].dispatchEvent(new Event('change', { bubbles: true }));
  [...document.querySelectorAll('button')].find(b => /새 게임 시작/.test(b.textContent)).click(); await wait(500);
  for (let i = 0; i < 2; i++) { [...document.querySelectorAll('button')].filter(b => /이 핸드 유지/.test(b.textContent)).forEach(b => b.click()); await wait(400); }
  B.trace = []; return snap();
};
