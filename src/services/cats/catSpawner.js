import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { RARITIES, pickCat, registerMessage, getCatConfig, recordCatch } from './catLogic.js';

const CATCH_WINDOW_MS = 60 * 1000;
const activeChannels = new Set();

/**
 * Posts a cat that the first person to press the button catches.
 * Button ids deliberately contain no colon so the global interaction router ignores them.
 * @returns {Promise<boolean>} false if a cat is already out in this channel
 */
export async function spawnCat(client, channel, rng = Math.random) {
    if (activeChannels.has(channel.id)) return false;
    activeChannels.add(channel.id);

    try {
        const cat = pickCat(rng);
        const rarity = RARITIES[cat.rarity];

        const spawnEmbed = new EmbedBuilder()
            .setColor(rarity.color)
            .setTitle('A wild cat appeared!')
            .setDescription(`${cat.emoji} **${cat.name}** (${rarity.label})\nBe the first to catch it! It runs away in ${CATCH_WINDOW_MS / 1000} seconds.`);

        const customId = `cat_catch_${channel.id}_${Date.now()}`;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(customId).setLabel('Catch!').setEmoji('🐾').setStyle(ButtonStyle.Success),
        );

        const message = await channel.send({ embeds: [spawnEmbed], components: [row] });
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: CATCH_WINDOW_MS,
            max: 1,
        });

        collector.on('collect', async (click) => {
            try {
                await click.deferUpdate();
                const user = await recordCatch(client, channel.guild.id, click.user.id, cat);
                const caughtEmbed = new EmbedBuilder()
                    .setColor(rarity.color)
                    .setTitle('Cat caught!')
                    .setDescription(
                        `🎉 ${click.user} caught the ${cat.emoji} **${cat.name}** (${rarity.label})!\n` +
                        `They now have **${user.total}** cat${user.total === 1 ? '' : 's'}.`,
                    );
                await message.edit({ embeds: [caughtEmbed], components: [], allowedMentions: { parse: [] } });
            } catch (error) {
                logger.error('Cat catch failed:', error);
            }
        });

        collector.on('end', async (collected) => {
            activeChannels.delete(channel.id);
            if (collected.size > 0) return;
            try {
                const fledEmbed = new EmbedBuilder()
                    .setColor('#99aab5')
                    .setTitle('The cat ran away...')
                    .setDescription(`The ${cat.emoji} **${cat.name}** got bored and wandered off. Be quicker next time!`);
                await message.edit({ embeds: [fledEmbed], components: [] });
            } catch (error) {
                logger.debug('Cat: could not update the fled message', { error: error.message });
            }
        });

        return true;
    } catch (error) {
        activeChannels.delete(channel.id);
        throw error;
    }
}

/** Called for every guild message; cheap unless this is the configured cat channel. */
export async function handleCatMessage(client, message) {
    if (!message.guild || message.author?.bot) return;

    const config = await getCatConfig(client, message.guild.id);
    if (!config.enabled || config.channelId !== message.channel.id) return;

    if (registerMessage(message.guild.id)) {
        spawnCat(client, message.channel).catch((error) => {
            logger.warn(`Could not spawn a cat in guild ${message.guild.id}`, { error: error.message });
        });
    }
}
