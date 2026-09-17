import * as S from './state.js';
import * as E from './engine.js';
import * as Effects from './effects.js';
import * as DB from './deckbuilder.js';

const PHASE_LABEL = { unsuspend: '액티브 페이즈', draw: '드로우 페이즈', breeding: '육성 페이즈', main: '메인 페이즈' };

const app = document.getElementById('app');
let state = null;
let sel = { hand: null, stack: null, stack2: null, player: 'p1' }; // UI selection only
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
  renderSetup();
}

let setupPick = { p1: null, p2: null };

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
    if (!c.nameKo.includes(dbFilter.q) && !(c.id || '').toLowerCase().includes(q) && !(c.nameEn || '').toLowerCase().includes(q)) return false;
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
      if (!dbSavedName.trim()) return;
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

function startNewGame() {
  state = S.newGame(resolveDeckPick(setupPick.p1), resolveDeckPick(setupPick.p2));
  E.drawOpeningHand(state, 'p1');
  E.drawOpeningHand(state, 'p2');
  mulliganDecided = { p1: false, p2: false };
  renderMulliganStage();
}

function renderMulliganStage() {
  app.innerHTML = '';
  app.appendChild(h('div', { className: 'topbar' }, [h('b', {}, '오프닝 핸드 확인 / 멀리건')]));
  const panels = ['p1', 'p2'].map(p => {
    const pl = state.players[p];
    return h('div', { className: 'player-panel' }, [
      h('div', { className: 'player-header' }, [h('b', {}, p.toUpperCase()), h('span', {}, pl.deckName)]),
      h('div', { className: 'hand-list' }, pl.hand.map(id => cardChip(id, {}))),
      h('div', { className: 'actions-row' }, [
        mulliganDecided[p]
          ? h('span', {}, '결정 완료 ✔')
          : h('button', {
              className: 'primary',
              onClick: () => { E.mulligan(state, p); mulliganDecided[p] = true; afterMulliganCheck(); },
            }, '멀리건 (새로 5장)'),
        !mulliganDecided[p] && h('button', {
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
    const first = E.coinFlip();
    E.beginGame(state, first);
    render();
  } else {
    renderMulliganStage();
  }
}

// ---------- render ----------

function render() {
  if (!state) return renderSetup();
  E.autoAdvance(state);
  app.innerHTML = '';
  app.classList.toggle('log-open', panelsOpen.log);
  app.appendChild(renderTopbar());
  app.appendChild(renderBoard());
  app.appendChild(renderActions());
  app.appendChild(renderLog());
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
    return h('div', { className: 'topbar' }, [h('b', {}, `게임 종료 — 승자: ${state.winner}`)]);
  }
  return h('div', { className: 'topbar' }, [
    h('b', {}, `턴 ${state.turnNumber}`),
    h('span', {}, `활성: ${state.activePlayer}`),
    h('span', {}, `페이즈: ${PHASE_LABEL[state.phase] || state.phase}`),
    bar,
    h('span', {}, `메모리 ${state.memory >= 0 ? '+' : ''}${state.memory}`),
    h('button', { onClick: () => { E.nextPhase(state); render(); } }, '다음 페이즈 ▶'),
    h('button', {
      className: 'danger', disabled: state.phase !== 'main',
      onClick: () => { E.declarePass(state); render(); },
    }, '패스 (메모리 상대측 3으로 고정하고 턴종료)'),
  ]);
}

function cardChip(cardId, opts = {}) {
  const c = S.card(cardId);
  const cls = ['card-chip'];
  if (opts.selected) cls.push('selected');
  if (opts.suspended) cls.push('suspended');
  const meta = [c.level ? `Lv.${c.level}` : c.category, c.dp ? `DP${c.dp}` : null, c.cost != null ? `C${c.cost}` : null]
    .filter(Boolean).join(' · ');
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
    h('div', { className: 'nm' }, c.nameKo),
    h('div', { className: 'meta' }, meta),
    opts.sourcesCount ? h('div', { className: 'stack-src' }, `진화원 ${opts.sourcesCount}장`) : null,
  ]);
}

function renderStack(p, stack, zoneKind, opts = {}) {
  const isSelected = sel.stack && sel.stack.uid === stack.uid;
  const isSecondSelected = sel.stack2 && sel.stack2.uid === stack.uid;
  const isOwnActiveBattle = p === state.activePlayer && zoneKind === 'battle' && !stack.suspended && state.phase === 'main';
  const chip = cardChip(stack.cardId, {
    selected: isSelected || isSecondSelected,
    suspended: stack.suspended,
    sourcesCount: stack.sources.length,
    draggable: isOwnActiveBattle,
    dragPayload: { kind: 'stack', player: p, uid: stack.uid, zone: zoneKind },
    onDrop: (drag) => {
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
      // Dropping the hand card on the SECOND of two selected battle stacks
      // is how DNA/Jogress fusion is triggered — no separate button needed,
      // the two-click stack1+stack2 selection already signals that intent.
      if (isSecondSelected && sel.stack && sel.stack.player === p && sel.stack.uid !== stack.uid) {
        S.fuseStacks(state, p, sel.stack.uid, stack.uid, drag.cardId, val('costInput'), 'hand');
        sel.stack = null; sel.stack2 = null;
        E.checkAutoEndTurn(state);
        dragData = null; render();
        return;
      }
      const check = E.canNormalEvolve(stack.cardId, drag.cardId, stack.extraColors || []);
      const evoModDelta = S.consumeEvoCostMod(state, p, drag.cardId);
      const cost = Math.max(0, (check.ok ? check.cost : 0) + evoModDelta);
      S.digivolve(state, p, stack.uid, drag.cardId, cost, 'hand');
      E.checkAutoEndTurn(state);
      dragData = null; render();
    },
    onClick: opts.onClickOverride || (() => {
      if (sel.stack && sel.stack.uid === stack.uid) { sel.stack = null; }
      else if (sel.stack && !sel.stack2 && sel.stack.player === p && zoneKind === 'battle' && sel.stack.uid !== stack.uid) {
        sel.stack2 = { player: p, uid: stack.uid, zone: zoneKind };
      } else {
        sel.stack = { player: p, uid: stack.uid, zone: zoneKind };
        sel.stack2 = null;
      }
      render();
    }),
  });

  const linkSlots = zoneKind !== 'raising' ? S.availableLinkSlots(stack) : [];
  if (!linkSlots.length) return chip;
  // Small overlay badge, separately droppable, so dragging a hand card onto
  // it links instead of digivolving — distinct from dropping on the card art.
  const badge = h('div', {
    className: 'link-badge',
    title: linkSlots.map(s => `${S.card(s.grantedBy).nameKo} 링크: ${s.conditionText} (코스트 ${s.cost})`).join('\n'),
    ondragover: (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-hover'); },
    ondragleave: (e) => { e.currentTarget.classList.remove('drop-hover'); },
    ondrop: (e) => {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-hover');
      const drag = dragData;
      if (!drag || drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main') return;
      const slot = linkSlots[0];
      S.linkCardTo(state, p, stack.uid, drag.cardId, slot.grantedBy, slot.cost, 'hand');
      E.checkAutoEndTurn(state);
      dragData = null; render();
    },
  }, '🔗' + (stack.linkCards?.length ? stack.linkCards.length : ''));
  return h('div', { className: 'stack-wrap' }, [chip, badge]);
}

function playFreshFromDrag(drag, p) {
  if (!drag || drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main') return;
  const category = S.card(drag.cardId).category;
  if (category === 'option') {
    S.useOptionCard(state, drag.player, drag.idx);
  } else {
    const cost = S.card(drag.cardId).cost || 0;
    if (cost > 0) S.spendMemory(state, cost);
    S.playDigimonFresh(state, drag.player, drag.idx);
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
  const canAttackThisPlayer = dragData && dragData.kind === 'stack' && dragData.player !== p;
  const header = h('div', {
    className: 'player-header',
    ondragover: canAttackThisPlayer ? (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); } : undefined,
    ondragleave: canAttackThisPlayer ? (e) => e.currentTarget.classList.remove('drop-hover') : undefined,
    ondrop: canAttackThisPlayer ? (e) => {
      e.preventDefault(); e.currentTarget.classList.remove('drop-hover');
      if (dragData && dragData.kind === 'stack' && dragData.zone === 'battle') { attackFlow(dragData.player, dragData.uid, 'PLAYER'); }
      dragData = null;
    } : undefined,
  }, [
    h('b', {}, p.toUpperCase()),
    h('span', {}, pl.deckName),
    canAttackThisPlayer ? h('span', { style: 'color:var(--danger)' }, '← 여기에 놓아서 이 플레이어 공격') : null,
  ]);

  const canHatch = state.phase === 'breeding' && p === state.activePlayer && !pl.raising && pl.digitamaDeck.length > 0;
  const pileRail = h('div', { className: 'pile-rail' }, [
    pileChip('덱', pl.deck.length, 'pile-deck'),
    pileChip('시큐리티', pl.security.length, 'pile-security'),
    pileChip('트래시', pl.trash.length, 'pile-trash'),
  ]);

  const canMoveRaising = state.phase === 'breeding' && p === state.activePlayer && pl.raising && (S.card(pl.raising.cardId).level || 0) >= 3;
  const raisingZone = h('div', { className: 'zone hex-field' }, [
    zonePill(canMoveRaising ? '육성 에어리어 (카드 클릭=배틀 이동)' : '육성 에어리어'),
    h('div', { className: 'hex-slot-row' }, [
      pl.raising
        ? renderStack(p, pl.raising, 'raising', canMoveRaising ? { onClickOverride: () => { S.moveRaisingToBattle(state, p); render(); } } : {})
        : h('div', { className: 'empty-slot' }, '비어있음'),
      // digitama pile lives right next to the raising area it feeds, not
      // grouped with the unrelated deck/security/trash counters
      pileChip(canHatch ? '디지타마 (클릭=부화)' : '디지타마', pl.digitamaDeck.length, 'pile-digitama', canHatch ? () => { S.hatchDigitama(state, p); render(); } : undefined),
    ]),
  ]);

  const battleZone = h('div', { className: 'zone drop-zone hex-field' }, [
    zonePill('배틀 에어리어 (핸드카드를 여기로 드래그하면 등장)'),
    h('div', {
      className: 'stack-list hex-slot-row',
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-hover'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); playFreshFromDrag(dragData, p); },
    }, pl.battle.length ? pl.battle.map(s => renderStack(p, s, 'battle')) : [h('div', { className: 'empty-slot' }, '비어있음')]),
  ]);

  const handZone = h('div', { className: 'zone hand-zone', style: 'flex:1' }, [
    zonePill(`핸드 (${pl.hand.length}장, 연습용 전체 공개) — 배틀 에어리어로 드래그=등장, 내 스택 위로 드래그=진화, 상대 이름 위로 스택 드래그=공격`),
    h('div', { className: 'hand-list' }, pl.hand.map((id, i) => cardChip(id, {
      selected: sel.hand && sel.hand.player === p && sel.hand.idx === i,
      draggable: p === state.activePlayer && state.phase === 'main',
      dragPayload: { kind: 'hand', player: p, idx: i, cardId: id },
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

function scriptFor(trigger) {
  return Effects.lookupCardSpecific(trigger.cardId, trigger.tags) || Effects.compileToScript(trigger.text);
}

async function runPendingScript(trigger) {
  const script = scriptFor(trigger);
  const ctx = { state, S, self: trigger.player, opp: S.opponentOf(trigger.player), sourceCardId: trigger.cardId, sourceStackUid: trigger.stackUid, choose: ctxChoose };
  await Effects.runScript(script, ctx);
  S.resolvePending(state, trigger.uid);
  render();
}

function renderPendingEffects() {
  if (!state.pending.length) return null;
  const rows = state.pending.map(t => {
    const c = S.card(t.cardId);
    const script = scriptFor(t);
    return h('div', { className: 'effect-box', style: 'margin-bottom:6px;' }, [
      h('div', {}, `【${t.tags.join('】【')}】 ${c.nameKo} (${t.player})`),
      h('div', {}, t.text),
      h('div', { className: 'actions-row', style: 'margin-top:6px;' }, [
        script.length
          ? h('button', { className: 'primary', onClick: () => { runPendingScript(t); } }, `자동 실행 (${script.length}개 동작 인식됨, 선택이 필요하면 팝업)`)
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

  if (kind === 'pickStack') {
    const cards = payload.uids.map(uid => {
      const pl = state.players[payload.player];
      const st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
      return { uid, cardId: st?.cardId };
    }).filter(x => x.cardId);
    rows.push(h('div', { className: 'stack-list' }, cards.map(x => cardChip(x.cardId, { onClick: () => resolve(x.uid) }))));
    rows.push(h('button', { onClick: () => resolve(null) }, '대상 없음 / 취소'));
  } else if (kind === 'pickFromHand') {
    const pl = state.players[payload.player];
    const idxs = pl.hand.map((id, i) => i);
    rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl.hand[i], { onClick: () => resolve(pl.hand[i]) }))));
    rows.push(h('button', { onClick: () => resolve(null) }, '선택 안 함'));
  } else if (kind === 'pickFromHandIndexes' || kind === 'pickFromZoneIndex') {
    const pl = state.players[payload.player];
    const zone = payload.zone || 'hand';
    const idxs = payload.eligibleIdxs;
    if (kind === 'pickFromZoneIndex') {
      rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl[zone][i], { onClick: () => resolve(i) }))));
      rows.push(h('button', { onClick: () => resolve(null) }, '선택 안 함'));
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
      h('button', { className: 'primary', onClick: () => { const result = picked.slice(); state._multiPick = []; resolve(result); } }, '확인 (핸드로 가져가고 나머지는 자동 처리)'),
    ]));
  } else if (kind === 'multipleChoice') {
    rows.push(h('div', { className: 'actions-row' }, payload.options.map((label, i) => h('button', { onClick: () => resolve(i) }, label))));
  }

  return h('div', { className: 'player-panel' }, rows);
}

function renderActions() {
  if (state.winner) return h('div', { className: 'actions' });

  const choiceUi = renderUiChoice();
  if (choiceUi) { return h('div', { className: 'actions' }, [choiceUi]); }

  const pendingUi = renderPendingAttack();
  if (pendingUi) { return h('div', { className: 'actions' }, [pendingUi]); }

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
      h('span', { className: 'meta' }, '디지타마 파일 클릭 = 부화, 육성 에어리어의 카드 클릭 = 배틀 이동 (둘 다 선택, 이동을 고르면 이번 턴 부화는 불가)'),
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

  const effText = describeSelectedEffects();
  if (effText) rows.push(h('div', { className: 'effect-box' }, effText));

  return h('div', { className: 'actions' }, rows);
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
function attackFlow(p, uid, directTarget) {
  const dec = S.declareAttack(state, p, uid);
  if (!dec.ok) { render(); return; }
  S.queueTriggersForStack(state, p, dec.stack, 'attack');
  const dp = S.effectiveDP(dec.stack);
  const opp = S.opponentOf(p);
  const digimonTargets = S.legalDigimonTargets(state, p, uid);
  sel.pendingAttack = { attacker: p, uid, dp, opp, digimonTargets, stage: 'targetChoice', attackerCardId: dec.stack.cardId };

  if (directTarget === 'PLAYER') {
    sel.pendingAttack.stage = 'blockerCheck';
  } else if (directTarget && digimonTargets.includes(directTarget) && !blockedFromDigimonTarget(p, dec.stack)) {
    const res = S.resolveDigimonBattle(state, p, uid, directTarget);
    sel.pendingAttack.stage = 'digimonResult';
    sel.pendingAttack.battleRes = res;
  }
  render();
}

const RESULT_LABEL_KO = { attackerWins: '공격측 승리', defenderWins: '방어측 승리', tie: '동점 (양쪽 소멸)', jammedSurvive: '≪재밍≫으로 생존' };

function renderVsBattle(leftCardId, leftDp, rightCardId, rightDp, result) {
  const leftWins = result === 'attackerWins' || result === 'jammedSurvive';
  const rightWins = result === 'defenderWins';
  return h('div', { className: 'vs-battle' }, [
    h('div', { className: `vs-side${leftWins ? ' vs-winner' : ''}` }, [cardChip(leftCardId, {}), h('div', { className: 'vs-dp' }, `DP ${leftDp}`)]),
    h('div', { className: 'vs-mid' }, [h('div', { className: 'vs-vs' }, 'VS'), h('div', { className: 'vs-result' }, RESULT_LABEL_KO[result] || result)]),
    h('div', { className: `vs-side${rightWins ? ' vs-winner' : ''}` }, [cardChip(rightCardId, {}), h('div', { className: 'vs-dp' }, `DP ${rightDp}`)]),
  ]);
}

function renderPendingAttack() {
  const pa = sel.pendingAttack;
  if (!pa) return null;
  const attackerStackNow = state.players[pa.attacker].battle.find(s => s.uid === pa.uid);
  const rows = [h('div', { className: 'section-title' }, `공격 처리 중: ${attackerStackNow ? S.card(attackerStackNow.cardId).nameKo : '(소멸됨)'} (DP${pa.dp}) → ${pa.opp}`)];

  if (pa.stage === 'targetChoice') {
    const attackerStack = state.players[pa.attacker].battle.find(s => s.uid === pa.uid);
    const blockedByDynamic = blockedFromDigimonTarget(pa.attacker, attackerStack);
    rows.push(h('div', { className: 'actions-row' }, [
      h('button', { className: 'primary', onClick: () => { pa.stage = 'blockerCheck'; render(); } }, `${pa.opp}(플레이어)를 공격 → 시큐리티 체크`),
    ]));
    if (blockedByDynamic) {
      rows.push(h('div', { className: 'meta' }, '(조건부 제약으로 이번엔 디지몬 직접 공격 불가 — 위 옵션으로만 진행)'));
    } else if (pa.digimonTargets.length) {
      rows.push(h('div', { className: 'zone-label' }, '또는 액티브 상태인 상대 디지몬을 직접 공격:'));
      rows.push(h('div', { className: 'stack-list' }, pa.digimonTargets.map(uid => {
        const st = state.players[pa.opp].battle.find(s => s.uid === uid);
        return cardChip(st.cardId, { onClick: () => {
          const res = S.resolveDigimonBattle(state, pa.attacker, pa.uid, uid);
          pa.stage = 'digimonResult'; pa.battleRes = res; render();
        } });
      })));
    } else {
      rows.push(h('div', { className: 'meta' }, '상대 필드에 레스트 상태 디지몬이 없어서(≪무진화원액티브공격≫ 등의 예외도 없어서) 직접 공격은 불가해요.'));
    }
  } else if (pa.stage === 'digimonResult') {
    const res = pa.battleRes;
    rows.push(renderVsBattle(res.attackerCardId, res.aDp, res.defenderCardId, res.dDp, res.result));
    if (res.result === 'defenderWins' || res.result === 'tie') {
      rows.push(h('div', { className: 'meta' }, '공격측이 소멸했어요 (배리어 등으로 살리려면 범용 도구로 직접 처리하세요).'));
    }
    if (res.result === 'attackerWins' && res.destroyedOnlyOpponent) {
      const survivorsWithKw = state.players[pa.attacker].battle.filter(s => S.hasKeyword(s, '전투후액티브'));
      if (survivorsWithKw.length) {
        rows.push(h('div', { className: 'actions-row' }, [
          h('span', {}, '상대만 소멸시켰어요 — ≪전투후액티브≫ 보유 디지몬을 액티브로 되돌릴까요? (턴 1회)'),
          ...survivorsWithKw.map(s => cardChip(s.cardId, { onClick: () => { S.unsuspendStack(state, pa.attacker, s.uid); render(); } })),
        ]));
      }
    }
    if (res.result === 'attackerWins' && res.piercing) {
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, '≪관통≫ 보유 — 상대만 소멸시켰으니 어택 종료 전에 시큐리티도 체크할 수 있어요.'),
        h('button', { className: 'primary', onClick: () => { pa.stage = 'blockerCheck'; render(); } }, '관통으로 시큐리티 체크 진행'),
        h('button', { onClick: () => { sel.pendingAttack = null; render(); } }, '체크 안 함 / 종료'),
      ]));
    } else {
      rows.push(h('button', { onClick: () => { sel.pendingAttack = null; render(); } }, '확인 / 닫기'));
    }
  } else if (pa.stage === 'blockerCheck') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `${pa.opp}가 블로커로 막습니까?`),
      h('button', {
        onClick: () => { pa.stage = 'manualBlock'; render(); },
      }, '블로커로 막음 (수동 처리)'),
      h('button', {
        className: 'primary',
        onClick: () => {
          const res = S.resolveSecurityCheck(state, pa.attacker, pa.uid, pa.opp);
          pa.stage = 'result'; pa.res = res; render();
        },
      }, '안 막음 → 시큐리티 체크 진행'),
    ]));
  } else if (pa.stage === 'manualBlock') {
    rows.push(h('div', { className: 'effect-box' }, '블로킹한 디지몬 스택을 선택하고, 범용 도구로 DP를 비교해서 진 쪽을 "선택 스택 소멸"로 직접 트래시 처리하세요.'));
    rows.push(h('button', { onClick: () => { sel.pendingAttack = null; render(); }, }, '처리 완료 / 닫기'));
  } else if (pa.stage === 'result') {
    const res = pa.res;
    if (res.gameOver) {
      rows.push(h('div', { className: 'effect-box' }, `${pa.opp} 시큐리티 0에서 피격 — 게임 종료!`));
    } else {
      res.checks.forEach((c, i) => {
        rows.push(h('div', { className: 'zone-label' }, `시큐리티 체크 ${i + 1}/${res.checks.length}`));
        rows.push(renderVsBattle(pa.attackerCardId, pa.dp, c.revealed, c.secDp, c.result));
      });
      const last = res.checks[res.checks.length - 1];
      if (last.result === 'defenderWins' || last.result === 'tie') {
        rows.push(h('div', { className: 'actions-row' }, [
          h('span', {}, '공격측이 소멸합니다. 배리어 등으로 살릴까요?'),
          h('button', {
            className: 'primary',
            onClick: () => { sel.pendingAttack = null; render(); },
          }, '그냥 소멸시키지 않음 (배리어 등으로 생존 처리 — 범용 도구로 대가 지불)'),
          h('button', {
            className: 'danger',
            onClick: () => { S.deleteStack(state, pa.attacker, pa.uid); sel.pendingAttack = null; render(); },
          }, '소멸시킴'),
        ]));
      } else {
        rows.push(h('button', { onClick: () => { sel.pendingAttack = null; render(); }, }, '확인 / 닫기'));
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
    h('div', { className: 'section-title clickable', onClick: () => { panelsOpen.log = false; render(); } }, '로그 (클릭=접기)'),
    ...state.log.slice(0, 100).map(e => h('div', {}, `[턴${e.turn}] ${e.msg}`)),
  ]);
}

window.__dbg = () => ({ dragData, sel, state, S, E, Effects, render, attackFlow });
init();
