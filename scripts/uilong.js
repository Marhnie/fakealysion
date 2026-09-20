// Long-game UI playtest helpers (dev tool). await import('/scripts/uibot.js'); await import('/scripts/uihelp.js'); await import('/scripts/uilong.js');
// LG.mkDeck(name, kwRegex, colors) builds a "strong" evolution-line deck around a mechanic keyword and saves it to localStorage.
// LG.game(deckA, deckB) starts a CPU game; LG.play(maxSteps) drives P1 like an expert bot with cheats (memory/cards) and invariant checks each step.
window.LG = window.LG || {};
const LG = window.LG;
LG.issues = LG.issues || [];
LG.note = (m) => { if (!LG.issues.includes(m)) LG.issues.push(m); };
LG.mkDeck = (name, kw, colors, seedIds = []) => {
  const { S, E } = __dbg(); const all = Object.values(S.CARDS).filter(c => !c.isParallel);
  const okc = (c) => (c.colors || []).length && c.colors.every(x => colors.includes(x));
  const pool = all.filter(okc); const rnd = (n) => Math.floor(Math.random() * n); const shuf = (a) => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  const main = {}; let tot = 0; const add = (c, n) => { const cur = main[c.id] || 0; const k = Math.min(n, 4 - cur, 50 - tot); if (k > 0) { main[c.id] = cur + k; tot += k; } };
  const anchors = shuf(pool.filter(c => ['digimon', 'tamer', 'option'].includes(c.category) && kw.test(c.effectKo || '')));
  for (const id of seedIds) if (S.CARDS[id]) add(S.CARDS[id], 3);
  const byLv = (l) => shuf(pool.filter(c => c.category === 'digimon' && c.level === l));
  const chain = (lv) => { const out = []; let cur = byLv(3)[0]; if (!cur) return out; out.push(cur); for (let l = 4; l <= lv; l++) { const nx = byLv(l).find(c => { try { const r = E.canEvolveAny(cur.id, c.id, undefined, undefined); return r && r.ok; } catch (e) { return false; } }); if (!nx) break; out.push(nx); cur = nx; } return out; };
  for (const a of anchors.slice(0, 10)) add(a, a.category === 'digimon' ? 2 : 3);
  let guard = 0; while (tot < 34 && guard++ < 60) { for (const c of chain(3 + rnd(4))) add(c, 3); }
  for (const c of shuf(pool.filter(c => c.category === 'tamer')).slice(0, 3)) add(c, 2);
  for (const c of shuf(pool.filter(c => c.category === 'option')).slice(0, 4)) add(c, 2);
  guard = 0; while (tot < 50 && guard++ < 200) { const c = shuf(pool.filter(c => c.category === 'digimon' && c.level >= 3))[0]; if (c) add(c, 2); }
  const eggs = shuf(pool.filter(c => c.category === 'digitama')); const dig = {}; let dn = 0; for (const e of eggs) { const k = Math.min(4, 5 - dn); if (k > 0) { dig[e.id] = k; dn += k; } if (dn >= 5) break; }
  const eg = eggs.length ? dig : (() => { const l2 = shuf(all.filter(c => c.category === 'digimon' && c.level === 2 && okc(c)))[0]; return l2 ? { [l2.id]: 5 } : {}; })();
  const d = JSON.parse(localStorage.getItem('digimon_saved_decks_v1') || '{}'); d[name] = { name, main, digitama: eg }; localStorage.setItem('digimon_saved_decks_v1', JSON.stringify(d));
  return { name, tot, eggs: eg, anchors: anchors.slice(0, 10).map(c => c.id + ':' + c.nameKo) };
};
// Invariants
LG.check = (tag) => {
  const errs = window.__errs || []; if (errs.length) { LG.note(tag + ' JSERR ' + errs.slice(-2).join(' / ')); errs.length = 0; }
  const { state: s } = __dbg();
  for (const p of ['p1', 'p2']) { const pl = s.players[p]; const uid = new Set(); for (const st of pl.battle) { if (uid.has(st.uid)) LG.note(tag + ' dup uid ' + st.uid); uid.add(st.uid); } }
  if (s.memory > 10 || s.memory < -10) LG.note(tag + ' memory range ' + s.memory);
  const mod = document.querySelector('.modal-panel');
  if (!mod) { const t = performance.now(); __dbg().render(); const dt = performance.now() - t; LG.maxRender = Math.max(LG.maxRender || 0, dt); }
};
LG.game = async (a, b, level = 'hard', mode = 'cpu') => {
  const nb = [...document.querySelectorAll('button')].find(x => /새 게임 \(덱 선택으로\)/.test(x.textContent)); if (nb) { nb.click(); await wait(250); }
  const sels = [...document.querySelectorAll('select')]; const setv = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } };
  setv(sels[2], mode); await wait(150); setv([...document.querySelectorAll('select')][3], level); await wait(150);
  await bots.newGame(a, b); const sp = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'fast')); if (sp) setv(sp, 'fast'); return snap();
};
LG.stats = () => { const { state: s } = __dbg(); return JSON.stringify({ t: s.turnNumber, p1: ['hand', 'battle', 'trash', 'security', 'deck'].map(k => s.players.p1[k].length), p2: ['hand', 'battle', 'trash', 'security', 'deck'].map(k => s.players.p2[k].length), mem: s.memory, w: s.winner, maxRender: Math.round(LG.maxRender || 0), dom: document.querySelectorAll('*').length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0 }); };
// Drive with cheat hook per turn: LG.cheat(state) invoked once when P1's main phase begins each turn.
LG.play = async (max = 400, ms = 120) => {
  let lastTurn = -1, last = '', same = 0, sameSince = Date.now();
  for (let i = 0; i < max; i++) {
    const { state: s } = __dbg(); if (s.winner) return 'WIN ' + s.winner + ' ' + LG.stats();
    if (s.turnNumber !== lastTurn && s.activePlayer === 'p1' && s.phase === 'main' && !document.querySelector('.modal-panel')) { lastTurn = s.turnNumber; if (LG.cheat) try { LG.cheat(s); __dbg().render(); } catch (e) { LG.note('cheat err ' + e.message); } }
    const cpuTurn = s.activePlayer === 'p2' && !document.querySelector('.modal-panel'); const r = cpuTurn ? 'cpu' : await bots.step(); LG.check('t' + s.turnNumber + ' ' + r.slice(0, 30));
    const sig = JSON.stringify([s.turnNumber, s.phase, s.memory, s.log.length, !!document.querySelector('.modal-panel'), document.querySelector('.modal-panel')?.textContent.length]);
    if (sig === last) { same++; if (Date.now() - sameSince > 45000) return 'STALL ' + r + ' | ' + snap(); } else { same = 0; sameSince = Date.now(); } last = sig; await wait(ms);
  }
  return 'max ' + snap() + ' ' + LG.stats();
};
// ---- card conservation + randomized modal answers + special-card injection ----
LG.count = (s) => { let n = 0; const cnt = (st) => { if (!st) return 0; let k = /TOKEN/.test(st.cardId) ? 0 : 1; k += (st.sources ? st.sources.filter(x => !/TOKEN/.test(x)).length : 0) + (st.linkCards ? st.linkCards.length : 0); return k; }; for (const p of ['p1', 'p2']) { const pl = s.players[p]; n += pl.hand.length + pl.deck.length + pl.trash.length + pl.security.length + pl.digitamaDeck.length + cnt(pl.raising) + pl.battle.reduce((a, st) => a + cnt(st), 0); } return n; };
LG.cons = (tag) => { const { state: s } = __dbg(); if (s.pending.some(t => !t.resolved) || document.querySelector('.modal-panel') || s.pendingAttack) return; const n = LG.count(s); if (LG.total == null || LG.stateRef !== s) { LG.total = n; LG.stateRef = s; LG.injected = 0; } if (n !== LG.total + (LG.injected || 0)) { LG.note(tag + ' CONSERVATION ' + LG.total + '+' + (LG.injected || 0) + ' -> ' + n); LG.total = n - (LG.injected || 0); } };
LG.rnd = (n) => Math.floor(Math.random() * n);
LG.fmodal = async () => {
  const ok0 = () => [...(document.querySelector('.modal-panel')?.querySelectorAll('button') || [])].some(b => !b.disabled && /^확인/.test(b.textContent));
  const mod = document.querySelector('.modal-panel'); if (!mod) return null;
  const bs = [...mod.querySelectorAll('button')].filter(b => !b.disabled);
  const txt = mod.textContent;
  if (/CPU가 결정 중/.test(txt) && !bs.length) return 'cpu-wait';
  if (/블로커≫로 막을|충돌/.test(txt) && Math.random() < 0.5) { const bc = mod.querySelector('.stack-list .card-chip'); if (bc) { bc.click(); return 'block'; } }
  const allChips = [...mod.querySelectorAll('.card-chip')]; const chips = Math.random() < 0.85 ? allChips.filter(c => !c.classList.contains('selected')) : allChips; if (!ok0() && allChips.length) { if (!chips.length) { allChips[LG.rnd(allChips.length)].click(); return 'unsel'; } }
  const ok = bs.find(b => /^확인/.test(b.textContent));
  if (chips.length && Math.random() < 0.7 && (!ok || Math.random() < 0.6)) { chips[LG.rnd(chips.length)].click(); return 'chip'; }
  if (!ok && allChips.length && !bs.length) { allChips[LG.rnd(allChips.length)].click(); return 'chip2'; }
  if (ok && Math.random() < 0.8) { ok.click(); return 'ok'; }
  const cancel = bs.filter(b => /취소|닫기|아니|건너|넘기기|하지 않/.test(b.textContent));
  if (cancel.length && Math.random() < 0.3) { cancel[0].click(); return 'cancel'; }
  const adv = bs.find(b => /^다음 단계|^바로 진행|카운터 단계로/.test(b.textContent)); if (adv && Math.random() < 0.7) { adv.click(); return 'adv'; }
  if (bs.length) { const b = bs[LG.rnd(bs.length)]; const t = b.textContent; b.click(); return 'btn:' + t.slice(0, 12); }
  return 'nobtn';
};
// inject up to n random special cards (matching kw regex list) into P1's hand; counts as injected so conservation stays valid
LG.inject = (s, n = 3) => { const { S } = __dbg(); if (!LG.pool) LG.pool = Object.values(S.CARDS).filter(c => !c.isParallel && ['digimon', 'tamer', 'option'].includes(c.category) && /(조그레스|디지크로스|링크|버스트|어셈블리|【시큐리티】|【메인】|딜레이|리커버리|디코이|세이브|회피|관통|재밍|블로커|어택 시|등장 시|진화 시)/.test(c.effectKo || '')); const pl = s.players.p1; const got = []; for (let i = 0; i < n; i++) { const c = LG.pool[LG.rnd(LG.pool.length)]; pl.hand.push(c.id); got.push(c.id); LG.injected = (LG.injected || 0) + 1; } return got; };
// board stuffing: put k random digimon stacks (with random sources) on a side; counted as injected
LG.stuff = (s, p, k, srcMax = 3) => { const { S } = __dbg(); const pl = s.players[p]; if (!LG.dpool) LG.dpool = Object.values(S.CARDS).filter(c => !c.isParallel && c.category === 'digimon' && c.level >= 3); for (let i = 0; i < k && pl.battle.length < 12; i++) { const c = LG.dpool[LG.rnd(LG.dpool.length)]; const srcs = []; for (let j = 0; j < LG.rnd(srcMax + 1); j++) srcs.push(LG.dpool[LG.rnd(LG.dpool.length)].id); const t = mkStack(p, c.id, srcs, { attackEligibleTurn: 0 }); LG.injected = (LG.injected || 0) + 1 + srcs.length; } };
LG.fplay = async (max = 400, ms = 40, opts = {}) => {
  let lastTurn = -1, last = '', sameSince = Date.now(), n = 0;
  for (let i = 0; i < max; i++) {
    const { state: s } = __dbg(); if (s.winner) return 'WIN ' + s.winner + ' ' + LG.stats();
    if (opts.stop && opts.stop(s)) return 'STOP ' + snap();
    const hasMod = !!document.querySelector('.modal-panel');
    if (s.turnNumber !== lastTurn && s.activePlayer === 'p1' && s.phase === 'main' && !hasMod) { lastTurn = s.turnNumber; try { if (LG.cheat) LG.cheat(s); if (opts.injectN) LG.inject(s, opts.injectN); if (opts.stuff && s.turnNumber > 2) { LG.stuff(s, 'p1', opts.stuff); LG.stuff(s, 'p2', opts.stuff); } __dbg().render(); } catch (e) { LG.note('cheat err ' + e.message); } }
    let r;
    if (hasMod) r = await LG.fmodal(); else if (s.activePlayer === 'p2') r = 'cpu'; else r = await bots.step();
    LG.check('t' + s.turnNumber + ' ' + String(r).slice(0, 30));
    const sig = JSON.stringify([s.turnNumber, s.phase, s.memory, s.log.length, hasMod, document.querySelector('.modal-panel')?.textContent.length]);
    LG.stable = (sig === last) ? (LG.stable || 0) + 1 : 0; if (LG.stable >= 3 && !s.uiChoice && !(s.pendingReplacements || []).length) LG.cons('t' + s.turnNumber + ' ' + String(r).slice(0, 30));
    if (sig === last) { if (Date.now() - sameSince > (opts.stall || 40000)) { const m = document.querySelector('.modal-panel'); LG.note('STALL t' + s.turnNumber + ' ' + snap() + ' modal=' + (m ? m.innerText.replace(/\n/g, ' | ').slice(0, 300) + ' btns=' + [...m.querySelectorAll('button')].map(b => b.textContent + (b.disabled ? '(x)' : '')).join(',') : 'none') + ' last=' + r); return 'STALL'; } } else { sameSince = Date.now(); } last = sig; await wait(ms);
  }
  return 'max ' + snap() + ' ' + LG.stats();
};
LG.fbg = (n, o) => { LG.res = null; LG.fplay(n, 40, o).then(r => LG.res = r); };
// wait until the UI is quiet: a modal is shown, or no uiChoice/pending/attack remains (max ms)
LG.settle = async (ms = 6000) => { const t0 = Date.now(); await wait(80); while (Date.now() - t0 < ms) { const { state: s } = __dbg(); const mod = document.querySelector('.modal-panel'); if (mod) return 'modal'; if (!s.uiChoice && !s.pending.some(t => !t.resolved)) return 'idle'; await wait(80); } return 'timeout'; };
// scenario mode: pause the CPU driver (its beat() would otherwise play on my fabricated p2 turn) and let it finish what it is doing
LG.pauseCpu = async () => { const b = [...document.querySelectorAll('button')].find(x => /일시정지/.test(x.textContent)); if (b) { b.click(); await wait(400); } await wait(1200); };
LG.scenario = async (a = 'L1', b = 'L2', mode = 'cpu') => { await LG.game(a, b, 'hard', mode); await wait(300); if (mode === 'cpu') await LG.pauseCpu(); const { state: s } = __dbg(); s.phase = 'main'; s.activePlayer = 'p1'; s.memory = 10; s.pending.forEach(t => t.resolved = true); s.uiChoice = null; __dbg().render(); await wait(200); return s; };
// answer/close every open prompt (random answers) until the UI is idle; returns the number of steps or 'STUCK:<modal text>'
LG.drain = async (max = 60) => { for (let i = 0; i < max; i++) { await LG.settle(2500); let m = document.querySelector('.modal-panel'); if (!m) { await wait(250); m = document.querySelector('.modal-panel'); if (!m) { await LG.settle(800); m = document.querySelector('.modal-panel'); } if (!m) return i; } const r = await LG.fmodal(); if (r === 'nobtn') return 'STUCK:' + m.innerText.replace(/\n/g, ' | ').slice(0, 300); await wait(120); } return 'STUCK-max:' + (document.querySelector('.modal-panel')?.innerText.replace(/\n/g, ' | ').slice(0, 300) || 'idle'); };
LG.fx = async (m) => { const F = await import('/src/fx.js'); F.fxSetMode(m); return F.fxGetMode(); };
