import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
  getCountingGameConfig,
  activateCountingGame,
  disableCountingGame,
  resetCountingGame,
  updateCountingSettings,
  buildCountingLeaderboard,
  getUserCountingStats,
  getCountingSystemChoices,
  getCountingSystemLabel,
  getExpectedCountValue,
} from '../../services/countingGameService.js';
import { logger } from '../../utils/logger.js';

import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

// Anyone can look at the game; only server managers can change it.
const PUBLIC_SUBCOMMANDS = new Set(['status', 'leaderboard', 'stats']);

export default {
  data: new SlashCommandBuilder()
    .setName('count')
    .setDescription('The server counting game')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('Start a counting game in a text channel (Manage Server)')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The channel where counting will take place')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((option) =>
          option
            .setName('system')
            .setDescription('The counting system to use (default: Decimal)')
            .setRequired(false)
            .addChoices(...getCountingSystemChoices()),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('Disable the counting game (Manage Server)'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('settings')
        .setDescription('Change counting rules (Manage Server)')
        .addBooleanOption((option) =>
          option
            .setName('strict')
            .setDescription('On: every message in the channel must be a number. Off: chat is ignored.'),
        )
        .addIntegerOption((option) =>
          option
            .setName('saves')
            .setDescription('Max saves (mistakes the group can survive). 0 turns saves off.')
            .setMinValue(0)
            .setMaxValue(5),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('View the current counting game status'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Reset the current counting sequence (Manage Server)')
        .addIntegerOption((option) =>
          option
            .setName('start')
            .setDescription('The number to start at after reset')
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('leaderboard').setDescription('Show the counting game leaderboard'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stats')
        .setDescription('Show counting stats for you or another member')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member to look up (default: you)'),
        ),
    ),
  category: 'Fun',

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      const isPublic = PUBLIC_SUBCOMMANDS.has(subcommand);

      const deferSuccess = await InteractionHelper.safeDefer(
        interaction,
        isPublic ? {} : { flags: MessageFlags.Ephemeral },
      );
      if (!deferSuccess) {
        logger.warn('Count command defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
        return;
      }

      if (!isPublic && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need the **Manage Server** permission to use this command.' });
      }

      const guildId = interaction.guildId;
      const config = await getCountingGameConfig(interaction.client, guildId);

      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const system = interaction.options.getString('system') || 'decimal';
        if (!channel || channel.type !== ChannelType.GuildText) {
          return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please choose a text channel for the counting game.' });
        }

        if (config.enabled && config.channelId && config.channelId !== channel.id) {
          return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `This server already has an active counting channel configured: <#${config.channelId}>. Disable the current counting game first, or use that existing channel.` });
        }

        const game = await activateCountingGame(interaction.client, guildId, channel.id, system);
        const saveLine = game.maxSaves > 0
          ? ` The group has **${game.maxSaves}** saves, so a mistake won't always reset the count, and one more is earned every 100 counts.`
          : '';
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              'Counting Game Enabled',
              `The counting game is now active in ${channel} using the **${getCountingSystemLabel(system)}** system. Players count up from **1** and may not post two numbers in a row.${saveLine}`,
            ),
          ],
        });
      }

      if (subcommand === 'disable') {
        if (!config.enabled) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [infoEmbed('Counting Game Disabled', 'The counting game is already disabled for this server.')],
          });
        }

        await disableCountingGame(interaction.client, guildId);
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [successEmbed('Counting Game Disabled', 'The counting game has been disabled.')],
        });
      }

      if (subcommand === 'settings') {
        const strict = interaction.options.getBoolean('strict');
        const saves = interaction.options.getInteger('saves');

        if (strict === null && saves === null) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
              createEmbed({
                title: 'Counting Settings',
                description: 'Use `/count settings` with an option to change a rule.',
                fields: [
                  { name: 'Strict mode', value: config.strict ? 'On: every message must be a number' : 'Off: chat is ignored', inline: true },
                  { name: 'Max saves', value: `${config.maxSaves}`, inline: true },
                ],
                color: 'primary',
              }),
            ],
          });
        }

        const updated = await updateCountingSettings(interaction.client, guildId, {
          strict: strict === null ? undefined : strict,
          maxSaves: saves === null ? undefined : saves,
        });
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              'Counting Settings Updated',
              `Strict mode: **${updated.strict ? 'on' : 'off'}**\nMax saves: **${updated.maxSaves}** (refilled to ${updated.saves})`,
            ),
          ],
        });
      }

      if (subcommand === 'status') {
        const fields = [
          { name: 'Enabled', value: config.enabled ? 'Yes' : 'No', inline: true },
          { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not configured', inline: true },
          { name: 'System', value: getCountingSystemLabel(config.system), inline: true },
          { name: 'Next count', value: getExpectedCountValue(config), inline: true },
          { name: 'Current streak', value: `${config.currentStreak}`, inline: true },
          { name: 'Best streak', value: `${config.bestStreak || 0}`, inline: true },
          { name: 'High score', value: `${config.highScore || 0}`, inline: true },
          { name: 'Saves', value: `${config.saves}/${config.maxSaves}`, inline: true },
          { name: 'Last counter', value: config.lastUserId ? `<@${config.lastUserId}>` : 'None', inline: true },
        ];

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: 'Counting Game Status',
              description: 'Overview of the currently configured counting game.',
              fields,
              color: 'primary',
            }),
          ],
        });
      }

      if (subcommand === 'reset') {
        if (!config.enabled) {
          return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Enable the counting game first with `/count setup`.' });
        }

        const startNumber = interaction.options.getInteger('start') || 1;
        await resetCountingGame(interaction.client, guildId, startNumber);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              'Counting Game Reset',
              `The counting sequence has been reset. Start again with **${startNumber}** in <#${config.channelId}>.`,
            ),
          ],
        });
      }

      if (subcommand === 'leaderboard') {
        const leaderboard = buildCountingLeaderboard(config);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: 'Counting Game Leaderboard',
              description: leaderboard.length > 0 ? leaderboard.join('\n') : 'No counts have been recorded yet.',
              color: 'primary',
            }),
          ],
        });
      }

      if (subcommand === 'stats') {
        const target = interaction.options.getUser('user') || interaction.user;
        const stats = getUserCountingStats(config, target.id);

        const description = stats.correct === 0 && stats.ruins === 0
          ? `${target} hasn't played the counting game yet.`
          : `Stats for ${target}`;

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: 'Counting Stats',
              description,
              fields: [
                { name: 'Correct counts', value: `${stats.correct}`, inline: true },
                { name: 'Mistakes', value: `${stats.ruins}`, inline: true },
                { name: 'Accuracy', value: stats.accuracy === null ? '—' : `${stats.accuracy}%`, inline: true },
                { name: 'Rank', value: stats.rank ? `#${stats.rank} of ${stats.totalPlayers}` : 'Unranked', inline: true },
              ],
              color: 'primary',
            }),
          ],
        });
      }

      return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please choose a valid counting game action.' });
    } catch (error) {
      logger.error('Count command error:', error);
      return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Something went wrong while managing the counting game.' });
    }
  },
};
