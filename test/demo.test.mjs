import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

test('demonstration contains four complete teams and two scheduled fixtures', async () => {
  const response = await fetch(`${baseUrl}/api/demo`);
  assert.equal(response.status, 200);
  const demo = await response.json();
  assert.equal(demo.teams.length, 4);
  assert.equal(demo.fixtures.length, 2);
  for (const fixture of demo.fixtures) {
    assert.equal(fixture.status, 'scheduled');
    assert.notEqual(fixture.homeTeamId, fixture.awayTeamId);
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      const lineup = fixture.lineups.filter(player => player.teamId === teamId);
      assert.equal(lineup.length, 11);
      assert.equal(new Set(lineup.map(player => player.playerId)).size, 11);
      assert.equal(lineup.filter(player => player.position === 'goleiro').length, 1);
      assert.ok(lineup.every(player => Number.isInteger(player.overall) && player.overall >= 1 && player.overall <= 100));
    }
  }
});
