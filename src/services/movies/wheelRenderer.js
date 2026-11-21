import { loadCanvas, FONT_BOLD, FONT_REGULAR, stripUnrenderable } from '../welcomeCardService.js';
import { wheelRotation } from './movieLogic.js';

const SIZE = 640;
const BANNER_HEIGHT = 110;
const MAX_LABELLED_SEGMENTS = 16;
const PALETTE = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e84393', '#00b894', '#0984e3', '#6c5ce7', '#fd79a8'];

function fitToWidth(ctx, text, family, startSize, minSize, maxWidth) {
    let size = startSize;
    ctx.font = `${size}px ${family}`;
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
        size -= 2;
        ctx.font = `${size}px ${family}`;
    }
    let result = text;
    while (result.length > 1 && ctx.measureText(result).width > maxWidth) {
        result = `${result.slice(0, -2).trimEnd()}…`;
    }
    return result;
}

/**
 * Draws the wheel with every entry, stopped with the winner under the pointer at the top.
 * With more than 16 entries the slices are too thin to label, so only the winner is named in the banner.
 * @returns {Promise<Buffer|null>} PNG, or null if image generation is unavailable
 */
export async function renderWheel(titles, winnerIndex) {
    const canvas = await loadCanvas();
    if (!canvas || titles.length < 2) return null;

    const surface = canvas.createCanvas(SIZE, SIZE + BANNER_HEIGHT);
    const ctx = surface.getContext('2d');

    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, SIZE, SIZE + BANNER_HEIGHT);

    const count = titles.length;
    const slice = (Math.PI * 2) / count;
    const rotation = wheelRotation(winnerIndex, count);
    const centerX = SIZE / 2;
    const centerY = SIZE / 2 + 14;
    const radius = SIZE / 2 - 44;

    const colorFor = (index) => {
        // avoid the last slice matching the first when the count wraps the palette
        if (index === count - 1 && count % PALETTE.length === 1) return PALETTE[(index + 3) % PALETTE.length];
        return PALETTE[index % PALETTE.length];
    };

    for (let i = 0; i < count; i += 1) {
        const start = -Math.PI / 2 + rotation + i * slice;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, start, start + slice);
        ctx.closePath();
        ctx.fillStyle = colorFor(i);
        ctx.fill();
        if (i !== winnerIndex) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
            ctx.fill();
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1e1f22';
        ctx.stroke();
    }

    // Winner outline on top of the neighbours.
    const winnerStart = -Math.PI / 2 + rotation + winnerIndex * slice;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, winnerStart, winnerStart + slice);
    ctx.closePath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    if (count <= MAX_LABELLED_SEGMENTS) {
        for (let i = 0; i < count; i += 1) {
            const middle = -Math.PI / 2 + rotation + (i + 0.5) * slice;
            // Labels on the left half would read upside down, so flip those to read left-to-right.
            const normalized = ((middle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const flipped = normalized > Math.PI / 2 && normalized < (Math.PI * 3) / 2;
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(flipped ? middle + Math.PI : middle);
            ctx.textAlign = flipped ? 'left' : 'right';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = 4;
            const label = fitToWidth(ctx, stripUnrenderable(titles[i]) || '?', i === winnerIndex ? FONT_BOLD : FONT_REGULAR, count > 10 ? 15 : 19, 11, radius - 60);
            ctx.fillText(label, flipped ? -(radius - 14) : radius - 14, 0);
            ctx.restore();
        }
    }

    // Hub and pointer.
    ctx.beginPath();
    ctx.arc(centerX, centerY, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1f22';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX - 20, centerY - radius - 26);
    ctx.lineTo(centerX + 20, centerY - radius - 26);
    ctx.lineTo(centerX, centerY - radius + 12);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1e1f22';
    ctx.stroke();

    // Winner banner.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = `22px ${FONT_REGULAR}`;
    ctx.fillText("Tonight's movie", SIZE / 2, SIZE + 38);
    ctx.fillStyle = '#ffffff';
    const winnerText = fitToWidth(ctx, stripUnrenderable(titles[winnerIndex]) || 'Winner', FONT_BOLD, 38, 18, SIZE - 60);
    ctx.fillText(winnerText, SIZE / 2, SIZE + 86);

    return surface.toBuffer('image/png');
}
