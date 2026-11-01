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

console.log('all game tests passed');
