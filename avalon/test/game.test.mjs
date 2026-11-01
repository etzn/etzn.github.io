import assert from 'node:assert/strict';
import * as G from '../js/game.js';

let seed = 1;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function lobby(n, cfgPatch = {}) {
  const S = G.newState();
  for (let i = 0; i < n; i++) G.addPlayer(S, 'p' + i, 'P' + i);
  const cfg = { ...G.defaultConfig(), ...cfgPatch };
  return { S, cfg };
}
const lead = (S) => S.players[S.game.leader].id;
const evilIds = (S) => Object.keys(S.game.roles).filter((k) => G.teamOf(S.game.roles[k]) === 'evil');
const goodIds = (S) => Object.keys(S.game.roles).filter((k) => G.teamOf(S.game.roles[k]) === 'good');

// Role counts for every official size
for (let n = 5; n <= 10; n++) {
  for (let t = 0; t < 30; t++) {
    const { S, cfg } = lobby(n, { roles: { merlin: true, percival: true, assassin: true, morgana: true, mordred: n >= 7, oberon: n >= 10 } });
    G.startGame(S, cfg, rng);
    assert.equal(evilIds(S).length, G.defaultSetup(n).evil, `evil count n=${n}`);
    assert.equal(S.game.missions[3].need, n >= 7 ? 2 : 1);
  }
}

// Night info correctness
{
  const S = G.newState();
  const roles = { a: 'merlin', b: 'percival', c: 'morgana', d: 'mordred', e: 'oberon', f: 'assassin', g: 'servant' };
  const mi = G.nightInfo('a', roles); assert.deepEqual(mi.seen.sort(), ['c', 'e', 'f']);
  assert.deepEqual(G.nightInfo('b', roles).seen.sort(), ['a', 'c']);
  assert.deepEqual(G.nightInfo('d', roles).seen.sort(), ['c', 'f']);
  assert.deepEqual(G.nightInfo('e', roles).seen, []);
  assert.deepEqual(G.nightInfo('g', roles).seen, []);
}

// Full game: good wins three, assassin misses
{
  const { S, cfg } = lobby(7);
  G.startGame(S, cfg, rng);
  for (let m = 0; m < 3; m++) {
    const size = S.game.missions[S.game.round].size;
    assert.throws(() => G.act(S, S.players.find((p) => p.id !== lead(S)).id, { type: 'propose', team: [] }));
    const team = goodIds(S).slice(0, size);
    G.act(S, lead(S), { type: 'propose', team });
    for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
    assert.equal(S.game.phase, 'mission');
    for (const id of S.game.team) {
      assert.throws(() => G.act(S, id, { type: 'card', fail: true }), /only play Success/);
      G.act(S, id, { type: 'card', fail: false });
    }
  }
  assert.equal(S.game.phase, 'assassin');
  const assassin = Object.keys(S.game.roles).find((k) => S.game.roles[k] === 'assassin');
  const notMerlin = goodIds(S).find((k) => S.game.roles[k] !== 'merlin');
  G.act(S, assassin, { type: 'assassinate', target: notMerlin });
  assert.equal(S.game.winner, 'good');
  assert.ok(G.viewFor(S, 'p0').game.roles);
}

// Five rejections => evil
{
  const { S, cfg } = lobby(5);
  G.startGame(S, cfg, rng);
  for (let i = 0; i < 5; i++) {
    G.act(S, lead(S), { type: 'propose', team: S.players.slice(0, S.game.missions[0].size).map((p) => p.id) });
    for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: false });
  }
  assert.equal(S.game.winner, 'evil');
}

// Tie vote rejects; double-fail rule on mission 4
{
  const { S, cfg } = lobby(8, { trackVotes: false });
  G.startGame(S, cfg, rng);
  const ev = evilIds(S);
  for (let m = 0; m < 4; m++) {
    const size = S.game.missions[S.game.round].size;
    const team = m === 3 ? [ev[0], ...goodIds(S).slice(0, size - 1)] : goodIds(S).slice(0, size);
    G.act(S, lead(S), { type: 'propose', team });
    G.act(S, lead(S), { type: 'markVote', approved: true });
    for (const id of S.game.team) G.act(S, id, { type: 'card', fail: m === 3 ? id === ev[0] : m === 0 ? false : (m === 1 ? false : false) });
    if (S.game.phase !== 'propose') break;
  }
  // missions 1-3 succeed => assassin phase already; check mission flow separately below
}
{
  const { S, cfg } = lobby(7);
  G.startGame(S, cfg, rng);
  const ev = evilIds(S);
  const play = (team, fails) => {
    G.act(S, lead(S), { type: 'propose', team });
    for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
    for (const id of S.game.team) G.act(S, id, { type: 'card', fail: fails.includes(id) });
  };
  const sz = () => S.game.missions[S.game.round].size;
  play([ev[0], ...goodIds(S).slice(0, sz() - 1)], [ev[0]]); // M1 fail
  play(goodIds(S).slice(0, sz()), []);                      // M2 success
  play([ev[0], ...goodIds(S).slice(0, sz() - 1)], [ev[0]]); // M3 fail
  play([ev[0], ...goodIds(S).slice(0, sz() - 1)], [ev[0]]); // M4: 1 fail, needs 2 => success
  assert.equal(S.game.missions[3].result, 'success');
  play([ev[0], ev[1], ...goodIds(S).slice(0, sz() - 2)], [ev[0], ev[1]]); // M5 fail
  assert.equal(S.game.winner, 'evil');
}

// Tie => reject (6 players, 3 yes)
{
  const { S, cfg } = lobby(6);
  G.startGame(S, cfg, rng);
  G.act(S, lead(S), { type: 'propose', team: S.players.slice(0, 2).map((p) => p.id) });
  S.players.forEach((p, i) => G.act(S, p.id, { type: 'vote', approve: i < 3 }));
  assert.equal(S.game.rejections, 1);
  assert.equal(S.game.phase, 'propose');
}

// Lady of the Lake triggers after M2, can't target previous holders, private result
{
  const { S, cfg } = lobby(8, { lady: true });
  G.startGame(S, cfg, rng);
  const first = S.game.lady.holder;
  assert.equal(first, S.players[(S.game.leader + 7) % 8].id);
  const sz = () => S.game.missions[S.game.round].size;
  for (let m = 0; m < 2; m++) {
    G.act(S, lead(S), { type: 'propose', team: goodIds(S).slice(0, sz()) });
    for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
    for (const id of S.game.team) G.act(S, id, { type: 'card', fail: false });
  }
  assert.equal(S.game.phase, 'lady');
  assert.throws(() => G.act(S, first, { type: 'lady', target: first }));
  const target = S.players.find((p) => p.id !== first).id;
  G.act(S, first, { type: 'lady', target });
  assert.equal(S.game.lady.holder, target);
  assert.ok(G.viewFor(S, first).game.lady.log[0].team);
  assert.equal(G.viewFor(S, target).game.lady.log[0].team, undefined);
  assert.equal(S.game.phase, 'propose');
}

// Views never leak roles mid-game
{
  const { S, cfg } = lobby(6);
  G.startGame(S, cfg, rng);
  const v = JSON.stringify(G.viewFor(S, 'p0'));
  const myRole = S.game.roles.p0;
  for (const [id, r] of Object.entries(S.game.roles)) if (id !== 'p0') assert.equal(G.viewFor(S, 'p0').game.roles, null);
  assert.ok(!v.includes('"roles":{'));
}

// Validation
assert.ok(G.validate(5, { ...G.defaultConfig(), roles: { merlin: true, percival: true, assassin: true, morgana: true, mordred: true, oberon: false } }).some((x) => x.level === 'error'));
assert.ok(!G.validate(5, G.defaultConfig()).some((x) => x.level === 'error'));
assert.ok(G.validate(3, G.defaultConfig()).some((x) => x.level === 'warn'));

// ---------- variants ----------
const playMission = (S, team, failers = [], exTarget) => {
  const lid = lead(S);
  const ex = S.game.config.excalibur ? team.find((id) => id !== lid) : undefined;
  G.act(S, lid, { type: 'propose', team, excalibur: ex, mission: S.game.config.targeting ? G.openMissions(S.game)[0] : undefined });
  for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
  for (const id of S.game.team) G.act(S, id, { type: 'card', fail: failers.includes(id) });
  return ex;
};

// Excalibur: required on proposal, can't be the leader, flips a card, private original
{
  const { S, cfg } = lobby(7, { excalibur: true });
  G.startGame(S, cfg, rng);
  const lid = lead(S), size = S.game.missions[0].size;
  const team = [lid, ...goodIds(S).filter((x) => x !== lid)].slice(0, size);
  assert.throws(() => G.act(S, lid, { type: 'propose', team }), /Excalibur/);
  assert.throws(() => G.act(S, lid, { type: 'propose', team, excalibur: lid }), /Excalibur/);
  const holder = team.find((x) => x !== lid);
  G.act(S, lid, { type: 'propose', team, excalibur: holder });
  for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
  for (const id of S.game.team) G.act(S, id, { type: 'card', fail: false });
  assert.equal(S.game.phase, 'excalibur');
  assert.throws(() => G.act(S, team.find((x) => x !== holder), { type: 'excalibur', target: holder }), /don’t hold/);
  const victim = team.find((x) => x !== holder);
  G.act(S, holder, { type: 'excalibur', target: victim });
  assert.equal(S.game.missions[0].result, 'fail');
  assert.equal(S.game.missions[0].fails, 1);
  assert.equal(G.viewFor(S, holder).game.excaliburLog[0].original, 'success');
  assert.equal(G.viewFor(S, victim).game.excaliburLog[0].original, undefined);
  assert.equal(S.game.lastEvent.excalibur.target, victim);
  // sheathed
  const t2 = goodIds(S).slice(0, S.game.missions[1].size);
  const h2 = playMission(S, t2);
  assert.equal(S.game.phase, 'excalibur');
  G.act(S, h2, { type: 'excalibur' });
  assert.equal(S.game.missions[1].result, 'success');
  assert.equal(S.game.lastEvent.excalibur.target, null);
}

// Targeting: any order, mission 5 locked until two successes, lady keyed to missions completed
{
  const { S, cfg } = lobby(7, { targeting: true, lady: true });
  G.startGame(S, cfg, rng);
  const lid = lead(S);
  assert.deepEqual(G.openMissions(S.game), [0, 1, 2, 3]);
  assert.throws(() => G.act(S, lid, { type: 'propose', team: goodIds(S).slice(0, 4), mission: 4 }), /unlocks/);
  G.act(S, lid, { type: 'propose', team: goodIds(S).slice(0, S.game.missions[3].size), mission: 3 });
  assert.equal(S.game.history.length, 0);
  for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
  assert.equal(S.game.history[0].mission, 3);
  for (const id of S.game.team) G.act(S, id, { type: 'card', fail: false });
  assert.equal(S.game.missions[3].result, 'success');
  assert.equal(S.game.missions[0].result, null);
  assert.equal(G.viewFor(S, 'p0').game.missionIdx, null);
  const l2 = lead(S);
  G.act(S, l2, { type: 'propose', team: goodIds(S).slice(0, 2), mission: 0 });
  for (const p of S.players) G.act(S, p.id, { type: 'vote', approve: true });
  for (const id of S.game.team) G.act(S, id, { type: 'card', fail: false });
  assert.equal(S.game.phase, 'lady');
  assert.ok(G.openMissions(S.game).includes(4));
}

// Cleric learns the first leader's loyalty
{
  const roles = { a: 'cleric', b: 'morgana', c: 'servant' };
  assert.equal(G.nightInfo('a', roles, { firstLeader: 'b' }).label, 'The first leader is EVIL');
  assert.deepEqual(G.nightInfo('a', roles, { firstLeader: 'b' }).seen, ['b']);
  assert.equal(G.nightInfo('a', roles, { firstLeader: 'c' }).label, 'The first leader is GOOD');
  assert.equal(G.nightInfo('a', roles, { firstLeader: 'a' }).label, null);
  const { S, cfg } = lobby(8, { roles: { ...G.defaultConfig().roles, cleric: true } });
  G.startGame(S, cfg, rng);
  const cl = Object.keys(S.game.roles).find((k) => S.game.roles[k] === 'cleric');
  if (cl !== S.game.firstLeader) assert.deepEqual(G.viewFor(S, cl).mine.info.seen, [S.game.firstLeader]);
}

// Trickster may lie to the Lady; Troublemaker must; everyone else must tell the truth
{
  assert.deepEqual(G.ladyOptions('trickster'), ['good', 'evil']);
  assert.deepEqual(G.ladyOptions('troublemaker'), ['evil']);
  assert.deepEqual(G.ladyOptions('merlin'), ['good']);
  assert.deepEqual(G.ladyOptions('minion'), ['evil']);
  let liarTested = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { S, cfg } = lobby(8, { lady: true, roles: { merlin: true, percival: false, assassin: true, morgana: false, mordred: false, oberon: false, cleric: false, troublemaker: true, trickster: true } });
    G.startGame(S, cfg, rng);
    for (let m = 0; m < 2; m++) playMission(S, goodIds(S).slice(0, S.game.missions[S.game.round].size));
    if (S.game.phase !== 'lady') continue;
    const holder = S.game.lady.holder;
    const trick = Object.keys(S.game.roles).find((k) => S.game.roles[k] === 'trickster');
    if (trick === holder || S.game.lady.used.includes(trick)) continue;
    G.act(S, holder, { type: 'lady', target: trick });
    assert.equal(S.game.phase, 'ladyReveal');
    assert.throws(() => G.act(S, holder, { type: 'ladyShow', show: 'good' }), /not the one/);
    G.act(S, trick, { type: 'ladyShow', show: 'good' });
    assert.equal(G.viewFor(S, holder).game.lady.log[0].team, 'good');
    assert.equal(S.game.phase, 'propose');
    // next: someone honest can't lie (fail mission 3 so the game continues)
    const ev0 = evilIds(S).find((k) => S.game.roles[k] !== 'trickster') || evilIds(S)[0];
    playMission(S, [ev0, ...goodIds(S)].slice(0, S.game.missions[S.game.round].size), [ev0]);
    assert.equal(S.game.phase, 'lady');
    const h2 = S.game.lady.holder;
    const honest = Object.keys(S.game.roles).find((k) => !['trickster', 'troublemaker'].includes(S.game.roles[k]) && k !== h2 && !S.game.lady.used.includes(k));
    G.act(S, h2, { type: 'lady', target: honest });
    const truth = G.teamOf(S.game.roles[honest]);
    assert.throws(() => G.act(S, honest, { type: 'ladyShow', show: truth === 'good' ? 'evil' : 'good' }), /can’t show/);
    G.act(S, honest, { type: 'ladyShow', show: truth });
    liarTested = true;
    break;
  }
  assert.ok(liarTested, 'trickster scenario never came up');
  const v = G.validate(8, { ...G.defaultConfig(), roles: { ...G.defaultConfig().roles, trickster: true } });
  assert.ok(v.some((x) => /Lady of the Lake/.test(x.msg)));
}

console.log('all game tests passed');
