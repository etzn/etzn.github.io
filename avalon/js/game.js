// Pure Avalon rules engine. No DOM, no network — the host owns one state
// object and mutates it through these functions; views are derived per player.

export const ROLE_INFO = {
  merlin:   { name: 'Merlin', team: 'good', blurb: 'You know who is evil — except Mordred. Guide your side without being obvious: if good wins and the Assassin names you, evil wins anyway.' },
  percival: { name: 'Percival', team: 'good', blurb: 'You can see Merlin. If Morgana is in play she looks identical, so work out which one is real and protect them.' },
  servant:  { name: 'Loyal Servant of Arthur', team: 'good', blurb: 'You know nothing except that you are good. Read the room.' },
  assassin: { name: 'Assassin', team: 'evil', blurb: 'If good completes three missions, you get one guess at who Merlin is. Get it right and evil wins.' },
  morgana:  { name: 'Morgana', team: 'evil', blurb: 'To Percival you look exactly like Merlin. Sell it.' },
  mordred:  { name: 'Mordred', team: 'evil', blurb: 'Merlin cannot see you. You are the one evil player Merlin can’t warn anyone about.' },
  oberon:   { name: 'Oberon', team: 'evil', blurb: 'You are evil, but you don’t know the other minions and they don’t know you. Merlin can still see you.' },
  minion:   { name: 'Minion of Mordred', team: 'evil', blurb: 'You know your fellow minions. Sabotage missions without getting caught.' },
};

export const GOOD_SPECIALS = ['merlin', 'percival'];
export const EVIL_SPECIALS = ['assassin', 'morgana', 'mordred', 'oberon'];
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
    roles: { merlin: true, percival: true, assassin: true, morgana: true, mordred: false, oberon: false },
    lady: false,
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
  const deck = [
    ...GOOD_SPECIALS.filter((r) => cfg.roles[r]),
    ...Array(n - s.evil - GOOD_SPECIALS.filter((r) => cfg.roles[r]).length).fill('servant'),
    ...EVIL_SPECIALS.filter((r) => cfg.roles[r]),
    ...Array(s.evil - EVIL_SPECIALS.filter((r) => cfg.roles[r]).length).fill('minion'),
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
    leader, round: 0, rejections: 0, phase: 'propose',
    missions: s.sizes.map((size, i) => ({ size, need: i === s.doubleFail ? 2 : 1, result: null, fails: null })),
    team: [], votes: {}, cards: { submitted: [], fails: 0 },
    lady: cfg.lady ? { holder: ladyHolder, used: [ladyHolder], log: [] } : null,
    history: [], lastEvent: null, eventSeq: 0,
    winner: null, reason: null, assassinTarget: null,
  };
  S.phase = 'game';
}

const ids = (S) => S.players.map((p) => p.id);
const leaderId = (S) => ids(S)[S.game.leader];
const roleHolder = (G, role) => Object.keys(G.roles).find((k) => G.roles[k] === role) || null;
const inPlay = (G, role) => !!G.rolesInPlay[role];

function event(G, e) { G.eventSeq += 1; G.lastEvent = { ...e, seq: G.eventSeq }; }
function end(G, winner, reason) { G.phase = 'over'; G.winner = winner; G.reason = reason; }
function nextLeader(S) { S.game.leader = (S.game.leader + 1) % S.players.length; }

function resolveVote(S, approvedOverride) {
  const G = S.game, n = S.players.length;
  const yes = Object.values(G.votes).filter(Boolean).length;
  const approved = approvedOverride ?? yes * 2 > n; // strict majority; ties fail
  const votes = G.config.trackVotes ? { ...G.votes } : null;
  G.history.push({ round: G.round, leader: leaderId(S), team: [...G.team], votes, approved, attempt: G.rejections + 1 });
  event(G, { kind: 'vote', approved, votes, team: [...G.team], leader: leaderId(S), round: G.round });
  G.votes = {};
  if (approved) {
    G.phase = 'mission';
    G.cards = { submitted: [], fails: 0 };
  } else {
    G.rejections += 1;
    G.team = [];
    if (G.rejections >= 5) return end(G, 'evil', 'Five team proposals in a row were rejected.');
    nextLeader(S);
    G.phase = 'propose';
  }
}

function resolveMission(S) {
  const G = S.game, m = G.missions[G.round];
  m.fails = G.cards.fails;
  m.result = m.fails >= m.need ? 'fail' : 'success';
  event(G, { kind: 'mission', round: G.round, fails: m.fails, result: m.result, need: m.need, size: G.team.length });
  G.round += 1; G.rejections = 0; G.team = []; G.cards = { submitted: [], fails: 0 };
  nextLeader(S);
  const wins = G.missions.filter((x) => x.result === 'success').length;
  const losses = G.missions.filter((x) => x.result === 'fail').length;
  if (losses >= 3) return end(G, 'evil', 'Three missions failed.');
  if (wins >= 3) {
    if (inPlay(G, 'merlin') && inPlay(G, 'assassin')) { G.phase = 'assassin'; return; }
    return end(G, 'good', 'Three missions succeeded.');
  }
  G.phase = G.lady && G.round >= 2 && G.round <= 4 ? 'lady' : 'propose';
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
      const team = [...new Set(a.team || [])];
      need(team.every(isPlayer), 'Unknown player in team.');
      need(team.length === G.missions[G.round].size, `Team must have exactly ${G.missions[G.round].size} players.`);
      G.team = ids(S).filter((id) => team.includes(id)); // keep seat order
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
      if (a.fail) G.cards.fails += 1; // only the count is kept, not who
      if (G.cards.submitted.length === G.team.length) resolveMission(S);
      return;
    }
    case 'lady': {
      need(G.phase === 'lady' && G.lady, 'The Lady of the Lake isn’t active.');
      need(actor === G.lady.holder, 'You don’t hold the Lady of the Lake.');
      need(isPlayer(a.target) && a.target !== actor, 'Pick another player.');
      need(!G.lady.used.includes(a.target), 'That player has already held the Lady.');
      G.lady.log.push({ by: actor, target: a.target, team: teamOf(G.roles[a.target]), round: G.round });
      G.lady.used.push(a.target);
      G.lady.holder = a.target;
      event(G, { kind: 'lady', by: actor, target: a.target });
      G.phase = 'propose';
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

export function nightInfo(pid, roles) {
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
  if (r === 'oberon') return { label: null, seen: [], notes: ['You don’t know the other evil players, and they don’t know you.'] };
  if (teamOf(r) === 'evil') {
    return {
      label: 'Your fellow servants of Mordred',
      seen: others.filter((o) => evil(o) && roles[o] !== 'oberon'),
      notes: has('oberon') ? ['Oberon is also evil, but hidden from you (and you from him).'] : [],
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
    leaderId: leaderId(S), team: G.team, trackVotes: G.config.trackVotes,
    voted: Object.keys(G.votes), cardsIn: G.cards.submitted,
    lady: G.lady ? {
      holder: G.lady.holder, used: G.lady.used,
      log: G.lady.log.map((e) => ({ by: e.by, target: e.target, round: e.round, team: e.by === pid ? e.team : undefined })),
    } : null,
    history: G.history, lastEvent: G.lastEvent,
    winner: G.winner, reason: G.reason, assassinTarget: G.assassinTarget,
    assassinId: assassinVisible ? roleHolder(G, 'assassin') : null,
    rolesInPlay: G.rolesInPlay,
    roles: G.phase === 'over' ? G.roles : null,
  };
  if (isPlayer) {
    const role = G.roles[pid];
    v.mine = {
      role, team: teamOf(role), info: nightInfo(pid, G.roles),
      myVote: pid in G.votes ? G.votes[pid] : null,
      cardPlayed: G.cards.submitted.includes(pid),
    };
  }
  return v;
}
