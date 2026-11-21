import { getColor } from '../../config/bot.js';
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    AttachmentBuilder,
} from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage, truncateForEmbedField } from '../../utils/welcome.js';
import {
    isWelcomeCardAvailable,
    processBackgroundUpload,
    saveWelcomeBackground,
    getWelcomeBackground,
    clearWelcomeBackground,
    renderWelcomeCard,
    WelcomeCardError,
    CARD_WIDTH,
    CARD_HEIGHT,
} from '../../services/welcomeCardService.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';

const CARD_FILE_NAME = 'welcome-card.png';

async function buildCardAttachment(client, guild, user, title) {
    const background = await getWelcomeBackground(client, guild.id);
    const png = await renderWelcomeCard({ user, guild, background, title: title || 'WELCOME' });
    return png ? new AttachmentBuilder(png, { name: CARD_FILE_NAME }) : null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configure the welcome system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up the welcome message')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to send welcome messages to')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Welcome message. Variables: {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL of the image to include in the welcome message')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Whether to ping the user in the welcome message')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('background')
                .setDescription('Upload a custom background image for the welcome card')
                .addAttachmentOption(option =>
                    option.setName('image')
                        .setDescription(`PNG, JPG, WEBP or GIF, under 8 MB (${CARD_WIDTH}x${CARD_HEIGHT} looks best)`)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-background')
                .setDescription('Remove the custom background and use the default look'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('card')
                .setDescription('Turn the welcome image card on or off, or change its heading')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Send a welcome image card with each new member')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Big heading on the card (default: WELCOME)')
                        .setMaxLength(30)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('preview')
                .setDescription('Preview the welcome card as it will look for you')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            const deferSuccess = await InteractionHelper.safeDefer(
                interaction,
                subcommand === 'setup' ? {} : { flags: MessageFlags.Ephemeral },
            );
            if (!deferSuccess) {
                logger.warn(`Welcome interaction defer failed`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'welcome'
                });
                return;
            }
        } catch (deferError) {
            logger.error(`Welcome defer error`, { error: deferError.message });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need the **Manage Server** permission to use `/welcome`.' });
        }

        switch (subcommand) {
            case 'setup':
                return await handleSetup(interaction);
            case 'background':
                return await handleBackground(interaction);
            case 'remove-background':
                return await handleRemoveBackground(interaction);
            case 'card':
                return await handleCard(interaction);
            case 'preview':
                return await handlePreview(interaction);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Unknown welcome action.' });
        }
    },
};

async function handleSetup(interaction) {
    const { options, guild, client } = interaction;
    const channel = options.getChannel('channel');
    const message = options.getString('message');
    const image = options.getString('image');
    const ping = options.getBoolean('ping') ?? false;

    const existingConfig = await getWelcomeConfig(client, guild.id);
    if (existingConfig?.channelId) {
        logger.info(`[Welcome] Setup blocked because config already exists in channel ${existingConfig.channelId} for guild ${guild.id}`);
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Welcome is already configured for <#${existingConfig.channelId}>. Use **/greet dashboard** to customize channel, message, ping, or image.` });
    }

    if (!message || message.trim().length === 0) {
        logger.warn(`[Welcome] Empty message provided by ${interaction.user.tag} in ${guild.name}`);
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Welcome message cannot be empty' });
    }

    if (image) {
        try {
            new URL(image);
        } catch (e) {
            logger.warn(`[Welcome] Invalid image URL provided by ${interaction.user.tag}: ${image}`);
            return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please provide a valid image URL (must start with http:// or https://' });
        }
    }

    try {
        await updateWelcomeConfig(client, guild.id, {
            enabled: true,
            channelId: channel.id,
            welcomeMessage: message,
            welcomeImage: image || undefined,
            welcomePing: ping
        });

        logger.info(`[Welcome] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

        const previewMessage = formatWelcomeMessage(message, {
            user: interaction.user,
            guild
        });

        const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('Welcome System Configured')
            .setDescription(`Welcome messages will now be sent to ${channel}`)
            .addFields(
                { name: 'Message Preview', value: truncateForEmbedField(previewMessage) },
                { name: 'Ping User', value: ping ? 'Yes' : 'No' },
                { name: 'Status', value: 'Enabled' }
            )
            .setFooter({ text: 'Tip: /welcome background lets you upload your own welcome card image' });

        if (image) {
            embed.setImage(image);
        }

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error(`[Welcome] Failed to setup welcome system for guild ${guild.id}:`, error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while configuring the welcome system. Please try again.' });
    }
}

async function handleBackground(interaction) {
    const { options, guild, client } = interaction;

    try {
        const attachment = options.getAttachment('image', true);
        const processed = await processBackgroundUpload(attachment);

        await saveWelcomeBackground(client, guild.id, processed.base64);
        const config = await updateWelcomeConfig(client, guild.id, { cardEnabled: true });

        const preview = await buildCardAttachment(client, guild, interaction.user, config.cardTitle);

        const notes = [`Saved **${processed.sourceWidth}×${processed.sourceHeight}** image as your welcome card background.`];
        if (!config.enabled || !config.channelId) {
            notes.push('Welcome messages are not on yet. Run `/welcome setup` to pick the channel.');
        }
        notes.push('Use `/welcome remove-background` to go back to the default look.');

        const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('Welcome Background Updated')
            .setDescription(notes.join('\n'));

        const payload = { embeds: [embed] };
        if (preview) {
            embed.setImage(`attachment://${CARD_FILE_NAME}`);
            embed.setFooter({ text: 'Preview shown with your own name and avatar' });
            payload.files = [preview];
        }

        await InteractionHelper.safeEditReply(interaction, payload);
    } catch (error) {
        if (error instanceof WelcomeCardError) {
            return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: error.userMessage });
        }
        logger.error(`[Welcome] Failed to save background for guild ${guild.id}:`, error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Something went wrong while saving that image. Please try again.' });
    }
}

async function handleRemoveBackground(interaction) {
    const { guild, client } = interaction;

    try {
        await clearWelcomeBackground(client, guild.id);
        const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('Welcome Background Removed')
            .setDescription('The welcome card will use the default purple gradient. Use `/welcome background` to upload a new one.');
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error(`[Welcome] Failed to remove background for guild ${guild.id}:`, error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Something went wrong while removing the background.' });
    }
}

async function handleCard(interaction) {
    const { options, guild, client } = interaction;
    const enabled = options.getBoolean('enabled', true);
    const title = options.getString('title');

    try {
        if (enabled && !(await isWelcomeCardAvailable())) {
            return await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'Image generation is not installed on this bot yet. Run `npm install` and restart the bot.',
            });
        }

        const updates = { cardEnabled: enabled };
        if (title) updates.cardTitle = title;
        const config = await updateWelcomeConfig(client, guild.id, updates);

        const lines = [enabled
            ? 'New members will get a welcome image card.'
            : 'Welcome image cards are off. New members get the normal welcome embed.'];
        if (enabled && (!config.enabled || !config.channelId)) {
            lines.push('Welcome messages are not on yet. Run `/welcome setup` to pick the channel.');
        }
        if (enabled && config.welcomeImage) {
            lines.push('Note: the card replaces the image URL you set in `/welcome setup`.');
        }

        const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle(enabled ? 'Welcome Card Enabled' : 'Welcome Card Disabled')
            .setDescription(lines.join('\n'));
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error(`[Welcome] Failed to update card settings for guild ${guild.id}:`, error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Something went wrong while updating the welcome card settings.' });
    }
}

async function handlePreview(interaction) {
    const { guild, client } = interaction;

    try {
        const config = await getWelcomeConfig(client, guild.id);
        const preview = await buildCardAttachment(client, guild, interaction.user, config.cardTitle);

        if (!preview) {
            return await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'Image generation is not installed on this bot yet. Run `npm install` and restart the bot.',
            });
        }

        const embed = new EmbedBuilder()
            .setColor(getColor('primary'))
            .setTitle('Welcome Card Preview')
            .setDescription(config.cardEnabled
                ? 'This is what new members will get.'
                : 'Cards are currently **off**. Turn them on with `/welcome card enabled:true`.')
            .setImage(`attachment://${CARD_FILE_NAME}`);

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], files: [preview] });
    } catch (error) {
        logger.error(`[Welcome] Failed to preview card for guild ${guild.id}:`, error);
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Something went wrong while generating the preview.' });
    }
}
