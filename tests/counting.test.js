import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processCountingMessage,
  getCountingGameConfig,
  saveCountingGameConfig,
  activateCountingGame,
  updateCountingSettings,
  looksLikeCountAttempt,
  applyCorrectCount,
  buildCountingLeaderboard,
  getUserCountingStats,
} from '../src/services/countingGameService.js';

function makeClient() {
  const store = new Map();
  return {
    db: {
      get: async (key, fallback = null) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
      set: async (key, value) => { store.set(key, structuredClone(value)); return true; },
    },
  };
}

function makeMessage({ content, authorId = 'u1', channelId = 'c1', guildId = 'g1' }) {
  const sent = [];
  const reactions = [];
  const state = { deleted: false };
  return {
    guild: { id: guildId },
    channel: { id: channelId, send: async (text) => { sent.push(text); return { delete: async () => {} }; } },
    author: { id: authorId },
    content,
    react: async (emoji) => { reactions.push(emoji); },
    delete: async () => { state.deleted = true; },
    sent,
    reactions,
    state,
  };
}

async function startGame(client, system = 'decimal') {
  return activateCountingGame(client, 'g1', 'c1', system);
}

test('a correct count is accepted, reacted to and recorded', async () => {
  const client = makeClient();
  await startGame(client);

  const msg = makeMessage({ content: '1', authorId: 'a' });
  assert.equal(await processCountingMessage(client, msg), true);
  assert.deepEqual(msg.reactions, ['✅']);
  assert.equal(msg.state.deleted, false);

  const config = await getCountingGameConfig(client, 'g1');
  assert.equal(config.nextNumber, 2);
  assert.equal(config.lastUserId, 'a');
  assert.equal(config.leaderboard.a, 1);
  assert.equal(config.highScore, 1);
});

test('normal chat in the counting channel is ignored unless strict mode is on', async () => {
  const client = makeClient();
  await startGame(client);

  const chat = makeMessage({ content: 'lol that was close', authorId: 'a' });
  assert.equal(await processCountingMessage(client, chat), false);
  assert.equal(chat.state.deleted, false);
  assert.equal((await getCountingGameConfig(client, 'g1')).nextNumber, 1);

  await updateCountingSettings(client, 'g1', { strict: true });
  const strictChat = makeMessage({ content: 'lol', authorId: 'a' });
  assert.equal(await processCountingMessage(client, strictChat), true);
  assert.equal(strictChat.state.deleted, true);
});

test('messages in other channels are not part of the game', async () => {
  const client = makeClient();
  await startGame(client);
  const msg = makeMessage({ content: '1', channelId: 'other' });
  assert.equal(await processCountingMessage(client, msg), false);
  assert.equal((await getCountingGameConfig(client, 'g1')).nextNumber, 1);
});

test('a wrong number spends a save instead of resetting', async () => {
  const client = makeClient();
  await startGame(client);
  await processCountingMessage(client, makeMessage({ content: '1', authorId: 'a' }));
  await processCountingMessage(client, makeMessage({ content: '2', authorId: 'b' }));

  const bad = makeMessage({ content: '9', authorId: 'a' });
  assert.equal(await processCountingMessage(client, bad), true);
  assert.equal(bad.state.deleted, true);

  const config = await getCountingGameConfig(client, 'g1');
  assert.equal(config.nextNumber, 3, 'count must not reset while saves remain');
  assert.equal(config.currentStreak, 2);
  assert.equal(config.saves, 2);
  assert.equal(config.ruins.a, 1);
  assert.match(bad.sent[0], /save/);
});

test('with no saves left a mistake resets the count to 1', async () => {
  const client = makeClient();
  await startGame(client);
  await updateCountingSettings(client, 'g1', { maxSaves: 0 });
  await processCountingMessage(client, makeMessage({ content: '1', authorId: 'a' }));
  await processCountingMessage(client, makeMessage({ content: '2', authorId: 'b' }));

  const bad = makeMessage({ content: '7', authorId: 'a' });
  await processCountingMessage(client, bad);

  const config = await getCountingGameConfig(client, 'g1');
  assert.equal(config.nextNumber, 1);
  assert.equal(config.currentStreak, 0);
  assert.equal(config.lastUserId, null);
  assert.equal(config.highScore, 2, 'high score survives a reset');
  assert.match(bad.sent[0], /reset to \*\*1\*\*/);
});

test('the same person counting twice in a row is a mistake even with the right number', async () => {
  const client = makeClient();
  await startGame(client);
  await updateCountingSettings(client, 'g1', { maxSaves: 0 });
  await processCountingMessage(client, makeMessage({ content: '1', authorId: 'a' }));

  const twice = makeMessage({ content: '2', authorId: 'a' });
  await processCountingMessage(client, twice);
  assert.equal(twice.state.deleted, true);
  assert.equal((await getCountingGameConfig(client, 'g1')).nextNumber, 1);
});

test('reaching 100 earns a save and celebrates', async () => {
  const client = makeClient();
  const config = await startGame(client);
  await saveCountingGameConfig(client, 'g1', { ...config, nextNumber: 100, saves: 1, currentStreak: 99, lastUserId: 'b' });

  const msg = makeMessage({ content: '100', authorId: 'a' });
  await processCountingMessage(client, msg);

  assert.deepEqual(msg.reactions, ['✅', '💯']);
  assert.match(msg.sent[0], /reached \*\*100\*\*/);
  const after = await getCountingGameConfig(client, 'g1');
  assert.equal(after.saves, 2);
  assert.equal(after.nextNumber, 101);
});

test('saves never exceed the maximum', () => {
  const base = { nextNumber: 200, saves: 3, maxSaves: 3, leaderboard: {}, currentStreak: 0, bestStreak: 0, highScore: 0 };
  const result = applyCorrectCount(base, 'a');
  assert.equal(result.earnedSave, false);
  assert.equal(result.config.saves, 3);
});

test('two people posting the same number at the same moment cannot corrupt the count', async () => {
  const client = makeClient();
  await startGame(client);

  const results = await Promise.all([
    processCountingMessage(client, makeMessage({ content: '1', authorId: 'a' })),
    processCountingMessage(client, makeMessage({ content: '1', authorId: 'b' })),
    processCountingMessage(client, makeMessage({ content: '1', authorId: 'c' })),
  ]);
  assert.deepEqual(results, [true, true, true]);

  const config = await getCountingGameConfig(client, 'g1');
  assert.equal(config.nextNumber, 2, 'exactly one of the three "1"s may count');
  const totalCorrect = Object.values(config.leaderboard).reduce((a, b) => a + b, 0);
  assert.equal(totalCorrect, 1);
  assert.equal(config.saves, 1, 'the two late posters each used a save');
});

test('other counting systems accept their own numbers and only treat plausible text as attempts', async () => {
  const client = makeClient();
  await startGame(client, 'hexadecimal');
  await processCountingMessage(client, makeMessage({ content: '1', authorId: 'a' }));
  const ten = makeMessage({ content: 'A', authorId: 'b' });
  // next expected is 2 in hex, so "A" is a wrong attempt; chat with non-hex letters is ignored
  assert.equal(await processCountingMessage(client, makeMessage({ content: 'lol', authorId: 'c' })), false);
  await processCountingMessage(client, ten);
  assert.equal(ten.state.deleted, true);
});

test('looksLikeCountAttempt per system', () => {
  assert.equal(looksLikeCountAttempt('42', { system: 'decimal' }), true);
  assert.equal(looksLikeCountAttempt('42 lol', { system: 'decimal' }), false);
  assert.equal(looksLikeCountAttempt('', { system: 'decimal' }), false);
  assert.equal(looksLikeCountAttempt('1010', { system: 'binary' }), true);
  assert.equal(looksLikeCountAttempt('12', { system: 'binary' }), false);
  assert.equal(looksLikeCountAttempt('XIV', { system: 'roman' }), true);
  assert.equal(looksLikeCountAttempt('hello', { system: 'roman' }), false);
  assert.equal(looksLikeCountAttempt('4*4=16', { system: 'math' }), true);
  assert.equal(looksLikeCountAttempt('(2+2)', { system: 'math' }), true);
  assert.equal(looksLikeCountAttempt('what', { system: 'math' }), false);
});

test('settings clamp and refill, and setup keeps earlier settings', async () => {
  const client = makeClient();
  await startGame(client);
  const updated = await updateCountingSettings(client, 'g1', { maxSaves: 99, strict: true });
  assert.equal(updated.maxSaves, 5);
  assert.equal(updated.saves, 5);
  assert.equal(updated.strict, true);

  const restarted = await activateCountingGame(client, 'g1', 'c2', 'decimal');
  assert.equal(restarted.strict, true);
  assert.equal(restarted.maxSaves, 5);
  assert.equal(restarted.nextNumber, 1);
});

test('legacy saved games without the new fields still load with sane defaults', async () => {
  const client = makeClient();
  await client.db.set('countingGame:g1', {
    enabled: true, channelId: 'c1', system: 'decimal', nextNumber: 5,
    lastUserId: null, currentStreak: 4, bestStreak: 9, leaderboard: { a: 4 },
  });
  const config = await getCountingGameConfig(client, 'g1');
  assert.equal(config.saves, 3);
  assert.equal(config.strict, false);
  assert.deepEqual(config.ruins, {});
  assert.equal(config.nextNumber, 5);
});

test('leaderboard and user stats', () => {
  const config = { leaderboard: { a: 10, b: 30, c: 5 }, ruins: { a: 2 } };
  const lines = buildCountingLeaderboard(config);
  assert.match(lines[0], /🥇 <@b> — 30 counts/);
  assert.match(lines[1], /🥈 <@a> — 10 counts/);
  assert.match(lines[2], /🥉 <@c> — 5 counts/);

  const stats = getUserCountingStats(config, 'a');
  assert.equal(stats.correct, 10);
  assert.equal(stats.ruins, 2);
  assert.equal(stats.rank, 2);
  assert.equal(stats.accuracy, 83.3);
  assert.equal(getUserCountingStats(config, 'nobody').rank, null);
});
