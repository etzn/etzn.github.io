import { createPlayerUI, esc } from './ui.js';
import { PREFIX, STALE_MS, peerOptions, peerFromQuery, normCode, randomToken, store, keepAwake } from './net.js';

const app = document.getElementById('app');
const q = new URLSearchParams(location.search);
const watch = q.get('watch') === '1';
const peerCfg = peerFromQuery(q);
const KEY = 'avalon.player';
let saved = store.get(KEY, {});
if (!saved.token) { saved.token = randomToken(); store.set(KEY, saved); }
const urlRoom = normCode(q.get('room'));
const auto = urlRoom ? (saved.room === urlRoom && saved.name) : (saved.room && saved.name);

if (auto || (watch && urlRoom)) start(urlRoom || saved.room, saved.name || 'Screen');
else joinForm();

function joinForm() {
  app.innerHTML = `<form class="card join" id="join">
    <h2>Join the table</h2>
    <label>Your name<input name="name" maxlength="20" autocomplete="nickname" required value="${esc(saved.name || '')}"></label>
    <label>Room code<input name="room" maxlength="8" autocapitalize="characters" autocomplete="off" required value="${esc(urlRoom || saved.room || '')}"></label>
    <button class="primary wide">Join</button>
    <p class="muted small">The host opens <code>/admin</code> on their device to get a code.</p>
  </form>`;
  const f = document.getElementById('join');
  if (urlRoom) f.name.focus();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.name.value.trim().slice(0, 20), room = normCode(f.room.value);
    if (!name || !room) return;
    saved = { ...saved, name, room }; store.set(KEY, saved);
    start(room, name);
  });
}

function start(room, name) {
  document.getElementById('who').innerHTML = `${esc(watch ? 'Public screen' : name)} · room <b>${esc(room)}</b> · <a href="#" id="leave">change</a>`;
  document.getElementById('leave').onclick = (e) => { e.preventDefault(); store.set(KEY, { token: saved.token, name: saved.name }); location.href = location.pathname + (peerCfg ? location.search.replace(/([?&])room=[^&]*&?/, '$1') : ''); };
  keepAwake();

  let conn = null, peer = null, retryT = 0, lastMsg = Date.now();
  const ui = createPlayerUI(app, (action) => {
    if (conn && conn.open) conn.send({ t: 'act', action });
    else ui.setError('Not connected — reconnecting…');
  }, { seenKey: 'avalon.seen.' + room });

  function retry(ms = 2000) { clearTimeout(retryT); retryT = setTimeout(connect, ms); }

  function connect() {
    clearTimeout(retryT);
    if (!peer || peer.destroyed) return makePeer();
    if (peer.disconnected) { try { peer.reconnect(); } catch {} return retry(2500); }
    if (conn) { const old = conn; conn = null; try { old.close(); } catch {} }
    const c = peer.connect(PREFIX + room, { reliable: true });
    conn = c;
    const timeout = setTimeout(() => { if (conn === c && !c.open) { try { c.close(); } catch {} conn = null; retry(500); } }, 9000);
    c.on('open', () => {
      clearTimeout(timeout);
      lastMsg = Date.now();
      ui.setStatus('');
      c.send({ t: 'hello', token: saved.token, name, watch });
    });
    c.on('data', (m) => {
      if (conn !== c) return;
      lastMsg = Date.now();
      if (m.t === 'state') ui.update(m.view);
      else if (m.t === 'ping') c.send({ t: 'pong' });
      else if (m.t === 'error') ui.setError(m.msg);
      else if (m.t === 'kicked') { ui.setStatus('The host removed you from the lobby. Reload to rejoin.'); clearTimeout(retryT); conn = null; c.close(); peer.destroy(); }
    });
    const lost = () => { if (conn === c) { conn = null; ui.setStatus('Lost the host — reconnecting…'); retry(); } };
    c.on('close', lost);
    c.on('error', lost);
  }

  function makePeer() {
    ui.setStatus('Connecting…');
    peer = new Peer(peerOptions(peerCfg));
    peer.on('open', connect);
    peer.on('disconnected', () => { if (!peer.destroyed) retry(2000); });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') { ui.setStatus(`No host found for room ${room}. Is the host page open? Retrying…`); conn = null; retry(3000); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) { ui.setStatus('Network trouble — retrying…'); retry(3000); }
      else if (err.type === 'browser-incompatible') ui.setStatus('This browser doesn’t support WebRTC.');
      else { console.warn(err); retry(3000); }
    });
  }

  // Phones kill connections in the background; heal fast when we come back.
  setInterval(() => {
    if (conn && conn.open && Date.now() - lastMsg > STALE_MS) { ui.setStatus('Connection went quiet — reconnecting…'); try { conn.close(); } catch {} conn = null; connect(); }
  }, 3000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !(conn && conn.open)) connect();
  });

  makePeer();
}
