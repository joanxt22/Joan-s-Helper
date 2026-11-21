import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration, truncate, trackChoiceName, buildTrackEntries, buildPlaylistEntry, getPlayChoices,
  takeSuggestedTrack, rememberSuggestion, resetPlayAutocompleteCaches,
} from '../src/services/music/playAutocomplete.js';

const track = (title, author, length = 234000, extra = {}) => ({ info: { title, author, length, uri: `https://example.com/${title}`, ...extra }, id: `${title}|${author}` });
const user = (id) => ({ id });
const searchResult = (tracks) => ({ loadType: 'search', tracks });
test.beforeEach(() => resetPlayAutocompleteCaches());

test('durations', () => {
  assert.equal(formatDuration(234000), '3:54');
  assert.equal(formatDuration(59000), '0:59');
  assert.equal(formatDuration(3725000), '1:02:05');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(1000, true), 'LIVE');
  assert.equal(formatDuration(NaN), '--:--');
  assert.equal(formatDuration(-5), '--:--');
});

test('choice names look like "🎵 Title - Artist - 3:54" and never exceed 100 characters', () => {
  assert.equal(trackChoiceName(track('California Gurls', 'Katy Perry').info), '🎵 California Gurls - Katy Perry - 3:54');
  const long = trackChoiceName(track('A'.repeat(300), 'Some Artist', 3725000).info);
  assert.ok(long.length <= 100);
  assert.ok(long.endsWith(' - 1:02:05'), 'the duration stays visible when the title is shortened');
  assert.ok(long.includes('…'));
  assert.equal(trackChoiceName({ title: 'No Artist', length: 60000 }), '🎵 No Artist - 1:00');
  assert.equal(truncate('short', 10), 'short');
});

test('entries are capped at 10, skip junk, and keep values unique and within limits', () => {
  const many = Array.from({ length: 15 }, (_, i) => track(`Song ${i}`, 'Band'));
  assert.equal(buildTrackEntries(many).length, 10);
  assert.deepEqual(buildTrackEntries([{ info: {} }, null, undefined, track('Ok', 'Band')]).map((e) => e.choice.value), ['Ok - Band']);

  const same = buildTrackEntries([track('Hello', 'Adele', 295000), track('Hello', 'Adele', 180000), track('Hello', 'Adele', 180000)]);
  assert.deepEqual(same.map((e) => e.choice.value), ['Hello - Adele', 'Hello - Adele (3:00)'], 'same title gets a distinguishing value; exact repeats are dropped');
  for (const { choice } of buildTrackEntries([track('x'.repeat(250), 'y'.repeat(250))])) {
    assert.ok(choice.name.length <= 100 && choice.value.length <= 100);
  }
});

test('playlist suggestion', () => {
  assert.deepEqual(buildPlaylistEntry({ name: 'Road Trip' }, 40, 'https://example.com/p').choice, { name: '📁 Road Trip (40 tracks)', value: 'https://example.com/p' });
  assert.equal(buildPlaylistEntry({ name: 'One' }, 1, 'https://example.com/p').choice.name, '📁 One (1 track)');
  assert.equal(buildPlaylistEntry({ name: 'X' }, 3, `https://example.com/${'p'.repeat(120)}`), null, 'a value over 100 characters cannot be submitted');
});

test('typing suggestions: searches, formats, and requires 2+ characters', async () => {
  let searches = 0;
  const resolveFn = async () => { searches += 1; return searchResult([track('California Gurls', 'Katy Perry'), track('Call Me Maybe', 'Carly Rae Jepsen', 193000)]); };
  assert.deepEqual(await getPlayChoices({}, user('a'), '', { resolveFn }), []);
  assert.deepEqual(await getPlayChoices({}, user('a'), 'c', { resolveFn }), []);
  assert.equal(searches, 0);

  const choices = await getPlayChoices({}, user('a'), 'cal', { resolveFn });
  assert.deepEqual(choices.map((c) => c.name), ['🎵 California Gurls - Katy Perry - 3:54', '🎵 Call Me Maybe - Carly Rae Jepsen - 3:13']);
});

test('repeat and simultaneous searches share one lookup', async () => {
  let searches = 0;
  const resolveFn = async () => { searches += 1; await new Promise((r) => setTimeout(r, 15)); return searchResult([track('Song', 'Band')]); };
  const [first, second] = await Promise.all([getPlayChoices({}, user('a'), 'song', { resolveFn }), getPlayChoices({}, user('b'), 'SONG ', { resolveFn })]);
  assert.equal(searches, 1);
  assert.deepEqual(first, second);
  await getPlayChoices({}, user('a'), 'song', { resolveFn });
  assert.equal(searches, 1, 'second keystroke is served from cache');
});

test('a slow search returns nothing now but is cached for the next keystroke', async () => {
  let searches = 0;
  const resolveFn = async () => { searches += 1; await new Promise((r) => setTimeout(r, 60)); return searchResult([track('Slow Song', 'Band')]); };
  assert.deepEqual(await getPlayChoices({}, user('a'), 'slow', { resolveFn, timeoutMs: 10 }), []);
  await new Promise((r) => setTimeout(r, 90));
  const later = await getPlayChoices({}, user('a'), 'slow', { resolveFn, timeoutMs: 10 });
  assert.equal(later.length, 1);
  assert.equal(searches, 1);
});

test('search failures, no results and unexpected load types give an empty list', async () => {
  assert.deepEqual(await getPlayChoices({}, user('a'), 'boom', { resolveFn: async () => { throw new Error('node offline'); } }), []);
  assert.deepEqual(await getPlayChoices({}, user('a'), 'none', { resolveFn: async () => ({ loadType: 'empty', tracks: [] }) }), []);
  assert.deepEqual(await getPlayChoices({}, user('a'), 'err', { resolveFn: async () => ({ loadType: 'error', tracks: [] }) }), []);
  assert.deepEqual(await getPlayChoices({ riffy: undefined }, user('a'), 'noclient'), [], 'no music node at all');
});

test('links are passed straight through without searching', async () => {
  let searches = 0;
  const resolveFn = async () => { searches += 1; return searchResult([]); };
  const url = 'https://open.spotify.com/track/abc';
  assert.deepEqual(await getPlayChoices({}, user('a'), url, { resolveFn }), [{ name: `🔗 ${url}`, value: url }]);
  assert.deepEqual(await getPlayChoices({}, user('a'), `https://example.com/${'x'.repeat(150)}`, { resolveFn }), []);
  assert.equal(searches, 0);
});

test('a search that returns a playlist shows it as a folder entry', async () => {
  const resolveFn = async () => ({ loadType: 'playlist', playlistInfo: { name: 'Chill Mix' }, tracks: [track('a', 'b'), track('c', 'd')] });
  const choices = await getPlayChoices({}, user('a'), 'chill mix', { resolveFn });
  assert.deepEqual(choices, [{ name: '📁 Chill Mix (2 tracks)', value: 'chill mix' }]);
  assert.equal(takeSuggestedTrack('a', 'chill mix'), null, 'playlists are searched again on submit, not cached as one track');
});

test('the exact track a person picks is remembered once, only for them, and expires', async () => {
  const resolveFn = async () => searchResult([track('Hello', 'Adele', 295000), track('Hello', 'Adele', 180000)]);
  const choices = await getPlayChoices({}, user('alice'), 'hello adele', { resolveFn });
  assert.equal(choices.length, 2);

  assert.equal(takeSuggestedTrack('bob', choices[1].value), null, 'another person cannot claim it');
  const picked = takeSuggestedTrack('alice', choices[1].value);
  assert.equal(picked.info.length, 180000, 'the version they clicked, not the top search result');
  assert.equal(takeSuggestedTrack('alice', choices[1].value), null, 'used up');

  rememberSuggestion('alice', 'old pick', track('Old', 'Band'), 1000);
  assert.equal(takeSuggestedTrack('alice', 'old pick', 1000 + 6 * 60 * 1000), null, 'expired after 5 minutes');
  assert.equal(takeSuggestedTrack('alice', 'typed text nobody suggested'), null);
});
