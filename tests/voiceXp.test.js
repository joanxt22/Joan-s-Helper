import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVoiceXpSettings,
  rollVoiceXp,
  isEligibleVoiceState,
  groupEligibleByChannel,
  pickXpRecipients,
  awardVoiceXp,
} from '../src/services/leveling/voiceXpService.js';

const member = (id, { bot = false, roles = [] } = {}) => ({
  user: { id, bot },
  roles: { cache: roles.map((roleId) => ({ id: roleId })) },
});
const state = (m, channelId, flags = {}) => ({ member: m, channelId, selfDeaf: false, serverDeaf: false, ...flags });

test('settings default to 8-12 XP per minute, on, needing company', () => {
  const settings = getVoiceXpSettings({});
  assert.deepEqual(settings.xpPerMinute, { min: 8, max: 12 });
  assert.equal(settings.enabled, true);
  assert.equal(settings.requireOthers, true);
});

test('settings are clamped and repaired', () => {
  assert.deepEqual(getVoiceXpSettings({ voiceXp: { xpPerMinute: { min: 50, max: 10 } } }).xpPerMinute, { min: 50, max: 50 });
  assert.deepEqual(getVoiceXpSettings({ voiceXp: { xpPerMinute: { min: -5, max: 99999 } } }).xpPerMinute, { min: 1, max: 500 });
  assert.equal(getVoiceXpSettings({ voiceXp: { enabled: false } }).enabled, false);
  assert.equal(getVoiceXpSettings({ voiceXp: { requireOthers: false } }).requireOthers, false);
  assert.deepEqual(getVoiceXpSettings({ voiceXp: { xpPerMinute: { min: 'abc' } } }).xpPerMinute, { min: 8, max: 12 });
});

test('rollVoiceXp stays in range and applies the multiplier', () => {
  const settings = getVoiceXpSettings({ voiceXp: { xpPerMinute: { min: 10, max: 20 } } });
  assert.equal(rollVoiceXp(settings, 1, () => 0), 10);
  assert.equal(rollVoiceXp(settings, 1, () => 0.999999), 20);
  assert.equal(rollVoiceXp(settings, 2, () => 0), 20);
  assert.equal(rollVoiceXp(settings, 0.5, () => 0), 10, 'a multiplier below 1 is ignored');
  assert.equal(rollVoiceXp(settings, undefined, () => 0), 10);
});

test('who is eligible', () => {
  assert.equal(isEligibleVoiceState(state(member('a'), 'c1')), true);
  assert.equal(isEligibleVoiceState(state(member('a'), 'c1', { selfDeaf: true })), false);
  assert.equal(isEligibleVoiceState(state(member('a'), 'c1', { serverDeaf: true })), false);
  assert.equal(isEligibleVoiceState(state(member('a'), 'c1', { selfMute: true })), true, 'muted people are listening');
  assert.equal(isEligibleVoiceState(state(member('bot', { bot: true }), 'c1')), false);
  assert.equal(isEligibleVoiceState(state(null, 'c1')), false, 'uncached member');
  assert.equal(isEligibleVoiceState(state(member('a'), null)), false);
});

test('AFK and ignored channels are skipped', () => {
  const states = [state(member('a'), 'afk'), state(member('b'), 'afk'), state(member('c'), 'quiet'), state(member('d'), 'quiet'), state(member('e'), 'ok'), state(member('f'), 'ok')];
  const groups = groupEligibleByChannel(states, { afkChannelId: 'afk', ignoredChannelIds: new Set(['quiet']) });
  assert.deepEqual([...groups.keys()], ['ok']);
});

test('nobody earns XP alone unless requireOthers is off', () => {
  const groups = groupEligibleByChannel([state(member('a'), 'c1')]);
  assert.equal(pickXpRecipients(groups, { requireOthers: true }).length, 0);
  assert.equal(pickXpRecipients(groups, { requireOthers: false }).length, 1);
});

test('a deafened friend does not count as company', () => {
  const groups = groupEligibleByChannel([state(member('a'), 'c1'), state(member('b'), 'c1', { selfDeaf: true })]);
  assert.equal(pickXpRecipients(groups, { requireOthers: true }).length, 0);
});

test('ignored roles and blacklisted users earn nothing but still count as company', () => {
  const groups = groupEligibleByChannel([
    state(member('a', { roles: ['muted-xp'] }), 'c1'),
    state(member('b'), 'c1'),
    state(member('c'), 'c1'),
  ]);
  const ids = pickXpRecipients(groups, { requireOthers: true, ignoredRoles: ['muted-xp'], blacklistedUsers: ['c'] }).map((m) => m.user.id);
  assert.deepEqual(ids, ['b']);

  const soloWithIgnoredFriend = groupEligibleByChannel([state(member('a', { roles: ['muted-xp'] }), 'c1'), state(member('b'), 'c1')]);
  assert.deepEqual(pickXpRecipients(soloWithIgnoredFriend, { requireOthers: true, ignoredRoles: ['muted-xp'] }).map((m) => m.user.id), ['b']);
});

function makeClient(guilds) {
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } };
}
const guildWith = (id, states, afkChannelId = null) => ({ id, afkChannelId, voiceStates: { cache: new Map(states.map((s, i) => [String(i), s])) } });

test('awardVoiceXp gives XP to everyone in a call, marked as voice XP', async () => {
  const calls = [];
  const guild = guildWith('g1', [state(member('a'), 'c1'), state(member('b'), 'c1'), state(member('solo'), 'c2')]);
  const summary = await awardVoiceXp(makeClient([guild]), {
    addXpFn: async (client, g, m, xp, options) => { calls.push({ id: m.user.id, xp, options }); },
    getConfigFn: async () => ({ enabled: true, xpMultiplier: 1 }),
    rng: () => 0,
  });
  assert.deepEqual(calls.map((c) => c.id), ['a', 'b']);
  assert.ok(calls.every((c) => c.xp === 8 && c.options.source === 'voice'));
  assert.equal(summary.awarded, 2);
});

test('awardVoiceXp respects disabled leveling and disabled voice XP', async () => {
  const guild = guildWith('g1', [state(member('a'), 'c1'), state(member('b'), 'c1')]);
  const calls = [];
  const deps = (config) => ({ addXpFn: async (...args) => { calls.push(args); }, getConfigFn: async () => config });

  await awardVoiceXp(makeClient([guild]), deps({ enabled: false }));
  await awardVoiceXp(makeClient([guild]), deps({ enabled: true, voiceXp: { enabled: false } }));
  assert.equal(calls.length, 0);
});

test('one failing member does not stop the others', async () => {
  const guild = guildWith('g1', [state(member('a'), 'c1'), state(member('b'), 'c1')]);
  const awarded = [];
  const summary = await awardVoiceXp(makeClient([guild]), {
    addXpFn: async (client, g, m) => { if (m.user.id === 'a') throw new Error('db down'); awarded.push(m.user.id); },
    getConfigFn: async () => ({ enabled: true }),
  });
  assert.deepEqual(awarded, ['b']);
  assert.equal(summary.failed, 1);
  assert.equal(summary.awarded, 1);
});

test('overlapping runs are skipped instead of double-awarding', async () => {
  const guild = guildWith('g1', [state(member('a'), 'c1'), state(member('b'), 'c1')]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let count = 0;
  const deps = { addXpFn: async () => { count += 1; await gate; }, getConfigFn: async () => ({ enabled: true }) };

  const first = awardVoiceXp(makeClient([guild]), deps);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await awardVoiceXp(makeClient([guild]), deps);
  assert.equal(second.skipped, true);
  release();
  await first;
  assert.equal(count, 2);
});
