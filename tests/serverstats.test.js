import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTER_TYPE_CONFIG,
  getGuildScopedCount,
  getCounterCount,
  formatCounterChannelName,
} from '../src/services/serverstatsService.js';

const collection = (items) => {
  const array = [...items];
  array.size = array.length;
  array.filter = (fn) => collection(Array.prototype.filter.call(array, fn));
  return array;
};

function makeGuild(overrides = {}) {
  return {
    premiumSubscriptionCount: 7,
    memberCount: 3,
    channels: {
      cache: collection([
        { type: 0, isThread: () => false }, // text
        { type: 2, isThread: () => false }, // voice
        { type: 4, isThread: () => false }, // category (not counted)
        { type: 11, isThread: () => true }, // thread (not counted)
      ]),
    },
    roles: { cache: collection([{}, {}, {}, {}]) }, // 3 real roles + @everyone
    voiceStates: { cache: collection([{ channelId: 'v1' }, { channelId: null }, { channelId: 'v2' }]) },
    members: {
      cache: collection([{ user: { bot: false } }, { user: { bot: true } }, { user: { bot: false } }]),
    },
    ...overrides,
  };
}

test('every counter type has a label, base name and emoji', () => {
  for (const [type, config] of Object.entries(COUNTER_TYPE_CONFIG)) {
    assert.ok(config.label && config.baseName && config.emoji, `${type} is incomplete`);
  }
  assert.ok(Object.keys(COUNTER_TYPE_CONFIG).length <= 25, 'Discord allows at most 25 choices');
});

test('guild-scoped counts', () => {
  const guild = makeGuild();
  assert.equal(getGuildScopedCount(guild, 'boosts'), 7);
  assert.equal(getGuildScopedCount(guild, 'channels'), 2, 'categories and threads are excluded');
  assert.equal(getGuildScopedCount(guild, 'roles'), 3, '@everyone is excluded');
  assert.equal(getGuildScopedCount(guild, 'in_voice'), 2);
  assert.equal(getGuildScopedCount(guild, 'members'), null);
  assert.equal(getGuildScopedCount(makeGuild({ premiumSubscriptionCount: null }), 'boosts'), 0);
});

test('member-based counts use the cache without fetching when it is complete', async () => {
  const guild = makeGuild();
  guild.members.fetch = async () => { throw new Error('must not fetch when the cache is complete'); };
  assert.equal(await getCounterCount(guild, 'members'), 3);
  assert.equal(await getCounterCount(guild, 'bots'), 1);
  assert.equal(await getCounterCount(guild, 'members_only'), 2);
  assert.equal(await getCounterCount(guild, 'nonsense'), null);
});

test('an incomplete member cache triggers one fetch', async () => {
  const guild = makeGuild({ memberCount: 10 });
  let fetches = 0;
  guild.members.fetch = async () => { fetches += 1; return guild.members.cache; };
  await getCounterCount(guild, 'bots');
  assert.equal(fetches, 1);
});

test('voice channels get "Name: 5", text channels keep the hyphen format', () => {
  assert.equal(formatCounterChannelName('members_only', 5, true), 'Members: 5');
  assert.equal(formatCounterChannelName('members_only', 5, false), 'Members-5');
  assert.equal(formatCounterChannelName('boosts', 12, true), 'Boosts: 12');
});
