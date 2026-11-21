import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getLevelingConfig, saveLevelingConfig } from '../../services/leveling/leveling.js';
import { getVoiceXpSettings } from '../../services/leveling/voiceXpService.js';
import { botHasPermission } from '../../utils/permissionGuard.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import levelDashboard from './modules/level_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Manage the leveling system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setup')
                .setDescription('Set up the leveling system — this also enables it')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send level-up notifications in')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_min')
                        .setDescription('Minimum XP awarded per message (default: 15)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_max')
                        .setDescription('Maximum XP awarded per message (default: 25)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName('message')
                        .setDescription(
                            'Level-up message. Use {user} and {level} as placeholders (default provided)',
                        )
                        .setMaxLength(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_cooldown')
                        .setDescription('Seconds between XP grants per user (default: 60)')
                        .setMinValue(0)
                        .setMaxValue(3600)
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Open the interactive leveling configuration dashboard'),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('voice')
                .setDescription('Change how much XP people earn for being in voice calls')
                .addBooleanOption((option) =>
                    option
                        .setName('enabled')
                        .setDescription('Turn voice XP on or off')
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_min')
                        .setDescription('Minimum XP per minute in a call (default: 8)')
                        .setMinValue(1)
                        .setMaxValue(200)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_max')
                        .setDescription('Maximum XP per minute in a call (default: 12)')
                        .setMinValue(1)
                        .setMaxValue(200)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName('require_others')
                        .setDescription('Only earn XP when at least 2 people are in the call (default: on)')
                        .setRequired(false),
                ),
        ),
    category: 'Leveling',

    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferred) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need the **Manage Server** permission to use this command.' });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'dashboard') {
            return levelDashboard.execute(interaction, config, client);
        }

        if (subcommand === 'voice') {
            const existingConfig = await getLevelingConfig(client, interaction.guildId);
            const current = getVoiceXpSettings(existingConfig);

            const enabled = interaction.options.getBoolean('enabled');
            const xpMin = interaction.options.getInteger('xp_min');
            const xpMax = interaction.options.getInteger('xp_max');
            const requireOthers = interaction.options.getBoolean('require_others');

            const changing = enabled !== null || xpMin !== null || xpMax !== null || requireOthers !== null;
            let settings = current;

            if (changing) {
                const nextMin = xpMin ?? current.xpPerMinute.min;
                const nextMax = xpMax ?? current.xpPerMinute.max;
                if (nextMin > nextMax) {
                    return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Minimum XP (**${nextMin}**) cannot be greater than maximum XP (**${nextMax}**).` });
                }

                settings = {
                    ...current,
                    enabled: enabled ?? current.enabled,
                    xpPerMinute: { min: nextMin, max: nextMax },
                    requireOthers: requireOthers ?? current.requireOthers,
                };
                await saveLevelingConfig(client, interaction.guildId, { ...existingConfig, voiceXp: settings });
            }

            const notes = [];
            if (existingConfig.enabled === false) {
                notes.push('Leveling itself is currently **off**, so no XP is given until it is turned back on.');
            }

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: changing ? 'Voice XP Updated' : 'Voice XP Settings',
                        description:
                            `**Voice XP:** ${settings.enabled ? 'on' : 'off'}\n` +
                            `**XP per minute:** ${settings.xpPerMinute.min} – ${settings.xpPerMinute.max}\n` +
                            `**Needs 2+ people in the call:** ${settings.requireOthers ? 'yes' : 'no'}\n\n` +
                            'Deafened members, bots and the AFK channel never earn XP. Ignored roles, blacklisted users and the XP multiplier from the dashboard also apply.' +
                            (notes.length ? `\n\n${notes.join('\n')}` : ''),
                        color: 'success',
                    }),
                ],
            });
        }

        if (subcommand === 'setup') {
            const channel = interaction.options.getChannel('channel');
            const xpMin = interaction.options.getInteger('xp_min') ?? 15;
            const xpMax = interaction.options.getInteger('xp_max') ?? 25;
            const message =
                interaction.options.getString('message') ??
                '{user} has leveled up to level {level}!';
            const xpCooldown = interaction.options.getInteger('xp_cooldown') ?? 60;

            if (xpMin > xpMax) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Minimum XP (**${xpMin}**) cannot be greater than maximum XP (**${xpMax}**).` });
            }

            if (!botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
                throw new TitanBotError(
                    'Bot missing permissions in the specified channel',
                    ErrorTypes.PERMISSION,
                    `I need **SendMessages** and **EmbedLinks** permissions in ${channel} to send level-up notifications.`,
                );
            }

            const existingConfig = await getLevelingConfig(client, interaction.guildId);

            if (existingConfig.configured) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `The leveling system is already set up on this server (level-up notifications go to <#${existingConfig.levelUpChannel}>).\n\nUse \`/level dashboard\` to adjust any settings.` });
            }

            const newConfig = {
                ...existingConfig,
                configured: true,
                enabled: true,
                levelUpChannel: channel.id,
                xpRange: { min: xpMin, max: xpMax },
                xpCooldown: xpCooldown,
                levelUpMessage: message,
                announceLevelUp: true,
            };

            await saveLevelingConfig(client, interaction.guildId, newConfig);

            logger.info(`Leveling system set up in guild ${interaction.guildId}`, {
                channelId: channel.id,
                xpMin,
                xpMax,
                xpCooldown,
                userId: interaction.user.id,
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Leveling System Set Up',
                        description:
                            `The leveling system is now **enabled** and ready to go.\n\n` +
                            `**Level-up Channel:** ${channel}\n` +
                            `**XP per Message:** ${xpMin} – ${xpMax}\n` +
                            `**XP Cooldown:** ${xpCooldown}s\n` +
                            `**Level-up Message:** \`${message}\`\n\n` +
                            `Use \`/level dashboard\` to adjust any of these settings at any time.`,
                        color: 'success',
                    }),
                ],
            });
        }
    },
};