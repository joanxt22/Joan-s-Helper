// Minimal, dependency-free RSS 2.0 / Atom parser plus helpers shared by the news service.
// Pure functions only, so they can be unit tested without any network.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
    return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
            try { return String.fromCodePoint(code); } catch { return match; }
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

/**
 * Unwraps CDATA, decodes entities and collapses whitespace.
 * With `stripHtml` (the default) tags are removed too; titles pass false because they are plain
 * text, where something like "&lt;story&gt;" is a real word and not markup.
 */
export function cleanText(raw, { stripHtml = true } = {}) {
    const decoded = decodeEntities(String(raw ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    return (stripHtml ? decoded.replace(/<[^>]*>/g, ' ') : decoded)
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTag(block, tag, options) {
    const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? cleanText(match[1], options) : '';
}

function extractLink(block, isAtom) {
    if (isAtom) {
        const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
        const alternate = links.find((attrs) => /rel\s*=\s*["']alternate["']/i.test(attrs)) ?? links.find((attrs) => !/rel\s*=/i.test(attrs)) ?? links[0];
        const href = alternate?.match(/href\s*=\s*["']([^"']+)["']/i);
        return href ? decodeEntities(href[1]) : '';
    }
    return extractTag(block, 'link');
}

function toTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @returns {Array<{ id: string, title: string, url: string, summary: string, publishedAt: number|null }>}
 * Items keep the order of the feed (normally newest first).
 */
export function parseFeed(xml) {
    const text = String(xml ?? '');
    const isAtom = /<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text);
    const blocks = [...text.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);

    const items = [];
    for (const block of blocks) {
        const title = extractTag(block, 'title', { stripHtml: false });
        const url = extractLink(block, isAtom);
        const summary = extractTag(block, isAtom ? 'summary' : 'description') || (isAtom ? extractTag(block, 'content') : '');
        const published = extractTag(block, isAtom ? 'published' : 'pubDate') || extractTag(block, 'updated') || extractTag(block, 'dc:date');
        const id = extractTag(block, isAtom ? 'id' : 'guid') || url || title;
        if (!id || (!title && !summary)) continue;
        items.push({ id, title, url, summary, publishedAt: toTimestamp(published) });
    }
    return items;
}

/** Turns an X API v2 timeline response into normalized items (newest first, as the API returns). */
export function normalizeXTimeline(body, handle) {
    const posts = Array.isArray(body?.data) ? body.data : [];
    return posts
        .filter((post) => post?.id && typeof post.text === 'string')
        .map((post) => ({
            id: String(post.id),
            title: '',
            url: `https://x.com/${handle}/status/${post.id}`,
            summary: decodeEntities(post.text).trim(),
            publishedAt: toTimestamp(post.created_at),
        }));
}

/**
 * Splits `items` into those not seen before, oldest first.
 * With `baseline` true (first run for a source) nothing is returned: everything currently
 * visible is just remembered, so setting up news does not dump old stories in the channel.
 */
export function selectNewItems(items, seenIds, { baseline = false, limit = 3 } = {}) {
    if (baseline) return [];
    const seen = new Set(seenIds);
    const fresh = items.filter((item) => !seen.has(item.id));
    return fresh.slice(0, limit).reverse();
}

/** Remembers the newest ids, capped so the stored state never grows without bound. */
export function mergeSeen(seenIds, items, cap = 100) {
    const merged = [...items.map((item) => item.id), ...seenIds.filter((id) => !items.some((item) => item.id === id))];
    return merged.slice(0, cap);
}
