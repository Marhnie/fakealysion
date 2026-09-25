# 온라인 대전 (P2P netplay) — design v1

Status: v1 implemented and partially live-tested (see "Tested" section at the bottom).
Owner-approved approach: simple P2P over WebRTC via PeerJS's free public broker, host-authoritative engine,
thin-client guest. No server of our own, no account creation for players.

## Why this shape

The whole game engine (`src/state.js` + `src/engine.js` + `src/effects.js`, ~11k lines) already lives entirely
inside one browser tab and mutates one module-scope `state` object (`src/main.js`). Re-implementing that engine
server-side (or even just "shared" between two clients) is out of scope for a v1 — instead we keep exactly ONE
copy of the real engine running (on whichever side is the "host") and make the other side ("guest") a thin
renderer that mirrors whatever the host broadcasts and sends back only *requests* ("I want to play card X").
This is the same shape used internally already for CPU play: `src/cpu.js`'s driver never touches `state`
directly either — it only calls a small API object (`cpuApiObj` in `main.js`) of named actions
(`play`, `evolve`, `attack`, `pass`, `answer`, `pa.block`, …) and the *real* `doPlayFromHand`/`attackFlow`/etc.
functions do the actual mutation. **v1 reuses `cpuApiObj` itself as the host-side "apply an incoming intent"
table** — an intent from the guest is just `cpuApiObj[action](...args)` (or `cpuApiObj.pa[sub](...)` for the
attack sub-steps). This means the host never runs any new/parallel game-logic path: illegal or out-of-turn
intents fail exactly the way an illegal CPU action would (the same `S.*`/`E.*` guards apply), which is the only
anti-cheat v1 has (see "Explicitly out of scope").

## Pieces

- `src/netplay.js` (new): PeerJS connection lifecycle (create/join room), the wire protocol, and the state
  redaction/serialization. No game logic. Pure-ish module, one mutable `NET` object exported for state.
- `index.html`: one new CDN `<script>` tag for PeerJS (`cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js`),
  matching the existing unbundled `jszip` CDN tag — this project ships with no bundler, so a runtime dependency
  for the plain static site has to arrive this way, not via `npm install` + import.
- `src/main.js`: a new setup-screen mode "🌐 온라인 대전" next to "🤖 CPU 대전"/"👥 2인 (한 화면)"; a `NET`-aware
  branch in `render()`/`renderInner()`; guest-side interception at a *small* number of call sites (see below);
  board-orientation fix so each side's own field is always at the bottom of their own screen.

## Connection / room flow

1. Host picks "🌐 온라인 대전" → clicks "방 만들기". `netplay.hostRoom()` creates a `Peer` with a random
   6-character alphanumeric ID (PeerJS lets the app pick its own ID string; that ID *is* the room code — no
   separate signaling server of our own, no account, nothing that exposes a GitHub identity). The code is shown
   on screen for the host to read out / copy to the guest over whatever side channel they already use (Discord,
   voice, etc. — out of scope for us).
2. Guest picks "🌐 온라인 대전" → enters the code → "참가하기". `netplay.joinRoom(code)` creates its own
   (randomly-named) `Peer` and opens a `DataConnection` to the host's peer ID via PeerJS's public cloud broker
   (`0.peerjs.com`, the library's default — no server to run ourselves).
3. Once the `DataConnection` opens both sides exchange a `hello` (protocol version + a display label) and the
   host immediately follows with `deckSelect` UI (see "Deck selection" below), then the first `state` snapshot
   once a game exists.
4. **Seat assignment**: the host is always `p1`, the guest is always `p2`. This is fixed and simple; it means
   `isCpuSide`-style "which seat am I" logic reduces to one constant per side (`NET.mySeat`).
5. **Deck selection** (v1 choice, documented per the prompt's "your call"): the HOST picks *both* decks, exactly
   like solo practice today, and simply starts the game — the guest does not get a deck-picker in v1. This was
   chosen over "each side picks their own" because it needed no new sync protocol for the pre-game setup screen
   (which today is pure local UI state, `setupPick`, not part of `state`) and gets a real match running fastest.
   Follow-up: let the guest submit a deck pick that the host's setup screen shows before starting.

## Wire protocol

Every message is one JSON *string* (not a raw object) produced by `SN.stringify`/`SN.parse` (`src/snapshot.js`,
already used for save files) — this gets Set/Map round-tripping for free and is a codebase-established
convention, rather than inventing a second serializer. PeerJS's own `DataConnection.send` would happily take a
plain object, but going through `SN.stringify` first guarantees the exact same encoding this project already
trusts for persisting `state`, and sidesteps any doubt about PeerJS's internal (de)serializer preserving
non-plain values.

```
host  -> guest : { t:'hello', v:1 }
guest -> host  : { t:'hello', v:1 }
host  -> guest : { t:'state', seat:'p2', state:<redacted plain object>, pa:<redacted pendingAttack|null>, sel:{...} }
guest -> host  : { t:'intent', action:'play'|'evolve'|'jogress'|'attack'|'pass'|'skipBreeding'|'hatch'|'move'
                          |'train'|'useDelay'|'useMain'|'answer'|'mulligan'|'keepHand'|'pa.chooseTarget'
                          |'pa.passRedirect'|'pa.passCounter'|'pa.useCounter'|'pa.block'|'pa.passBlock'
                          |'pa.pierce'|'pa.close', args:[...] }
```

`state` messages are sent by the host after every `render()` while connected (cheap: `render()` already runs at
most a few times per second even during animation-heavy sequences, and the redacted payload is bounded — see
"Payload size" below). The guest never sends a `state` message; it is a pure follower.

`pa` (the current `sel.pendingAttack`, see next section) travels *alongside* `state`, not inside it, because it
lives in `sel` (UI-local) on the host, not in `state`.

## The `sel.pendingAttack` problem

This was the single biggest surprise reading `src/main.js`: the entire multi-step attack sequence (target
choice → redirect timing → counter timing → block check → result) is **not** part of `state` — it is
`sel.pendingAttack` (`sel` is explicitly documented in `main.js` as "UI selection only"). A naive
"redact-and-broadcast `state`" would leave the guest with no idea an attack is even in progress. v1 fixes this
by treating `sel.pendingAttack` as a *second*, smaller thing the host also broadcasts (redacted the same way:
strip the `fireDeclare`/`terminate` function fields — dropped for free by `JSON.stringify`). The guest assigns
whatever it receives onto its own local `sel.pendingAttack` so the existing `renderPendingAttack()` renders
unchanged.

## Redaction (what a guest is allowed to see)

Implemented in `netplay.buildSnapshot(state, forSeat)`, called by the host once per broadcast. Per player `p`:

- `hand`: real card ids **iff** `p === forSeat`; otherwise every entry replaced with `null` (array length kept,
  so "N cards in hand" renders via the existing `cpu-hidden` convention — see rendering changes below).
- `security`: redacted **for both seats, always** — this is the one place the task's brief specifically calls
  out ("security is secret even from its owner"). Reproduces `securityui.js`'s own face-up algorithm exactly
  (`left = {...pl.secUp}`, walk `pl.security` top→bottom, an id is real only while its `secUp` count is still
  unspent) so the guest never receives more than what the *existing single-process UI* would ever draw for
  that seat, and neither does the host's own outgoing copy of its own security. Only face-up counts (`secUp`)
  and true face-down positions differ from what already renders locally today — nothing new is hidden from a
  local human that would have been visible before.
- `deck`, `digitamaDeck`: always `null`-filled (order is secret to both sides in a real game; count preserved).
- `trash`, `battle`, `raising`, `memoryLocks`, `deckName`, `art`: sent as-is (already public zones/info).
- Top-level fields (`turnNumber`, `phase`, `activePlayer`, `memory`, `winner`, `firstPlayer`, `pending`
  [functions stripped for free by `JSON.stringify`], `log` [last 200 lines], `attackCtx`, …): sent as-is.
  `pendingReplacements`, `_fxRec`, `_rcDepth`, `_caster`, `_fxOp`, `_replWaiters`, `_leavePending`, `fxHistory`
  are dropped — all are either host-internal bookkeeping the guest's renderer never reads, or (for
  `pendingReplacements`) redundant with the `uiChoice` the host derives from them via the existing
  `pumpReplacementPrompt()` before the broadcast is built.
- `uiChoice`: sent as `{ kind, payload, by }` — `resolve` (a closure) cannot cross the wire and is rebuilt
  locally on each side (see next section). `by` (which seat's decision this is) is computed with
  `Cpu.deciderFor(state, kind, payload, {})` — the exact function `cpuApiObj`/the CPU driver already uses for
  the same question, reused rather than re-derived.

**Known gap, called out rather than silently shipped**: `uiChoice.payload` itself is passed through unaudited.
Most payloads are safe (ids of already-public stacks, canned prompt strings), but a payload whose *text* quotes
hidden information (e.g. a scry-style "choose one of: X, Y, Z" where X/Y/Z name cards from a hidden zone) would
currently leak that text to both sides even though only the deciding side is meant to ever see it. Auditing
every `ctx.choose` call site in `src/effects.js`/the card scripts for this is a real but separate follow-up
(flagged, not attempted in v1 — see "Out of scope").

## Guest-side interception (how a guest's click becomes an intent instead of a mutation)

The guest still runs the *same* `main.js`/render code — this was a hard requirement (no separate guest build).
Rather than touching every one of the dozens of `onClick` call sites that call into `S.*`/`E.*`/local helpers
directly, v1 adds one `net.guard(action, player, args)` guard **inside the small number of already-centralized
action functions** that every one of those call sites ultimately funnels through:

- `doPlayFromHand`, `doEvolve`, `runJogress`, `attackFlow` (already single named functions — every hand-card
  play / evolve / jogress / attack-declare click in the file calls one of these four).
- `paChooseTarget`, `paUseCounter`, `paBlock` (already single named functions for the three attack sub-steps
  that take a real argument; the four *parameterless* "pass this step" sub-steps — `passRedirect`/
  `passCounter`/`passBlock`/`pierce`/`close` — are one-line closures at their `onClick` sites inside
  `renderPendingAttack()`, so those five got the guard inline instead of a new named wrapper).
- The mulligan buttons, the breeding-phase "부화"/"이동"/다음 페이즈 buttons, and the main-phase "패스"/"다음
  페이즈" button — a handful of one-line `onClick`s, guarded inline the same way.
- `ctxChoose`'s *resolve path* is not guarded at the source at all — see next paragraph, it needed a different
  trick.

`net.guard(action, player, args)` returns `true` (meaning "handled, caller should return now") when
`NET.role === 'guest' && player === NET.mySeat`, and as a side effect calls `netplay.sendIntent(action, args)`.
When it returns `false` (not a guest, or this seat is not `NET.mySeat` — e.g. the guest is only ever asked to
gate *their own* seat's actions, never the host's, since the guest's mirrored `state` still contains the host's
real actions being applied to it) the original function runs exactly as before — this is why CPU mode and local
2p mode are provably unaffected: `NET.role` is `null` there, so `net.guard` always returns `false` immediately.

### `uiChoice.resolve` across the wire

Because a function cannot be serialized, the guest's copy of `state.uiChoice` (as received from `buildSnapshot`)
has no real `resolve`. `netplay`'s receive handler patches one back on before calling the guest's own `render()`:

```js
state.uiChoice = payload.uiChoice && {
  ...payload.uiChoice,
  resolve: (val) => netplay.sendIntent('answer', [val]),
};
```

Every existing render path that calls `state.uiChoice.resolve(val)` (`renderUiChoice()`, the replacement-effect
prompt, …) therefore works completely unchanged on the guest — it has no idea it's talking to the network
instead of a real `Promise`. On the host, the `'answer'` intent handler is exactly
`cpuApiObj.answer(state.uiChoice, val)` — using the **host's own live `uiChoice`** (with its real `resolve`
closure), not anything reconstructed from the wire; the guest's message only carries `val`. This one trick
covers both of the two places `main.js` currently creates a `uiChoice` (`ctxChoose` and
`pumpReplacementPrompt`) with zero changes to either of them.

## Rendering changes

- `renderBoard()`: was a hardcoded `[panel('p2'), memoryTrack, panel('p1')]` (fine for CPU mode, where the human
  is always `p1`, and for local 2p, where "top/bottom" is an arbitrary shared-screen convention). For netplay,
  per the project owner's explicit ask, each side's own panel must render at the *bottom of their own screen* —
  changed to `[panel(opponentOf(bottomSeat)), memoryTrack, panel(bottomSeat)]` where
  `bottomSeat = NET.active ? NET.mySeat : 'p1'`. When `NET.active` is false this is byte-for-byte the previous
  behavior (`bottomSeat` is always `'p1'`), so CPU/2p rendering is untouched.
- The two hand-list renderers (`pl.hand.map(id => …)`, mulligan screen + main board) already had a
  CPU-specific "hidden hand" branch (`isCpuSide(p) && !CPU_CFG.reveal`) that draws a face-down `cpu-hidden`
  placeholder instead of a real `cardChip`. v1 extends the *same* branch condition with `|| id == null` — since
  a redacted opponent hand now genuinely contains `null` entries (not just "would-look-the-same-if-hidden"),
  this reuses the existing placeholder rendering exactly as the brief suggested, with no new CSS/markup.

## What v1 actually does end-to-end

Implemented and wired: room create/join + PeerJS connection, host authoritative state broadcast (redacted),
guest thin-client render from received state, intent relay for: hand-card play (tap flow AND drag-drop),
evolve (tap + drag-drop), jogress, attack declare + the full target/redirect(incl. cost-carrying
redirects, sent by index since their `pay` closure can't cross the wire)/counter/block/pierce/close
sub-steps, the post-battle ≪전투후액티브≫ unsuspend prompt, pass, breeding skip/hatch/move, ≪트레이닝≫,
≪딜레이≫, activated 【메인】 abilities, mulligan/keep-hand, and generic choice resolution (`answer`, which
covers every `ctxChoose` kind plus the replacement-effect prompt) — this list is every state-mutating
click site found in `src/main.js` at the time of writing, not a curated subset.

`state.attackCtx` (a host-internal pointer `attackFlow` sets for card scripts to read "is this stack
currently attacking") turned out to hold a genuine reference cycle once an attack was mid-flight — the first
live two-tab test hit `TypeError: Converting circular structure to JSON` naming `attackCtx` as the closing
property. Fixed by adding it to `DROP_KEYS` (the guest gets the same information through the separate `pa`
field already) and, as defense in depth, `netplay.js`'s `send()` now retries once with a generic
circular/function-stripping replacer if the normal `SN.stringify` throws, so one future unanticipated field
degrades gracefully instead of silently dropping the whole message.

## Explicitly out of scope for v1 (per the approved brief — not attempted)

- Reconnection after a dropped connection mid-game (a lost `DataConnection` ends the online match; both sides
  fall back to the setup screen).
- More than 2 human players / spectators on a live P2P match.
- CPU-vs-network-human hybrid modes.
- Any anti-cheat beyond "the host only ever calls the same validated `cpuApiObj`/`S.*`/`E.*` functions a local
  click would" — a guest that tampers with its own client can still send an intent for an illegal action; the
  host's existing rule checks reject it the same way an illegal local/CPU action would (e.g. `S.declareAttack`
  returning `{ok:false}`), but there is no *additional* server-side validation layer beyond what already exists.
- Full `uiChoice.payload` content redaction (see "Known gap" above).
- Voice/text chat.
- A guest-side deck picker (host picks both decks for v1 — see "Deck selection").

## Payload size

A redacted snapshot is one JSON string of the whole `state` minus hidden card identities; for a mid-game state
with a full log this is on the order of tens of KB, well within a WebRTC data channel's per-message limits and
sent at most a few times a second — no chunking/diffing was implemented (or needed) for v1.

## Tested

Live, with two real separate browser tabs (host + guest) against the project's normal dev server
(`npx serve`, `.claude/launch.json`'s `digimon-sim` config), across two separate sessions (a room was created,
played a few turns, and re-created from scratch after a fix, to confirm the fix took effect):

- Room create (host) → PeerJS peer registers on the public broker, 6-character code shown.
- Room join (guest) → `DataConnection` opens, both sides show "connected".
- Host picks both decks and starts the game; the guest's screen transitions automatically (no local click) the
  moment the first `state` broadcast arrives, straight into the mulligan screen.
- Mulligan: host (P1) and guest (P2) each independently clicked "이 핸드 유지"/"멀리건" for their own seat; the
  turn-order gating (선공 decides first) and the resulting board rendered correctly on both sides.
- Verified via `window.__dbg().state` **executed inside the guest's own tab** (not inferred from rendering)
  that `players.p1.hand` was `[null,null,null,null,null]` while `players.p2.hand` held the guest's real card
  ids, and both `deck` arrays were all-`null` — the redaction is real at the data level, not just a rendering
  choice.
- Board orientation: confirmed host sees P1 (itself) at the bottom / P2 at top, and the guest simultaneously
  sees P2 (itself) at the bottom / P1 at top, on the same live game.
- Full turn cycle: host played a card (tap-to-play flow), turn auto-passed to the guest on memory going
  positive, guest played a card (network intent → host applied it → rebroadcast, confirmed the card appeared
  in the guest's own battle area on both screens), turn passed back to the host, host declared an attack on
  the guest's security, the guest (on their own screen) saw the synced attack panel and clicked "넘기기" to
  decline blocking with their ≪블로커≫-tagged Digimon, and the resulting security check (top card revealed,
  DP comparison, attacker destroyed) matched exactly on both screens.
- Confirmed the engine's own legality checks still apply to intents: attacking with a Digimon on the turn it
  was played was correctly rejected (host logged "이번 턴에 등장/원본이 플레이된 카드라 공격 불가" and no attack
  panel opened) rather than the guest's illegal request being silently honored.
- Regression check: CPU mode and local 2p mode were each started fresh after all the above changes — both
  reached the mulligan screen and the main board with no console errors, CPU still auto-decided its mulligan
  and played a card on its own turn, and 2p showed both hands face-up as before (network code paths are
  no-ops there: `Net.NET.role` stays `null`).
- `node scripts/check-syntax.mjs` — OK (157 files). `node scripts/test-cpu.mjs` — OK (this exercises
  `cpu.js`/`cpusim.js` headlessly, not `main.js`'s DOM code, so it is a weaker signal for THIS feature than the
  live two-tab test above, but confirms the CPU engine itself wasn't touched/broken).

Not tested live: a redirect-with-cost (`opt.pay`) card actually being redirected over the network, a
counter effect being activated by a network guest, a full game reaching a win condition over the network, and
anything from the "explicitly out of scope" list above.
