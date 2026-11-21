import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, cleanText, parseFeed, normalizeXTimeline, selectNewItems, mergeSeen } from '../src/services/news/feedParser.js';
import { fetchXPosts, fetchFeedItems, fetchSourceItems, resetNewsCaches, NewsError } from '../src/services/news/newsService.js';
import { sourceKey, NEWS_GAMES } from '../src/config/news/sources.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title><![CDATA[Update 1.2 &amp; more]]></title><link>https://example.com/a</link><guid>guid-a</guid>
<description><![CDATA[<p>Big <b>patch</b> notes &amp; fixes</p>]]></description><pubDate>Tue, 10 Jun 2025 10:00:00 GMT</pubDate></item>
<item><title>Second &lt;story&gt; &#8211; news &#x1F600;</title><link>https://example.com/b</link>
<description>Plain text</description><pubDate>Mon, 09 Jun 2025 10:00:00 GMT</pubDate></item>
<item><description>No title but has body</description><link>https://example.com/c</link></item>
<item></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title>Atom one</title><id>tag:x,1</id><link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/one?a=1&amp;b=2"/>
<updated>2025-06-10T10:00:00Z</updated><summary>Short summary</summary></entry>
<entry><title>Atom two</title><id>tag:x,2</id><link href="https://example.com/two"/><published>2025-06-09T10:00:00Z</published><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry>
</feed>`;

test('entity decoding handles named, decimal and hex entities safely', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;&#66;'), 'a & b <c> "d" \'e\' AB');
  assert.equal(decodeEntities('&unknown; &#99999999999;'), '&unknown; &#99999999999;');
  assert.equal(decodeEntities(null), '');
  assert.equal(cleanText('<![CDATA[<p>Hi <b>there</b></p>]]>'), 'Hi there');
  assert.equal(cleanText('  lots \n of\t space  '), 'lots of space');
});

test('parses RSS 2.0 including CDATA, entities and items without a title', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 3, 'the empty item is dropped');
  assert.equal(items[0].title, 'Update 1.2 & more');
  assert.equal(items[0].summary, 'Big patch notes & fixes');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].id, 'guid-a');
  assert.equal(items[0].publishedAt, Date.parse('2025-06-10T10:00:00Z'));
  assert.equal(items[1].title, 'Second <story> – news 😀', 'titles are plain text, so escaped angle brackets survive');
  assert.equal(items[1].id, 'https://example.com/b', 'falls back to the link when there is no guid');
  assert.equal(items[2].title, '');
  assert.equal(items[2].summary, 'No title but has body');
});

test('parses Atom, preferring the alternate link', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://example.com/one?a=1&b=2');
  assert.equal(items[0].id, 'tag:x,1');
  assert.equal(items[0].publishedAt, Date.parse('2025-06-10T10:00:00Z'));
  assert.equal(items[1].url, 'https://example.com/two');
  assert.equal(items[1].summary, 'Body');
});

test('garbage input gives an empty list instead of throwing', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
  assert.deepEqual(parseFeed('<html><body>not a feed</body></html>'), []);
  assert.deepEqual(parseFeed('<rss><channel><item><title>broken'), []);
});

test('X timeline normalisation', () => {
  const items = normalizeXTimeline({ data: [{ id: '200', text: 'New &amp; shiny', created_at: '2025-06-10T10:00:00.000Z' }, { id: '100', text: 'Older' }, { text: 'no id' }, null] }, 'FortniteGame');
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://x.com/FortniteGame/status/200');
  assert.equal(items[0].summary, 'New & shiny');
  assert.equal(items[0].publishedAt, Date.parse('2025-06-10T10:00:00.000Z'));
  assert.equal(items[1].publishedAt, null);
  assert.deepEqual(normalizeXTimeline({}, 'x'), []);
  assert.deepEqual(normalizeXTimeline(undefined, 'x'), []);
});

test('only unseen stories are posted, oldest first, and the first run just records', () => {
  const items = [{ id: '3' }, { id: '2' }, { id: '1' }];
  assert.deepEqual(selectNewItems(items, [], { baseline: true }), []);
  assert.deepEqual(selectNewItems(items, ['1']).map((i) => i.id), ['2', '3']);
  assert.deepEqual(selectNewItems(items, ['1', '2', '3']), []);
  assert.deepEqual(selectNewItems(items, [], { limit: 2 }).map((i) => i.id), ['2', '3'], 'keeps the newest ones when capped');
});

test('seen ids are merged newest first and capped', () => {
  assert.deepEqual(mergeSeen(['1', '0'], [{ id: '3' }, { id: '2' }, { id: '1' }]), ['3', '2', '1', '0']);
  const many = Array.from({ length: 150 }, (_, i) => ({ id: String(i) }));
  assert.equal(mergeSeen([], many).length, 100);
});

test('source configuration is sane', () => {
  for (const [key, game] of Object.entries(NEWS_GAMES)) {
    assert.ok(game.label && game.emoji && /^#[0-9a-f]{6}$/i.test(game.color), key);
    assert.ok(game.sources.length > 0);
    for (const source of game.sources) {
      assert.ok(source.label);
      assert.ok(source.type === 'x' ? /^[A-Za-z0-9_]{1,15}$/.test(source.handle) : /^https?:\/\//.test(source.url), `${key} source invalid`);
    }
  }
  assert.equal(sourceKey({ type: 'x', handle: 'FortniteGame' }), 'x:fortnitegame');
  assert.equal(sourceKey({ type: 'rss', url: 'https://a/b' }), 'rss:https://a/b');
});

// ---- X API client with a fake HTTP layer ----

function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    async get(url, options) {
      calls.push({ url, options });
      const route = routes.find((r) => url.includes(r.match));
      if (!route) throw new Error(`unexpected request ${url}`);
      if (route.status) { const error = new Error('http'); error.response = { status: route.status, headers: route.headers || {} }; throw error; }
      return { data: route.body };
    },
  };
}

test('X: missing token gives a clear, user-safe error', async () => {
  resetNewsCaches();
  await assert.rejects(() => fetchXPosts('FortniteGame', { http: fakeHttp([]), token: null }), (error) => error instanceof NewsError && /X_BEARER_TOKEN/.test(error.userMessage));
});

test('X: looks up the account once, then reads only recent original posts', async () => {
  resetNewsCaches();
  const http = fakeHttp([
    { match: '/users/by/username/FortniteGame', body: { data: { id: '42' } } },
    { match: '/users/42/tweets', body: { data: [{ id: '9', text: 'Hello' }] } },
  ]);
  const first = await fetchXPosts('FortniteGame', { http, token: 'TOKEN' });
  await fetchXPosts('FortniteGame', { http, token: 'TOKEN' });
  assert.equal(first[0].id, '9');
  assert.equal(http.calls.filter((c) => c.url.includes('/by/username/')).length, 1, 'user id is cached');
  const timeline = http.calls.find((c) => c.url.includes('/tweets'));
  assert.equal(timeline.options.headers.Authorization, 'Bearer TOKEN');
  assert.equal(timeline.options.params.exclude, 'retweets,replies');
  assert.equal(timeline.options.params.max_results, 5);
});

const rejectsWithUserMessage = (fn, pattern) => assert.rejects(fn, (error) => error instanceof NewsError && pattern.test(error.userMessage));

test('X: error statuses become friendly messages and rate limits pause the source', async () => {
  resetNewsCaches();
  await rejectsWithUserMessage(() => fetchXPosts('A', { http: fakeHttp([{ match: '/by/username/', status: 401 }]), token: 't' }), /rejected/);
  await rejectsWithUserMessage(() => fetchXPosts('B', { http: fakeHttp([{ match: '/by/username/', status: 404 }]), token: 't' }), /could not be found/);
  await rejectsWithUserMessage(() => fetchXPosts('C', { http: fakeHttp([{ match: '/by/username/', status: 500 }]), token: 't' }), /Could not reach X/);

  const now = 1_000_000;
  const limited = fakeHttp([{ match: '/by/username/', status: 429, headers: { 'x-rate-limit-reset': String(now / 1000 + 600) } }]);
  await rejectsWithUserMessage(() => fetchXPosts('D', { http: limited, token: 't', now }), /rate limiting/);
  const quiet = fakeHttp([]);
  await rejectsWithUserMessage(() => fetchXPosts('D', { http: quiet, token: 't', now: now + 1000 }), /rate limiting/);
  assert.equal(quiet.calls.length, 0, 'does not hit X again while paused');
});

test('feeds are fetched with limits and parsed; failures are friendly', async () => {
  resetNewsCaches();
  const http = fakeHttp([{ match: 'example.com/feed', body: RSS }]);
  const items = await fetchFeedItems('https://example.com/feed.xml', { http });
  assert.equal(items.length, 3);
  assert.equal(http.calls[0].options.maxContentLength, 2 * 1024 * 1024);
  assert.equal(http.calls[0].options.timeout, 10000);
  await assert.rejects(() => fetchFeedItems('https://nowhere.test/x', { http: fakeHttp([{ match: 'nowhere', status: 500 }]) }), (e) => e instanceof NewsError);
});

test('on-demand results are cached for ten minutes unless forced', async () => {
  resetNewsCaches();
  const http = fakeHttp([{ match: 'example.com/feed', body: RSS }]);
  const source = { type: 'rss', url: 'https://example.com/feed.xml', label: 'T' };
  const t0 = 5_000_000;
  await fetchSourceItems(source, { http, now: t0 });
  await fetchSourceItems(source, { http, now: t0 + 9 * 60 * 1000 });
  assert.equal(http.calls.length, 1);
  await fetchSourceItems(source, { http, now: t0 + 11 * 60 * 1000 });
  assert.equal(http.calls.length, 2);
  await fetchSourceItems(source, { http, now: t0 + 11 * 60 * 1000 + 1, force: true });
  assert.equal(http.calls.length, 3);
});
