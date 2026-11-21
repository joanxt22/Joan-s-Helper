// Pure helpers for the /fun commands. No Discord or database access in here,
// so everything can be unit tested (see tests/fun.test.js).

export const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** @returns {'win'|'lose'|'tie'} from the point of view of `player`. */
export function rpsOutcome(player, opponent) {
    if (player === opponent) return 'tie';
    return RPS_BEATS[player] === opponent ? 'win' : 'lose';
}

export const TTT_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

/** `board` is an array of 9 cells: 'X', 'O' or null. */
export function getTicTacToeResult(board) {
    for (const line of TTT_LINES) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], line, draw: false };
        }
    }
    return { winner: null, line: null, draw: board.every(Boolean) };
}

/** 32-bit FNV-1a. Deterministic, so the same inputs always give the same ship/rating. */
export function hashString(text) {
    let hash = 0x811c9dc5;
    const input = String(text);
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** 0-100, identical no matter which order the two ids are given in. */
export function shipPercent(idA, idB) {
    const [first, second] = [String(idA), String(idB)].sort();
    return hashString(`${first}:${second}`) % 101;
}

export function shipVerdict(percent) {
    if (percent >= 90) return 'Soulmates. Start planning the wedding. 💍';
    if (percent >= 75) return 'A fantastic match! 💞';
    if (percent >= 50) return 'There is definitely something there. 💘';
    if (percent >= 25) return 'Maybe as good friends. 🙂';
    return 'Yikes... better stay friends. 💔';
}

export function progressBar(fraction, size = 10, filled = '█', empty = '░') {
    const clamped = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
    const count = Math.round(clamped * size);
    return filled.repeat(count) + empty.repeat(size - count);
}

/** Splits "Alice" + "Bob" into a ship name like "Alob". */
export function blendNames(nameA, nameB) {
    const a = String(nameA).trim();
    const b = String(nameB).trim();
    if (!a || !b) return a || b;
    return a.slice(0, Math.ceil(a.length / 2)) + b.slice(Math.floor(b.length / 2));
}

/** Deterministic 0-10 rating for anything someone types. */
export function ratingFor(thing) {
    return hashString(String(thing).trim().toLowerCase()) % 11;
}

export function pickRandom(list, rng = Math.random) {
    if (!Array.isArray(list) || list.length === 0) return undefined;
    return list[Math.min(Math.floor(rng() * list.length), list.length - 1)];
}

/** Fisher-Yates, returns a new array. */
export function shuffled(list, rng = Math.random) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.min(Math.floor(rng() * (i + 1)), i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** "pizza, tacos | sushi or ramen" -> ['pizza','tacos','sushi','ramen'] (unique, trimmed, capped). */
export function parseChoices(input, { max = 20, maxLength = 100 } = {}) {
    const seen = new Set();
    const result = [];
    for (const part of String(input ?? '').split(/\s*(?:,|\||;|\s+or\s+)\s*/i)) {
        const item = part.trim().slice(0, maxLength);
        const key = item.toLowerCase();
        if (!item || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length >= max) break;
    }
    return result;
}

export const EIGHT_BALL_ANSWERS = [
    'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
    'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
    'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', 'Cannot predict now.',
    'Concentrate and ask again.', "Don't count on it.", 'My reply is no.', 'My sources say no.',
    'Outlook not so good.', 'Very doubtful.',
];

export const ACTIONS = {
    hug: { label: 'Hug', emoji: '🤗', self: '{user} hugs themselves. Sending a real hug your way!', lines: ['{user} gives {target} a big warm hug!', '{user} wraps {target} in a cozy hug.', '{user} squeezes {target} in a bear hug!'] },
    pat: { label: 'Pat', emoji: '🫶', self: '{user} pats their own head. Good job, you!', lines: ['{user} gently pats {target} on the head.', '{user} gives {target} some headpats.', '{user} pats {target}. Good one!'] },
    boop: { label: 'Boop', emoji: '👉', self: '{user} boops their own nose.', lines: ['{user} boops {target} on the nose!', '{user} sneaks up and boops {target}.', 'Boop! {user} got {target}.'] },
    highfive: { label: 'High five', emoji: '🙌', self: '{user} high fives the air. It was a great one.', lines: ['{user} and {target} share an epic high five!', '{user} gives {target} a thunderous high five!', 'Smack! {user} and {target} high five.'] },
    wave: { label: 'Wave', emoji: '👋', self: '{user} waves at everyone.', lines: ['{user} waves at {target}.', '{user} gives {target} a big friendly wave!', '{user} waves hello to {target}.'] },
    poke: { label: 'Poke', emoji: '👆', self: '{user} pokes themselves. Why though?', lines: ['{user} pokes {target}.', '{user} gives {target} a little poke.', 'Poke poke! {user} wants {target}\'s attention.'] },
};

export function renderAction(type, userName, targetName, sameUser, rng = Math.random) {
    const action = ACTIONS[type];
    if (!action) return null;
    const template = sameUser ? action.self : pickRandom(action.lines, rng);
    return template.replaceAll('{user}', userName).replaceAll('{target}', targetName);
}
