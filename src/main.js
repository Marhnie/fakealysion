import * as S from './state.js';
import * as E from './engine.js';
import * as Effects from './effects.js';
import * as DB from './deckbuilder.js';

const PHASE_LABEL = { unsuspend: '액티브 페이즈', draw: '드로우 페이즈', breeding: '육성 페이즈', main: '메인 페이즈' };

const app = document.getElementById('app');
let state = null;
let sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1' }; // UI selection only
let dragData = null; // { kind: 'hand', player, idx, cardId } | { kind: 'stack', player, uid, zone }
let panelsOpen = { actions: false, log: false, advancedTools: false }; // everything but the field starts collapsed

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'className') el.className = v;
    else if (typeof v === 'boolean') el[k] = v; // disabled/checked/etc — set as DOM property, not attribute
    else if (/^on[a-z]/.test(k) && typeof v === 'function') el[k] = v; // ondragover/ondrop/etc — assign as IDL property
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

async function init() {
  await S.loadData();
  S.REPL.interactive = true; // optional survive/replacement effects ask the player (state.deleteStack → pendingReplacements)
  S.REPL.onPending = () => { if (state) render(); };
  renderSetup();
}

let setupPick = { p1: null, p2: null };
let setupError = '';

function deckOptionsList() {
  const saved = DB.loadSavedDecks();
  return Object.keys(saved).map(name => ({ key: 'saved:' + name, label: name }));
}

function resolveDeckPick(key) {
  if (key.startsWith('saved:')) {
    const saved = DB.loadSavedDecks();
    return saved[key.slice(6)];
  }
  return key; // built-in key string, looked up inside state.newGame
}

function renderSetup() {
  app.innerHTML = '';
  app.appendChild(h('div', { className: 'topbar' }, [
    h('b', {}, '디지몬 카드게임 시뮬레이터'),
  ]));
  const options = deckOptionsList();
  if (!setupPick.p1 && options[0]) setupPick.p1 = options[0].key;
  if (!setupPick.p2 && options[1]) setupPick.p2 = options[1].key;
  if (!setupPick.p2 && options[0]) setupPick.p2 = options[0].key;

  if (!options.length) {
    app.appendChild(h('div', { className: 'board' }, [
      h('div', { className: 'player-panel' }, [
        h('div', { className: 'section-title' }, '새 게임'),
        h('div', { className: 'actions-row' }, [h('span', {}, '저장된 덱이 없습니다 — 덱 빌더에서 먼저 덱을 만들어주세요.')]),
        h('div', { className: 'actions-row' }, [h('button', { className: 'primary', onClick: openDeckBuilder }, '덱 빌더 열기')]),
      ]),
    ]));
    return;
  }

  const selectFor = (p) => {
    const sel = h('select', {}, options.map(o => h('option', { value: o.key }, o.label)));
    sel.value = setupPick[p];
    sel.addEventListener('change', (e) => { setupPick[p] = e.target.value; });
    return sel;
  };
  const box = h('div', { className: 'board' }, [
    h('div', { className: 'player-panel' }, [
      h('div', { className: 'section-title' }, '새 게임'),
      h('div', { className: 'actions-row' }, [h('span', {}, 'P1 덱'), selectFor('p1')]),
      h('div', { className: 'actions-row' }, [h('span', {}, 'P2 덱'), selectFor('p2')]),
      setupError ? h('div', { className: 'effect-box', style: 'color:var(--danger)' }, setupError) : null,
      h('div', { className: 'actions-row' }, [
        h('button', { className: 'primary', onClick: startNewGame }, '선택한 덱으로 새 게임 시작'),
        h('button', { onClick: openDeckBuilder }, '덱 빌더 열기'),
      ]),
    ]),
  ]);
  app.appendChild(box);
}

// ---------- deck builder ----------

let dbDraft = null;
let dbFilter = { q: '', colors: [], category: '', pageSize: 60 };
let dbSavedName = '';
let dbLastError = '';

function openDeckBuilder() {
  dbDraft = DB.newDraft();
  dbFilter = { q: '', colors: [], category: '', pageSize: 60 };
  dbSavedName = '';
  renderDeckBuilderScreen();
}

function matchesDbFilter(c) {
  if (dbFilter.category && c.category !== dbFilter.category) return false;
  if (dbFilter.colors.length && !dbFilter.colors.some(col => (c.colors || []).includes(col))) return false;
  if (dbFilter.q) {
    const q = dbFilter.q.toLowerCase();
    if (!c.nameKo.includes(dbFilter.q) && !(c.nameDisplayKo || '').includes(dbFilter.q) && !(c.id || '').toLowerCase().includes(q) && !(c.nameEn || '').toLowerCase().includes(q)) return false;
  }
  return true;
}

function allCardIds() { return Object.keys(S.CARDS); }

function renderDeckBuilderScreen() {
  // Full re-render destroys/recreates every DOM node (this app's usual
  // pattern), which would otherwise steal focus out of the search box on
  // every keystroke. Snapshot + restore focus/cursor across the rebuild.
  const prevActive = document.activeElement;
  const wasSearchFocused = prevActive && prevActive.placeholder === '이름/카드번호 검색';
  const prevCursor = wasSearchFocused ? prevActive.selectionStart : null;

  app.innerHTML = '';
  const v = DB.validate(dbDraft);
  app.appendChild(h('div', { className: 'topbar' }, [
    h('b', {}, '덱 빌더'),
    h('span', {}, `메인 ${v.mainN}/50`),
    h('span', { style: v.digitamaN > 5 ? 'color:var(--danger)' : '' }, `디지타마 ${v.digitamaN}/5`),
    h('button', { onClick: () => { state = null; render(); } }, '나가기'),
  ]));

  const filterRow = h('div', { className: 'actions-row' }, [
    (() => { const inp = h('input', { placeholder: '이름/카드번호 검색', value: dbFilter.q }); inp.addEventListener('input', (e) => { dbFilter.q = e.target.value; renderDeckBuilderScreen(); }); return inp; })(),
    ...['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'].map(col => h('button', {
      className: dbFilter.colors.includes(col) ? 'primary' : '',
      onClick: () => { const i = dbFilter.colors.indexOf(col); if (i === -1) dbFilter.colors.push(col); else dbFilter.colors.splice(i, 1); renderDeckBuilderScreen(); },
    }, col)),
    ...['', 'digimon', 'tamer', 'option', 'digitama'].map(cat => h('button', {
      className: dbFilter.category === cat ? 'primary' : '',
      onClick: () => { dbFilter.category = cat; renderDeckBuilderScreen(); },
    }, cat || '전체')),
  ]);

  const matched = allCardIds().filter(id => matchesDbFilter(S.card(id)));
  const shown = matched.slice(0, dbFilter.pageSize);
  const cardGrid = h('div', { className: 'hand-list' }, shown.map(id => {
    const have = DB.copiesInDeck(dbDraft, id);
    return cardChip(id, {
      selected: have > 0,
      sourcesCount: have || undefined,
      onClick: () => { const r = DB.addCard(dbDraft, id); dbLastError = r.ok ? '' : r.reason; renderDeckBuilderScreen(); },
    });
  }));
  if (dbLastError) filterRow.appendChild(h('span', { style: 'color:var(--danger)' }, dbLastError));
  const loadMore = matched.length > shown.length
    ? h('button', { onClick: () => { dbFilter.pageSize += 60; renderDeckBuilderScreen(); } }, `더 보기 (${matched.length - shown.length}장 더 있음)`)
    : h('span', { className: 'meta' }, `총 ${matched.length}장 검색됨`);

  const draftMainList = Object.entries(dbDraft.main).map(([id, n]) => deckLineItem(id, n));
  const draftDigitamaList = Object.entries(dbDraft.digitama).map(([id, n]) => deckLineItem(id, n));

  const saved = DB.loadSavedDecks();
  const nameInput = h('input', { placeholder: '덱 이름', value: dbSavedName });
  nameInput.addEventListener('input', (e) => { dbSavedName = e.target.value; });

  const rightCol = h('div', { className: 'player-panel', style: 'min-width:260px;' }, [
    h('div', { className: 'section-title' }, '내 덱'),
    v.errors.length ? h('div', { className: 'effect-box' }, v.errors.join(' / ')) : h('div', { className: 'meta', style: 'color:var(--ok)' }, '유효한 덱 구성입니다'),
    h('div', { className: 'zone-label' }, `메인덱 (${v.mainN}/50)`),
    h('div', { className: 'stack-list' }, draftMainList),
    h('div', { className: 'zone-label' }, `디지타마덱 (${v.digitamaN}/5)`),
    h('div', { className: 'stack-list' }, draftDigitamaList),
    h('div', { className: 'actions-row' }, [nameInput, h('button', { className: 'primary', onClick: () => {
      if (!dbSavedName.trim()) { dbLastError = '덱 이름을 입력하세요'; renderDeckBuilderScreen(); return; }
      // 1-4-1: an illegal deck (not exactly 50 / >5 digitama / over the copy limit) cannot be saved.
      const legal = DB.validate(dbDraft);
      if (!legal.ok) { dbLastError = '저장 불가 — ' + legal.errors.join(' / '); renderDeckBuilderScreen(); return; }
      dbLastError = '';
      const all = DB.loadSavedDecks();
      all[dbSavedName.trim()] = DB.toDeckDefRecord({ ...dbDraft, name: dbSavedName.trim() });
      DB.saveSavedDecks(all);
      renderDeckBuilderScreen();
    } }, '저장')]),
    Object.keys(saved).length ? h('div', {}, [
      h('div', { className: 'zone-label' }, '저장된 덱'),
      ...Object.keys(saved).map(name => h('div', { className: 'actions-row' }, [
        h('span', {}, name),
        h('button', { onClick: () => { dbDraft = { name, main: { ...saved[name].main }, digitama: { ...saved[name].digitama } }; dbSavedName = name; renderDeckBuilderScreen(); } }, '불러오기'),
        h('button', { className: 'danger', onClick: () => { delete saved[name]; DB.saveSavedDecks(saved); renderDeckBuilderScreen(); } }, '삭제'),
      ])),
    ]) : null,
    h('button', { onClick: () => { dbDraft = DB.newDraft(); dbSavedName = ''; renderDeckBuilderScreen(); } }, '새로 만들기(초기화)'),
  ]);

  app.appendChild(h('div', { className: 'board' }, [
    h('div', { className: 'player-panel' }, [filterRow, cardGrid, loadMore]),
    rightCol,
  ]));

  if (wasSearchFocused) {
    const freshInput = [...app.querySelectorAll('input')].find(i => i.placeholder === '이름/카드번호 검색');
    if (freshInput) { freshInput.focus(); freshInput.setSelectionRange(prevCursor, prevCursor); }
  }
}

function deckLineItem(id, n) {
  return cardChip(id, {
    sourcesCount: n,
    onClick: () => { DB.removeCard(dbDraft, id); renderDeckBuilderScreen(); },
  });
}

let mulliganDecided = { p1: false, p2: false };
// Tracks whose hand was JUST dealt (initial deal, or that player's own
// mulligan) so the deal-in animation only plays for that hand's cards, not
// replayed across both hands on every re-render of this screen (e.g. when
// the other player clicks "이 핸드 유지" after you already mulliganed).
let mulliganDealFlash = { p1: false, p2: false };

function startNewGame() {
  // 1-4-1: refuse to start with an illegal deck (previously-saved decks may predate the save check).
  for (const p of ['p1', 'p2']) {
    const def = resolveDeckPick(setupPick[p]);
    const d = typeof def === 'string' ? S.DECKS[def] : def;
    const v = d ? S.deckLegality(d) : { ok: false, errors: ['덱을 찾을 수 없음'] };
    if (!v.ok) { setupError = `${p.toUpperCase()} 덱 "${d?.name || setupPick[p]}"은(는) 게임에 사용할 수 없습니다: ` + v.errors.join(' / '); renderSetup(); return; }
  }
  setupError = '';
  state = S.newGame(resolveDeckPick(setupPick.p1), resolveDeckPick(setupPick.p2));
  E.drawOpeningHand(state, 'p1');
  E.drawOpeningHand(state, 'p2');
  mulliganDecided = { p1: false, p2: false };
  mulliganDealFlash = { p1: true, p2: true };
  state.firstPlayer = E.coinFlip(); // 5-2-1-3: first player is decided BEFORE hands/mulligans (rock-paper-scissors); 5-2-1-4: mulligan goes first player first
  renderMulliganStage();
}

function renderMulliganStage() {
  app.innerHTML = '';
  app.appendChild(h('div', { className: 'topbar' }, [h('b', {}, '오프닝 핸드 확인 / 멀리건')]));
  const panels = ['p1', 'p2'].map(p => {
    const pl = state.players[p];
    const justDealt = mulliganDealFlash[p];
    mulliganDealFlash[p] = false;
    return h('div', { className: 'player-panel' }, [
      h('div', { className: 'player-header' }, [h('b', {}, p.toUpperCase()), h('span', {}, pl.deckName)]),
      h('div', { className: 'hand-list' + (justDealt ? ' mulligan-hand' : '') }, pl.hand.map(id => cardChip(id, {}))),
      h('div', { className: 'actions-row' }, [
        mulliganDecided[p]
          ? h('span', {}, '결정 완료 ✔')
          : (p !== state.firstPlayer && !mulliganDecided[state.firstPlayer])
          ? h('span', {}, `선공(${state.firstPlayer.toUpperCase()})이 먼저 멀리건 여부를 결정합니다 (룰 5-2-1-4)`)
          : h('button', {
              className: 'primary',
              onClick: () => { E.mulligan(state, p); mulliganDealFlash[p] = true; mulliganDecided[p] = true; afterMulliganCheck(); },
            }, '멀리건 (새로 5장)'),
        !mulliganDecided[p] && (p === state.firstPlayer || mulliganDecided[state.firstPlayer]) && h('button', {
          onClick: () => { mulliganDecided[p] = true; afterMulliganCheck(); },
        }, '이 핸드 유지'),
      ].filter(Boolean)),
    ]);
  });
  app.appendChild(h('div', { className: 'board' }, panels));
}

function afterMulliganCheck() {
  if (mulliganDecided.p1 && mulliganDecided.p2) {
    E.setSecurityStacks(state);
    E.beginGame(state, state.firstPlayer);
    render();
  } else {
    renderMulliganStage();
  }
}

// ---------- render ----------

// 6-5-1: main-phase actions (play / evolve / use / link / attack / activate / pass) may only be
// taken while NOTHING is left unresolved — no waiting effect, open choice, or attack in progress.
function busy() {
  return !!state.uiChoice || !!sel.pendingAttack || !!sel.atkQueued || !!state.turnEnding || state.pending.some(t => !t.resolved);
}
// 6-6-2/6-6-3: a begun turn end finishes only once nothing is left to resolve (no waiting effect, choice, or
// attack — including one an end-of-turn effect has queued to start).
function settleTurnEndIfIdle() {
  if (state.turnEnding && !state.uiChoice && !sel.pendingAttack && !sel.atkQueued && !state.pending.some(t => !t.resolved)) E.settleTurnEnd(state);
}
function blockIfBusy() {
  if (!busy()) return false;
  S.log(state, '해결 중인 처리(효과/선택/어택)가 남아 있어 지금은 행동할 수 없음 (룰 6-5-1)');
  render();
  return true;
}

// A deletion parked by state.deleteStack on an OPTIONAL survive ability (회피/세이브/디코이/printed "…하는 것으로 소멸하지 않는다"):
// ask the owner whether to use it; resumeReplacement re-runs the deletion with that ability allowed / declined.
function pumpReplacementPrompt() {
  const pr = state.pendingReplacements;
  if (!pr || !pr.length || state.uiChoice) return;
  const e = pr[0];
  const nm = e.cardId ? S.card(e.cardId).nameDisplayKo || S.card(e.cardId).nameKo : '';
  state.uiChoice = {
    kind: 'confirmEffect',
    payload: { player: e.p, yesLabel: '사용한다', noLabel: '사용하지 않는다', prompt: `${e.p}: ${nm}이(가) 소멸하려 합니다 — 대신 다음 효과를 사용할 수 있습니다: ${e.lines.join(' / ') || '(생존 효과)'}` },
    resolve: (val) => { state.uiChoice = null; S.resumeReplacement(state, e, !!val); render(); },
  };
}

function render() {
  if (!state) return renderSetup();
  settleTurnEndIfIdle();
  pumpReplacementPrompt();
  E.autoAdvance(state);
  autoRunMandatoryPending();
  // 6-1-4: once memory sits on the opponent's side and there's genuinely
  // nothing left to resolve (no pending effect, no attack/choice in
  // progress), the turn ends immediately — don't wait for a manual "다음
  // 페이즈" click. Checked on every render, so it also catches memory
  // shifted by a card effect (e.g. an "어택 시 메모리 -2" effect) finishing
  // resolution, not just the direct memory-spending actions that already
  // called checkAutoEndTurn themselves.
  if (state.phase === 'main' && !state.pending.length && !sel.pendingAttack && !state.uiChoice && !state.turnEnding) {
    if (E.checkAutoEndTurn(state)) { // turn end begun (6-6-1): start resolving its effects / finish right away when none
      settleTurnEndIfIdle();
      E.autoAdvance(state);
      autoRunMandatoryPending();
    }
  }
  app.innerHTML = '';
  app.classList.toggle('log-open', panelsOpen.log);
  app.appendChild(renderTopbar());
  app.appendChild(renderBoard());
  app.appendChild(renderActions());
  app.appendChild(renderLog());
  const modal = renderModal();
  if (modal) app.appendChild(modal);
  const vanishToast = renderVanishToast();
  if (vanishToast) app.appendChild(vanishToast);
}

// deleteStack() (rule-check DP<=0, battle losses, 【소멸】 effects — every
// route a stack can be destroyed through) pushes the destroyed card's name
// here. Consumed once so it only shows for the render right after it
// happened, similar to pl.pendingDrawFlash.
function renderVanishToast() {
  const names = state.pendingVanishFlash || [];
  state.pendingVanishFlash = [];
  if (!names.length) return null;
  return h('div', { className: 'vanish-toast' }, `💀 소멸: ${names.join(', ')}`);
}

function renderTopbar() {
  const pct = ((state.memory + 10) / 20) * 100;
  const bar = h('div', { className: 'gauge-track' }, [
    h('div', { className: 'gauge-mid' }),
    h('div', { className: 'gauge-fill', style: '' }),
  ]);
  bar.querySelector('.gauge-fill').style.left = state.memory >= 0 ? '50%' : `${pct}%`;
  bar.querySelector('.gauge-fill').style.width = `${Math.abs(state.memory) / 20 * 100}%`;
  if (state.winner) {
    return h('div', { className: 'topbar' }, [h('div', { className: 'topbar-row' }, [h('b', {}, state.winner === 'draw' ? '게임 종료 — 무승부 (영구 순환, 18-3-2)' : `게임 종료 — 승자: ${state.winner}`)])]);
  }
  const mainRow = h('div', { className: 'topbar-row' }, [
    h('b', {}, `턴 ${state.turnNumber}`),
    h('span', {}, `활성: ${state.activePlayer}`),
    h('span', {}, `페이즈: ${PHASE_LABEL[state.phase] || state.phase}`),
    bar,
    h('span', {}, `메모리 ${state.memory >= 0 ? '+' : ''}${state.memory}`),
    h('button', { disabled: state.phase === 'main', title: state.phase === 'main' ? '메인 페이즈는 패스로만 끝낼 수 있음 (룰 6-5-1-7)' : '', onClick: () => { if (blockIfBusy()) return; E.nextPhase(state); render(); } }, '다음 페이즈 ▶'),
    h('button', {
      className: 'danger', disabled: state.phase !== 'main',
      onClick: () => { if (blockIfBusy()) return; E.declarePass(state); render(); },
    }, '패스 (메모리 상대측 3으로 고정하고 턴종료)'),
    ...['p1', 'p2'].map(pp => h('button', { title: '투항: 즉시 패배 (룰 1-2-4, 효과는 유발하지 않음)', onClick: () => { if (window.confirm(`${pp.toUpperCase()} 투항하시겠습니까?`)) { E.surrender(state, pp); render(); } } }, `🏳 ${pp.toUpperCase()} 투항`)),
  ]);
  const rows = [mainRow];
  // Selected-card info (including 진화원효과) lives here — part of the
  // topbar's own normal layout flow, so it can never float on top of a
  // board drag target the way a fixed-position overlay could.
  const infoText = describeSelectedEffects();
  if (infoText) {
    const selStack = findStack(sel.stack);
    const canArmFusion = sel.stack && !sel.stack2 && sel.stack.zone === 'battle' && sel.stack.player === state.activePlayer
      && selStack && !selStack.suspended && S.card(selStack.cardId).category === 'digimon';
    rows.push(h('div', { className: 'topbar-info' }, [
      h('div', { className: 'topbar-info-text' }, infoText),
      canArmFusion && !sel.armFusion
        ? h('button', { onClick: () => { sel.armFusion = true; render(); } }, '🔗 조그레스 상대 선택')
        : null,
      sel.armFusion ? h('span', { className: 'meta' }, '다른 내 디지몬을 클릭하세요') : null,
      h('button', { onClick: () => { sel.hand = null; sel.stack = null; sel.stack2 = null; sel.armFusion = false; render(); } }, '✕'),
    ]));
  }
  return h('div', { className: 'topbar' }, rows);
}

function cardChip(cardId, opts = {}) {
  const c = S.card(cardId);
  const cls = ['card-chip'];
  if (opts.selected) cls.push('selected');
  if (opts.suspended) cls.push('suspended');
  if (opts.attackable) cls.push('attackable');
  if (opts.justDrawn) cls.push('just-drawn');
  // Show the LIVE effective DP (temp/inherited/turn-conditional modifiers
  // all folded in — see S.effectiveDP) rather than always the static
  // printed value, so buffs/debuffs from this session's many DP-modifying
  // effects actually show up somewhere instead of only affecting battle
  // math invisibly. Only for cards that print a DP stat at all (Tamers/
  // Options have none) — effectiveDP would otherwise return a bare 0.
  const dpModified = c.dp && opts.effectiveDp != null && opts.effectiveDp !== c.dp;
  const dpNode = c.dp
    ? h('span', { className: dpModified ? (opts.effectiveDp > c.dp ? 'dp-buffed' : 'dp-debuffed') : '' },
        dpModified ? `DP${c.dp}→${opts.effectiveDp}` : `DP${c.dp}`)
    : null;
  const metaParts = [c.level ? `Lv.${c.level}` : c.category, dpNode, c.cost != null ? `C${c.cost}` : null].filter(x => x != null);
  const metaChildren = metaParts.flatMap((part, i) => i === 0 ? [part] : [' · ', part]);
  const attrs = { className: cls.join(' '), onClick: opts.onClick };
  if (opts.draggable) {
    attrs.draggable = true;
    attrs.ondragstart = (e) => { dragData = opts.dragPayload; e.target.classList.add('dragging'); };
    attrs.ondragend = (e) => { e.target.classList.remove('dragging'); };
  }
  if (opts.onDrop) {
    attrs.ondragover = (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); };
    attrs.ondragleave = (e) => { e.currentTarget.classList.remove('drop-hover'); };
    attrs.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-hover'); opts.onDrop(dragData); };
  }
  return h('div', attrs, [
    c.imgUrl ? h('img', { src: c.imgUrl, alt: c.nameKo, loading: 'lazy' }) : null,
    h('div', { className: 'nm' }, c.nameDisplayKo || c.nameKo),
    h('div', { className: 'meta' }, metaChildren),
    opts.keywordBadges?.length ? h('div', { className: 'keyword-badges' }, opts.keywordBadges.map(k => h('span', { className: 'kw-badge' }, k))) : null,
    opts.sourcesCount ? h('div', { className: 'stack-src' }, `진화원 ${opts.sourcesCount}장`) : null,
  ]);
}

// Short labels for every keyword this session's many systems can actually
// grant a stack — shown on the card chip itself instead of only affecting
// game logic invisibly, same motivation as showing effectiveDp: none of
// these ever appeared anywhere on the board before.
const KEYWORD_BADGE_LABEL = {
  블로커: '🛡블로커', 재밍: '🌀재밍', 관통: '🗡관통', 재기동: '🔄재기동',
  속공: '⚡속공', 진격: '⚔진격', 길동무: '🤝길동무', 방벽: '🧱방벽', 아머퍼지: '🛡아머퍼지', 회피: '💨회피', 스케이프고트: '🐐스케이프고트', 불굴: '🔥불굴', 돌진: '🐗돌진', 연계: '🔗연계', 빙장: '🧊빙장', 트레이닝: '🏋트레이닝', 프래그먼트: '🧩프래그먼트', DP감소무효: '🚫DP감소무효',
  무진화원액티브공격: '🎯무진화원액티브공격', 액티브공격: '🎯액티브공격',
  수호: '🛡수호', 급습: '🗡급습', 프로그레스: '⏩프로그레스',
};
function activeKeywordBadges(stack) {
  const badges = [];
  const seen = new Set();
  for (const src of [stack.keywords, stack.inheritedKeywords]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (!v || seen.has(k)) continue;
      seen.add(k);
      if (k === '시큐리티어택') badges.push(`S어택+${v}`);
      else if (KEYWORD_BADGE_LABEL[k]) badges.push(KEYWORD_BADGE_LABEL[k]);
    }
  }
  return badges;
}

function renderStack(p, stack, zoneKind, opts = {}) {
  const isSelected = sel.stack && sel.stack.uid === stack.uid;
  const isSecondSelected = sel.stack2 && sel.stack2.uid === stack.uid;
  const isOwnActiveBattle = p === state.activePlayer && zoneKind === 'battle' && !stack.suspended && state.phase === 'main';
  const chip = cardChip(stack.cardId, {
    selected: isSelected || isSecondSelected,
    suspended: stack.suspended,
    sourcesCount: stack.sources.length,
    effectiveDp: zoneKind === 'raising' ? undefined : S.effectiveDP(state, p, stack),
    keywordBadges: activeKeywordBadges(stack),
    draggable: isOwnActiveBattle,
    dragPayload: { kind: 'stack', player: p, uid: stack.uid, zone: zoneKind },
    attackable: !!opts.attackTarget,
    onDrop: async (drag) => {
      if (!drag) return;
      // An opposing battle stack dropped directly onto this one is a direct
      // attack declaration on THIS specific digimon — no separate target-
      // choice menu needed, the drop location already said which target.
      if (drag.kind === 'stack' && drag.player !== p && drag.zone === 'battle' && zoneKind === 'battle') {
        attackFlow(drag.player, drag.uid, stack.uid);
        dragData = null; render();
        return;
      }
      if (drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main' || S.card(drag.cardId).category !== 'digimon') return;
      if (blockIfBusy()) return;
      // Dropping the hand card on the SECOND of two selected battle stacks
      // is how DNA/Jogress fusion is triggered — no separate button needed,
      // the two-click stack1+stack2 selection already signals that intent.
      if (isSecondSelected && sel.stack && sel.stack.player === p && sel.stack.uid !== stack.uid) {
        const stA = findStack(sel.stack);
        const jr = stA ? S.canJogress(stA, stack, drag.cardId) : { ok: true };
        if (!jr.ok) {
          S.log(state, `${p} ${S.card(drag.cardId).nameKo} 조그레스 거부: ${S.card(stA.cardId).nameKo}+${S.card(stack.cardId).nameKo} (${jr.reason})`);
          dragData = null; render();
          return;
        }
        // 8-2-3-2 / 8-2-2-5: pay the printed jogress cost, adjusted by evolve-cost effects (falls back to the manual input only for unparsed lines).
        const evoSnap = S.snapshotEvoCostMods(state, p); // a rejected jogress must not burn the one-time discount
        let jcost = jr.cost != null ? jr.cost : Number(val('costInput')) || 0;
        if (jr.cost != null) jcost = Math.max(0, jcost + S.consumeEvoCostMod(state, p, drag.cardId) + S.continuousEvoCostDiscount(state, p, stack, drag.cardId) + S.hookEvoCostDiscount(state, p, stack, drag.cardId));
        if (!S.fuseStacks(state, p, sel.stack.uid, stack.uid, drag.cardId, jcost, 'hand')) S.restoreEvoCostMods(evoSnap);
        sel.stack = null; sel.stack2 = null;
        E.checkAutoEndTurn(state);
        dragData = null; render();
        return;
      }
      // canEvolveAny checks evoNormal AND every special "〔진화〕 <이름/특징>"
      // line on the target — a failure here means NO printed condition
      // justifies this evolution, so the drop must be rejected outright
      // rather than silently let through for cost 0.
      if (S.card(stack.cardId).category !== 'digimon') { S.log(state, `${p} 진화 거부: ${S.card(stack.cardId).nameKo}는 디지몬이 아님 (8-1-1)`); dragData = null; render(); return; }
      let check = E.canEvolveAny(stack.cardId, drag.cardId, S.evoExtraArg(state, p, stack), S.evolveTargetRestriction(state, p, stack));
      const s1alt = S.s1EvolveAlt(state, p, stack, drag.cardId); // shard1: 진화조건 무시 + 고정 코스트
      if (s1alt && (!check.ok || s1alt.cost < check.cost)) check = { ok: true, cost: s1alt.cost, raw: '특수 진화' };
      // 8-3 버스트 진화 / 8-4 어플 합체: printed special evolutions (the normal condition check above never covers them).
      const restrOk = E.evoRestrictionCheck(drag.cardId, S.evolveTargetRestriction(state, p, stack)).ok;
      const burst = restrOk && S.parseBurstEvolution(drag.cardId) ? S.burstCheck(state, p, stack, drag.cardId) : null;
      const appf = restrOk && S.parseAppFusion(drag.cardId) ? S.appFusionCheck(state, p, stack, drag.cardId) : null;
      const special = burst && burst.ok ? 'burst' : appf && appf.ok ? 'app' : null;
      if (special && (!check.ok || await askYN(p, special === 'burst' ? '《버스트 진화》로 진화할까요? (테이머를 패로 되돌림)' : '《어플 합체》로 진화할까요? (링크 카드를 위에 겹침)'))) {
        const evoSnap2 = S.snapshotEvoCostMods(state, p);
        const baseCost = special === 'burst' ? burst.cost : appf.cost;
        const cost2 = Math.max(0, baseCost + S.consumeEvoCostMod(state, p, drag.cardId) + S.continuousEvoCostDiscount(state, p, stack, drag.cardId) + S.hookEvoCostDiscount(state, p, stack, drag.cardId)); // 8-3-2-3 / 8-4-2-3
        let tUid = null;
        if (special === 'burst' && burst.tamerUids.length > 1) { tUid = await ctxChoose('pickStack', { player: p, uids: burst.tamerUids, required: true, prompt: '《버스트 진화》 — 패로 되돌릴 자신의 테이머를 선택하세요' }) || burst.tamerUids[0]; }
        const res = special === 'burst' ? S.burstEvolve(state, p, stack.uid, drag.cardId, cost2, tUid) : S.appFusion(state, p, stack.uid, drag.cardId, cost2);
        if (!res) S.restoreEvoCostMods(evoSnap2);
        E.checkAutoEndTurn(state);
        dragData = null; render();
        return;
      }
      if (!check.ok) {
        S.log(state, `${p} 진화 조건 불일치로 거부: ${S.card(stack.cardId).nameKo} → ${S.card(drag.cardId).nameKo} (${check.reason})`);
        dragData = null; render();
        return;
      }
      const evoSnap = S.snapshotEvoCostMods(state, p); // a rejected evolution must not burn the one-time discount
      let evoModDelta = S.consumeEvoCostMod(state, p, drag.cardId) + S.continuousEvoCostDiscount(state, p, stack, drag.cardId);
      evoModDelta += S.hookEvoCostDiscount(state, p, stack, drag.cardId);
      evoModDelta += S.s1EvoAuto(state, p, stack, drag.cardId); // shard1
      for (const o of S.s1EvoOptions(state, p, stack, drag.cardId)) { if (await askYN(p, o.label)) evoModDelta += o.apply() || 0; }
      for (const o of S.hookEvoCostOptions(state, p, stack, drag.cardId)) { if (await askYN(p, o.label)) evoModDelta += o.apply() || 0; }
      const absorb = S.absorbEvolveOption(state, p, stack, drag.cardId);
      if (absorb && absorb.candidates.length && await askYN(p, `《흡수진화》 — 다른 액티브 디지몬 1마리를 레스트시켜 진화 코스트 ${absorb.delta}?`)) {
        // the player picks WHICH active Digimon is rested (8-x 《흡수진화》)
        const au = absorb.candidates.length > 1 ? await ctxChoose('pickStack', { player: p, uids: absorb.candidates, required: true, prompt: '《흡수진화》 — 레스트시킬 자신의 액티브 디지몬을 선택하세요' }) : absorb.candidates[0];
        S.restStack(state, p, au || absorb.candidates[0]);
        evoModDelta += absorb.delta;
      } else if (absorb && absorb.oppCandidates && absorb.oppCandidates.length && await askYN(p, `《흡수진화》 — 상대의 액티브 디지몬 1마리를 레스트시켜 진화 코스트 ${absorb.delta}?`)) {
        const ou = absorb.oppCandidates.length > 1 ? await ctxChoose('pickStack', { player: S.opponentOf(p), uids: absorb.oppCandidates, required: true, prompt: '《흡수진화》 — 레스트시킬 상대의 액티브 디지몬을 선택하세요' }) : absorb.oppCandidates[0];
        S.restStack(state, S.opponentOf(p), ou || absorb.oppCandidates[0]); // shard1 (BT3-056)
        evoModDelta += absorb.delta;
      }
      const cost = Math.max(0, check.cost + evoModDelta);
      if (!S.digivolve(state, p, stack.uid, drag.cardId, cost, 'hand')) S.restoreEvoCostMods(evoSnap);
      E.checkAutoEndTurn(state);
      dragData = null; render();
    },
    onClick: opts.onClickOverride || (opts.attackTarget
      ? (() => { attackFlow(opts.attackTarget.attackerP, opts.attackTarget.attackerUid, stack.uid); sel.stack = null; render(); })
      : (() => {
        if (sel.stack && sel.stack.uid === stack.uid) { sel.stack = null; sel.armFusion = false; }
        // Only treat this click as picking a DNA/Jogress fusion partner when
        // the "조그레스 상대 선택" button was explicitly used first — otherwise
        // simply viewing one card's info, then clicking a different card to
        // view ITS info instead, was silently arming the second fusion slot
        // and hijacking the next click on that card.
        else if (sel.armFusion && sel.stack && !sel.stack2 && sel.stack.player === p && zoneKind === 'battle' && sel.stack.uid !== stack.uid) {
          sel.stack2 = { player: p, uid: stack.uid, zone: zoneKind };
          sel.armFusion = false;
        } else {
          sel.stack = { player: p, uid: stack.uid, zone: zoneKind };
          sel.stack2 = null;
          sel.armFusion = false;
        }
        render();
      })),
  });

  // 16-17 ≪딜레이≫: this placed card can be discarded (from turns after the
  // one it was placed on) to run its listed bullet effect. Rerouted through
  // state.pending instead of running it directly here, reusing the exact
  // same auto-run/manual-resolve/delay-banner machinery every other
  // triggered effect already goes through — no separate async plumbing
  // needed in this onClick.
  const delayBody = zoneKind === 'battle' ? S.parseDelayEffect(S.card(stack.cardId).effectKo) : null;
  const canDelay = delayBody && p === state.activePlayer && state.phase === 'main' && state.turnNumber > stack.placedTurn;
  const delayBtn = canDelay ? h('button', {
    className: 'delay-btn',
    title: `《딜레이》 발동: ${delayBody}`,
    onClick: (e) => {
      e.stopPropagation();
      if (blockIfBusy()) return;
      const cardId = S.discardForDelay(state, p, stack.uid);
      if (cardId) state.pending.push({ uid: 'delay' + Math.random().toString(36).slice(2), player: p, cardId, stackUid: null, tags: ['메인'], text: delayBody, resolved: false });
      render();
    },
  }, '🗑딜레이') : null;

  // ≪트레이닝≫ — activated main-phase ability (also usable from the raising area).
  const canTrain = (zoneKind === 'battle' || zoneKind === 'raising') && p === state.activePlayer && state.phase === 'main'
    && S.hasKeyword(stack, '트레이닝') && !stack.suspended && state.players[p].deck.length > 0;
  const trainBtn = canTrain ? h('button', {
    className: 'delay-btn train-btn',
    title: '《트레이닝》 — 이 디지몬을 레스트시키고 덱 위 1장을 진화원 아래에 놓음',
    onClick: (e) => { e.stopPropagation(); if (blockIfBusy()) return; S.useTraining(state, p, stack.uid); render(); },
  }, '🏋트레이닝') : null;
  // Activated 【메인】 abilities printed on Digimon/Tamer cards (incl. 《디지버스트》).
  const mainAbilities = (zoneKind === 'battle' || zoneKind === 'raising') ? S.activatableMainAbilities(state, p, stack, zoneKind) : [];
  const mainBtns = mainAbilities.length ? h('div', { className: 'main-btns' }, mainAbilities.map((ab, i) => h('button', {
    className: 'delay-btn main-btn',
    title: `【메인】 ${ab.text.replace(/\n/g, ' ')}`,
    onClick: (e) => {
      e.stopPropagation();
      if (blockIfBusy()) return;
      state.pending.push({ uid: 'main' + Math.random().toString(36).slice(2), player: p, cardId: ab.cardId, stackUid: stack.uid, tags: ab.tags, text: ab.text, resolved: false });
      render();
    },
  }, mainAbilities.length > 1 ? `⚡메인${i + 1}` : '⚡메인'))) : null;
  const extraBtns = [delayBtn, trainBtn, mainBtns].filter(Boolean);

  // 10-1-1: the link condition/cost are printed on the card being linked (S.linkCheck); any own battle Digimon can be a host candidate.
  const linkSlots = (zoneKind === 'battle' && S.card(stack.cardId).category === 'digimon' && p === state.activePlayer) ? [{ grantedBy: stack.cardId, conditionText: '드롭한 카드의 링크 조건', cost: '?' }] : [];
  if (!linkSlots.length) return extraBtns.length ? h('div', { className: 'stack-wrap' }, [chip, ...extraBtns]) : chip;
  // Small overlay badge, separately droppable, so dragging a hand card onto
  // it links instead of digivolving — distinct from dropping on the card art.
  const badge = h('div', {
    className: 'link-badge',
    title: linkSlots.map(s => `${S.card(s.grantedBy).nameKo} 링크: ${s.conditionText} (코스트 ${s.cost})`).join('\n'),
    ondragover: (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-hover'); },
    ondragleave: (e) => { e.currentTarget.classList.remove('drop-hover'); },
    ondrop: async (e) => {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-hover');
      const drag = dragData;
      // 6-5-1-4-1: a Digimon standing in the battle area can be linked to another Digimon too (drag its stack onto the 🔗 badge).
      if (drag && drag.kind === 'stack' && drag.zone === 'battle' && drag.player === p && drag.uid !== stack.uid && p === state.activePlayer && state.phase === 'main') {
        if (blockIfBusy()) return;
        const src = findStack({ player: p, uid: drag.uid });
        const lk2 = src ? S.linkCheck(state, p, stack, src.cardId) : { ok: false, reason: '카드 없음' };
        if (!lk2.ok) { S.log(state, `${p} 링크 거부: ${src ? S.card(src.cardId).nameKo : '?'} → ${S.card(stack.cardId).nameKo} (${lk2.reason})`); dragData = null; render(); return; }
        S.linkFromBattle(state, p, drag.uid, stack.uid, Math.max(0, lk2.cost + (S.s7LinkCostDelta ? S.s7LinkCostDelta(state, p, stack, src.cardId) : 0)));
        E.checkAutoEndTurn(state);
        dragData = null; render();
        return;
      }
      if (!drag || drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main') return;
      if (blockIfBusy()) return; // 6-5-1: no link while something is unresolved
      if (blockIfBusy()) return;
      const lk = S.linkCheck(state, p, stack, drag.cardId);
      if (!lk.ok) { S.log(state, `${p} 링크 거부: ${S.card(drag.cardId).nameKo} → ${S.card(stack.cardId).nameKo} (${lk.reason})`); dragData = null; render(); return; }
      dragData = null;
      const lcost = Math.max(0, lk.cost + (S.s7LinkCostDelta ? S.s7LinkCostDelta(state, p, stack, drag.cardId) : 0));
      const dIdx = await S.linkDiscardIdx(state, p, stack.uid, ctxChoose); // 4-9-5: the player picks which old link card goes
      S.linkCardTo(state, p, stack.uid, drag.cardId, drag.cardId, lcost, 'hand', dIdx);
      E.checkAutoEndTurn(state);
      render();
    },
  }, '🔗' + (stack.linkCards?.length ? stack.linkCards.length : ''));
  return h('div', { className: 'stack-wrap' }, [chip, badge, ...extraBtns]);
}

// Yes/no through the game's own modal (ctxChoose) instead of a blocking browser dialog.
const askYN = (player, prompt) => ctxChoose('confirmEffect', { player, prompt, yesLabel: '예', noLabel: '아니오' });

async function playFreshFromDrag(drag, p) {
  if (blockIfBusy()) return;
  if (!drag || drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main') return;
  const category = S.card(drag.cardId).category;
  if (category === 'digimon' && S.isPlayRestricted(state, drag.player, drag.cardId)) { S.log(state, `${drag.player} ${S.card(drag.cardId).nameKo}: 효과로 등장시킬 수 없음 (DP 제한)`); dragData = null; render(); return; }
  if (category === 'option') {
    let optDelta = 0; // s8: HOOKS.playDiscount also applies to Option cards ("…옵션 카드를 사용할 때, …사용 코스트 -N")
    for (const o of S.hookPlayCostOptions(state, drag.player, drag.cardId)) { if (await askYN(drag.player, o.label)) optDelta += o.apply() || 0; }
    S.useOptionCard(state, drag.player, drag.idx, { costDelta: optDelta });
  } else {
    let discount = S.card(drag.cardId).category === 'digimon' ? S.tamerPlayCostDiscount(state, drag.player, drag.cardId) + S.traitPlayCostDiscount(state, drag.player, drag.cardId) : 0;
    // 《디지크로스》 (7-2): optionally place matching hand/battle cards under this card for -N each.
    let materials = [], restTamers = [];
    // 7-2-2-3/4: the player picks which candidate cards (from hand / battle area / tamer / trash) go under, at least 1.
    const xrOpts = category === 'digimon' ? S.digiXrosOptions(state, drag.player, drag.idx) : [];
    if (xrOpts.length && await askYN(drag.player, `《디지크로스》 — 재료를 아래에 놓고 등장 코스트를 줄이시겠습니까? (후보: ${xrOpts.map(o => S.card(o.cardId).nameKo).join(', ')})`)) {
      const KIND = { hand: '패', battle: '배틀 에어리어', tamer: '테이머 아래', trash: '트래시' };
      const keys = new Set();
      for (const o of xrOpts) if (xrOpts.length === 1 || await askYN(drag.player, `${S.card(o.cardId).nameKo} (${KIND[o.kind] || o.kind})을(를) 아래에 놓겠습니까?`)) keys.add(o.key);
      const xr = keys.size ? S.planDigiXrosPicked(state, drag.player, drag.idx, keys) : null;
      if (xr) { materials = xr.materials; discount -= xr.discount; restTamers = xr.restTamers || []; }
    }
    // 《어셈블리》 (7-3): place exactly the required trash cards under the card for a fixed play-cost reduction (all or nothing).
    let assembly = [];
    const asmPlan = category === 'digimon' ? S.planAssembly(state, drag.player, drag.idx) : null;
    if (asmPlan && await askYN(drag.player, `《어셈블리 -${asmPlan.per}》 — 트래시의 ${asmPlan.materials.map(m => S.card(m.cardId).nameKo).join(', ')}을(를) 아래에 놓고 등장 코스트 -${asmPlan.discount}?`)) {
      assembly = asmPlan.materials; discount -= asmPlan.discount;
    }
    // Card-specific "…등장할 때, <비용>하는 것으로 지불하는 등장 코스트 -N" abilities (HOOKS.playDiscount) — confirmed one by one.
    for (const o of S.hookPlayCostOptions(state, drag.player, drag.cardId)) { if (await askYN(drag.player, o.label)) discount += o.apply() || 0; }
    if (category === 'digimon') discount += S.s1PlayDiscount(state, drag.player, drag.cardId); // shard1
    const cost = Math.max(0, (S.card(drag.cardId).cost || 0) + discount);
    if (!S.canPayCost(state, cost)) { S.log(state, `${drag.player} ${S.card(drag.cardId).nameKo} 등장 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); dragData = null; render(); return; }
    if (cost > 0) S.spendMemory(state, cost);
    S.playDigimonFresh(state, drag.player, drag.idx, { materials, restTamers, assembly });
  }
  E.checkAutoEndTurn(state);
  dragData = null; render();
}

// A small square tile showing a face-down pile's count + label — deck/
// security/digitama/trash, styled like the reference layout's side piles
// instead of plain text.
function pileChip(label, count, extraClass = '', onClick) {
  return h('div', { className: `pile-chip ${extraClass}${onClick ? ' clickable' : ''}`, onClick }, [
    h('div', { className: 'pile-count' }, String(count)),
    h('div', { className: 'pile-label' }, label),
  ]);
}

function zonePill(text) {
  return h('div', { className: 'zone-pill' }, text);
}

function renderPlayerPanel(p) {
  const pl = state.players[p];
  const isActive = state.activePlayer === p;
  const canAttackThisPlayerByDrag = dragData && dragData.kind === 'stack' && dragData.player !== p && S.canAttackPlayer(state, dragData.player, dragData.uid);
  // Selecting your own eligible attacker (click, same as picking DNA/link
  // targets) highlights every legal target on the OPPONENT's side directly
  // on the board — the player and each attackable Digimon — as a second,
  // more discoverable way to attack besides dragging.
  const selectedEnemyAttacker = (sel.stack && sel.stack.player !== p && sel.stack.zone === 'battle' && sel.stack.player === state.activePlayer && state.phase === 'main')
    ? findStack(sel.stack) : null;
  const canAttackThisPlayerByClick = selectedEnemyAttacker && !selectedEnemyAttacker.suspended && S.canAttackPlayer(state, sel.stack.player, sel.stack.uid);
  const canAttackThisPlayer = canAttackThisPlayerByDrag || canAttackThisPlayerByClick;
  const legalClickTargets = canAttackThisPlayerByClick ? new Set(S.legalDigimonTargets(state, sel.stack.player, sel.stack.uid)) : new Set();
  const header = h('div', {
    className: `player-header${canAttackThisPlayer ? ' attackable' : ''}`,
    ondragover: canAttackThisPlayerByDrag ? (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); } : undefined,
    ondragleave: canAttackThisPlayerByDrag ? (e) => e.currentTarget.classList.remove('drop-hover') : undefined,
    ondrop: canAttackThisPlayerByDrag ? (e) => {
      e.preventDefault(); e.currentTarget.classList.remove('drop-hover');
      if (dragData && dragData.kind === 'stack' && dragData.zone === 'battle') { attackFlow(dragData.player, dragData.uid, 'PLAYER'); }
      dragData = null;
    } : undefined,
    onClick: canAttackThisPlayerByClick ? () => { attackFlow(sel.stack.player, sel.stack.uid, 'PLAYER'); sel.stack = null; render(); } : undefined,
  }, [
    h('b', {}, p.toUpperCase()),
    h('span', {}, pl.deckName),
    canAttackThisPlayer ? h('span', { style: 'color:var(--danger)' }, '← 클릭/드래그로 이 플레이어 공격') : null,
  ]);

  // 6-4: hatch OR move, not both, per breeding phase visit
  const canHatch = state.phase === 'breeding' && p === state.activePlayer && !state.breedingActionTaken && !pl.raising && pl.digitamaDeck.length > 0;
  const pileRail = h('div', { className: 'pile-rail' }, [
    pileChip('덱', pl.deck.length, 'pile-deck'),
    pileChip('시큐리티', pl.security.length, 'pile-security'),
    // 3-1-2-1 / 3-6-3: the trash is a public zone — its cards (and order, top = last) can be inspected by anyone at any time.
    pileChip(panelsOpen.trashOf?.[p] ? '트래시 ▼' : '트래시', pl.trash.length, 'pile-trash', () => { (panelsOpen.trashOf ||= {})[p] = !panelsOpen.trashOf[p]; render(); }),
    panelsOpen.trashOf?.[p] ? h('div', { className: 'hand-list trash-list' }, pl.trash.length ? pl.trash.slice().reverse().map(id => cardChip(id, {})) : [h('span', {}, '(비어 있음)')]) : null,
  ].filter(Boolean));

  const canMoveRaising = state.phase === 'breeding' && p === state.activePlayer && !state.breedingActionTaken && pl.raising && S.canMoveFromRaising(pl.raising);
  const raisingZone = h('div', { className: 'zone hex-field' }, [
    zonePill(canMoveRaising ? '육성 에어리어 (카드 클릭=배틀 이동)' : '육성 에어리어'),
    h('div', { className: 'hex-slot-row' }, [
      pl.raising
        ? renderStack(p, pl.raising, 'raising', canMoveRaising ? { onClickOverride: () => { if (blockIfBusy()) return; S.moveRaisingToBattle(state, p); render(); } } : {})
        : h('div', { className: 'empty-slot' }, '비어있음'),
      // digitama pile lives right next to the raising area it feeds, not
      // grouped with the unrelated deck/security/trash counters
      pileChip(canHatch ? '디지타마 (클릭=부화)' : '디지타마', pl.digitamaDeck.length, 'pile-digitama', canHatch ? () => { if (blockIfBusy()) return; S.hatchDigitama(state, p); render(); } : undefined),
    ]),
  ]);

  const battleZone = h('div', { className: 'zone drop-zone hex-field' }, [
    zonePill('배틀 에어리어 (핸드카드를 여기로 드래그하면 등장)'),
    h('div', {
      className: 'stack-list hex-slot-row',
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-hover'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); playFreshFromDrag(dragData, p); },
    }, [
      ...pl.battle.map(s => renderStack(p, s, 'battle', legalClickTargets.has(s.uid) ? { attackTarget: { attackerP: sel.stack.player, attackerUid: sel.stack.uid } } : {})),
      // Always show plenty of open slots to drop a new card into — at
      // least 3 empty ones, more if the area is still mostly empty —
      // instead of only appearing once and disappearing the moment the
      // area has a single card in it.
      ...Array(Math.max(3, 6 - pl.battle.length)).fill(0).map(() => h('div', { className: 'empty-slot' }, '비어있음')),
    ]),
  ]);

  // Explicit counter set by S.drawCards, not a hand.length diff — a
  // digivolve's bonus draw nets to a ZERO length change (one card spent on
  // the evolution, one drawn back), which silently hid it from a length-
  // diff detector. Consumed (reset to 0) right after reading so it only
  // flashes once, on the render right after the draw happened.
  const justDrawnCount = pl.pendingDrawFlash || 0;
  pl.pendingDrawFlash = 0;
  const handZone = h('div', { className: 'zone hand-zone', style: 'flex:1' }, [
    zonePill(`핸드 (${pl.hand.length}장, 연습용 전체 공개) — 배틀 에어리어로 드래그=등장, 내 스택 위로 드래그=진화, 상대 이름 위로 스택 드래그=공격`),
    ...(() => {
      // "[패]【메인】"/"[트래시]【메인】" abilities printed on Digimon/Tamer cards (usable from hand / trash in the main phase)
      const abs = [...S.zoneMainAbilities(state, p, 'hand').map(a => ({ ...a, zone: 'hand' })), ...S.zoneMainAbilities(state, p, 'trash').map(a => ({ ...a, zone: 'trash' }))];
      return abs.length ? [h('div', { className: 'actions-row' }, abs.map(a => h('button', {
        className: 'delay-btn main-btn', title: `【메인】 ${a.text.replace(/\n/g, ' ')}`,
        onClick: () => {
          if (blockIfBusy()) return;
          state.pending.push({ uid: 'zmain' + Math.random().toString(36).slice(2), player: p, cardId: a.cardId, stackUid: null, tags: a.tags, text: a.text, resolved: false, zoneMain: a.zone, zoneIdx: a.idx });
          render();
        },
      }, `⚡메인(${a.zone === 'hand' ? '패' : '트래시'}) ${S.card(a.cardId).nameKo}`)))] : [];
    })(),
    h('div', { className: 'hand-list' }, pl.hand.map((id, i) => cardChip(id, {
      selected: sel.hand && sel.hand.player === p && sel.hand.idx === i,
      draggable: p === state.activePlayer && state.phase === 'main',
      dragPayload: { kind: 'hand', player: p, idx: i, cardId: id },
      justDrawn: i >= pl.hand.length - justDrawnCount,
      onClick: () => { sel.hand = (sel.hand && sel.hand.idx === i && sel.hand.player === p) ? null : { player: p, idx: i, cardId: id }; render(); },
    }))),
  ]);

  return h('div', { className: `player-panel${isActive ? ' active' : ''}` }, [
    header,
    h('div', { className: 'field-row' }, [
      h('div', { className: 'field-zones' }, [
        h('div', { className: 'zone-row' }, [raisingZone, battleZone]),
        handZone,
      ]),
      pileRail,
    ]),
  ]);
}

// Horizontal memory-gauge number line (-10..0..+10 with a position marker),
// shared between both panels — mirrors the physical "메모리 게이지" strip.
function renderMemoryTrack() {
  const cells = [];
  for (let n = 10; n >= 0; n--) cells.push(n);
  for (let n = 1; n <= 10; n++) cells.push(n);
  const numRow = h('div', { className: 'mem-numbers' },
    cells.map((n, i) => h('span', { className: 'mem-num' + (i === 10 ? ' mem-zero' : '') }, String(n))));
  const pos = ((state.memory + 10) / 20) * 100;
  return h('div', { className: 'mem-track' }, [
    numRow,
    h('div', { className: 'mem-marker', style: `left:${pos}%` }),
  ]);
}

function renderBoard() {
  if (state.winner) return h('div', { className: 'board' });
  return h('div', { className: 'board' }, [
    h('div', { className: 'table-surface' }, [
      renderPlayerPanel('p2'),
      renderMemoryTrack(),
      renderPlayerPanel('p1'),
    ]),
  ]);
}

// ---------- action panel ----------

function numInput(id, value = 1) {
  return h('input', { type: 'number', id, value, min: '0' });
}
function val(id) { return Number(document.getElementById(id)?.value || 0); }

// Best-effort pattern → one-click-action compiler over the OFFICIAL Korean
// effect text. This is intentionally NOT a full NLP parser — natural-language
// game text has too much conditional/branching structure to fully automate.
// It recognizes the common, unconditional numeric patterns that make up a
// large share of card text, and leaves everything else for manual handling
// via the generic tools (which stay visible either way).
function quickApplyButtonsFor(text, player) {
  const opp = S.opponentOf(player);
  const btns = [];
  let m;

  if ((m = text.match(/[≪《]\s*(\d+)\s*드로우\s*[≫》]/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.drawCards(state, player, n); render(); } }, `${player} ${n}드로우`));
  }
  if ((m = text.match(/메모리(?:를|을)?\s*\+\s*(\d+)/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.grantMemory(state, player, n); render(); } }, `${player} 메모리+${n}`));
  }
  if ((m = text.match(/메모리(?:를|을)?\s*-\s*(\d+)/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.grantMemory(state, player, -n); render(); } }, `${player} 메모리-${n}`));
  }
  if ((m = text.match(/(?:자신의\s*)?덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.trashTopOfDeck(state, player, n); render(); } }, `${player} 덱 위 ${n}장 파기`));
  }
  if ((m = text.match(/상대(?:의)?\s*덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.trashTopOfDeck(state, opp, n); render(); } }, `${opp}(상대) 덱 위 ${n}장 파기`));
  }
  if (/패(?:를)?\s*전부\s*파기|핸드(?:를)?\s*전부\s*파기/.test(text)) {
    btns.push(h('button', { onClick: () => { const n = state.players[player].hand.length; for (let i=0;i<n;i++) S.trashFromHand(state, player, 0); render(); } }, `${player} 핸드 전부 파기`));
  }
  if ((m = text.match(/자신의\s*시큐리티(?:를)?\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { for (let i=0;i<n;i++) S.trashTopSecurityByEffect(state, player); render(); } }, `${player} 자기 시큐리티 위 ${n}장 파기`));
  }
  if ((m = text.match(/상대(?:의)?\s*시큐리티(?:를)?\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { for (let i=0;i<n;i++) S.trashTopSecurityByEffect(state, opp); render(); } }, `${opp}(상대) 시큐리티 위 ${n}장 파기`));
  }
  if (/자신의\s*시큐리티(?:를)?\s*아래(?:에서)?\s*(?:부터)?\s*1\s*장(?:을)?\s*파기/.test(text)) {
    btns.push(h('button', { onClick: () => { S.trashBottomSecurityByEffect(state, player); render(); } }, `${player} 자기 시큐리티 맨 밑 1장 파기`));
  }
  return btns;
}

async function ctxChoose(kind, payload) {
  return new Promise(resolve => {
    state.uiChoice = { kind, payload, resolve: (val) => { state.uiChoice = null; resolve(val); render(); } };
    render();
  });
}

// "이 카드의 【메인】 효과를 발휘한다." — near-universal boilerplate printed as
// EVERY Option card's inheritedKo (its "when revealed by a security check"
// text): reroute into compiling that same card's own 【메인】 segment
// (effectKo) instead of trying to pattern-match this sentence itself.
// Confirmed via a full-DB audit: 168 of 175 occurrences of this exact
// sentence are on Option cards' inheritedKo, always paired with a plain
// 【메인】-tagged effectKo to re-run.
function scriptFor(trigger) {
  if (trigger.schedFn) return [{ op: 'sched' }]; // held end-of-turn effect (18-1): run via trigger.schedFn in runPendingScript
  const specific = Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text);
  if (specific) return specific;
  if (/^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(trigger.text.trim())) {
    const { segments } = S.parseEffectSegments(S.card(trigger.cardId).effectKo || '');
    const mainSeg = segments.find(seg => seg.tags.includes('메인'));
    if (mainSeg) return Effects.compileToScript(mainSeg.body);
  }
  return Effects.compileToScript(trigger.text);
}

// "[턴에 N회]"/"[턴 N회]" printed at the start of a segment's body caps how
// many times THIS SPECIFIC effect can fire per turn — e.g. ST2-11
// MetalGarurumon's "【어택 시】[턴에 1회] 이 디지몬을 액티브로 한다." should
// only re-activate it once per turn, not every time it attacks.
function parseOnceLimit(text) {
  const m = text.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
  return m ? Number(m[1]) : null;
}

// Printed "…할 수 있다" effects are OPTIONAL — but a script made only of ops that never
// ask the player anything (draw, memory, mill, own-stack changes…) used to just fire.
// Those get an explicit "발동한다 / 발동하지 않는다" prompt; scripts that already let the
// player pick/cancel (playFree, jogress, targets…) keep their own cancel button.
const NO_CHOICE_OPS = new Set(['draw', 'gainMemory', 'trashDeckTop', 'recoverTop', 'restStack', 'removeSecurity', 'securityTopToHand', 'securityBottomToHand', 'unsuspend', 'modifyDP', 'grantKeyword', 'securityDPMod', 'addSecurity']);
function isOptionalAutoEffect(text, script) {
  const bare = text.replace(/\([^()]*\)/g, '').replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '').trim();
  if (/^상대는/.test(bare)) return false;
  if (!/(?:할|시킬|놓을|추가할|등장시킬|사용할|오픈할|파기할|되돌릴|이동시킬|진화시킬|레스트시킬)\s*수\s*있다/.test(bare)) return false;
  const flat = script.flatMap(o => o.op === 'costGroup' ? [...o.cost, ...o.then] : o.op === 'condition' ? [...o.then, ...(o.else || [])] : [o]);
  return flat.length > 0 && flat.every(o => NO_CHOICE_OPS.has(o.op) && (o.op !== 'unsuspend' || o.target === 'thisStack' || true));
}

async function runPendingScript(trigger, opts = {}) {
  if (trigger.schedFn) { // 18-1: a held "이 턴 종료 시 …" effect resolves like any other trigger
    if (opts.delay) await new Promise(r => setTimeout(r, 400));
    try { await trigger.schedFn(); } catch (e) { S.log(state, `예약된 턴 종료 효과 처리 오류: ${e && e.message}`); }
    S.resolvePending(state, trigger.uid);
    render();
    return;
  }
  // 15-4-4-3: a waiting effect can't resolve if its card left the area or turned into a NEW card
  // (evolved / fused) before its turn came. 【소멸 시】 effects are meant to wait after leaving.
  if (trigger.stackUid && trigger.topId && !trigger.tags.some(t => t.includes('소멸 시'))) {
    const stNow = findStack({ player: trigger.player, uid: trigger.stackUid });
    let why = null;
    if (!stNow || stNow.cardId !== trigger.topId) why = '카드가 벗어나거나 새 카드가 되어 (15-4-4-3)';
    // 15-4-4-4: the card no longer has this effect (an inherited effect whose source card left the stack)
    else if (trigger.inherited && !stNow.sources.includes(trigger.cardId) && !(stNow.linkCards || []).some(l => l.cardId === trigger.cardId)) why = '그 효과를 잃어 (15-4-4-4)';
    // 15-4-4-5: the trigger condition ("자신의 턴"/"상대의 턴") no longer holds
    else if (trigger.tags.includes('자신의 턴') && trigger.player !== state.activePlayer) why = '유발 조건(자신의 턴)을 잃어 (15-4-4-5)';
    else if (trigger.tags.includes('상대의 턴') && trigger.player === state.activePlayer) why = '유발 조건(상대의 턴)을 잃어 (15-4-4-5)';
    if (why) {
      S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 발동 대기 효과는 ${why} 발휘하지 못함`);
      S.resolvePending(state, trigger.uid);
      render();
      return;
    }
  }
  const limit = parseOnceLimit(trigger.text);
  let onceMark = null;
  if (limit != null && trigger.stackUid) {
    const stack = findStack({ player: trigger.player, uid: trigger.stackUid });
    if (stack) {
      const key = S.onceLimitKey(trigger.cardId, trigger.tags);
      if (S.turnUsesRemaining(stack, key, limit) <= 0) {
        S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 효과는 이번 턴 사용 횟수(${limit}회)를 넘어서 건너뜀`);
        S.resolvePending(state, trigger.uid);
        render();
        return;
      }
      onceMark = { stack, key }; // consumed only once the player actually chooses to activate (15-14-1-1)
    }
  }
  // A deliberate pause before actually resolving — auto-running instantly
  // (previous behavior) meant the effect banner appeared and vanished on
  // the same render tick, too fast to actually read. Skipped for effects
  // that need a real choice (ctx.choose already pauses those naturally).
  if (opts.delay) await new Promise(r => setTimeout(r, 700));
  const script = scriptFor(trigger);
  if (isOptionalAutoEffect(trigger.text, script)) {
    const yes = await ctxChoose('confirmEffect', { player: trigger.player, prompt: `【${trigger.tags.join('】【')}】 ${S.card(trigger.cardId).nameKo}: ${trigger.text.replace(/\([^()]*\)/g, '').slice(0, 90)} — 발동할까요?` });
    if (!yes) {
      S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 효과를 발동하지 않음`);
      S.resolvePending(state, trigger.uid);
      render();
      return;
    }
  }
  if (onceMark) S.markTurnEffectUsed(onceMark.stack, onceMark.key);
  const ctx = { state, S, E, self: trigger.player, opp: S.opponentOf(trigger.player), sourceCardId: trigger.cardId, sourceStackUid: trigger.stackUid, choose: ctxChoose, trigger, attack: () => sel.pendingAttack, endAttack: () => { endAttack(); render(); },
    startAttack: (p, uid, directTarget, atkOpts) => { sel.atkQueued = (sel.atkQueued || 0) + 1; setTimeout(() => { sel.atkQueued--; if (!sel.pendingAttack) { attackFlow(p, uid, directTarget, true, atkOpts); } render(); }, 0); } };
  await Effects.runScript(script, ctx);
  // Sentences the compiler can't express are handed to the player instead of silently vanishing.
  if (!trigger.manualOnly && !Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text)) { // bespoke scripts cover the whole segment
    const dropped = Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text) ? [] : Effects.droppedSentences(trigger.text); // bespoke scripts implement the whole text
    if (dropped.length) {
      state.pending.push({ uid: 'rem' + Math.random().toString(36).slice(2), player: trigger.player, cardId: trigger.cardId, stackUid: trigger.stackUid, tags: trigger.tags, text: dropped.join(' '), resolved: false, manualOnly: true, note: '자동 처리되지 않은 나머지 효과 — 직접 처리하세요' });
    }
  }
  S.resolvePending(state, trigger.uid);
  render();
}

// 15-8-3-1: a triggered effect ALWAYS triggers once its condition is met —
// there's no top-level "activate or not" for the trigger itself in this
// game's rules (any real optionality is a sub-decision WITHIN resolution,
// e.g. "up to N cards" or picking a target, which the compiled script
// already pauses for via ctx.choose). So a pending item with a
// successfully-compiled script should just run the instant it appears,
// not sit waiting for a redundant "run it?" click. Only genuinely
// uncompiled text (script.length === 0) needs the manual fallback UI.
const autoRunAttempted = new Set();
let pendingRunner = null; // uid of the effect currently resolving — effects resolve ONE AT A TIME
let runningPendingUid = null;
function autoRunMandatoryPending() {
  if (pendingRunner) return;
  // 4-3-2 simultaneous triggers: the TURN player resolves their waiting effects first (choosing the
  // order when there are several); only when none are left does the non-turn player's queue start.
  const waiting = state.pending.filter(t => !t.resolved && !t.manualOnly && !autoRunAttempted.has(t.uid) && scriptFor(t).length);
  if (!waiting.length) return;
  // 15-16-10-2: a triggered 【시큐리티】 effect skips the waiting line and resolves at once. 15-4-5: effects that
  // triggered WHILE simultaneous ones were resolving (derived triggers, t.depth) resolve before the older waiting ones.
  const secNow = waiting.filter(t => t.evt && t.evt.kind === 'security');
  const tier = secNow.length ? secNow : (() => { const md = Math.max(...waiting.map(t => t.depth || 0)); return waiting.filter(t => (t.depth || 0) === md); })();
  const mine = tier.filter(t => t.player === state.activePlayer);
  const pool = mine.length ? mine : tier;
  pendingRunner = true; // set BEFORE the async body runs — ctxChoose renders synchronously and would re-enter here
  pendingRunner = (async () => {
    let next = pool[0];
    if (pool.length > 1) {
      const uid = await ctxChoose('pickPendingOrder', {
        player: pool[0].player,
        items: pool.map(t => ({ uid: t.uid, label: `${S.card(t.cardId).nameKo} 【${t.tags.join('】【')}】 ${t.text.replace(/\([^()]*\)/g, '').slice(0, 60)}` })),
        prompt: `${pool[0].player}: 동시에 발동 대기 중인 효과 ${pool.length}개 — 먼저 처리할 효과를 선택하세요 (룰 4-3-2${mine.length ? ', 턴 플레이어 우선' : ''})`,
      });
      next = pool.find(t => t.uid === uid) || pool[0];
    }
    if (next.resolved) return;
    autoRunAttempted.add(next.uid);
    runningPendingUid = next.uid;
    const knownUids = new Set(state.pending.map(x => x.uid));
    try { await runPendingScript(next, { delay: true }); }
    finally { for (const x of state.pending) if (!knownUids.has(x.uid) && x.depth == null) x.depth = (next.depth || 0) + (x.rcSim ? 0 : 1); } // rcSim: 15-4-3-3 rule-check deletion triggers alongside the waiting ones // 15-4-5 derived triggers
  })().catch(() => {}).finally(() => {
    pendingRunner = null; runningPendingUid = null;
    render(); // chains into the next queued effect
  });
}

function renderPendingEffects() {
  if (!state.pending.length) return null;
  const rows = state.pending.map(t => {
    const c = S.card(t.cardId);
    const script = t.manualOnly ? [] : scriptFor(t);
    return h('div', { className: `effect-box${script.length && t.uid === runningPendingUid ? ' effect-firing' : ''}`, style: `margin-bottom:6px;${script.length && t.uid !== runningPendingUid ? 'opacity:.6;' : ''}` }, [
      h('div', { className: 'effect-firing-title' }, `⚡ ${c.nameKo} 【${t.tags.join('】【')}】 발동`),
      h('div', {}, t.text),
      t.note ? h('div', { className: 'meta' }, '⚠ ' + t.note) : null,
      h('div', { className: 'actions-row', style: 'margin-top:6px;' }, [
        script.length
          ? h('span', { className: 'meta' }, t.uid === runningPendingUid ? '▶ 처리 중…' : t.resolved ? '완료' : `⏳ 대기 중 (순서 ${state.pending.filter(x => !x.resolved && scriptFor(x).length).indexOf(t) + 1})`)
          : h('span', { className: 'meta' }, '자동 인식 실패 — 아래 버튼이나 범용 도구로 수동 처리'),
        ...quickApplyButtonsFor(t.text, t.player),
        h('button', { className: 'danger', onClick: () => { S.resolvePending(state, t.uid); render(); } }, '처리 완료 (닫기)'),
      ]),
    ]);
  });
  return h('div', {}, [h('div', { className: 'section-title' }, '발동 대기 중인 효과'), ...rows]);
}

function renderUiChoice() {
  const uc = state.uiChoice;
  if (!uc) return null;
  const { kind, payload, resolve } = uc;
  const rows = [h('div', { className: 'effect-box' }, payload.prompt || '선택하세요')];

  if (kind === 'pickPendingOrder') {
    payload.items.forEach((it, i) => rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `${i + 1}. ${it.label}`),
      h('button', { className: 'primary', onClick: () => resolve(it.uid) }, '먼저 처리'),
    ])));
  } else if (kind === 'confirmEffect') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('button', { className: 'primary', onClick: () => resolve(true) }, payload.yesLabel || '발동한다'),
      h('button', { onClick: () => resolve(false) }, payload.noLabel || '발동하지 않는다'),
    ]));
  } else if (kind === 'pickStack') {
    const cards = payload.uids.map(uid => {
      const pl = state.players[payload.player];
      const st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
      return { uid, cardId: st?.cardId };
    }).filter(x => x.cardId);
    rows.push(h('div', { className: 'stack-list' }, cards.map(x => cardChip(x.cardId, { onClick: () => resolve(x.uid) }))));
    if (!(payload.required && cards.length)) rows.push(h('button', { onClick: () => resolve(null) }, '대상 없음 / 취소')); // 1-3-6: a required choice can't pick zero
  } else if (kind === 'pickStackAnySide') {
    const cards = payload.entries.map(({ player, uid }) => {
      const pl = state.players[player];
      const st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
      return { player, uid, cardId: st?.cardId };
    }).filter(x => x.cardId);
    rows.push(h('div', { className: 'stack-list' }, cards.map(x => cardChip(x.cardId, {
      selected: false,
      onClick: () => resolve({ player: x.player, uid: x.uid }),
    }))));
    if (!(payload.required && cards.length)) rows.push(h('button', { onClick: () => resolve(null) }, '대상 없음 / 취소'));
  } else if (kind === 'pickFromHand') {
    const pl = state.players[payload.player];
    const idxs = pl.hand.map((id, i) => i);
    rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl.hand[i], { onClick: () => resolve(pl.hand[i]) }))));
    if (!(payload.required && idxs.length)) rows.push(h('button', { onClick: () => resolve(null) }, '선택 안 함'));
  } else if (kind === 'pickFromHandIndexes' || kind === 'pickFromZoneIndex') {
    const pl = state.players[payload.player];
    const zone = payload.zone || 'hand';
    const idxs = payload.eligibleIdxs;
    if (kind === 'pickFromZoneIndex') {
      rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl[zone][i], { onClick: () => resolve(i) }))));
      if (!(payload.required && idxs.length)) rows.push(h('button', { onClick: () => resolve(null) }, '선택 안 함'));
    } else {
      if (!state._multiPick) state._multiPick = [];
      const picked = state._multiPick;
      rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl.hand[i], {
        selected: picked.includes(i),
        onClick: () => { const p = picked.indexOf(i); if (p === -1) picked.push(i); else picked.splice(p, 1); render(); },
      }))));
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, `${picked.length}/${payload.n}장 선택됨`),
        h('button', {
          className: 'primary', disabled: picked.length !== payload.n,
          onClick: () => { const result = picked.slice(); state._multiPick = []; resolve(result); },
        }, '확인'),
      ]));
    }
  } else if (kind === 'pickFromRevealed') {
    if (!state._multiPick) state._multiPick = [];
    const picked = state._multiPick;
    rows.push(h('div', { className: 'hand-list' }, payload.revealed.map((id, i) => {
      const eligible = payload.eligible.some(x => x.i === i);
      return cardChip(id, {
        selected: picked.includes(i),
        onClick: eligible ? () => { const p = picked.indexOf(i); if (p === -1 && picked.length < payload.max) picked.push(i); else if (p !== -1) picked.splice(p, 1); render(); } : undefined,
      });
    })));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `${picked.length}장 선택 (최대 ${payload.max})`),
      h('button', { className: 'primary', disabled: picked.length < Math.max(payload.min || 0, payload.required && payload.eligible.length ? 1 : 0), onClick: () => { const result = picked.slice(); state._multiPick = []; resolve(result); } }, '확인 (핸드로 가져가고 나머지는 자동 처리)'),
    ]));
  } else if (kind === 'pickSourcesMulti') {
    if (!state._multiPick) state._multiPick = [];
    const picked = state._multiPick;
    rows.push(h('div', { className: 'hand-list' }, payload.ids.map((id, i) => cardChip(id, {
      selected: picked.includes(i),
      onClick: () => { const k = picked.indexOf(i); if (k === -1) { if (picked.length < payload.n) picked.push(i); } else picked.splice(k, 1); render(); },
    }))));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `${picked.length}/${payload.n}장 선택됨`),
      h('button', { className: 'primary', disabled: picked.length !== payload.n, onClick: () => { const r = picked.slice().sort((a, b) => a - b); state._multiPick = []; resolve(r); } }, '확인'),
    ]));
  } else if (kind === 'pickLinkCard') {
    rows.push(h('div', { className: 'hand-list' }, payload.ids.map((id, i) => cardChip(id, { onClick: () => resolve(i) }))));
  } else if (kind === 'orderCards') {
    // 3-1-3-4 / 15-15-3-6: the owner picks the order in which several cards are placed at once (click in order; first = top)
    if (!state._orderPick) state._orderPick = [];
    const ord = state._orderPick;
    rows.push(h('div', { className: 'hand-list' }, payload.ids.map((id, i) => {
      const pos = ord.indexOf(i);
      return cardChip(id, { selected: pos !== -1, keywordBadges: pos !== -1 ? [`#${pos + 1}`] : undefined, onClick: () => { if (pos === -1) ord.push(i); else ord.splice(pos, 1); render(); } });
    })));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `순서 ${ord.length}/${payload.ids.length} (숫자 = 위에서부터의 순서, 다시 누르면 취소)`),
      h('button', { onClick: () => { state._orderPick = []; render(); } }, '초기화'),
      h('button', { className: 'primary', disabled: ord.length !== payload.ids.length, onClick: () => { const r = ord.slice(); state._orderPick = []; resolve(r); } }, '확인'),
    ]));
  } else if (kind === 'multipleChoice') {
    rows.push(h('div', { className: 'actions-row' }, payload.options.map((label, i) => h('button', { onClick: () => resolve(i) }, label))));
  }

  return h('div', { className: 'player-panel' }, rows);
}

// The attack flow (declaration → counter → block → result) and any
// ctx.choose() prompt are both "must address now" dialogs — floated as a
// centered modal instead of buried in the bottom actions bar, which could
// be scrolled/collapsed out of view. Checked in render() before the
// regular actions panel; whichever of these exists takes over the screen.
function renderModal() {
  const choiceUi = renderUiChoice();
  if (choiceUi) return h('div', { className: 'modal-backdrop' }, [h('div', { className: 'modal-panel' }, [choiceUi])]);
  const pendingUi = renderPendingAttack();
  if (pendingUi) return h('div', { className: 'modal-backdrop' }, [h('div', { className: 'modal-panel' }, [pendingUi])]);
  return null;
}

function renderActions() {
  if (state.winner) return h('div', { className: 'actions' });

  // 11-1-4: a timing never advances until everything resolvable in it is
  // resolved — a triggered effect from the attack declaration (or anything
  // else queued) must be dealt with before the Counter/Block/etc. attack-
  // flow UI is shown, not hidden behind it.
  const pendingEffectsUiEarly = renderPendingEffects();
  if (pendingEffectsUiEarly) { return h('div', { className: 'actions actions-attention' }, [pendingEffectsUiEarly]); }

  const pendingEffectsUi = renderPendingEffects();

  // Everything here is optional/reference info once a turn is underway — the
  // field is the focus, so this whole panel starts collapsed. A mandatory
  // pending effect (something the player MUST resolve) always forces it open.
  if (!panelsOpen.actions && !pendingEffectsUi) {
    return h('div', { className: 'actions actions-collapsed' }, [
      h('div', {
        className: 'panel-tab', onClick: () => { panelsOpen.actions = true; render(); },
      }, `▲ 조작 패널 — ${PHASE_LABEL[state.phase] || state.phase} (${state.activePlayer})`),
    ]);
  }

  const rows = [];
  rows.push(h('div', {
    className: 'section-title clickable',
    onClick: () => { panelsOpen.actions = false; render(); },
  }, `▼ ${PHASE_LABEL[state.phase] || state.phase} — ${state.activePlayer} (클릭=접기)`));

  if (pendingEffectsUi) rows.push(pendingEffectsUi);

  if (state.phase === 'breeding') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', { className: 'meta' }, '디지타마 파일 클릭 = 부화, 육성 에어리어의 카드 클릭 = 배틀 이동 (둘 다 선택사항이지만 이번 턴엔 둘 중 하나만 가능)'),
    ]));
  }

  if (state.phase === 'main') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, '핸드:'), h('b', {}, sel.hand ? S.card(sel.hand.cardId).nameKo : '-'),
      h('span', {}, '스택1:'), h('b', {}, describeSelectedStackName(sel.stack)),
      h('span', {}, '스택2:'), h('b', {}, describeSelectedStackName(sel.stack2)),
      h('span', {}, 'DNA/링크 코스트'), numInput('costInput', 0),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', { className: 'meta' }, '핸드→필드/내 디지몬 드래그 = 등장·진화 · 스택1+스택2 선택 후 핸드→스택2 드래그 = DNA/조그레스 · 디지몬의 🔗 배지에 핸드카드 드롭 = 링크 · 내 디지몬→상대 진영 드래그 = 공격'),
    ]));
  }

  rows.push(h('div', {
    className: 'section-title clickable',
    onClick: () => { panelsOpen.advancedTools = !panelsOpen.advancedTools; render(); },
  }, `${panelsOpen.advancedTools ? '▼' : '▶'} 범용 도구 (카드 효과 수동 처리용 — 평소엔 접어두세요)`));

  if (panelsOpen.advancedTools) {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, '대상'),
      ...['p1', 'p2'].map(p => h('button', { className: sel.player === p ? 'primary' : '', onClick: () => { sel.player = p; render(); } }, p)),
      h('span', {}, '장수'), numInput('genN', 1),
      h('button', { onClick: () => { S.drawCards(state, sel.player, val('genN')); render(); } }, '드로우'),
      h('button', { onClick: () => { S.trashTopOfDeck(state, sel.player, val('genN')); render(); } }, '덱 위 파기'),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('button', { onClick: () => { S.trashTopSecurityByEffect(state, sel.player); render(); } }, '시큐리티 맨 위 효과로 파기'),
      h('button', { onClick: () => { S.trashBottomSecurityByEffect(state, sel.player); render(); } }, '시큐리티 맨 밑 효과로 파기'),
      h('span', {}, '카드ID'), h('input', { id: 'secCardId', placeholder: 'e.g. BT25-034' }),
      h('button', { onClick: () => { const id = document.getElementById('secCardId').value.trim(); if (id) S.addToSecurity(state, sel.player, id, 'top'); render(); } }, '핸드지정없이 시큐리티 맨위 추가(id입력)'),
      h('button', { onClick: () => { const id = document.getElementById('secCardId').value.trim(); if (id) S.addToSecurity(state, sel.player, id, 'bottom'); render(); } }, '맨밑 추가(id입력)'),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, '메모리'), numInput('memN', 1),
      h('button', { onClick: () => { S.grantMemory(state, sel.player, val('memN')); render(); } }, '메모리 획득 적용'),
      h('span', {}, '퇴화 단수'), numInput('retN', 1),
      h('button', { disabled: !sel.stack, onClick: () => { S.retreat(state, sel.stack.player, sel.stack.uid, val('retN')); render(); } }, '선택 스택 퇴화'),
      h('button', { className: 'danger', disabled: !sel.stack, onClick: () => { S.deleteStack(state, sel.stack.player, sel.stack.uid); sel.stack = null; render(); } }, '선택 스택 소멸(트래시)'),
    ]));
  }

  return h('div', { className: `actions${pendingEffectsUi ? ' actions-attention' : ''}` }, rows);
}

function findStack(selRef) {
  if (!selRef) return null;
  const pl = state.players[selRef.player];
  if (pl.raising?.uid === selRef.uid) return pl.raising;
  return pl.battle.find(s => s.uid === selRef.uid) || null;
}

function describeSelectedStackName(selRef) {
  const stack = findStack(selRef);
  return stack ? S.card(stack.cardId).nameKo : '없음';
}

function describeSelectedEffects() {
  if (!sel.stack && !sel.hand) return '';
  const parts = [];
  const showCard = (id) => {
    const c = S.card(id);
    const bits = [`${c.nameKo} (${id}) Lv.${c.level ?? '-'} ${c.colors?.join('/') || ''} C${c.cost ?? '-'} DP${c.dp ?? '-'}`];
    if (c.evoNormal) bits.push(`진화: ${(c.evoNormal.colors||[]).join('/')} Lv.${c.evoNormal.level}→코스트${c.evoNormal.cost}`);
    if (c.effectKo) bits.push(c.effectKo);
    if (c.inheritedKo) bits.push('[진화원효과] ' + c.inheritedKo);
    parts.push(bits.join('\n'));
  };
  if (sel.hand) showCard(sel.hand.cardId);
  const stack = findStack(sel.stack);
  if (stack) {
    showCard(stack.cardId);
    stack.sources.forEach(id => showCard(id));
  }
  return parts.join('\n\n');
}


// Some option effects grant a one-off "can only directly attack a Digimon
// if you also control a named ally" style restriction — shared between the
// direct-drop auto-resolve path and the fallback target-choice menu.
function blockedFromDigimonTarget(p, attackerStack) {
  const restrictions = attackerStack?.dynamicRestrictions || [];
  return restrictions.some(r => {
    if (r.type !== 'noDigimonAttackUnlessOwn') return true;
    return !state.players[p].battle.some(s => S.card(s.cardId).nameKo.includes(r.filter.nameIncludes));
  });
}

// `directTarget`: 'PLAYER' to attack the opponent player directly, an
// opposing stack uid to attack that specific Digimon, or omitted to fall
// back to the target-choice menu (e.g. an illegal/ambiguous drop). Letting
// the drop location itself express the target — instead of always opening
// a menu — is what makes attack (the single most common action) a single
// drag instead of drag-then-pick-from-a-list.
// ≪블로커≫ can only intercept if the defender actually controls an ACTIVE
// Digimon with the keyword (using it rests that Digimon) — asking "does the
// opponent block?" when they have none is both misleading and an
// unnecessary extra click.
// 16-30 ≪충돌≫: while the attacker has it, EVERY one of the opponent's
// Digimon is granted Blocker for this attack and must block if able (11-4/
// 12-1's normal "may block" becomes mandatory) — checked live since it only
// matters for the exact attack in progress, not tracked as a cached keyword.
// ---- step-by-step pacing (attack timings + effect resolution) ----
// Every attack timing (대상 변경 → 카운터 → 블록 → 결과) is now shown as its own step
// even when nothing can be decided in it, instead of the whole chain resolving in
// one render. Auto mode advances after a short visible pause (and waits for any
// pending effect to finish first); manual mode waits for the "다음 단계" button.
const STEP = { manual: false, delay: 1300 };
try { STEP.manual = localStorage.getItem('digimon_step_manual') === '1'; } catch (e) { /* ignore */ }

function runPendingNext(pa) {
  const next = pa.pendingNext;
  if (!next) return;
  pa.pendingNext = null; pa.paused = false; pa.token = (pa.token || 0) + 1;
  next();
  render();
}

function stepPause(pa, stage, info, next) {
  pa.stage = stage; pa.info = info; pa.pendingNext = next; pa.paused = true;
  const token = pa.token = (pa.token || 0) + 1;
  if (STEP.manual) return;
  const tick = () => {
    if (sel.pendingAttack !== pa || pa.token !== token || !pa.pendingNext) return;
    // Don't run ahead of an effect that is still resolving (its banner is on screen).
    if (state.pending.some(t => !t.resolved && scriptFor(t).length) || state.uiChoice) { setTimeout(tick, 400); return; }
    runPendingNext(pa);
  };
  setTimeout(tick, STEP.delay);
}

function eligibleBlockers(p, collidingAttacker) {
  // 12-1-4: a Digimon that can't be rested can't block.
  if (collidingAttacker) return state.players[p].battle.filter(s => S.card(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(state, p, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, p, s));
  return state.players[p].battle.filter(s => (S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(state, p, s).includes('블로커')) && !s.suspended && S.canRestByRule(state, p, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, p, s));
}

// Runs the security check and — same as resolveDigimonBattle already does
// for digimon-vs-digimon combat — immediately destroys the attacker if it
// lost. There's no tracked "survives destruction" keyword in this game (no
// card prints one; each is bespoke text), so this must never be left as an
// unconditional player choice — that was letting an attacker survive with
// no actual effect backing it up.
function runSecurityCheck(pa) {
  pa.secCtl = S.beginSecurityCheck(state, pa.attacker, pa.uid, pa.opp);
  pa.secCtl.deferBattle = true; // reveal -> resolve 【시큐리티】 effect -> battle (13-1-8)
  pa.res = { checks: pa.secCtl.results, gameOver: false };
  pa.secDone = false;
  pa.stage = 'result';
  doSecurityStep(pa);
}

// One security check per visible step: reveal → its 【시큐리티】 effect is queued →
// (pause) → next check. The attacker's loss is applied only after the last check.
function doSecurityStep(pa) {
  const ctl = pa.secCtl;
  if (ctl.awaiting) S.battleSecurityCheck(ctl, ctl.awaiting.id); // 13-1-8-3: battle only after the 【시큐리티】 effect (13-1-8-2) has resolved
  else S.stepSecurityCheck(ctl);
  pa.res.gameOver = ctl.gameOver;
  if (ctl.awaiting) {
    stepPause(pa, 'result', `시큐리티 체크 ${ctl.i + 1}/${ctl.total}: ${S.card(ctl.awaiting.id).nameKo} 공개 — 【시큐리티】 효과 처리 후 배틀합니다`, () => doSecurityStep(pa));
    return;
  }
  if (ctl.done) {
    if (!ctl.gameOver && ctl.results.length) {
      const last = ctl.results[ctl.results.length - 1];
      if (last.result === 'defenderWins' || last.result === 'tie') S.deleteStack(state, pa.attacker, pa.uid, 'trash', 'battle');
    }
    pa.secDone = true;
  } else {
    stepPause(pa, 'result', `시큐리티 체크 ${ctl.i}/${ctl.total} 완료 — 다음 체크로 넘어갑니다`, () => doSecurityStep(pa));
  }
}

// 11-5/14: resolve against whatever the FINAL target is after Block Timing
// (block can redirect a player-attack, or even a direct digimon-attack, to
// a different Digimon — 12-1-5 only bars blocking with the digimon that's
// already the target).
function resolveFinalTarget(pa) {
  // 11-2-7-4 / 11-5-1-4 / 11-2-6: the attacker or a Digimon target left the battle area (e.g. deleted by a
  // 【어택 시】/【카운터】 effect) -> the attack is established nowhere; it just ends.
  if (!findStack({ player: pa.attacker, uid: pa.uid }) || (pa.targetKind === 'digimon' && !findStack({ player: pa.opp, uid: pa.targetUid }))) {
    S.log(state, '어택 중인 디지몬 또는 어택 대상이 없어 어택이 성립하지 않고 종료 (11-2-6 / 11-5-1-4)');
    endAttack(); return;
  }
  if (pa.targetKind === 'player') {
    runSecurityCheck(pa);
  } else {
    const aSt = findStack({ player: pa.attacker, uid: pa.uid }), dSt = findStack({ player: pa.opp, uid: pa.targetUid });
    pa.battlePreview = aSt && dSt ? { aCard: aSt.cardId, aDp: S.effectiveDP(state, pa.attacker, aSt), dCard: dSt.cardId, dDp: S.effectiveDP(state, pa.opp, dSt) } : null;
    stepPause(pa, 'digimonResult', '배틀! 양쪽 DP를 비교해 결과를 확인합니다', () => {
      const res = S.resolveDigimonBattle(state, pa.attacker, pa.uid, pa.targetUid);
      if (!res) { S.log(state, '배틀 직전 어택 중인 디지몬/대상이 사라져 어택이 성립하지 않고 종료 (11-2-6)'); endAttack(); return; }
      pa.stage = 'digimonResult'; pa.battleRes = res;
    });
  }
}

// 11-4/12-1: Block Timing — applies regardless of whether the attack
// targeted the player or a specific Digimon; 12-1-5 only excludes the
// Digimon that's already the target from blocking (it can't block itself).
function enterBlockCheck(pa) {
  const attackerStack = findStack({ player: pa.attacker, uid: pa.uid });
  if (!attackerStack) { S.log(state, '어택 중인 디지몬이 배틀 에어리어에 없어 블록할 수 없고 어택이 종료 (12-1-6 / 11-2-7-4)'); endAttack(); return; }
  const colliding = !!attackerStack && (S.hasKeyword(attackerStack, '충돌') || S.hasContinuousKeyword(state, pa.attacker, attackerStack, '충돌'));
  const blockers = eligibleBlockers(pa.opp, colliding).filter(s => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(state, pa.attacker, pa.uid, s));
  if (blockers.length === 0) {
    pa.blockers = [];
    stepPause(pa, 'blockCheck', '블록 타이밍 — 블록할 수 있는 디지몬이 없습니다', () => resolveFinalTarget(pa));
  } else {
    pa.stage = 'blockCheck';
    pa.blockers = blockers;
    pa.mandatoryBlock = colliding;
  }
}

// 11-3: Counter Timing — the defender's window to activate 【카운터】
// effects before Block Timing. Genuinely automating arbitrary counter
// effects (e.g. a full free evolution) is out of scope for the compiler,
// so activating one hands it to the normal pending-effect/manual-tools
// path instead of silently skipping the timing altogether.
function enterCounterTiming(pa) {
  const counters = S.findCounterOptions(state, pa.opp);
  if (counters.length === 0) {
    pa.counters = [];
    stepPause(pa, 'counterTiming', '카운터 타이밍 — 사용할 수 있는 카운터가 없습니다', () => enterBlockCheck(pa));
  } else {
    pa.stage = 'counterTiming';
    pa.counters = counters;
  }
}

// A defender-side "may redirect the attack's target to THIS Digimon"
// reaction (e.g. BT20-033/BT20-036/EX7-046/EX8-050's "[턴에 1회] 상대의
// 디지몬이 어택했을 때, 어택의 대상을 이 디지몬으로 변경할 수 있다.") —
// resolved before Counter Timing since it decides WHICH digimon Counter/
// Block even apply against.
// "어택의 대상이 변경되었을 때" watchers (hooks) — fired whenever a redirect/block changes the attack target.
function noteRedirect(pa) {
  const aSt = findStack({ player: pa.attacker, uid: pa.uid });
  S.emitGameEvent(state, 'redirect', { owner: pa.attacker, stack: aSt, cause: null, targetUid: pa.targetUid });
}

function enterRedirectTiming(pa) {
  if (pa.fireDeclare) { const f = pa.fireDeclare; pa.fireDeclare = null; f(); } // 11-2-2: 【어택 시】 triggers only after the target is fixed
  if (pa.s1ForcedTarget) { pa.targetKind = 'digimon'; pa.targetUid = pa.s1ForcedTarget; pa.s1ForcedTarget = null; } // shard1 (BT4-075)
  if (!pa.s1Noted) { // shard1: 'attackTarget' event (BT2-084 등) + BT4-101
    pa.s1Noted = true;
    const aS1 = findStack({ player: pa.attacker, uid: pa.uid });
    if (aS1) S.s1AttackTargeted(state, pa.attacker, aS1, pa.targetKind, pa.targetUid);
    if (pa.targetKind === 'digimon' && !findStack({ player: pa.opp, uid: pa.targetUid })) { S.log(state, '어택 대상이 사라져 어택 종료'); endAttack(); return; }
  }
  if (pa.targetKind === 'digimon' && !pa.declaredNoted) {
    // "이 디지몬이 (…한) 상대의 디지몬에게 어택했을 때" — the moment a Digimon target is declared.
    pa.declaredNoted = true;
    const aSt0 = findStack({ player: pa.attacker, uid: pa.uid }), dSt0 = findStack({ player: pa.opp, uid: pa.targetUid });
    if (aSt0 && dSt0) S.emitGameEvent(state, 'attackOnDigimon', { owner: pa.attacker, stack: aSt0, cause: null, target: dSt0 });
    if (dSt0 && !findStack({ player: pa.opp, uid: pa.targetUid })) { S.log(state, '어택 대상이 사라져 어택 종료'); endAttack(); return; }
  }
  const options = S.findRedirectOptions(state, pa.opp, pa.attacker, pa.uid)
    .concat(S.hookRedirectOptions(state, pa.opp, pa.attacker, findStack({ player: pa.attacker, uid: pa.uid })))
    .concat(pa.targetKind === 'digimon' ? S.hookAttackerRedirectOptions(state, pa.attacker, findStack({ player: pa.attacker, uid: pa.uid }), pa.targetUid) : []);
  // 11-2-7-3: the target can't be redirected to the target it already has.
  for (let i = options.length - 1; i >= 0; i--) { const o = options[i]; if (o.endsAttack) continue; if (o.toPlayer ? pa.targetKind === 'player' : (pa.targetKind === 'digimon' && (o.targetUid || o.stackUid) === pa.targetUid)) options.splice(i, 1); }
  pa.chargeTargets = S.chargeRedirectTargets(state, pa.attacker, pa.uid).filter(u => !(pa.targetKind === 'digimon' && u === pa.targetUid)); // DP tie -> the player picks
  pa.chargeTarget = pa.chargeTargets[0] || null;
  const chainAvail = !pa.chainUsed && S.chainOptions(state, pa.attacker, pa.uid).length > 0;
  if (options.length === 0 && !pa.chargeTarget && !chainAvail) {
    pa.redirectOptions = [];
    stepPause(pa, 'redirectTiming', '어택 선언 — 어택 대상을 바꿀 수 있는 효과가 없습니다', () => enterCounterTiming(pa));
  } else {
    pa.stage = 'redirectTiming';
    pa.redirectOptions = options;
  }
}

// 【어택 종료 시】 (82 printed segments) — was never queued anywhere. Fires for
// the attacker's stack (own + inherited text) once the attack panel is closed.
function endAttack() {
  const pa = sel.pendingAttack;
  sel.pendingAttack = null;
  if (!pa) return;
  if (state.attackCtx === pa) state.attackCtx = null;
  const st = findStack({ player: pa.attacker, uid: pa.uid });
  if (st) S.s8AttackEnded(state, pa.attacker, pa.uid); // s8
  if (st) { S.queueTriggersForStack(state, pa.attacker, st, 'attackEnd'); S.emitGameEvent(state, 'attackEnd', { owner: pa.attacker, stack: st, cause: null }); }
}

function attackFlow(p, uid, directTarget, force = false, atkOpts = {}) {
  if (!force && blockIfBusy()) return;
  const dec = S.declareAttack(state, p, uid, atkOpts);
  if (!dec.ok) { render(); return; }
  // 11-2-2: the attack target is chosen together with the declaration, i.e. BEFORE 【어택 시】 effects are triggered/resolved.
  // Drag-drop already knows the target; the click path defers the triggers until a target is picked (see enterRedirectTiming).
  const fireDeclare = () => {
    const st = findStack({ player: p, uid });
    if (!st) return;
    S.queueTriggersForStack(state, p, st, 'attack');
    S.emitGameEvent(state, 'attack', { owner: p, stack: st, cause: null });
  };
  const dp = S.effectiveDP(state, p, dec.stack);
  const opp = S.opponentOf(p);
  const digimonTargets = S.legalDigimonTargets(state, p, uid);
  const canHitPlayer = S.canAttackPlayer(state, p, uid);
  const pa = { attacker: p, uid, dp, opp, digimonTargets, canHitPlayer, attackerCardId: dec.stack.cardId, targetKind: null, targetUid: null, stage: 'targetChoice' };
  pa.fireDeclare = fireDeclare;
  sel.pendingAttack = pa;
  state.attackCtx = pa; // read by card scripts ("어택 중인 대상…"); pa.terminate() ends this attack ("그 어택을 종료한다")
  pa.terminate = () => { if (sel.pendingAttack === pa) { endAttack(); render(); } };

  if (directTarget === 'PLAYER' && canHitPlayer) {
    pa.targetKind = 'player';
    enterRedirectTiming(pa);
  } else if (directTarget && digimonTargets.includes(directTarget) && !blockedFromDigimonTarget(p, dec.stack)) {
    pa.targetKind = 'digimon'; pa.targetUid = directTarget;
    enterRedirectTiming(pa);
  }
  render();
}

const RESULT_LABEL_KO = { attackerWins: '공격측 승리', defenderWins: '방어측 승리', tie: '동점 (양쪽 소멸)', jammedSurvive: '≪재밍≫으로 생존', noBattle: '시큐리티 디지몬 없음 (배틀 없음)' };

function renderVsBattle(leftCardId, leftDp, rightCardId, rightDp, result) {
  const leftWins = result === 'attackerWins' || result === 'jammedSurvive';
  const rightWins = result === 'defenderWins';
  // jammedSurvive is deliberately excluded from rightLoses — Jamming means
  // the defender survives the hit, so it shouldn't play a "destroyed" beat.
  const leftLoses = result === 'defenderWins' || result === 'tie';
  const rightLoses = result === 'attackerWins' || result === 'tie';
  const sideClass = (wins, loses) => `vs-side${wins ? ' vs-winner' : ''}${loses ? ' vs-loser' : ''}`;
  return h('div', { className: 'vs-battle' }, [
    h('div', { className: sideClass(leftWins, leftLoses) }, [cardChip(leftCardId, {}), h('div', { className: 'vs-dp' }, `DP ${leftDp}`)]),
    h('div', { className: 'vs-mid' }, [h('div', { className: 'vs-vs' }, 'VS'), h('div', { className: 'vs-result' }, RESULT_LABEL_KO[result] || result || '')]),
    h('div', { className: sideClass(rightWins, rightLoses) }, [cardChip(rightCardId, {}), h('div', { className: 'vs-dp' }, `DP ${rightDp}`)]),
  ]);
}

// Short breadcrumb of the fixed attack sequence (11-1-3), current step
// highlighted — lets the player see at a glance where they are instead of
// parsing a paragraph each stage.
const ATTACK_STEP_ORDER = ['targetChoice', 'redirectTiming', 'counterTiming', 'blockCheck', 'digimonResult', 'result'];
const ATTACK_STEP_LABEL = { targetChoice: '대상', redirectTiming: '대상 변경', counterTiming: '카운터', blockCheck: '블록', digimonResult: '결과', result: '결과' };
function renderAttackSteps(currentStage) {
  const seen = new Set();
  const steps = ATTACK_STEP_ORDER.filter(s => { const label = ATTACK_STEP_LABEL[s]; if (seen.has(label)) return false; seen.add(label); return true; });
  const currentIdx = ATTACK_STEP_ORDER.indexOf(currentStage);
  return h('div', { className: 'actions-row' }, steps.map((s) => {
    const idx = ATTACK_STEP_ORDER.indexOf(s);
    const isPast = idx < currentIdx || (currentStage === 'result' && s === 'digimonResult');
    const isNow = s === currentStage || (currentStage === 'digimonResult' && s === 'result') || (currentStage === 'result' && s === 'digimonResult');
    return h('span', { className: `zone-pill${s === currentStage ? ' step-now' : ''}${isPast ? ' step-done' : ''}` }, ATTACK_STEP_LABEL[s]);
  }));
}

function renderPendingAttack() {
  const pa = sel.pendingAttack;
  if (!pa) return null;
  const attackerStackNow = state.players[pa.attacker].battle.find(s => s.uid === pa.uid);
  const rows = [
    h('div', { className: 'section-title' }, `${attackerStackNow ? S.card(attackerStackNow.cardId).nameKo : '(소멸됨)'} DP${pa.dp} 공격 중`),
    renderAttackSteps(pa.stage),
  ];

  // Step pacing controls + the current step's explanation (see stepPause).
  rows.push(h('label', { className: 'meta', style: 'display:flex;gap:6px;align-items:center;cursor:pointer;' }, [
    h('input', { type: 'checkbox', checked: STEP.manual, onChange: (e) => { STEP.manual = e.target.checked; try { localStorage.setItem('digimon_step_manual', STEP.manual ? '1' : '0'); } catch (err) { /* ignore */ } render(); } }),
    '단계 수동 진행 (각 단계마다 "다음"을 눌러 진행)',
  ]));
  if (pa.paused && pa.pendingNext) {
    rows.push(h('div', { className: 'effect-box step-info' }, [
      h('div', {}, pa.info || ''),
      h('button', { className: 'primary', onClick: () => runPendingNext(pa) }, STEP.manual ? '다음 단계 ▶' : '바로 진행 ▶'),
      STEP.manual ? null : h('span', { className: 'meta', style: 'margin-left:8px;' }, '잠시 후 자동 진행…'),
    ]));
  }

  // ≪연계≫ — optional, offered until the battle actually resolves.
  if (attackerStackNow && pa.stage !== 'digimonResult' && pa.stage !== 'result' && !pa.chainUsed) {
    const chainUids = S.chainOptions(state, pa.attacker, pa.uid);
    if (chainUids.length) {
      rows.push(h('div', { className: 'zone-label' }, '《연계》 — 다른 디지몬 1마리를 레스트시켜 DP 합산 + S 어택 +1:'));
      rows.push(h('div', { className: 'stack-list' }, chainUids.map(uid => {
        const st = state.players[pa.attacker].battle.find(x => x.uid === uid);
        return cardChip(st.cardId, { onClick: () => { if (S.useChain(state, pa.attacker, pa.uid, uid)) { pa.chainUsed = true; pa.dp = S.effectiveDP(state, pa.attacker, attackerStackNow); } render(); } });
      })));
    }
  }

  if (pa.stage === 'targetChoice') {
    const attackerStack = state.players[pa.attacker].battle.find(s => s.uid === pa.uid);
    const blockedByDynamic = blockedFromDigimonTarget(pa.attacker, attackerStack);
    if (pa.canHitPlayer) {
      rows.push(h('div', { className: 'actions-row' }, [
        h('button', {
          className: 'primary',
          onClick: () => { pa.targetKind = 'player'; enterRedirectTiming(pa); render(); },
        }, `${pa.opp} 본체 공격`),
      ]));
    } else {
      rows.push(h('div', { className: 'meta' }, '이 디지몬은 플레이어에게 어택할 수 없음 (효과 제약)'));
    }
    if (blockedByDynamic) {
      rows.push(h('div', { className: 'meta' }, '지금은 디지몬 직접 공격 불가 (효과 제약)'));
    } else if (pa.digimonTargets.length) {
      rows.push(h('div', { className: 'zone-label' }, '또는 디지몬 직접 공격:'));
      rows.push(h('div', { className: 'stack-list' }, pa.digimonTargets.map(uid => {
        const st = state.players[pa.opp].battle.find(s => s.uid === uid);
        return cardChip(st.cardId, { onClick: () => {
          pa.targetKind = 'digimon'; pa.targetUid = uid; enterRedirectTiming(pa); render();
        } });
      })));
    } else {
      rows.push(h('div', { className: 'meta' }, '레스트 상태 디지몬이 없어서 직접 공격 불가'));
    }
  } else if (pa.stage === 'redirectTiming' && !pa.paused) {
    if (pa.chargeTarget) {
      for (const cuid of (pa.chargeTargets && pa.chargeTargets.length ? pa.chargeTargets : [pa.chargeTarget])) {
        const ct = state.players[pa.opp].battle.find(s => s.uid === cuid);
        if (ct) rows.push(h('div', { className: 'actions-row' }, [
          h('span', {}, `《돌진》 — 가장 DP가 높은 액티브 ${S.card(ct.cardId).nameKo}(으)로 어택 대상 변경`),
          h('button', { onClick: () => { pa.targetKind = 'digimon'; pa.targetUid = ct.uid; pa.chargeTarget = null; pa.chargeTargets = []; pa.redirectOptions = []; noteRedirect(pa); enterCounterTiming(pa); render(); } }, '변경'),
        ]));
      }
    }
    if (pa.redirectOptions.length) rows.push(h('div', { className: 'zone-label' }, `${pa.opp}의 대상 변경 기회`));
    pa.redirectOptions.forEach(opt => {
      const tUid = opt.targetUid || opt.stackUid;
      const st = state.players[pa.opp].battle.find(s => s.uid === tUid);
      if (!st && !opt.toPlayer) return;
      const srcSt = state.players[pa.opp].battle.find(s => s.uid === opt.stackUid);
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, opt.label || (opt.toPlayer ? '플레이어(으)로 어택 대상 변경' : `${S.card(st.cardId).nameKo}(으)로 어택 대상 변경` + (tUid !== opt.stackUid && srcSt ? ` (${S.card(opt.cardId).nameKo})` : ''))),
        h('button', {
          onClick: async () => {
            // card-specific redirects may carry a cost (opt.pay) and/or redirect to the player (opt.toPlayer)
            if (opt.pay) { const paid = await opt.pay(ctxChoose); if (!paid) { render(); return; } }
            if (opt.endsAttack) { endAttack(); render(); return; } // shard2: "그 어택을 종료한다"
            if (opt.toPlayer) { pa.targetKind = 'player'; pa.targetUid = null; } else { pa.targetKind = 'digimon'; pa.targetUid = tUid; }
            if (opt.limit != null) S.markRedirectUsed(state, pa.opp, opt.stackUid, opt.cardId);
            noteRedirect(pa);
            enterCounterTiming(pa); render();
          },
        }, '변경'),
      ]));
    });
    rows.push(h('button', { className: 'primary', onClick: () => { enterCounterTiming(pa); render(); } }, pa.redirectOptions.length || pa.chargeTarget ? '넘기기' : '진행 (카운터 단계로)'));
  } else if (pa.stage === 'counterTiming' && !pa.paused) {
    rows.push(h('div', { className: 'zone-label' }, `${pa.opp}의 카운터 기회`));
    pa.counters.forEach(opt => {
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, `${S.card(opt.cardId).nameKo}: ${opt.body}`),
        h('button', {
          onClick: () => {
            state.pending.push({ uid: 'ct' + Math.random().toString(36).slice(2), player: pa.opp, cardId: opt.cardId, stackUid: opt.stackUid, tags: opt.tags, text: opt.body, resolved: false });
            enterBlockCheck(pa); render();
          },
        }, '발동'),
      ]));
    });
    rows.push(h('button', { className: 'primary', onClick: () => { enterBlockCheck(pa); render(); } }, '넘기기'));
  } else if (pa.stage === 'digimonResult' && pa.paused) {
    if (pa.battlePreview) rows.push(renderVsBattle(pa.battlePreview.aCard, pa.battlePreview.aDp, pa.battlePreview.dCard, pa.battlePreview.dDp, null));
  } else if (pa.stage === 'digimonResult') {
    const res = pa.battleRes;
    rows.push(renderVsBattle(res.attackerCardId, res.aDp, res.defenderCardId, res.dDp, res.result));
    if (res.result === 'defenderWins' || res.result === 'tie') {
      rows.push(h('div', { className: 'meta' }, '공격측 소멸 (생존 효과가 있다면 범용 도구로 처리)'));
    }
    if (res.result === 'attackerWins' && res.destroyedOnlyOpponent) {
      const survivorsWithKw = state.players[pa.attacker].battle.filter(s => S.hasKeyword(s, '전투후액티브'));
      if (survivorsWithKw.length) {
        rows.push(h('div', { className: 'actions-row' }, [
          h('span', {}, '≪전투후액티브≫ 액티브로 되돌리기?'),
          ...survivorsWithKw.map(s => cardChip(s.cardId, { onClick: () => { S.unsuspendStack(state, pa.attacker, s.uid); render(); } })),
        ]));
      }
    }
    if (res.piercing) {
      // 16-7-3: the ≪관통≫ check is mandatory — no "안 함" option.
      // 16-7-4: the pierce check is a pending process handled AFTER effects triggered by this battle (e.g. 【소멸 시】) resolve.
      const pierceWaiting = state.pending.some(t => !t.resolved) || !!state.uiChoice;
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, pierceWaiting ? '≪관통≫ — 대기 중인 효과를 먼저 처리하세요 (16-7-4)' : '≪관통≫ — 시큐리티 체크 (강제)'),
        h('button', {
          className: 'primary',
          disabled: pierceWaiting,
          // Piercing's bonus check is still part of THIS attack's single
          // "성립의 확인" — Counter/Block Timing already happened once for
          // this attack and don't repeat here.
          onClick: () => { pa.targetKind = 'player'; runSecurityCheck(pa); render(); },
        }, '체크'),
      ]));
    } else {
      rows.push(h('button', { onClick: () => { endAttack(); render(); } }, '닫기'));
    }
  } else if (pa.stage === 'blockCheck' && !pa.paused) {
    rows.push(h('div', { className: 'zone-label' },
      pa.mandatoryBlock ? '≪충돌≫ — 상대는 반드시 블록해야 함, 막을 디지몬 선택:' : '≪블로커≫로 막을 디지몬 선택 (없으면 넘기기):'));
    rows.push(h('div', { className: 'stack-list' }, pa.blockers.map(s => cardChip(s.cardId, {
      onClick: () => {
        S.restStack(state, pa.opp, s.uid, 'block');
        pa.targetKind = 'digimon'; pa.targetUid = s.uid;
        noteRedirect(pa);
        resolveFinalTarget(pa);
        render();
      },
    }))));
    if (!pa.mandatoryBlock) {
      rows.push(h('div', { className: 'actions-row' }, [
        h('button', {
          className: 'primary',
          onClick: () => { resolveFinalTarget(pa); render(); },
        }, '넘기기'),
      ]));
    }
  } else if (pa.stage === 'result') {
    const res = pa.res;
    if (res.gameOver) {
      rows.push(h('div', { className: 'effect-box' }, `${pa.opp} 시큐리티 0에서 피격 — 게임 종료!`));
    } else {
      res.checks.forEach((c, i) => {
        rows.push(h('div', { className: 'zone-label' }, `시큐리티 체크 ${i + 1}/${pa.secCtl ? pa.secCtl.total : res.checks.length}`));
        rows.push(renderVsBattle(pa.attackerCardId, c.atkDp != null ? c.atkDp : pa.dp, c.revealed, c.secDp, c.result));
      });
      const last = res.checks[res.checks.length - 1];
      if (!pa.secDone) {
        // still revealing — the step-info row above carries the "next" control
      } else if (last && (last.result === 'defenderWins' || last.result === 'tie')) {
        // Already destroyed by runSecurityCheck — this is purely
        // informational. No "survive anyway" button: there's no tracked
        // keyword for it, every real instance is bespoke card text handled
        // via the normal trigger/pending-effect system instead.
        rows.push(h('div', { className: 'meta' }, '공격측 소멸 (생존 효과가 있다면 범용 도구로 처리)'));
        rows.push(h('button', {
          className: 'primary',
          onClick: () => { endAttack(); render(); },
        }, '닫기'));
      } else {
        rows.push(h('button', { onClick: () => { endAttack(); render(); }, }, '닫기'));
      }
    }
  }
  return h('div', { className: 'player-panel' }, rows);
}

function renderLog() {
  if (!panelsOpen.log) {
    return h('div', { className: 'log-panel log-collapsed', onClick: () => { panelsOpen.log = true; render(); } }, '◀ 로그');
  }
  return h('div', { className: 'log-panel' }, [
    h('div', { className: 'log-panel-header' }, [
      h('span', { className: 'section-title', style: 'margin:0;' }, '로그'),
      h('button', { className: 'log-close-btn', onClick: () => { panelsOpen.log = false; render(); } }, '접기 ▶'),
    ]),
    ...state.log.slice(0, 100).map(e => h('div', {}, `[턴${e.turn}] ${e.msg}`)),
  ]);
}

window.__dbg = () => ({ dragData, sel, state, S, E, Effects, render, attackFlow });
init();
