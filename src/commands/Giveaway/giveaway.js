import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { botConfig } from '../../config/bot.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import giveawayStart from './modules/giveaway_start.js';
import giveawayEnd from './modules/giveaway_end.js';
import giveawayReroll from './modules/giveaway_reroll.js';
import giveawayDelete from './modules/giveaway_delete.js';
import giveawayList from './modules/giveaway_list.js';

const GIVEAWAY_MIN_WINNERS = botConfig.giveaways?.minimumWinners ?? 1;
const GIVEAWAY_MAX_WINNERS = botConfig.giveaways?.maximumWinners ?? 10;

const HANDLERS = {
    start: giveawayStart,
    end: giveawayEnd,
    reroll: giveawayReroll,
    delete: giveawayDelete,
    list: giveawayList,
};

// One command instead of four (gcreate/gend/gdelete/greroll): Discord allows only
// 100 slash commands per bot, and this one needed to give slots back.
export default {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Run giveaways')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('start')
                .setDescription('Start a new giveaway')
                .addStringOption((option) =>
                    option
                        .setName('duration')
                        .setDescription('How long the giveaway should last (e.g., 1h, 30m, 5d).')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('winners')
                        .setDescription('The number of winners to pick.')
                        .setMinValue(GIVEAWAY_MIN_WINNERS)
                        .setMaxValue(GIVEAWAY_MAX_WINNERS)
                        .setRequired(true))
                .addStringOption((option) =>
                    option
                        .setName('prize')
                        .setDescription('The prize being given away.')
                        .setRequired(true))
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Where to post it (defaults to this channel).')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false))
                .addRoleOption((option) =>
                    option
                        .setName('required_role')
                        .setDescription('Only members with this role can enter.')
                        .setRequired(false)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('end')
                .setDescription('End a giveaway now and pick the winner(s)')
                .addStringOption((option) =>
                    option
                        .setName('messageid')
                        .setDescription('The message ID of the giveaway to end.')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('reroll')
                .setDescription('Pick new winner(s) for an ended giveaway')
                .addStringOption((option) =>
                    option
                        .setName('messageid')
                        .setDescription('The message ID of the ended giveaway.')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('delete')
                .setDescription('Delete a giveaway message and its data')
                .addStringOption((option) =>
                    option
                        .setName('messageid')
                        .setDescription('The message ID of the giveaway to delete.')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('list')
                .setDescription('Show active giveaways in this server')),

    async execute(interaction, guildConfig, client) {
        const handler = HANDLERS[interaction.options.getSubcommand()];
        if (!handler) {
            return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Unknown giveaway action.' });
        }
        return await handler.execute(interaction, guildConfig, client);
    },
};
