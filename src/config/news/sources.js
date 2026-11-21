// Where /news and the automatic news posts get their stories.
//
// type 'x'   : an account's recent posts through the official X API v2.
//              Needs X_BEARER_TOKEN in .env (reading posts needs a paid X API plan).
// type 'rss' : any RSS 2.0 or Atom feed URL. No key needed.
//
// IMPORTANT: the handles below are the official accounts as far as the author knows, but
// they could not be verified from the build environment. Open each one in a browser once
// and confirm it is the real, verified account before you rely on it.
// To add a feed, add an entry like:
//   { type: 'rss', url: 'https://example.com/feed.xml', label: 'Example News' }

export const NEWS_GAMES = {
    fortnite: {
        label: 'Fortnite',
        emoji: '🪂',
        color: '#8b5cf6',
        sources: [{ type: 'x', handle: 'FortniteGame', label: 'Fortnite on X' }],
    },
    roblox: {
        label: 'Roblox',
        emoji: '🧱',
        color: '#e2231a',
        sources: [{ type: 'x', handle: 'Roblox', label: 'Roblox on X' }],
    },
    minecraft: {
        label: 'Minecraft',
        emoji: '⛏️',
        color: '#57a64a',
        sources: [{ type: 'x', handle: 'Minecraft', label: 'Minecraft on X' }],
    },
};

export const NEWS_GAME_KEYS = Object.keys(NEWS_GAMES);

/** Stable id for a source, used for caching and for remembering what was already posted. */
export const sourceKey = (source) => (source.type === 'x' ? `x:${source.handle.toLowerCase()}` : `rss:${source.url}`);
