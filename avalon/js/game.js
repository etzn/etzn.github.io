// Pure Avalon rules engine. No DOM, no network — the host owns one state
// object and mutates it through these functions; views are derived per player.

export const ROLE_INFO = {
  merlin:   { name: 'Merlin', team: 'good', blurb: 'You know who is evil — except Mordred. Guide your side without being obvious: if good wins and the Assassin names you, evil wins anyway.' },
  percival: { name: 'Percival', team: 'good', blurb: 'You can see Merlin. If Morgana is in play she looks identical, so work out which one is real and protect them.' },
  cleric:   { name: 'Cleric', team: 'good', blurb: 'You know whether the first leader is good or evil.' },
  troublemaker: { name: 'Troublemaker', team: 'good', blurb: 'You are good, but if the Lady of the Lake examines you, you must show Evil.' },
  servant:  { name: 'Loyal Servant of Arthur', team: 'good', blurb: 'You know nothing except that you are good. Read the room.' },
  assassin: { name: 'Assassin', team: 'evil', blurb: 'If good completes three missions, you get one guess at who Merlin is. Get it right and evil wins.' },
  morgana:  { name: 'Morgana', team: 'evil', blurb: 'To Percival you look exactly like Merlin. Sell it.' },
  mordred:  { name: 'Mordred', team: 'evil', blurb: 'Merlin cannot see you. You are the one evil player Merlin can’t warn anyone about.' },
  oberon:   { name: 'Oberon', team: 'evil', blurb: 'You are evil, but you don’t know the other minions and they don’t know you. Merlin can still see you.' },
  trickster: { name: 'Trickster', team: 'evil', blurb: 'If the Lady of the Lake examines you, you may show either loyalty.' },
  minion:   { name: 'Minion of Mordred', team: 'evil', blurb: 'You know your fellow minions. Sabotage missions without getting caught.' },
};

export const GOOD_SPECIALS = ['merlin', 'percival', 'cleric', 'troublemaker'];
export const EVIL_SPECIALS = ['assassin', 'morgana', 'mordred', 'oberon', 'trickster'];
export const SPECIAL_ROLES = [...GOOD_SPECIALS, ...EVIL_SPECIALS];
export const teamOf = (r) => ROLE_INFO[r].team;

const OFFICIAL = {
  5:  { evil: 2, sizes: [2, 3, 2, 3, 3] },
  6:  { evil: 2, sizes: [2, 3, 4, 3, 4] },
  7:  { evil: 3, sizes: [2, 3, 3, 4, 4] },
  8:  { evil: 3, sizes: [3, 4, 4, 5, 5] },
  9:  { evil: 3, sizes: [3, 4, 4, 5, 5] },
  10: { evil: 4, sizes: [3, 4, 4, 5, 5] },
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 20;

export function defaultConfig() {
  return {
    roles: { merlin: true, percival: true, assassin: true, morgana: true, mordred: false, oberon: false, cleric: false, troublemaker: false, trickster: false },
    lady: false,
    excalibur: false,
    targeting: false,
    trackVotes: true,
    hostPlays: true,
    hostName: 'Host',
    override: { enabled: false, evil: 2, sizes: [2, 3, 2, 3, 3], doubleFail: false },
    peer: { host: '', port: '', path: '', secure: true },
  };
}

// Official table for 5–10; improvised (and clearly labelled) outside that.
export function defaultSetup(n) {
  if (OFFICIAL[n]) {
    return { evil: OFFICIAL[n].evil, sizes: [...OFFICIAL[n].sizes], doubleFail: n >= 7 ? 3 : -1, official: true };
  }
  if (n < 5) {
    const cap = Math.max(1, n - 1);
    return { evil: Math.max(1, Math.floor(n / 3)), sizes: [2, 3, 2, 3, 3].map((s) => Math.min(s, cap)), doubleFail: -1, official: false };
  }
  const bump = Math.floor((n - 10) / 2);
  return { evil: Math.round(n * 0.38), sizes: [3, 4, 4, 5, 5].map((s) => s + bump), doubleFail: 3, official: false };
}

export function getSetup(n, config) {
  const o = config.override;
  if (o && o.enabled) {
    return { evil: +o.evil, sizes: o.sizes.map(Number), doubleFail: o.doubleFail ? 3 : -1, official: false, custom: true };
  }
  return defaultSetup(n);
}

export function validate(n, config) {
  const out = [];
  const err = (msg) => out.push({ level: 'error', msg });
  const warn = (msg) => out.push({ level: 'warn', msg });
  if (n < MIN_PLAYERS) { err(`Need at least ${MIN_PLAYERS} players.`); return out; }
  if (n > MAX_PLAYERS) { err(`Max ${MAX_PLAYERS} players.`); return out; }
  const s = getSetup(n, config);
  if ((n < 5 || n > 10) && !s.custom) warn(`${n} players is outside the official 5–10 range, so an improvised table is in use (${s.evil} evil, missions ${s.sizes.join('/')}). You can edit it under Overrides.`);
  if (s.custom) {
    if (!(s.evil >= 1 && s.evil < n)) err('Override: evil count must be between 1 and players − 1.');
    if (s.sizes.length !== 5 || s.sizes.some((x) => !(Number.isInteger(x) && x >= 1 && x <= n))) err(`Override: every mission size must be a whole number from 1 to ${n}.`);
  }
  const good = n - s.evil;
  const gs = GOOD_SPECIALS.filter((r) => config.roles[r]).length;
  const es = EVIL_SPECIALS.filter((r) => config.roles[r]).length;
  if (gs > good) err(`${gs} good special roles but only ${good} good seats.`);
  if (es > s.evil) err(`${es} evil special roles but only ${s.evil} evil seats.`);
  const R = config.roles;
  if (R.merlin && !R.assassin) warn('Merlin without the Assassin: good wins outright after three successes, so Merlin is close to a free win.');
  if (R.assassin && !R.merlin) warn('The Assassin does nothing without Merlin (plays as a plain minion).');
  if (R.percival && !R.merlin) warn('Percival without Merlin has nobody to see.');
  if (R.morgana && !R.percival) warn('Morgana’s disguise only matters to Percival; without him she’s a plain minion.');
  if (R.mordred && !R.merlin) warn('Mordred’s power is hiding from Merlin; without Merlin he’s a plain minion.');
  if ((R.trickster || R.troublemaker) && !config.lady) warn('The Trickster and Troublemaker only matter when the Lady of the Lake is on.');
  return out;
}

export function newState() {
  return { phase: 'lobby', players: [], game: null };
}

export function addPlayer(S, id, name) {
  if (S.players.some((p) => p.id === id)) return;
  S.players.push({ id, name });
}
export function removePlayer(S, id) {
  if (S.phase !== 'lobby') throw new Error('Players can only be removed in the lobby.');
  S.players = S.players.filter((p) => p.id !== id);
}
export function movePlayer(S, id, dir) {
  if (S.phase !== 'lobby') throw new Error('Seats can only be changed in the lobby.');
  const i = S.players.findIndex((p) => p.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= S.players.length) return;
  [S.players[i], S.players[j]] = [S.players[j], S.players[i]];
}
export function shuffleSeats(S, rng = Math.random) {
  if (S.phase !== 'lobby') throw new Error('Seats can only be changed in the lobby.');
  shuffle(S.players, rng);
}
export function toLobby(S) { S.phase = 'lobby'; S.game = null; }

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function startGame(S, config, rng = Math.random) {
  if (S.phase !== 'lobby') throw new Error('A game is already running.');
  const ids = S.players.map((p) => p.id), n = ids.length;
  const errors = validate(n, config).filter((x) => x.level === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.msg).join(' '));
  const cfg = JSON.parse(JSON.stringify(config));
  const s = getSetup(n, cfg);
  const goodSp = GOOD_SPECIALS.filter((r) => cfg.roles[r]);
  const evilSp = EVIL_SPECIALS.filter((r) => cfg.roles[r]);
  const deck = [
    ...goodSp, ...Array(n - s.evil - goodSp.length).fill('servant'),
    ...evilSp, ...Array(s.evil - evilSp.length).fill('minion'),
  ];
  shuffle(deck, rng);
  const roles = Object.fromEntries(ids.map((id, i) => [id, deck[i]]));
  const rolesInPlay = {};
  for (const r of deck) rolesInPlay[r] = (rolesInPlay[r] || 0) + 1;
  const leader = Math.floor(rng() * n);
  const ladyHolder = ids[(leader - 1 + n) % n]; // player to the leader's right
  S.game = {
    id: Math.floor(rng() * 1e9).toString(36) + Date.now().toString(36),
    config: cfg, setup: s, roles, rolesInPlay,
    leader, firstLeader: ids[leader],
    round: 0,          // missions completed so far
    target: null,      // index of the mission being attempted (set when a team is proposed)
    rejections: 0, phase: 'propose',
    missions: s.sizes.map((size, i) => ({ size, need: i === s.doubleFail ? 2 : 1, result: null, fails: null })),
    team: [], excalibur: null, votes: {}, cards: { submitted: [], by: {} },
    lady: cfg.lady ? { holder: ladyHolder, used: [ladyHolder], log: [], pending: null } : null,
    excaliburLog: [],
    history: [], lastEvent: null, eventSeq: 0,
    winner: null, reason: null, assassinTarget: null,
  };
  S.phase = 'game';
}

const ids = (S) => S.players.map((p) => p.id);
const leaderId = (S) => ids(S)[S.game.leader];
const roleHolder = (G, role) => Object.keys(G.roles).find((k) => G.roles[k] === role) || null;
const inPlay = (G, role) => !!G.rolesInPlay[role];
const wins = (G) => G.missions.filter((x) => x.result === 'success').length;
export const nextMission = (G) => G.missions.findIndex((m) => !m.result);

// Missions the leader may pick under Targeting (all unplayed; #5 locked until two successes).
export function openMissions(G) {
  return G.missions.map((m, i) => i).filter((i) => !G.missions[i].result && (i !== 4 || wins(G) >= 2));
}

function event(G, e) { G.eventSeq += 1; G.lastEvent = { ...e, seq: G.eventSeq }; }
function end(G, winner, reason) { G.phase = 'over'; G.winner = winner; G.reason = reason; }
function nextLeader(S) { S.game.leader = (S.game.leader + 1) % S.players.length; }

function resolveVote(S, approvedOverride) {
  const G = S.game, n = S.players.length;
  const yes = Object.values(G.votes).filter(Boolean).length;
  const approved = approvedOverride ?? yes * 2 > n; // strict majority; ties fail
  const votes = G.config.trackVotes ? { ...G.votes } : null;
  const rec = { mission: G.target, leader: leaderId(S), team: [...G.team], excalibur: G.excalibur, votes, approved, attempt: G.rejections + 1 };
  G.history.push(rec);
  event(G, { kind: 'vote', ...rec });
  G.votes = {};
  if (approved) {
    G.phase = 'mission';
    G.cards = { submitted: [], by: {} };
  } else {
    G.rejections += 1;
    G.team = []; G.excalibur = null; G.target = null;
    if (G.rejections >= 5) return end(G, 'evil', 'Five team proposals in a row were rejected.');
    nextLeader(S);
    G.phase = 'propose';
  }
}

function resolveMission(S, excaliburUse) {
  const G = S.game, m = G.missions[G.target];
  m.fails = Object.values(G.cards.by).filter(Boolean).length;
  m.result = m.fails >= m.need ? 'fail' : 'success';
  event(G, { kind: 'mission', mission: G.target, fails: m.fails, result: m.result, need: m.need, size: G.team.length, excalibur: excaliburUse || null });
  // forget who played what: only the count survives
  G.round += 1; G.rejections = 0; G.team = []; G.excalibur = null; G.target = null; G.cards = { submitted: [], by: {} };
  nextLeader(S);
  const losses = G.missions.filter((x) => x.result === 'fail').length;
  if (losses >= 3) return end(G, 'evil', 'Three missions failed.');
  if (wins(G) >= 3) {
    if (inPlay(G, 'merlin') && inPlay(G, 'assassin')) { G.phase = 'assassin'; return; }
    return end(G, 'good', 'Three missions succeeded.');
  }
  G.phase = G.lady && G.round >= 2 && G.round <= 4 ? 'lady' : 'propose';
}

function finishLady(S, shown) {
  const G = S.game, { by, target } = G.lady.pending;
  G.lady.log.push({ by, target, team: shown, round: G.round });
  G.lady.used.push(target);
  G.lady.holder = target;
  G.lady.pending = null;
  event(G, { kind: 'lady', by, target });
  G.phase = 'propose';
}

// What loyalty a player is allowed to show the Lady of the Lake.
export function ladyOptions(role) {
  if (role === 'trickster') return ['good', 'evil'];
  if (role === 'troublemaker') return ['evil'];
  return [teamOf(role)];
}

// Every player-originated action goes through here. `actor` is the player id the
// host has bound to the connection, so clients can't act as someone else.
export function act(S, actor, a) {
  const G = S.game;
  if (!G || S.phase !== 'game') throw new Error('No game in progress.');
  const n = S.players.length;
  const isPlayer = (id) => ids(S).includes(id);
  if (!isPlayer(actor)) throw new Error('You are not in this game.');
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };

  switch (a && a.type) {
    case 'propose': {
      need(G.phase === 'propose', 'Not proposing right now.');
      need(actor === leaderId(S), 'Only the leader can propose a team.');
      const idx = G.config.targeting ? Number(a.mission) : nextMission(G);
      need(Number.isInteger(idx) && idx >= 0 && idx < 5 && !G.missions[idx].result, 'Pick a mission that hasn’t been played.');
      need(!(G.config.targeting && idx === 4 && wins(G) < 2), 'Mission 5 unlocks after two successful missions.');
      const size = G.missions[idx].size;
      const team = [...new Set(a.team || [])];
      need(team.every(isPlayer), 'Unknown player in team.');
      need(team.length === size, `Team must have exactly ${size} players.`);
      let ex = null;
      if (G.config.excalibur) {
        const eligible = team.filter((id) => id !== actor);
        if (eligible.length) { need(eligible.includes(a.excalibur), 'Give Excalibur to a team member other than yourself.'); ex = a.excalibur; }
      }
      G.target = idx;
      G.team = ids(S).filter((id) => team.includes(id)); // keep seat order
      G.excalibur = ex;
      G.votes = {};
      G.phase = 'vote';
      return;
    }
    case 'vote': {
      need(G.phase === 'vote', 'Not voting right now.');
      need(G.config.trackVotes, 'Votes are being taken out loud this game.');
      G.votes[actor] = !!a.approve;
      if (Object.keys(G.votes).length === n) resolveVote(S);
      return;
    }
    case 'markVote': {
      need(G.phase === 'vote', 'Not voting right now.');
      need(!G.config.trackVotes, 'Votes are tracked in the app.');
      need(actor === leaderId(S) || a.admin, 'Only the leader records the vote.');
      resolveVote(S, !!a.approved);
      return;
    }
    case 'card': {
      need(G.phase === 'mission', 'No mission in progress.');
      need(G.team.includes(actor), 'You are not on this mission.');
      need(!G.cards.submitted.includes(actor), 'You already played a card.');
      need(!(a.fail && teamOf(G.roles[actor]) === 'good'), 'Good players can only play Success.');
      G.cards.submitted.push(actor);
      G.cards.by[actor] = !!a.fail;
      if (G.cards.submitted.length === G.team.length) {
        if (G.excalibur) G.phase = 'excalibur';
        else resolveMission(S);
      }
      return;
    }
    case 'excalibur': {
      need(G.phase === 'excalibur', 'Excalibur isn’t in play right now.');
      need(actor === G.excalibur, 'You don’t hold Excalibur.');
      if (a.target == null) return resolveMission(S, { by: actor, target: null });
      need(G.team.includes(a.target) && a.target !== actor, 'Pick another member of the team.');
      const original = G.cards.by[a.target];
      G.cards.by[a.target] = !original;
      G.excaliburLog.push({ mission: G.target, by: actor, target: a.target, original: original ? 'fail' : 'success' });
      return resolveMission(S, { by: actor, target: a.target });
    }
    case 'lady': {
      need(G.phase === 'lady' && G.lady, 'The Lady of the Lake isn’t active.');
      need(actor === G.lady.holder, 'You don’t hold the Lady of the Lake.');
      need(isPlayer(a.target) && a.target !== actor, 'Pick another player.');
      need(!G.lady.used.includes(a.target), 'That player has already held the Lady.');
      G.lady.pending = { by: actor, target: a.target };
      // With liars in the game, the examined player picks the card they show.
      if (inPlay(G, 'trickster') || inPlay(G, 'troublemaker')) G.phase = 'ladyReveal';
      else finishLady(S, teamOf(G.roles[a.target]));
      return;
    }
    case 'ladyShow': {
      need(G.phase === 'ladyReveal' && G.lady && G.lady.pending, 'Nobody is being examined.');
      need(actor === G.lady.pending.target, 'You are not the one being examined.');
      need(ladyOptions(G.roles[actor]).includes(a.show), 'You can’t show that loyalty.');
      finishLady(S, a.show);
      return;
    }
    case 'assassinate': {
      need(G.phase === 'assassin', 'No assassination right now.');
      need(actor === roleHolder(G, 'assassin'), 'Only the Assassin chooses.');
      need(isPlayer(a.target) && a.target !== actor, 'Pick another player.');
      G.assassinTarget = a.target;
      if (G.roles[a.target] === 'merlin') end(G, 'evil', 'The Assassin found Merlin.');
      else end(G, 'good', 'Three missions succeeded and Merlin survived the Assassin.');
      return;
    }
    default:
      throw new Error('Unknown action.');
  }
}

export function nightInfo(pid, roles, ctx = {}) {
  const r = roles[pid];
  const others = Object.keys(roles).filter((x) => x !== pid);
  const has = (x) => Object.values(roles).includes(x);
  const evil = (o) => teamOf(roles[o]) === 'evil';
  if (r === 'merlin') {
    return {
      label: 'Evil players you can see',
      seen: others.filter((o) => evil(o) && roles[o] !== 'mordred'),
      notes: has('mordred') ? ['Mordred is in the game and invisible to you.'] : [],
    };
  }
  if (r === 'percival') {
    return {
      label: has('morgana') ? 'One of these is Merlin, the other is Morgana' : 'Merlin',
      seen: others.filter((o) => roles[o] === 'merlin' || roles[o] === 'morgana'),
      notes: [],
    };
  }
  if (r === 'cleric' && ctx.firstLeader) {
    const fl = ctx.firstLeader;
    if (fl === pid) return { label: null, seen: [], notes: ['You are the first leader yourself, so your vision shows you nothing new.'] };
    return { label: `The first leader is ${teamOf(roles[fl]) === 'good' ? 'GOOD' : 'EVIL'}`, seen: [fl], notes: [] };
  }
  if (r === 'troublemaker') return { label: null, seen: [], notes: ['If the Lady examines you, the app will only let you show Evil.'] };
  if (r === 'oberon') return { label: null, seen: [], notes: ['You don’t know the other evil players, and they don’t know you.'] };
  if (teamOf(r) === 'evil') {
    const notes = [];
    if (has('oberon')) notes.push('Oberon is also evil, but hidden from you (and you from him).');
    if (r === 'trickster') notes.push('If the Lady examines you, you choose which loyalty to show.');
    return {
      label: 'Your fellow servants of Mordred',
      seen: others.filter((o) => evil(o) && roles[o] !== 'oberon'),
      notes,
    };
  }
  return { label: null, seen: [], notes: [] };
}

export function viewFor(S, pid, connected = new Set()) {
  const isPlayer = S.players.some((p) => p.id === pid);
  const v = {
    phase: S.phase,
    me: isPlayer ? pid : null,
    spectator: !isPlayer,
    players: S.players.map((p) => ({ id: p.id, name: p.name, connected: connected.has(p.id) })),
  };
  const G = S.game;
  if (!G) return v;
  const assassinVisible = G.phase === 'assassin' || G.phase === 'over';
  v.game = {
    id: G.id, phase: G.phase, round: G.round, missions: G.missions, rejections: G.rejections,
    missionIdx: G.target ?? (G.config.targeting ? null : nextMission(G)),
    openMissions: G.config.targeting ? openMissions(G) : null,
    targeting: !!G.config.targeting, excaliburOn: !!G.config.excalibur, excalibur: G.excalibur,
    excaliburLog: G.excaliburLog.map((e) => ({ mission: e.mission, by: e.by, target: e.target, original: e.by === pid ? e.original : undefined })),
    leaderId: leaderId(S), team: G.team, trackVotes: G.config.trackVotes,
    voted: Object.keys(G.votes), cardsIn: G.cards.submitted,
    lady: G.lady ? {
      holder: G.lady.holder, used: G.lady.used, pending: G.lady.pending,
      log: G.lady.log.map((e) => ({ by: e.by, target: e.target, round: e.round, team: e.by === pid ? e.team : undefined })),
    } : null,
    liars: inPlay(G, 'trickster') || inPlay(G, 'troublemaker'),
    history: G.history, lastEvent: G.lastEvent,
    winner: G.winner, reason: G.reason, assassinTarget: G.assassinTarget,
    assassinId: assassinVisible ? roleHolder(G, 'assassin') : null,
    rolesInPlay: G.rolesInPlay,
    roles: G.phase === 'over' ? G.roles : null,
  };
  if (isPlayer) {
    const role = G.roles[pid];
    v.mine = {
      role, team: teamOf(role), info: nightInfo(pid, G.roles, { firstLeader: G.firstLeader }),
      myVote: pid in G.votes ? G.votes[pid] : null,
      cardPlayed: G.cards.submitted.includes(pid),
      ladyOptions: ladyOptions(role),
    };
  }
  return v;
}
