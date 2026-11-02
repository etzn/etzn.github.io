// Shared player view. Renders whatever view object the host sends and turns
// taps into actions via `send(action)`. Used by player pages and by the host's own seat.
import { ROLE_INFO } from './game.js';
import { store } from './net.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE_ORDER = ['merlin', 'percival', 'cleric', 'troublemaker', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'trickster', 'minion'];

export function createPlayerUI(root, send, { seenKey = 'avalon.seen', isHost = false } = {}) {
  const L = { view: null, sel: new Set(), selKey: '', card: null, kill: null, mission: null, excal: null, revealed: false, seen: store.get(seenKey, { gid: null, seq: 0 }), status: '', error: '', errTimer: 0, busy: '' };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    const a = b.dataset.a, x = b.dataset.x, g = L.view && L.view.game;
    // one-shot actions lock until the host answers, so double-taps don't double-send
    if (['propose', 'play', 'lady', 'killgo', 'mark', 'exgo', 'show'].includes(a)) { if (L.busy === L.selKey) return; L.busy = L.selKey; }
    switch (a) {
      case 'reveal': L.revealed = !L.revealed; break;
      case 'pick': {
        const idx = curMission(g); if (idx == null) break;
        const size = g.missions[idx].size;
        if (L.sel.has(x)) { L.sel.delete(x); if (L.excal === x) L.excal = null; } else if (L.sel.size < size) L.sel.add(x);
        break;
      }
      case 'mpick': {
        L.mission = +x;
        const size = g.missions[L.mission].size;
        while (L.sel.size > size) { const last = [...L.sel].pop(); L.sel.delete(last); if (L.excal === last) L.excal = null; }
        break;
      }
      case 'expick': L.excal = x; break;
      case 'propose': send({ type: 'propose', team: [...L.sel], mission: curMission(g), excalibur: L.excal }); break;
      case 'exsel': L.exTarget = x; break;
      case 'exgo': send({ type: 'excalibur', target: x === 'none' ? null : L.exTarget }); break;
      case 'show': send({ type: 'ladyShow', show: x }); break;
      case 'vote': send({ type: 'vote', approve: x === '1' }); break;
      case 'mark': send({ type: 'markVote', approved: x === '1' }); break;
      case 'card': L.card = x; break;
      case 'play': if (L.card) send({ type: 'card', fail: L.card === 'fail' }); break;
      case 'lady': send({ type: 'lady', target: x }); break;
      case 'kill': L.kill = x; break;
      case 'killgo': if (L.kill) send({ type: 'assassinate', target: L.kill }); break;
      case 'dismiss': L.seen = { gid: g.id, seq: g.lastEvent.seq }; store.set(seenKey, L.seen); break;
    }
    render();
  });

  function update(view) {
    L.view = view;
    const g = view.game;
    const key = g ? `${g.round}-${g.leaderId}-${g.rejections}-${g.phase}` : 'lobby';
    if (key !== L.selKey) { L.selKey = key; L.sel.clear(); L.card = null; L.kill = null; L.mission = null; L.excal = null; L.exTarget = null; }
    if (!g) { L.revealed = false; }
    if (g && L.seen.gid !== g.id) { L.seen = { gid: g.id, seq: 0 }; store.set(seenKey, L.seen); }
    render();
  }
  function setStatus(s) { L.status = s; render(); }
  function setError(msg) {
    L.error = msg; L.busy = ''; render();
    clearTimeout(L.errTimer); L.errTimer = setTimeout(() => { L.error = ''; render(); }, 4000);
  }

  let lastHTML = '';
  const paint = (h) => { if (h !== lastHTML) { lastHTML = h; root.innerHTML = h; } };
  function render() {
    const v = L.view;
    let h = '';
    if (L.status) h += `<div class="status">${esc(L.status)}</div>`;
    if (L.error) h += `<div class="status err">${esc(L.error)}</div>`;
    if (!v) return paint(h + `<section class="card center muted">Connecting to the host…</section>`);
    if (v.phase === 'lobby') h += lobby(v);
    else h += game(v);
    paint(h);
  }

  // mission being proposed/played: fixed by the host, or the leader's pick under Targeting
  const curMission = (g) => (g.missionIdx != null ? g.missionIdx : L.mission);
  const mName = (i) => `Mission ${i + 1}`;
  const name = (v, id) => esc((v.players.find((p) => p.id === id) || {}).name || '?');
  const names = (v, list) => list.map((id) => `<b>${name(v, id)}</b>`).join(', ') || '<i>nobody</i>';

  function lobby(v) {
    const meName = v.me ? name(v, v.me) : null;
    return `<section class="card">
      <h2>${v.spectator ? 'Watching' : 'You’re in'}${meName ? `, ${meName}` : ''}</h2>
      <p class="muted">${v.spectator ? (v.watch ? 'This screen shows the public board.' : 'A game is in progress — you’ll be able to join the next one.') : (isHost ? 'Check the settings below, then deal roles when everyone has joined.' : 'Waiting for the host to start the game.')}</p>
      <ol class="seats">${v.players.map((p) => `<li class="${p.connected ? '' : 'off'}"><span>${esc(p.name)}${p.id === v.me ? ' <span class="muted">(you)</span>' : ''}</span>${p.connected ? '' : '<span class="tag">offline</span>'}</li>`).join('')}</ol>
    </section>`;
  }

  function game(v) {
    const g = v.game;
    if (g.phase === 'over' && g.reveal) return board(v) + panel(v) + reveal(v) + overlay(v);
    return board(v) + (v.mine ? roleCard(v) : '') + panel(v) + seats(v) + history(v) + overlay(v);
  }

  function board(v) {
    const g = v.game;
    const pips = [0, 1, 2, 3, 4].map((i) => `<span class="pip ${i < g.rejections ? 'on' : ''} ${i === 4 ? 'last' : ''}"></span>`).join('');
    return `<section class="board">
      <div class="missions">${g.missions.map((m, i) => `
        <div class="mission ${m.result || ''} ${i === g.missionIdx && !['over', 'assassin'].includes(g.phase) ? 'current' : ''} ${g.phase === 'propose' && g.openMissions && g.openMissions.includes(i) ? 'avail' : ''} ${g.targeting && i === 4 && !m.result && g.openMissions && !g.openMissions.includes(4) ? 'locked' : ''}">
          <span class="size">${m.size}</span>
          ${m.result ? `<span class="res">${m.result === 'success' ? '✓' : `${m.fails}✗`}</span>` : m.need > 1 ? '<span class="need">2 fails</span>' : ''}
        </div>`).join('')}</div>
      <div class="track"><span class="muted">Rejected teams</span><span class="pips">${pips}</span></div>
      <div class="inplay muted">${ROLE_ORDER.filter((r) => g.rolesInPlay[r]).map((r) => `${g.rolesInPlay[r] > 1 ? g.rolesInPlay[r] + '× ' : ''}<span class="${ROLE_INFO[r].team}">${ROLE_INFO[r].name}</span>`).join(' · ')}</div>
    </section>`;
  }

  function roleCard(v) {
    const m = v.mine, info = ROLE_INFO[m.role], g = v.game;
    if (!L.revealed) return `<section class="role closed"><button class="ghost wide" data-a="reveal">Tap to see your role</button></section>`;
    const lady = (g.lady ? g.lady.log : []).filter((e) => e.team).map((e) => `<p>🌊 Lady of the Lake: <b>${name(v, e.target)}</b> showed <span class="${e.team}">${e.team.toUpperCase()}</span>${g.liars ? ' <span class="muted small">(could be a lie)</span>' : ''}.</p>`).join('')
      + g.excaliburLog.filter((e) => e.original).map((e) => `<p>⚔ Excalibur, ${mName(e.mission)}: <b>${name(v, e.target)}</b> had played <span class="${e.original === 'success' ? 'good' : 'evil'}">${e.original.toUpperCase()}</span> (you flipped it).</p>`).join('');
    return `<section class="role open ${m.team}" data-a="reveal">
      <div class="role-head"><h2>${esc(info.name)}</h2><span class="badge ${m.team}">${m.team}</span></div>
      <p>${esc(info.blurb)}</p>
      ${m.info.label ? `<p class="seen"><span class="muted">${esc(m.info.label)}:</span><br>${names(v, m.info.seen)}</p>` : ''}
      ${m.info.notes.map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}
      ${lady}
      <p class="muted small">Tap to hide</p>
    </section>`;
  }

  function panel(v) {
    const g = v.game, me = v.me, idx = curMission(g), M = idx != null ? g.missions[idx] : null;
    const exNote = g.excalibur ? ` <span class="muted">⚔ Excalibur: <b>${name(v, g.excalibur)}</b></span>` : '';
    const isLeader = me && me === g.leaderId;
    let h = '';
    switch (g.phase) {
      case 'propose': {
        const warn = g.rejections === 4 ? '<p class="warn">Fifth proposal: if this team is rejected, evil wins.</p>' : '';
        if (isLeader) {
          h = `<h2>👑 You’re the leader</h2>${warn}`;
          if (g.targeting) {
            h += `<p>Choose which mission to attempt${g.openMissions.includes(4) ? '' : ' (Mission 5 unlocks after two successes)'}:</p>
              <div class="picks missions-pick">${g.openMissions.map((i) => `<button class="pick ${L.mission === i ? 'on' : ''}" data-a="mpick" data-x="${i}">${mName(i)} · ${g.missions[i].size} players${g.missions[i].need > 1 ? ' · 2 fails' : ''}</button>`).join('')}</div>`;
          }
          if (M) {
            const exEligible = [...L.sel].filter((id) => id !== me);
            const needEx = g.excaliburOn && exEligible.length > 0;
            const ready = L.sel.size === M.size && (!needEx || (L.excal && L.sel.has(L.excal)));
            h += `<p>Pick <b>${M.size}</b> players for ${mName(idx)}${M.need > 1 ? ' (needs 2 fails to fail)' : ''}.</p>
              <div class="picks">${v.players.map((p) => `<button class="pick ${L.sel.has(p.id) ? 'on' : ''}" data-a="pick" data-x="${esc(p.id)}">${esc(p.name)}${p.id === me ? ' (you)' : ''}</button>`).join('')}</div>`;
            if (g.excaliburOn) {
              h += `<p class="small">⚔ Give Excalibur to a team member (not yourself). After the cards are played, they may secretly flip one other teammate’s card.</p>
                <div class="picks">${exEligible.length ? exEligible.map((id) => `<button class="pick ex ${L.excal === id ? 'on' : ''}" data-a="expick" data-x="${esc(id)}">⚔ ${name(v, id)}</button>`).join('') : '<span class="muted small">Pick your team first.</span>'}</div>`;
            }
            h += `<button class="primary wide" data-a="propose" ${ready ? '' : 'disabled'}>Propose team (${L.sel.size}/${M.size})</button>`;
          }
        } else {
          h = g.targeting
            ? `<h2>Choosing a mission</h2><p><b>${name(v, g.leaderId)}</b> is choosing which mission to attempt and who goes.</p>${warn}`
            : `<h2>${mName(idx)}</h2><p><b>${name(v, g.leaderId)}</b> is choosing ${M.size} players.</p>${warn}`;
        }
        break;
      }
      case 'vote': {
        h = `<h2>Vote: ${mName(idx)}</h2><p>${name(v, g.leaderId)} proposes: ${names(v, g.team)}${exNote}</p>`;
        if (g.rejections === 4) h += '<p class="warn">Fifth proposal: if rejected, evil wins.</p>';
        if (g.trackVotes) {
          if (me) {
            const mv = v.mine.myVote;
            h += `<div class="row"><button class="big approve ${mv === true ? 'on' : ''}" data-a="vote" data-x="1">Approve</button><button class="big reject ${mv === false ? 'on' : ''}" data-a="vote" data-x="0">Reject</button></div>
              <p class="muted small">${mv === null ? 'Votes stay secret until everyone has voted.' : 'You can change your vote until the last one is in.'}</p>`;
          }
          h += `<p class="muted">${g.voted.length}/${v.players.length} voted</p>`;
        } else if (isLeader) {
          h += `<p>Vote out loud, then record the result:</p><div class="row"><button class="big approve" data-a="mark" data-x="1">Approved</button><button class="big reject" data-a="mark" data-x="0">Rejected</button></div>`;
        } else {
          h += `<p class="muted">Vote out loud. ${name(v, g.leaderId)} will record the result.</p>`;
        }
        break;
      }
      case 'mission': {
        const onTeam = me && g.team.includes(me);
        h = `<h2>${mName(idx)}</h2><p>Team: ${names(v, g.team)}${exNote}</p>`;
        if (onTeam && !v.mine.cardPlayed) {
          const good = v.mine.team === 'good';
          h += `<div class="row"><button class="big approve ${L.card === 'success' ? 'on' : ''}" data-a="card" data-x="success">Success</button>
            <button class="big reject ${L.card === 'fail' ? 'on' : ''}" data-a="card" data-x="fail" ${good ? 'disabled' : ''}>Fail</button></div>
            ${good ? '<p class="muted small">Good players can only play Success.</p>' : ''}
            <button class="primary wide" data-a="play" ${L.card ? '' : 'disabled'}>Play card</button>`;
        } else if (onTeam) {
          h += '<p class="muted">Card played. Waiting for the rest of the team…</p>';
        }
        h += `<p class="muted">${g.cardsIn.length}/${g.team.length} cards played</p>`;
        break;
      }
      case 'excalibur': {
        if (me === g.excalibur) {
          const others = g.team.filter((id) => id !== me);
          h = `<h2>⚔ Excalibur</h2><p>All cards are in. You may secretly flip one teammate’s card (Success ↔ Fail). You’ll see what they originally played. Everyone will see whose card you chose.</p>
            <div class="picks">${others.map((id) => `<button class="pick ${L.exTarget === id ? 'on' : ''}" data-a="exsel" data-x="${esc(id)}">${name(v, id)}</button>`).join('')}</div>
            <div class="row"><button class="ghost big" data-a="exgo" data-x="none">Don’t use it</button><button class="primary big" data-a="exgo" data-x="use" ${L.exTarget ? '' : 'disabled'}>Flip ${L.exTarget ? name(v, L.exTarget) + '’s card' : ''}</button></div>`;
        } else {
          h = `<h2>⚔ Excalibur</h2><p>All cards are in. <b>${name(v, g.excalibur)}</b> may secretly flip one other teammate’s card before they’re revealed.</p>`;
        }
        break;
      }
      case 'ladyReveal': {
        const pend = g.lady.pending;
        if (me === pend.target) {
          const opts = v.mine.ladyOptions;
          h = `<h2>🌊 You’re being examined</h2><p><b>${name(v, pend.by)}</b> is using the Lady of the Lake on you. Show your loyalty:</p>
            <div class="row">${['good', 'evil'].map((t) => `<button class="big ${t === 'good' ? 'approve' : 'reject'}" data-a="show" data-x="${t}" ${opts.includes(t) ? '' : 'disabled'}>${t === 'good' ? 'Good' : 'Evil'}</button>`).join('')}</div>
            <p class="muted small">${opts.length > 1 ? 'As the Trickster, you may show either.' : v.mine.role === 'troublemaker' ? 'As the Troublemaker, you must show Evil.' : 'You must show your true loyalty.'}</p>`;
        } else {
          h = `<h2>🌊 Lady of the Lake</h2><p><b>${name(v, pend.target)}</b> is showing their loyalty to <b>${name(v, pend.by)}</b>.</p>`;
        }
        break;
      }
      case 'lady': {
        const holder = g.lady.holder;
        if (me === holder) {
          const ok = v.players.filter((p) => p.id !== me && !g.lady.used.includes(p.id));
          h = `<h2>🌊 Lady of the Lake</h2><p>Choose a player to learn their loyalty. You may then say whatever you like about it.</p>
            <div class="picks">${ok.map((p) => `<button class="pick" data-a="lady" data-x="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>`;
        } else {
          h = `<h2>🌊 Lady of the Lake</h2><p><b>${name(v, holder)}</b> is choosing someone to examine.</p>`;
        }
        break;
      }
      case 'assassin': {
        const aid = g.assassinId;
        if (me === aid) {
          h = `<h2>🗡 Name Merlin</h2><p>Good has won three missions. Confer with your team, then choose. One shot.</p>
            <div class="picks">${v.players.filter((p) => p.id !== me).map((p) => `<button class="pick ${L.kill === p.id ? 'on' : ''}" data-a="kill" data-x="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
            <button class="danger wide" data-a="killgo" ${L.kill ? '' : 'disabled'}>Assassinate ${L.kill ? name(v, L.kill) : ''}</button>`;
        } else {
          h = `<h2>🗡 The Assassin strikes</h2><p>Good has won three missions. <b>${name(v, aid)}</b> is the Assassin and gets one guess at Merlin. Evil may confer openly.</p>`;
        }
        break;
      }
      case 'over': {
        h = `<h2 class="${g.winner}">${g.winner === 'good' ? 'Good wins' : 'Evil wins'}</h2><p>${esc(g.reason)}</p>
          ${g.assassinTarget ? `<p class="muted">The Assassin (${name(v, g.assassinId)}) chose ${name(v, g.assassinTarget)}.</p>` : ''}
          <ul class="reveal">${v.players.map((p) => { const r = g.roles[p.id]; return `<li><span>${esc(p.name)}</span><span class="${ROLE_INFO[r].team}">${esc(ROLE_INFO[r].name)}</span></li>`; }).join('')}</ul>
          <p class="muted small">The host can start a new game from the lobby.</p>`;
        break;
      }
    }
    return `<section class="card panel">${h}</section>`;
  }

  function seats(v) {
    const g = v.game;
    return `<section class="card"><h3>Table</h3><ol class="seats">${v.players.map((p) => {
      const tags = [];
      if (p.id === g.leaderId && g.phase !== 'over') tags.push('<span title="Leader">👑</span>');
      if (g.lady && g.lady.holder === p.id && g.phase !== 'over') tags.push('<span title="Lady of the Lake">🌊</span>');
      if (g.team.includes(p.id)) tags.push('<span class="tag team">on team</span>');
      if (g.excalibur === p.id) tags.push('<span title="Excalibur">⚔</span>');
      if (g.phase === 'vote' && g.voted.includes(p.id)) tags.push('<span class="tag">voted</span>');
      if (g.phase === 'mission' && g.cardsIn.includes(p.id)) tags.push('<span class="tag">played</span>');
      if (!p.connected) tags.push('<span class="tag off">offline</span>');
      return `<li class="${p.connected ? '' : 'off'}"><span>${esc(p.name)}${p.id === v.me ? ' <span class="muted">(you)</span>' : ''}</span><span class="tags">${tags.join('')}</span></li>`;
    }).join('')}</ol></section>`;
  }

  function history(v) {
    const g = v.game;
    if (!g.history.length && !(g.lady && g.lady.log.length) && !g.excaliburLog.length) return '';
    const rows = g.history.slice().reverse().map((h) => {
      const votes = h.votes ? `<div class="votes">${v.players.map((p) => `<span class="${h.votes[p.id] ? 'yes' : 'no'}">${esc(p.name)}</span>`).join('')}</div>` : '';
      return `<li><div><b>M${h.mission + 1}.${h.attempt}</b> ${name(v, h.leader)} → ${names(v, h.team)}${h.excalibur ? ` (⚔ ${name(v, h.excalibur)})` : ''} <span class="${h.approved ? 'good' : 'evil'}">${h.approved ? 'approved' : 'rejected'}</span></div>${votes}</li>`;
    }).join('');
    const lady = (g.lady ? g.lady.log.map((e) => `<li>🌊 ${name(v, e.by)} examined ${name(v, e.target)}</li>`).join('') : '')
      + g.excaliburLog.map((e) => `<li>⚔ ${name(v, e.by)} flipped ${name(v, e.target)}’s card on ${mName(e.mission)}</li>`).join('');
    return `<details class="card"><summary>History</summary><ul class="hist">${lady}${rows}</ul></details>`;
  }

  // ---------- post-game reveal ----------
  function reveal(v) {
    const g = v.game, R = g.reveal, roles = g.roles;
    const tm = (id) => (roles[id] ? ROLE_INFO[roles[id]].team : '');
    const who = (id) => `<b class="${tm(id)}">${name(v, id)}</b>`;
    const whos = (list) => list.map(who).join(', ') || '<i>nobody</i>';
    const fill = (text) => esc(text).replace(/@([\w-]+)/g, (_, id) => who(id));
    const awards = R.awards.map((a) => `<li><span class="aw-icon">${a.icon}</span><div><div class="aw-title">${esc(a.title)}${a.who.length ? ` · ${whos(a.who)}` : ''}</div><div class="muted small">${fill(a.detail)}</div></div></li>`).join('');
    const good = Object.keys(R.accuracy).filter((id) => tm(id) === 'good' && R.accuracy[id].total).sort((a, b) => R.accuracy[b].right / R.accuracy[b].total - R.accuracy[a].right / R.accuracy[a].total);
    const accLine = good.length ? `<p class="small acc"><span class="muted">How well good read the votes:</span> ${good.map((id) => `${who(id)} ${Math.round(100 * R.accuracy[id].right / R.accuracy[id].total)}%`).join(' · ')}</p>` : '';
    const chip = (h, p) => `<span class="${h.votes[p.id] ? 'yes' : 'no'} t-${tm(p.id)}">${esc(p.name)} ${h.votes[p.id] ? '✓' : '✗'}</span>`;
    const story = R.timeline.map((t) => {
      if (t.kind === 'proposal') {
        return `<li class="st-prop"><div><span class="st-tag">M${t.mission + 1}·${t.attempt}</span> ${who(t.leader)} proposed ${whos(t.team)}${t.excalibur ? ` <span class="muted">(⚔ ${name(v, t.excalibur)})</span>` : ''}</div>
          <div class="small"><span class="${t.evil.length ? 'evil' : 'good'}">${t.evil.length ? `${t.evil.length} evil on the team` : 'Clean team'}</span> · <span class="muted">${t.approved ? 'approved' : 'rejected'}${t.votes ? ` ${t.yes}–${t.no}` : ''}${t.close ? ' · close call' : ''}</span></div>
          ${t.votes ? `<div class="votes">${v.players.map((p) => chip(t, p)).join('')}</div>` : ''}</li>`;
      }
      if (t.kind === 'mission') {
        const flip = t.excalibur ? (t.flip
          ? `<div class="small">⚔ ${who(t.flip.by)} flipped ${who(t.flip.target)}’s ${t.flip.from.toUpperCase()} to ${t.flip.to.toUpperCase()}${t.flip.changed ? ' <b class="warn">and changed the result</b>' : ''}.</div>`
          : `<div class="small muted">⚔ ${name(v, t.excalibur.by)} kept Excalibur sheathed.</div>`) : '';
        return `<li class="st-mis ${t.result}"><div><b class="${t.result === 'success' ? 'good' : 'evil'}">Mission ${t.mission + 1} ${t.result === 'success' ? 'succeeded' : 'failed'}</b> <span class="muted small">(${t.fails} fail${t.fails === 1 ? '' : 's'}${t.need > 1 ? ', 2 needed' : ''})</span></div>
          <div class="small">Played Fail: ${t.failers.length ? whos(t.failers) : '<span class="muted">nobody</span>'}</div>${flip}</li>`;
      }
      if (t.kind === 'lady') return `<li class="st-lady">🌊 ${who(t.by)} examined ${who(t.target)}: shown <span class="${t.shown}">${t.shown.toUpperCase()}</span>${t.lied ? `, actually <span class="${t.truth}">${t.truth.toUpperCase()}</span> <b class="warn">(a lie)</b>` : ' (true)'}</li>`;
      if (t.kind === 'assassin') return `<li class="st-ass">🗡 ${who(t.by)} named ${who(t.target)}, who was ${esc(ROLE_INFO[t.targetRole].name)}. <b class="${t.hit ? 'evil' : 'good'}">${t.hit ? 'A hit.' : 'A miss.'}</b></li>`;
      return '';
    }).join('');
    return `<section class="card reveal-card">
      ${awards ? `<h3>Awards</h3><ul class="awards">${awards}</ul>` : ''}${accLine}
      <h3>The whole story</h3>
      <p class="muted small">Names are colored by their true side.${g.trackVotes ? ' Vote chips: ✓ approve, ✗ reject.' : ''}</p>
      <ol class="story">${story}</ol>
    </section>`;
  }

  function overlay(v) {
    const g = v.game, e = g.lastEvent;
    if (!e || e.seq <= L.seen.seq) return '';
    let body = '';
    if (e.kind === 'vote') {
      body = `<h2 class="${e.approved ? 'good' : 'evil'}">Team ${e.approved ? 'approved' : 'rejected'}</h2>
        <p>${name(v, e.leader)}’s team for ${mName(e.mission)}: ${names(v, e.team)}${e.excalibur ? ` (⚔ ${name(v, e.excalibur)})` : ''}</p>
        ${e.votes ? `<div class="votes big">${v.players.map((p) => `<span class="${e.votes[p.id] ? 'yes' : 'no'}">${esc(p.name)} ${e.votes[p.id] ? '✓' : '✗'}</span>`).join('')}</div>` : ''}`;
    } else if (e.kind === 'mission') {
      const cards = Array.from({ length: e.size }, (_, i) => `<span class="mcard ${i < e.fails ? 'f' : 's'}" style="animation-delay:${i * 0.35}s">${i < e.fails ? 'FAIL' : 'OK'}</span>`);
      const ex = e.excalibur;
      const exMine = ex && ex.target && g.excaliburLog.find((x) => x.mission === e.mission && x.original);
      body = `<h2 class="${e.result === 'success' ? 'good' : 'evil'}">${mName(e.mission)} ${e.result === 'success' ? 'succeeded' : 'failed'}</h2>
        <div class="mcards">${cards.join('')}</div>
        <p>${e.fails} fail card${e.fails === 1 ? '' : 's'}${e.need > 1 ? ' (2 needed to fail)' : ''}</p>
        ${ex ? `<p class="muted">⚔ ${ex.target ? `${name(v, ex.by)} used Excalibur on ${name(v, ex.target)}’s card.` : `${name(v, ex.by)} kept Excalibur sheathed.`}</p>` : ''}
        ${exMine ? `<p class="lady-res small">${name(v, ex.target)} had played <span class="${exMine.original === 'success' ? 'good' : 'evil'}">${exMine.original.toUpperCase()}</span></p><p class="muted small">Only you can see this.</p>` : ''}`;
    } else if (e.kind === 'lady') {
      const mine = g.lady && g.lady.log.find((x) => x.by === v.me && x.target === e.target && x.team);
      body = `<h2>🌊 Lady of the Lake</h2><p>${name(v, e.by)} examined ${name(v, e.target)}.</p>
        ${mine ? `<p class="lady-res">${name(v, e.target)} showed <span class="${mine.team}">${mine.team.toUpperCase()}</span></p><p class="muted small">Only you can see this.${g.liars ? ' A Trickster or Troublemaker is in this game, so it could be a lie.' : ''}</p>` : ''}`;
    }
    return `<div class="overlay"><div class="modal">${body}<button class="primary wide" data-a="dismiss">OK</button></div></div>`;
  }

  render();
  return { update, setStatus, setError };
}
