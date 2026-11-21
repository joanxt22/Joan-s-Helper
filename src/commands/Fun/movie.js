import { randomInt } from 'crypto';
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { MOVIE_CATALOG, MOVIE_GENRES, GENRE_LABELS } from '../../config/movies/catalog.js';
import { pickRandom } from '../../services/fun/gameLogic.js';
import {
    MAX_PER_USER,
    MAX_POOL_SIZE,
    parseTitleInput,
    normalizeTitle,
    formatMovie,
    addToPool,
    removeFromPool,
    filterCatalog,
    searchCatalog,
    buildSpinSequence,
    frameWindow,
    getPool,
    updatePool,
} from '../../services/movies/movieLogic.js';
import { renderWheel } from '../../services/movies/wheelRenderer.js';

// Who may remove movies and spin the wheel. Change to PermissionFlagsBits.Administrator
// if only full administrators should be allowed.
const ADMIN_PERMISSION = PermissionFlagsBits.ManageGuild;
const ADMIN_SUBCOMMANDS = new Set(['remove', 'wheel']);

// Pause (ms) before each animation frame; the wheel slows down as it "lands".
const SPIN_DELAYS = [500, 550, 600, 700, 850, 1050, 1300, 1600, 1900];
const FRAME_RADIUS = 2;
const LIST_LIMIT = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

const ADD_FAILURES = {
    empty: 'Please type a movie title.',
    too_long: 'That title is too long (100 characters max).',
    duplicate: 'That movie is already on the list.',
    pool_full: `The list is full (${MAX_POOL_SIZE} movies). Ask an admin to remove some.`,
    user_limit: `You already have ${MAX_PER_USER} movies on the list. Wait until one is picked or removed.`,
};

function frameEmbed(titles, index, landed) {
    const lines = frameWindow(titles, index, FRAME_RADIUS).map(({ offset, title }) =>
        offset === 0 ? `▶ **${clip(title, 45)}** ◀` : `▫ ${clip(title, 45)}`);
    return new EmbedBuilder()
        .setColor(getColor(landed ? 'success' : 'primary'))
        .setTitle(landed ? '🎡 The wheel is stopping...' : '🎡 Spinning the wheel...')
        .setDescription(lines.join('\n'));
}

async function handleRecommend(interaction) {
    const genre = interaction.options.getString('genre');
    const movie = pickRandom(filterCatalog(MOVIE_CATALOG, genre));
    const embed = new EmbedBuilder()
        .setColor(getColor('primary'))
        .setTitle(`🎬 ${formatMovie(movie)}`)
        .setDescription(`Genre: ${movie.genres.map((g) => GENRE_LABELS[g] || g).join(', ')}`)
        .setFooter({ text: 'Want it for movie night? Add it with /movie suggest' });
    return interaction.reply({ embeds: [embed] });
}

async function handleSuggest(interaction, client) {
    const { title, year } = parseTitleInput(interaction.options.getString('title', true));
    const isAdmin = interaction.memberPermissions?.has(ADMIN_PERMISSION) ?? false;

    const result = await updatePool(client, interaction.guildId, (pool) =>
        addToPool(pool, { title, year, userId: interaction.user.id, exemptFromLimit: isAdmin }));

    if (!result.ok) {
        return interaction.reply(ephemeral(ADD_FAILURES[result.reason] || 'Could not add that movie.'));
    }

    const total = (await getPool(client, interaction.guildId)).length;
    const embed = new EmbedBuilder()
        .setColor(getColor('success'))
        .setDescription(`🎬 ${interaction.user} added **${formatMovie(result.movie)}** to the movie list. (${total} on the list)`);
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleList(interaction, client) {
    const pool = await getPool(client, interaction.guildId);
    const shown = pool.slice(0, LIST_LIMIT).map((movie, index) => `**${index + 1}.** ${formatMovie(movie)} — <@${movie.addedBy}>`);
    if (pool.length > LIST_LIMIT) shown.push(`...and ${pool.length - LIST_LIMIT} more`);

    const embed = new EmbedBuilder()
        .setColor(getColor('primary'))
        .setTitle(`🎬 Movie list (${pool.length})`)
        .setDescription(shown.length ? shown.join('\n') : 'Nothing here yet. Add a movie with `/movie suggest`!');
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleRemove(interaction, client) {
    const result = await updatePool(client, interaction.guildId, (pool) =>
        removeFromPool(pool, interaction.options.getString('title', true)));

    if (!result.ok) {
        return interaction.reply(ephemeral(result.reason === 'not_found' ? 'I could not find that movie on the list.' : 'Please type a movie title.'));
    }
    return interaction.reply(ephemeral(`Removed **${formatMovie(result.removed)}** from the list.`));
}

async function handleWheel(interaction, client) {
    const pool = await getPool(client, interaction.guildId);
    if (pool.length < 2) {
        return interaction.reply(ephemeral('The wheel needs at least 2 movies. Members can add some with `/movie suggest`.'));
    }

    const removeWinner = interaction.options.getBoolean('remove_winner') ?? false;
    const titles = pool.map(formatMovie);
    const winnerIndex = randomInt(pool.length);
    const winner = pool[winnerIndex];
    const sequence = buildSpinSequence(pool.length, winnerIndex, SPIN_DELAYS.length + 1);

    await interaction.reply({ embeds: [frameEmbed(titles, sequence[0], false)] });

    try {
        for (let step = 1; step < sequence.length; step += 1) {
            await sleep(SPIN_DELAYS[step - 1]);
            await interaction.editReply({ embeds: [frameEmbed(titles, sequence[step], step === sequence.length - 1)] });
        }
        await sleep(900);

        if (removeWinner) {
            await updatePool(client, interaction.guildId, (current) => removeFromPool(current, formatMovie(winner)));
        }

        const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('🎉 The wheel has spoken!')
            .setDescription(`**${formatMovie(winner)}**\nSuggested by <@${winner.addedBy}>`)
            .setFooter({ text: `${pool.length} movies were on the wheel${removeWinner ? ' • winner removed from the list' : ''}` });

        const payload = { embeds: [embed], allowedMentions: { parse: [] }, files: [] };
        try {
            const image = await renderWheel(titles, winnerIndex);
            if (image) {
                payload.files = [new AttachmentBuilder(image, { name: 'movie-wheel.png' })];
                embed.setImage('attachment://movie-wheel.png');
            }
        } catch (error) {
            logger.warn('Movie wheel image failed, sending text result only', { error: error.message });
        }
        await interaction.editReply(payload);
    } catch (error) {
        logger.error('Movie wheel animation failed:', error);
    }
}

export default {
    slashOnly: true,
    category: 'Fun',
    data: new SlashCommandBuilder()
        .setName('movie')
        .setDescription('Movie recommendations and movie night')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('recommend').setDescription('Get a movie recommendation')
                .addStringOption((o) => o.setName('genre').setDescription('Pick a genre (optional)')
                    .addChoices(...MOVIE_GENRES.map((value) => ({ name: GENRE_LABELS[value], value })))))
        .addSubcommand((sub) =>
            sub.setName('suggest').setDescription('Add a movie to the server list for movie night')
                .addStringOption((o) => o.setName('title').setDescription('Movie title (start typing for suggestions)')
                    .setAutocomplete(true).setMaxLength(100).setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('See every movie members have suggested'))
        .addSubcommand((sub) =>
            sub.setName('remove').setDescription('Remove a movie from the list (admins only)')
                .addStringOption((o) => o.setName('title').setDescription('Movie to remove')
                    .setAutocomplete(true).setMaxLength(100).setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('wheel').setDescription('Spin the wheel over all suggested movies (admins only)')
                .addBooleanOption((o) => o.setName('remove_winner').setDescription('Take the winner off the list afterwards'))),

    async autocomplete(interaction, client) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'title') return interaction.respond([]);

        const subcommand = interaction.options.getSubcommand(false);
        let movies = [];

        if (subcommand === 'suggest') {
            movies = searchCatalog(MOVIE_CATALOG, focused.value, 25);
        } else if (subcommand === 'remove') {
            const key = normalizeTitle(focused.value);
            const pool = await getPool(client, interaction.guildId);
            movies = pool.filter((movie) => !key || normalizeTitle(movie.title).includes(key)).slice(0, 25);
        }

        return interaction.respond(movies.map((movie) => {
            const label = clip(formatMovie(movie), 100);
            return { name: label, value: label };
        }));
    },

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (ADMIN_SUBCOMMANDS.has(subcommand) && !interaction.memberPermissions?.has(ADMIN_PERMISSION)) {
                return await interaction.reply(ephemeral('Only server admins can use that.'));
            }

            switch (subcommand) {
                case 'recommend': return await handleRecommend(interaction);
                case 'suggest': return await handleSuggest(interaction, client);
                case 'list': return await handleList(interaction, client);
                case 'remove': return await handleRemove(interaction, client);
                case 'wheel': return await handleWheel(interaction, client);
                default: return await interaction.reply(ephemeral('Unknown movie action.'));
            }
        } catch (error) {
            logger.error('Movie command error:', error);
            const payload = ephemeral('Something went wrong with the movie command. Please try again.');
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
            else await interaction.reply(payload).catch(() => {});
        }
    },
};
