import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';

const COUNTING_GAME_KEY_PREFIX = 'countingGame:';

const COUNTING_SYSTEMS = {
  decimal: {
    label: 'Decimal',
    description: 'Standard 10-number system using 0-9',
    toString: (n) => n.toString(10),
    parse: (value) => {
      if (!/^[0-9]+$/.test(value)) return null;
      return Number(value);
    },
  },
  hexadecimal: {
    label: 'Hexadecimal',
    description: '16-number system using 0-9 and A-F',
    toString: (n) => n.toString(16).toUpperCase(),
    parse: (value) => {
      if (!/^[0-9A-Fa-f]+$/.test(value)) return null;
      return parseInt(value, 16);
    },
  },
  binary: {
    label: 'Binary',
    description: '2-number system using 0-1',
    toString: (n) => n.toString(2),
    parse: (value) => {
      if (!/^[01]+$/.test(value)) return null;
      return parseInt(value, 2);
    },
  },
  base36: {
    label: 'Base36',
    description: '36-number system using 0-9 and A-Z',
    toString: (n) => n.toString(36).toUpperCase(),
    parse: (value) => {
      if (!/^[0-9A-Za-z]+$/.test(value)) return null;
      return parseInt(value, 36);
    },
  },
  base64: {
    label: 'Base64',
    description: '64-number system using A-Z, a-z, 0-9, +, /',
    alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    toString: (n) => {
      if (n === 0) return 'A';
      const alphabet = COUNTING_SYSTEMS.base64.alphabet;
      let value = n;
      let result = '';
      while (value > 0) {
        const remainder = value % 64;
        result = alphabet[remainder] + result;
        value = Math.floor(value / 64);
      }
      return result;
    },
    parse: (value) => {
      const alphabet = COUNTING_SYSTEMS.base64.alphabet;
      const normalized = value.replace(/=+$/, '');
      if (!/^[A-Za-z0-9+/]+$/.test(normalized)) {
        return null;
      }
      let result = 0;
      for (const char of normalized) {
        const index = alphabet.indexOf(char);
        if (index === -1) return null;
        result = result * 64 + index;
      }
      return result;
    },
  },
  roman: {
    label: 'Roman',
    description: 'Roman numerals like I, II, III, IV, V',
    toString: (n) => {
      const romanNumerals = [
        ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
        ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
        ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
      ];
      let num = n;
      let result = '';
      for (const [roman, value] of romanNumerals) {
        while (num >= value) {
          result += roman;
          num -= value;
        }
      }
      return result;
    },
    parse: (value) => {
      const roman = value.toUpperCase();
      if (!/^[IVXLCDM]+$/.test(roman)) return null;
      const romanValues = {
        I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
      };
      let total = 0;
      let prev = 0;
      for (let i = roman.length - 1; i >= 0; i--) {
        const current = romanValues[roman[i]];
        if (!current) return null;
        if (current < prev) {
          total -= current;
        } else {
          total += current;
          prev = current;
        }
      }
      return total;
    },
  },
  math: {
    label: 'Math Expressions',
    description: 'Use a math expression that equals the next number, like 4*4=16',
    toString: (n) => `${n}`,
    parse: (value) => {
      const expression = value.replace(/\s+/g, '');
      if (expression.length === 0) return null;
      const sanitized = expression.replace(/\^/g, '**');
      if (!/^[0-9+\-*/().=**]+$/.test(sanitized)) return null;
      const parts = sanitized.split('=');
      try {
        const evaluate = (expr) => {
          if (!expr || /[^0-9+\-*/().]/.test(expr)) return null;
          // eslint-disable-next-line no-new-func
          return Function(`"use strict"; return (${expr});`)();
        };

        if (parts.length === 1) {
          return Number(evaluate(parts[0]));
        }
        if (parts.length === 2) {
          const left = evaluate(parts[0]);
          const right = evaluate(parts[1]);
          if (left === right) {
            return Number(left);
          }
          return null;
        }
      } catch {
        return null;
      }
      return null;
    },
  },
  alphabet: {
    label: 'Alphabet',
    description: 'Letters A-Z in sequence',
    toString: (n) => {
      let num = n;
      let result = '';
      while (num > 0) {
        num -= 1;
        result = String.fromCharCode(65 + (num % 26)) + result;
        num = Math.floor(num / 26);
      }
      return result;
    },
    parse: (value) => {
      const letters = value.toUpperCase();
      if (!/^[A-Z]+$/.test(letters)) return null;
      let result = 0;
      for (const char of letters) {
        result = result * 26 + (char.charCodeAt(0) - 64);
      }
      return result;
    },
  },
};

const DEFAULT_MAX_SAVES = 3;
const MAX_SAVES_LIMIT = 5;
const SAVE_EARNED_EVERY = 100;
const MILESTONE_EVERY = 100;
const NOTICE_LIFETIME_MS = 10000;

const DEFAULT_COUNTING_GAME = {
  enabled: false,
  channelId: null,
  system: 'decimal',
  nextNumber: 1,
  lastUserId: null,
  currentStreak: 0,
  bestStreak: 0,
  highScore: 0,
  leaderboard: {},
  ruins: {},
  // When false (default) normal chat in the counting channel is ignored.
  // When true every message in the channel must be the next number.
  strict: false,
  // Shared "lives": a mistake uses one save instead of resetting the count.
  saves: DEFAULT_MAX_SAVES,
  maxSaves: DEFAULT_MAX_SAVES,
};

function clampSaves(value, max) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0;
  return Math.min(Math.max(number, 0), max);
}

function normalizeCountingGame(state) {
  const normalized = {
    ...DEFAULT_COUNTING_GAME,
    ...(state || {}),
  };

  normalized.system = COUNTING_SYSTEMS[normalized.system] ? normalized.system : 'decimal';
  normalized.leaderboard = normalized.leaderboard && typeof normalized.leaderboard === 'object'
    ? { ...normalized.leaderboard }
    : {};
  normalized.ruins = normalized.ruins && typeof normalized.ruins === 'object'
    ? { ...normalized.ruins }
    : {};
  normalized.strict = Boolean(normalized.strict);
  normalized.maxSaves = clampSaves(normalized.maxSaves, MAX_SAVES_LIMIT);
  normalized.saves = clampSaves(normalized.saves, normalized.maxSaves);
  normalized.highScore = Math.max(Number(normalized.highScore) || 0, 0);

  return normalized;
}

function getStorageKey(guildId) {
  return `${COUNTING_GAME_KEY_PREFIX}${guildId}`;
}

export async function getCountingGameConfig(client, guildId) {
  try {
    const rawState = await client.db.get(getStorageKey(guildId));
    return normalizeCountingGame(rawState);
  } catch (error) {
    logger.error('Failed to load counting game config:', { guildId, error });
    return normalizeCountingGame();
  }
}

export async function saveCountingGameConfig(client, guildId, state) {
  const normalized = normalizeCountingGame(state);
  await client.db.set(getStorageKey(guildId), normalized);
  return normalized;
}

export async function disableCountingGame(client, guildId) {
  const config = await getCountingGameConfig(client, guildId);
  return saveCountingGameConfig(client, guildId, { ...config, enabled: false });
}

export async function resetCountingGame(client, guildId, startNumber = 1) {
  const config = await getCountingGameConfig(client, guildId);
  return saveCountingGameConfig(client, guildId, {
    ...config,
    nextNumber: startNumber,
    lastUserId: null,
    currentStreak: 0,
  });
}

/** Admin settings: `strict` and `maxSaves` (saves are topped up to the new max). */
export async function updateCountingSettings(client, guildId, { strict, maxSaves } = {}) {
  return Mutex.runExclusive(`counting:${guildId}`, async () => {
    const config = await getCountingGameConfig(client, guildId);
    const next = { ...config };
    if (typeof strict === 'boolean') next.strict = strict;
    if (Number.isInteger(maxSaves)) {
      next.maxSaves = clampSaves(maxSaves, MAX_SAVES_LIMIT);
      next.saves = next.maxSaves;
    }
    return saveCountingGameConfig(client, guildId, next);
  });
}

/** Pure helper: returns the next state after a correct count by `userId`. */
export function applyCorrectCount(config, userId) {
  const counted = config.nextNumber || 1;
  const leaderboard = { ...config.leaderboard };
  leaderboard[userId] = (leaderboard[userId] || 0) + 1;

  const currentStreak = (config.currentStreak || 0) + 1;
  const earnedSave = counted % SAVE_EARNED_EVERY === 0 && config.saves < config.maxSaves;

  const updated = {
    ...config,
    leaderboard,
    lastUserId: userId,
    currentStreak,
    bestStreak: Math.max(config.bestStreak || 0, currentStreak),
    highScore: Math.max(config.highScore || 0, counted),
    nextNumber: counted + 1,
    saves: earnedSave ? config.saves + 1 : config.saves,
  };

  return {
    config: updated,
    counted,
    earnedSave,
    isMilestone: counted % MILESTONE_EVERY === 0,
  };
}

export async function recordCorrectCount(client, guildId, userId) {
  const config = await getCountingGameConfig(client, guildId);
  const { config: updated } = applyCorrectCount(config, userId);
  return saveCountingGameConfig(client, guildId, updated);
}

export function getCountingSystemChoices() {
  return Object.entries(COUNTING_SYSTEMS).map(([value, system]) => ({
    name: system.label,
    value,
  }));
}

export function getCountingSystemLabel(systemKey) {
  return COUNTING_SYSTEMS[systemKey]?.label || COUNTING_SYSTEMS.decimal.label;
}

export function getExpectedCountValue(config) {
  const system = COUNTING_SYSTEMS[config.system] ? config.system : 'decimal';
  return COUNTING_SYSTEMS[system].toString(config.nextNumber || 1);
}

export function isValidCountingMessage(content, config) {
  const trimmed = content.trim();
  const system = COUNTING_SYSTEMS[config.system] ? config.system : 'decimal';
  const current = COUNTING_SYSTEMS[system];
  if (system === 'math') {
    const parsedValue = current.parse(trimmed);
    return parsedValue === config.nextNumber;
  }

  const expected = current.toString(config.nextNumber || 1);
  if (system === 'alphabet' || system === 'roman') {
    return trimmed.toUpperCase() === expected.toUpperCase();
  }
  return trimmed === expected;
}

const ATTEMPT_PATTERNS = {
  decimal: /^[0-9]+$/,
  hexadecimal: /^[0-9a-f]+$/i,
  binary: /^[01]+$/,
  base36: /^[0-9a-z]+$/i,
  base64: /^[A-Za-z0-9+/]+=*$/,
  roman: /^[ivxlcdm]+$/i,
  alphabet: /^[a-z]+$/i,
  math: /^[0-9(][0-9+\-*/^().=\s]*$/,
};

/**
 * In non-strict mode, only messages that look like an attempt at a number in
 * the active system can break the count. Everything else is just chat.
 */
export function looksLikeCountAttempt(content, config) {
  const trimmed = String(content ?? '').trim();
  if (!trimmed) return false;
  const pattern = ATTEMPT_PATTERNS[config.system] || ATTEMPT_PATTERNS.decimal;
  return pattern.test(trimmed);
}

export async function activateCountingGame(client, guildId, channelId, system = 'decimal') {
  const normalizedSystem = COUNTING_SYSTEMS[system] ? system : 'decimal';
  const previous = await getCountingGameConfig(client, guildId);
  const config = normalizeCountingGame({
    enabled: true,
    channelId,
    system: normalizedSystem,
    nextNumber: 1,
    lastUserId: null,
    currentStreak: 0,
    bestStreak: 0,
    highScore: 0,
    leaderboard: {},
    ruins: {},
    // Keep the admin's earlier settings when a game is set up again.
    strict: previous.strict,
    maxSaves: previous.maxSaves,
    saves: previous.maxSaves,
  });

  return saveCountingGameConfig(client, guildId, config);
}

export function buildCountingLeaderboard(config) {
  const entries = Object.entries(config.leaderboard || {});
  if (entries.length === 0) {
    return [];
  }

  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count], index) => {
      const medal = ['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`;
      return `${medal} <@${userId}> — ${count} ${count === 1 ? 'count' : 'counts'}`;
    });
}

export function getUserCountingStats(config, userId) {
  const correct = config.leaderboard?.[userId] || 0;
  const ruins = config.ruins?.[userId] || 0;
  const ranked = Object.entries(config.leaderboard || {}).sort((a, b) => b[1] - a[1]);
  const position = ranked.findIndex(([id]) => id === userId);
  const attempts = correct + ruins;

  return {
    correct,
    ruins,
    rank: position === -1 ? null : position + 1,
    totalPlayers: ranked.length,
    accuracy: attempts === 0 ? null : Math.round((correct / attempts) * 1000) / 10,
  };
}

function sendTemporaryNotice(channel, content) {
  channel
    .send(content)
    .then((notice) => {
      const timer = setTimeout(() => notice.delete().catch(() => {}), NOTICE_LIFETIME_MS);
      if (typeof timer.unref === 'function') timer.unref();
    })
    .catch(() => {});
}

/**
 * Handles a message posted in a guild. Returns true when the message belonged to the
 * counting game (so XP and prefix commands should be skipped), false otherwise.
 * Everything that reads and writes the game state runs inside a per-guild lock so two
 * people counting at the same moment can't corrupt the sequence.
 */
export async function processCountingMessage(client, message) {
  try {
    const guildId = message.guild.id;

    const quick = await getCountingGameConfig(client, guildId);
    if (!quick.enabled || !quick.channelId || message.channel.id !== quick.channelId) {
      return false;
    }

    return await Mutex.runExclusive(`counting:${guildId}`, async () => {
      const config = await getCountingGameConfig(client, guildId);
      if (!config.enabled || message.channel.id !== config.channelId) {
        return false;
      }

      const content = message.content.trim();
      if (!config.strict && !looksLikeCountAttempt(content, config)) {
        return false;
      }

      const userId = message.author.id;
      const correctNumber = isValidCountingMessage(content, config);
      const countedTwice = correctNumber && userId === config.lastUserId;

      if (correctNumber && !countedTwice) {
        const result = applyCorrectCount(config, userId);
        await saveCountingGameConfig(client, guildId, result.config);

        await message.react('✅').catch(() => {});
        if (result.isMilestone) {
          await message.react('💯').catch(() => {});
          const saveLine = result.earnedSave
            ? ` A save was earned (**${result.config.saves}/${result.config.maxSaves}**).`
            : '';
          await message.channel.send(`🎉 We reached **${result.counted}**!${saveLine}`).catch(() => {});
        }
        return true;
      }

      // Mistake: wrong number, or the same person counting twice in a row.
      await message.delete().catch(() => {});
      const ruins = { ...config.ruins, [userId]: (config.ruins[userId] || 0) + 1 };
      const what = countedTwice ? 'counted twice in a row' : 'got the wrong number';

      if (config.saves > 0) {
        const saves = config.saves - 1;
        await saveCountingGameConfig(client, guildId, { ...config, saves, ruins });
        sendTemporaryNotice(
          message.channel,
          `⚠️ <@${userId}> ${what}, but a save kept the count alive! **${saves}/${config.maxSaves}** saves left. Next number: **${getExpectedCountValue(config)}**`,
        );
        return true;
      }

      await saveCountingGameConfig(client, guildId, {
        ...config,
        nextNumber: 1,
        lastUserId: null,
        currentStreak: 0,
        ruins,
      });
      const lost = config.currentStreak > 0 ? ` The streak of **${config.currentStreak}** is over.` : '';
      sendTemporaryNotice(
        message.channel,
        `❌ <@${userId}> ${what}.${lost} The sequence has been reset to **1**.`,
      );
      return true;
    });
  } catch (error) {
    logger.error('Error handling counting game:', error);
    return false;
  }
}
