// welcomeCardService.js
//
// Generates welcome-card images (avatar + text over a background) and manages
// the custom background image a server admin uploads with `/welcome background`.
//
// Design notes:
// - Discord attachment URLs expire, so an uploaded background is downloaded,
//   resized to the card size, compressed to JPEG and stored in the database.
// - `@napi-rs/canvas` is loaded lazily. If it is missing or fails to load the
//   bot keeps working and the welcome message falls back to a normal embed.
// - Fonts are bundled in src/assets/fonts because slim Docker images (alpine)
//   ship with no system fonts, which would render blank text.

import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, '../assets/fonts');

export const CARD_WIDTH = 1024;
export const CARD_HEIGHT = 450;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MIN_IMAGE_SIDE = 200;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
export const FONT_BOLD = 'WelcomeBold';
export const FONT_REGULAR = 'WelcomeRegular';

export const getWelcomeBackgroundKey = (guildId) => `guild:${guildId}:welcomecard:background`;

/** Error whose `userMessage` is safe to show directly to the person running the command. */
export class WelcomeCardError extends Error {
    constructor(message, userMessage = message) {
        super(message);
        this.name = 'WelcomeCardError';
        this.userMessage = userMessage;
    }
}

let canvasModule = null;
let canvasLoadFailed = false;

/** Lazily loads @napi-rs/canvas with the bundled fonts registered. Returns null if unavailable. */
export async function loadCanvas() {
    if (canvasModule) return canvasModule;
    if (canvasLoadFailed) return null;

    try {
        const mod = await import('@napi-rs/canvas');
        mod.GlobalFonts.registerFromPath(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'), FONT_BOLD);
        mod.GlobalFonts.registerFromPath(path.join(FONT_DIR, 'DejaVuSans.ttf'), FONT_REGULAR);
        canvasModule = mod;
        return canvasModule;
    } catch (error) {
        canvasLoadFailed = true;
        logger.warn('Welcome cards disabled: could not load @napi-rs/canvas. Run `npm install` to enable them.', {
            error: error.message,
        });
        return null;
    }
}

/** True when image generation is available on this machine. */
export async function isWelcomeCardAvailable() {
    return (await loadCanvas()) !== null;
}

async function downloadBuffer(url, maxBytes) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
    });
    return Buffer.from(response.data);
}

function isDiscordCdnUrl(rawUrl) {
    try {
        const { protocol, hostname } = new URL(rawUrl);
        if (protocol !== 'https:') return false;
        return (
            hostname === 'cdn.discordapp.com' ||
            hostname === 'media.discordapp.net' ||
            hostname.endsWith('.discordapp.com') ||
            hostname.endsWith('.discordapp.net')
        );
    } catch {
        return false;
    }
}

/** Draws `image` so it fully covers the target rectangle (like CSS `object-fit: cover`). */
function drawCover(ctx, image, x, y, width, height) {
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

/**
 * Validates an uploaded attachment and converts it into a card-sized JPEG.
 * @returns {Promise<{ base64: string, sourceWidth: number, sourceHeight: number }>}
 */
export async function processBackgroundUpload(attachment) {
    const canvas = await loadCanvas();
    if (!canvas) {
        throw new WelcomeCardError(
            'Canvas unavailable',
            'Image generation is not installed on this bot yet. Run `npm install` and restart the bot.',
        );
    }

    const mime = String(attachment?.contentType || '').split(';')[0].trim().toLowerCase();
    const extension = String(attachment?.name || '').split('.').pop().toLowerCase();
    const typeOk = ALLOWED_MIME_TYPES.has(mime) || (!mime && ALLOWED_EXTENSIONS.has(extension));
    if (!typeOk) {
        throw new WelcomeCardError('Unsupported file type', 'Please upload a **PNG, JPG, WEBP or GIF** image.');
    }

    if (attachment.size > MAX_UPLOAD_BYTES) {
        throw new WelcomeCardError('File too large', 'That image is too large. Please upload one under **8 MB**.');
    }

    if (!isDiscordCdnUrl(attachment.url)) {
        throw new WelcomeCardError('Attachment is not on the Discord CDN', 'That attachment could not be verified. Please upload the image directly.');
    }

    let raw;
    try {
        raw = await downloadBuffer(attachment.url, MAX_UPLOAD_BYTES);
    } catch (error) {
        logger.warn('Failed to download welcome background', { error: error.message });
        throw new WelcomeCardError('Download failed', 'I could not download that image. Please try uploading it again.');
    }

    let image;
    try {
        image = await canvas.loadImage(raw);
    } catch {
        throw new WelcomeCardError('Undecodable image', 'That file could not be read as an image. Try a different PNG or JPG.');
    }

    if (image.width < MIN_IMAGE_SIDE || image.height < MIN_IMAGE_SIDE) {
        throw new WelcomeCardError('Image too small', `That image is too small. Use one at least **${MIN_IMAGE_SIDE}×${MIN_IMAGE_SIDE}** pixels (**${CARD_WIDTH}×${CARD_HEIGHT}** looks best).`);
    }

    const out = canvas.createCanvas(CARD_WIDTH, CARD_HEIGHT);
    drawCover(out.getContext('2d'), image, 0, 0, CARD_WIDTH, CARD_HEIGHT);

    return {
        base64: out.toBuffer('image/jpeg', 85).toString('base64'),
        sourceWidth: image.width,
        sourceHeight: image.height,
    };
}

export async function saveWelcomeBackground(client, guildId, base64) {
    await client.db.set(getWelcomeBackgroundKey(guildId), { data: base64, updatedAt: Date.now() });
}

/** @returns {Promise<Buffer|null>} */
export async function getWelcomeBackground(client, guildId) {
    try {
        const stored = await client.db.get(getWelcomeBackgroundKey(guildId), null);
        if (stored && typeof stored.data === 'string' && stored.data.length > 0) {
            return Buffer.from(stored.data, 'base64');
        }
    } catch (error) {
        logger.warn(`Failed to read welcome background for guild ${guildId}`, { error: error.message });
    }
    return null;
}

export async function clearWelcomeBackground(client, guildId) {
    await client.db.delete(getWelcomeBackgroundKey(guildId));
}

/** DejaVu has no emoji glyphs; strip them so text doesn't render as empty boxes. */
export function stripUnrenderable(text) {
    return String(text ?? '')
        .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function cleanDisplayName(name) {
    return stripUnrenderable(name) || 'New Member';
}

function fitText(ctx, text, fontFamily, weightPrefix, startSize, minSize, maxWidth) {
    let size = startSize;
    ctx.font = `${weightPrefix}${size}px ${fontFamily}`;
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
        size -= 2;
        ctx.font = `${weightPrefix}${size}px ${fontFamily}`;
    }

    if (ctx.measureText(text).width <= maxWidth) return text;

    let trimmed = text;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed.trimEnd()}…`;
}

/**
 * Renders the welcome card.
 * @param {object} options
 * @param {import('discord.js').User} options.user
 * @param {import('discord.js').Guild} options.guild
 * @param {Buffer|null} [options.background] Custom background (any image Buffer).
 * @param {string} [options.title] Big heading, defaults to WELCOME.
 * @returns {Promise<Buffer|null>} PNG buffer, or null when image generation is unavailable.
 */
export async function renderWelcomeCard({ user, guild, background = null, title = 'WELCOME' }) {
    const canvas = await loadCanvas();
    if (!canvas) return null;

    const surface = canvas.createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = surface.getContext('2d');

    // Background: custom upload, or a default gradient.
    let drewBackground = false;
    if (background) {
        try {
            drawCover(ctx, await canvas.loadImage(background), 0, 0, CARD_WIDTH, CARD_HEIGHT);
            drewBackground = true;
        } catch (error) {
            logger.warn('Stored welcome background could not be drawn, using default', { error: error.message });
        }
    }
    if (!drewBackground) {
        const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
        gradient.addColorStop(0, '#4f46e5');
        gradient.addColorStop(1, '#9333ea');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    }

    // Darken so white text stays readable on any background.
    const shade = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.20)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.70)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Avatar (circular, white ring).
    const centerX = CARD_WIDTH / 2;
    const centerY = 155;
    const radius = 100;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    try {
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
        const avatar = await canvas.loadImage(await downloadBuffer(avatarUrl, 4 * 1024 * 1024));
        ctx.drawImage(avatar, centerX - radius, centerY - radius, radius * 2, radius * 2);
    } catch (error) {
        logger.debug('Could not load avatar for welcome card, drawing placeholder', { error: error.message });
        ctx.fillStyle = '#5865f2';
        ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        ctx.fillStyle = '#ffffff';
        ctx.font = `120px ${FONT_BOLD}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cleanDisplayName(user.username).charAt(0).toUpperCase(), centerX, centerY + 6);
    }
    ctx.restore();

    // Text.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 10;

    const heading = fitText(ctx, (stripUnrenderable(title) || 'WELCOME').toUpperCase(), FONT_BOLD, '', 54, 28, CARD_WIDTH - 120);
    ctx.fillText(heading, centerX, 318);

    const name = fitText(ctx, cleanDisplayName(user.globalName || user.username), FONT_BOLD, '', 42, 22, CARD_WIDTH - 120);
    ctx.fillText(name, centerX, 372);

    const memberNumber = Number(guild.memberCount || 0).toLocaleString('en-US');
    const subtitle = fitText(ctx, `Member #${memberNumber}  •  ${cleanDisplayName(guild.name)}`, FONT_REGULAR, '', 26, 16, CARD_WIDTH - 120);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillText(subtitle, centerX, 416);

    return surface.toBuffer('image/png');
}
