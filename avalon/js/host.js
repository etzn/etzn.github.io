import * as G from './game.js';
import { createPlayerUI, esc } from './ui.js';
import { PREFIX, HEARTBEAT_MS, STALE_MS, peerOptions, peerToQuery, randomCode, store, keepAwake } from './net.js';

const HOST = 'host';
const K = { state: 'avalon.host.state', config: 'avalon.host.config', room: 'avalon.host.room' };

const savedCfg = store.get(K.config, {});
const def = G.defaultConfig();
let config = {
  ...def, ...savedCfg,
  roles: { ...def.roles, ...(savedCfg.roles || {}) },
  override: { ...def.override, ...(savedCfg.override || {}) },
  peer: { ...def.peer, ...(savedCfg.peer || {}) },
};
let S = store.get(K.state) || G.newState();
let room = store.get(K.room) || randomCode();
store.set(K.room, room);

const conns = new Map();       // player id -> DataConnection
const spectators = new Set();  // DataConnections for watchers / late joiners
const lastSeen = new WeakMap();
let peer = null, peerRetry = 0, net = { state: 'starting', msg: '' };
let lastRenderedPhase = null, abortArmed = false, qrCache = { url: '', svg: '' };

const $ = (id) => document.getElementById(id);
// Only touch the DOM when markup actually changed, so taps aren't lost to no-op re-renders.
const htmlCache = new Map();
function setHTML(id, html) { if (htmlCache.get(id) === html) return; htmlCache.set(id, html); $(id).innerHTML = html; }
const seatUI = createPlayerUI($('seat'), (action) => doAct(HOST, action, (msg) => seatUI.setError(msg)), { seenKey: 'avalon.seen.host', isHost: true });

// ---------- state plumbing ----------
const hostInGame = () => S.players.some((p) => p.id === HOST);
function connectedSet() { const s = new Set(conns.keys()); s.add(HOST); return s; }
function safeSend(c, m) { try { if (c.open) c.send(m); } catch {} }

function syncHostSeat() {
  if (S.phase !== 'lobby') return;
  const name = (config.hostName || 'Host').trim().slice(0, 20) || 'Host';
  const p = S.players.find((x) => x.id === HOST);
  if (config.hostPlays && !p) S.players.unshift({ id: HOST, name: uniqueName(name, HOST) });
  else if (config.hostPlays && p) p.name = uniqueName(name, HOST);
  else if (!config.hostPlays && p) S.players = S.players.filter((x) => x.id !== HOST);
}

function commit() {
  store.set(K.state, S);
  const connected = connectedSet();
  for (const [pid, c] of conns) safeSend(c, { t: 'state', view: G.viewFor(S, pid, connected) });
  for (const c of spectators) safeSend(c, { t: 'state', view: { ...G.viewFor(S, null, connected), watch: !!c.watch } });
  seatUI.update({ ...G.viewFor(S, hostInGame() ? HOST : null, connected), watch: true });
  render();
}

function uniqueName(name, id) {
  const base = String(name || 'Player').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';
  const taken = (n) => S.players.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
  let n = base, i = 2;
  while (taken(n)) n = `${base.slice(0, 17)} ${i++}`;
  return n;
}

function doAct(pid, action, onErr) {
  try {
    if (!action || typeof action !== 'object') throw new Error('Bad action.');
    const clean = { type: String(action.type), team: Array.isArray(action.team) ? action.team.map(String) : undefined, approve: !!action.approve, approved: !!action.approved, fail: !!action.fail, target: action.target != null ? String(action.target) : undefined };
    G.act(S, pid, clean);
    commit();
  } catch (e) { onErr(e.message); }
}

function adminDo(fn) {
  try { fn(); commit(); } catch (e) { toast(e.message); }
}

function backToLobby() {
  G.toLobby(S);
  // late joiners who were spectating get seats now
  for (const c of [...spectators]) {
    if (c.watch || !c.token) continue;
    if (!S.players.some((p) => p.id === c.token) && S.players.length < G.MAX_PLAYERS) G.addPlayer(S, c.token, uniqueName(c.name, c.token));
    c.pid = c.token; conns.set(c.token, c); spectators.delete(c);
  }
  syncHostSeat();
}

// ---------- networking ----------
function setNet(state, msg = '') { net = { state, msg }; renderRoom(); }

function startPeer() {
  clearTimeout(peerRetry);
  if (peer) { try { peer.destroy(); } catch {} }
  setNet('connecting');
  const p = (peer = new Peer(PREFIX + room, peerOptions(config.peer)));
  p.on('open', () => { if (p === peer) setNet('online'); });
  p.on('connection', onConn);
  p.on('disconnected', () => {
    if (p !== peer || p.destroyed) return;
    setNet('reconnecting', 'Lost the matchmaking server; existing players stay connected.');
    peerRetry = setTimeout(() => { try { if (!p.destroyed) p.reconnect(); } catch {} }, 1500);
  });
  p.on('error', (err) => {
    if (p !== peer) return;
    if (err.type === 'unavailable-id') {
      setNet('busy', 'This room code is still held by a previous session (a refresh does this). Retrying — it can take up to a minute.');
      peerRetry = setTimeout(startPeer, 5000);
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      setNet('reconnecting', 'Network trouble — retrying…');
      peerRetry = setTimeout(() => { if (p.destroyed) startPeer(); else if (p.disconnected) { try { p.reconnect(); } catch { startPeer(); } } }, 3000);
    } else if (err.type === 'browser-incompatible') setNet('error', 'This browser doesn’t support WebRTC.');
    else console.warn('peer error', err);
  });
}

function onConn(c) {
  c.on('open', () => lastSeen.set(c, Date.now()));
  c.on('data', (m) => { lastSeen.set(c, Date.now()); onData(c, m); });
  const drop = () => {
    let changed = spectators.delete(c);
    if (c.pid && conns.get(c.pid) === c) { conns.delete(c.pid); changed = true; }
    if (changed) commit();
  };
  c.on('close', drop);
  c.on('error', drop);
}

function onData(c, m) {
  if (!m || typeof m !== 'object' || m.t === 'pong') return;
  if (m.t === 'hello') {
    const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
    if (!token || token === HOST) return c.close();
    c.token = token; c.name = String(m.name || '').slice(0, 20);
    if (m.watch) { c.watch = true; spectators.add(c); return commit(); }
    const p = S.players.find((x) => x.id === token);
    if (!p) {
      if (S.phase !== 'lobby') { spectators.add(c); return commit(); }
      if (S.players.length >= G.MAX_PLAYERS) return safeSend(c, { t: 'error', msg: 'The table is full.' });
      G.addPlayer(S, token, uniqueName(c.name, token));
    } else if (S.phase === 'lobby' && c.name) p.name = uniqueName(c.name, token);
    const old = conns.get(token);
    if (old && old !== c) { old.pid = null; try { old.close(); } catch {} }
    c.pid = token; conns.set(token, c); spectators.delete(c);
    return commit();
  }
  if (m.t === 'act' && c.pid) doAct(c.pid, m.action, (msg) => safeSend(c, { t: 'error', msg }));
}

setInterval(() => {
  const now = Date.now();
  for (const c of [...conns.values(), ...spectators]) {
    if (now - (lastSeen.get(c) || now) > STALE_MS) { try { c.close(); } catch {} continue; }
    safeSend(c, { t: 'ping' });
  }
}, HEARTBEAT_MS);

// ---------- rendering ----------
function joinUrl(extra) {
  const u = new URL('../', location.href);
  u.search = ''; u.hash = '';
  const q = new URLSearchParams({ room });
  peerToQuery(config.peer, q);
  if (extra) for (const [k, v] of Object.entries(extra)) q.set(k, v);
  u.search = q.toString();
  return u.toString();
}

function qrSvg(url) {
  if (qrCache.url === url) return qrCache.svg;
  let svg = '';
  try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch {}
  qrCache = { url, svg };
  return svg;
}

function renderRoom() {
  const url = joinUrl();
  const dot = { online: 'ok', connecting: 'wait', starting: 'wait', reconnecting: 'wait', busy: 'wait', error: 'bad' }[net.state] || 'wait';
  const label = { online: 'Room open', connecting: 'Opening room…', starting: 'Starting…', reconnecting: 'Reconnecting…', busy: 'Waiting for room code…', error: 'Error' }[net.state];
  const inLobby = S.phase === 'lobby';
  const body = `
    <div class="roomgrid">
      <div class="qr">${qrSvg(url)}</div>
      <div>
        <div class="muted small">Room code</div>
        <div class="code">${esc(room)}</div>
        <div class="net"><span class="dot ${dot}"></span>${esc(label)}</div>
        ${net.msg ? `<p class="muted small">${esc(net.msg)}</p>` : ''}
        <div class="row wrap">
          <button class="ghost" data-h="copy">Copy join link</button>
          ${inLobby ? '<button class="ghost" data-h="newcode">New code</button>' : ''}
        </div>
        <p class="muted small">Players scan or open <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ''))}</a>. For a shared TV screen: <a href="${esc(joinUrl({ watch: '1' }))}" target="_blank" rel="noopener">public board</a>.</p>
      </div>
    </div>`;
  setHTML('room', inLobby ? `<section class="card">${body}</section>` : `<details class="card"><summary>Room ${esc(room)} <span class="dot ${dot}"></span></summary>${body}</details>`);
}

function renderControls() {
  const n = S.players.length, inLobby = S.phase === 'lobby', connected = connectedSet();
  let h = `<h3>Players <span class="muted">(${n})</span></h3>`;
  if (inLobby) h += `<p class="muted small">Seat order = leader order. Arrange it to match the table (clockwise), or shuffle.</p>`;
  h += `<ol class="seats admin">${S.players.map((p, i) => `
    <li class="${connected.has(p.id) ? '' : 'off'}">
      <span><span class="dot ${connected.has(p.id) ? 'ok' : 'bad'}"></span>${esc(p.name)}${p.id === HOST ? ' <span class="muted">(this device)</span>' : ''}</span>
      ${inLobby ? `<span class="tags">
        <button class="mini" data-h="up" data-x="${esc(p.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
        <button class="mini" data-h="down" data-x="${esc(p.id)}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
        ${p.id === HOST ? '' : `<button class="mini" data-h="kick" data-x="${esc(p.id)}" aria-label="Remove">✕</button>`}
      </span>` : ''}
    </li>`).join('') || '<li class="muted">Nobody yet — share the code.</li>'}</ol>`;
  if (spectators.size) h += `<p class="muted small">${spectators.size} watching</p>`;

  if (inLobby) {
    const issues = G.validate(n, config);
    const s = n >= G.MIN_PLAYERS ? G.getSetup(n, config) : null;
    if (s) h += `<p class="small">${n} players → <b class="good">${n - s.evil} good</b>, <b class="evil">${s.evil} evil</b>; missions ${s.sizes.map((x, i) => i === s.doubleFail ? x + '*' : x).join(' / ')}${s.doubleFail >= 0 ? ' <span class="muted">(* needs 2 fails)</span>' : ''}${s.official ? '' : ' <span class="muted">(unofficial)</span>'}</p>`;
    h += issues.map((x) => `<p class="${x.level === 'error' ? 'err' : 'warn'} small">${esc(x.msg)}</p>`).join('');
    h += `<div class="row wrap"><button class="primary" data-h="start" ${issues.some((x) => x.level === 'error') ? 'disabled' : ''}>Deal roles & start</button><button class="ghost" data-h="shuffle" ${n < 2 ? 'disabled' : ''}>Shuffle seats</button></div>`;
  } else {
    const g = S.game;
    if (g.phase === 'vote' && !g.config.trackVotes) {
      h += `<p class="small">Record the out-loud vote (if the leader can’t):</p><div class="row"><button class="ghost" data-h="mark" data-x="1">Approved</button><button class="ghost" data-h="mark" data-x="0">Rejected</button></div>`;
    }
    h += `<div class="row wrap">${g.phase === 'over'
      ? '<button class="primary" data-h="lobby">Back to lobby (same players)</button>'
      : `<button class="danger" data-h="abort">${abortArmed ? 'Tap again to end the game' : 'End game early'}</button>`}</div>`;
  }
  setHTML('controls', `<section class="card">${h}</section>`);
}

function renderSettings() {
  if (S.phase !== 'lobby') {
    $('settings').innerHTML = `<details class="card"><summary>Settings</summary><p class="muted small">Locked while a game is running. Roles this game: ${Object.entries(S.game.rolesInPlay).map(([r, c]) => (c > 1 ? c + '× ' : '') + G.ROLE_INFO[r].name).join(', ')}.</p></details>`;
    return;
  }
  const c = config, o = c.override, pe = c.peer;
  const roleBox = (r) => `<label class="check"><input type="checkbox" name="role_${r}" ${c.roles[r] ? 'checked' : ''}><span><b class="${G.ROLE_INFO[r].team}">${G.ROLE_INFO[r].name}</b><br><span class="muted small">${esc(G.ROLE_INFO[r].blurb)}</span></span></label>`;
  $('settings').innerHTML = `<form class="card" id="cfg" autocomplete="off">
    <h3>Settings</h3>
    <label class="check"><input type="checkbox" name="hostPlays" ${c.hostPlays ? 'checked' : ''}><span>I’m playing on this device<br><span class="muted small">Your screen shows only your own seat. Off = this device just runs the game and shows the public board.</span></span></label>
    <label>Your name<input name="hostName" maxlength="20" value="${esc(c.hostName)}"></label>
    <fieldset><legend>Special roles <span class="muted small">(the rest are Loyal Servants / Minions)</span></legend>
      <div class="cols">${G.GOOD_SPECIALS.map(roleBox).join('')}${G.EVIL_SPECIALS.map(roleBox).join('')}</div>
    </fieldset>
    <fieldset><legend>Rules</legend>
      <label class="check"><input type="checkbox" name="lady" ${c.lady ? 'checked' : ''}><span>Lady of the Lake<br><span class="muted small">After missions 2, 3 and 4 the holder privately learns one player’s loyalty. Recommended for 7+.</span></span></label>
      <label class="check"><input type="checkbox" name="trackVotes" ${c.trackVotes ? 'checked' : ''}><span>Team votes in the app<br><span class="muted small">Off = everyone votes out loud with thumbs and the leader taps the result.</span></span></label>
    </fieldset>
    <details><summary>Overrides: evil count & mission sizes</summary>
      <label class="check"><input type="checkbox" name="ovEnabled" ${o.enabled ? 'checked' : ''}><span>Use a custom table instead of the official one</span></label>
      <div class="row wrap"><label class="num">Evil<input type="number" name="ovEvil" min="1" max="19" value="${o.evil}"></label>
      ${o.sizes.map((s, i) => `<label class="num">M${i + 1}<input type="number" name="ovS${i}" min="1" max="20" value="${s}"></label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="ovDouble" ${o.doubleFail ? 'checked' : ''}><span>Mission 4 needs 2 fails</span></label>
      <button type="button" class="ghost" data-h="ovfill">Copy current defaults into the override</button>
    </details>
    <details><summary>Advanced: PeerJS server</summary>
      <p class="muted small">Blank uses PeerJS’s free public server for matchmaking (game data goes directly between devices). Only change this if you run your own <code>peerjs-server</code>.</p>
      <div class="row wrap"><label>Host<input name="pHost" value="${esc(pe.host)}" placeholder="0.peerjs.com"></label><label class="num">Port<input name="pPort" value="${esc(pe.port)}"></label><label>Path<input name="pPath" value="${esc(pe.path)}" placeholder="/"></label></div>
      <label class="check"><input type="checkbox" name="pSecure" ${pe.secure ? 'checked' : ''}><span>HTTPS / WSS</span></label>
    </details>
  </form>`;
  const f = $('cfg');
  f.addEventListener('input', readSettings);
  f.addEventListener('change', (e) => { readSettings(); if (/^p[A-Z]/.test(e.target.name)) startPeer(); });
}

function readSettings() {
  const f = $('cfg'); if (!f) return;
  const v = (n) => f.elements[n];
  for (const r of G.SPECIAL_ROLES) config.roles[r] = v('role_' + r).checked;
  config.hostPlays = v('hostPlays').checked;
  config.hostName = v('hostName').value;
  config.lady = v('lady').checked;
  config.trackVotes = v('trackVotes').checked;
  config.override = {
    enabled: v('ovEnabled').checked, evil: parseInt(v('ovEvil').value, 10) || 1,
    sizes: [0, 1, 2, 3, 4].map((i) => parseInt(v('ovS' + i).value, 10) || 1), doubleFail: v('ovDouble').checked,
  };
  config.peer = { host: v('pHost').value.trim(), port: v('pPort').value.trim(), path: v('pPath').value.trim(), secure: v('pSecure').checked };
  store.set(K.config, config);
  syncHostSeat();
  commit();
}

function render() {
  renderRoom();
  renderControls();
  if (S.phase !== lastRenderedPhase) { lastRenderedPhase = S.phase; abortArmed = false; renderSettings(); }
  document.body.classList.toggle('ingame', S.phase !== 'lobby');
}

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4000); }

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-h]'); if (!b || b.disabled) return;
  const h = b.dataset.h, x = b.dataset.x;
  if (h !== 'abort') abortArmed = false;
  switch (h) {
    case 'copy': try { await navigator.clipboard.writeText(joinUrl()); toast('Join link copied'); } catch { toast(joinUrl()); } break;
    case 'newcode': room = randomCode(); store.set(K.room, room); startPeer(); renderRoom(); break;
    case 'up': adminDo(() => G.movePlayer(S, x, -1)); break;
    case 'down': adminDo(() => G.movePlayer(S, x, 1)); break;
    case 'shuffle': adminDo(() => G.shuffleSeats(S)); break;
    case 'kick': adminDo(() => { const c = conns.get(x); G.removePlayer(S, x); if (c) { safeSend(c, { t: 'kicked' }); conns.delete(x); c.pid = null; setTimeout(() => c.close(), 300); } }); break;
    case 'start': syncHostSeat(); adminDo(() => G.startGame(S, config)); break;
    case 'mark': adminDo(() => G.act(S, S.players[S.game.leader].id, { type: 'markVote', approved: x === '1', admin: true })); break;
    case 'abort': if (!abortArmed) { abortArmed = true; renderControls(); } else adminDo(backToLobby); break;
    case 'lobby': adminDo(backToLobby); break;
    case 'ovfill': {
      const s = G.defaultSetup(Math.max(G.MIN_PLAYERS, S.players.length));
      config.override = { ...config.override, evil: s.evil, sizes: s.sizes, doubleFail: s.doubleFail >= 0 };
      store.set(K.config, config); lastRenderedPhase = null; render(); break;
    }
  }
});

window.addEventListener('beforeunload', (e) => { if (S.phase === 'game' && S.game.phase !== 'over') { e.preventDefault(); e.returnValue = ''; } });

// expose for debugging / tests
window.__avalon = { get state() { return S; }, get room() { return room; } };

keepAwake();
syncHostSeat();
commit();
startPeer();
