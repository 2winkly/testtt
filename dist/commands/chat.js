"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const discord_module_loader_1 = require("discord-module-loader");
const discord_js_1 = require("discord.js");
const truncate_1 = tslib_1.__importDefault(require("lodash/truncate"));
const config_1 = tslib_1.__importDefault(require("../config"));
const helpers_1 = require("../lib/helpers");
const openai_1 = require("../lib/openai");
const prisma_1 = tslib_1.__importDefault(require("../lib/prisma"));
const rate_limiter_1 = require("../lib/rate-limiter");
const rateLimiter = new rate_limiter_1.RateLimiter(5, 900000);
exports.default = new discord_module_loader_1.DiscordCommand({
    command: {
        name: 'chat',
        description: 'Start a conversation!',
        options: [
            {
                type: discord_js_1.ApplicationCommandOptionType.String,
                name: 'message',
                description: 'The message to start the conversation with.',
                required: true,
            },
            {
                type: discord_js_1.ApplicationCommandOptionType.String,
                name: 'behavior',
                description: 'Specify how the bot should behave.',
            },
        ],
    },
    execute: async (interaction) => {
        if (!interaction.isChatInputCommand()) {
            return;
        }
        const message = interaction.options.getString('message')?.trim();
        if (!message || message.length === 0) {
            await interaction.reply({
                content: 'You must provide a message to start a conversation!',
                ephemeral: true,
            });
            return;
        }
        if ((0, helpers_1.exceedsTokenLimit)(message)) {
            await interaction.reply({
                content: 'Your message is too long, try shortening it!',
                ephemeral: true,
            });
            return;
        }
        const behavior = interaction.options.getString('behavior')?.trim();
        if (behavior && (await (0, openai_1.isTextFlagged)(behavior))) {
            await interaction.reply({
                content: 'Your behavior has been blocked by moderation!',
                ephemeral: true,
            });
            return;
        }
        const channel = interaction.channel;
        if (!channel) {
            await interaction.reply({
                content: 'There was an error while executing this command!',
                ephemeral: true,
            });
            return;
        }
        if (!(channel instanceof discord_js_1.TextChannel)) {
            await interaction.reply({
                content: "You can't start a conversation here!",
                ephemeral: true,
            });
            return;
        }
        const executed = rateLimiter.attempt(interaction.user.id, async () => {
            await interaction.reply({
                embeds: [getThreadCreatingEmbed(interaction.user, message, behavior)],
            });
            let response = null;
            try {
                response = await (0, openai_1.getChatResponse)([{ role: 'user', content: message }], behavior);
            }
            catch (err) {
                if (err instanceof Error) {
                    const isModerated = err.message.includes('moderation');
                    await interaction.editReply({
                        embeds: [
                            isModerated
                                ? getModeratedEmbed(interaction.user, message, behavior)
                                : getErrorEmbed(interaction.user, message, behavior),
                        ],
                    });
                    return;
                }
                throw err;
            }
            try {
                const thread = await channel.threads.create({
                    name: (0, truncate_1.default)(`💬 ${interaction.user.username} - ${message}`, {
                        length: 100,
                    }),
                    autoArchiveDuration: 60,
                    reason: config_1.default.bot.name,
                    rateLimitPerUser: 1,
                });
                const pruneInterval = Math.ceil(config_1.default.bot.prune_interval);
                if (pruneInterval > 0) {
                    try {
                        await prisma_1.default.conversation.create({
                            data: {
                                interactionId: (await interaction.fetchReply()).id,
                                channelId: thread.id,
                                expiresAt: new Date(Date.now() + 3600000 * pruneInterval),
                            },
                        });
                    }
                    catch (err) {
                        await (0, helpers_1.destroyThread)(thread);
                        throw err;
                    }
                }
                if (behavior) {
                    await thread.send(`Behavior: ${behavior}`);
                }
                await thread.members.add(interaction.user);
                await thread.send(response);
                await interaction.editReply({
                    embeds: [
                        getThreadCreatedEmbed(thread, interaction.user, message, behavior),
                    ],
                });
            }
            catch (err) {
                console.error(err);
                await interaction.editReply({
                    embeds: [getErrorEmbed(interaction.user, message, behavior)],
                });
            }
        });
        if (!executed) {
            await interaction.reply({
                content: 'You are currently being rate limited.',
                ephemeral: true,
            });
        }
    },
});
function getBaseEmbed(user, message, behavior) {
    const fields = [{ name: 'Message', value: message }];
    if (behavior) {
        fields.push({ name: 'Behavior', value: behavior });
    }
    return new discord_js_1.EmbedBuilder()
        .setColor(discord_js_1.Colors.Green)
        .setDescription(`<@${user.id}> has started a conversation! 💬`)
        .setFields(fields);
}
function getThreadCreatingEmbed(user, message, behavior) {
    return getBaseEmbed(user, message, behavior).addFields({
        name: 'Thread',
        value: 'Creating...',
    });
}
function getThreadCreatedEmbed(thread, user, message, behavior) {
    return getBaseEmbed(user, message, behavior).addFields({
        name: 'Thread',
        value: thread.toString(),
    });
}
function getModeratedEmbed(user, message, behavior) {
    return getBaseEmbed(user, message, behavior)
        .setColor(discord_js_1.Colors.DarkRed)
        .setTitle('Your message has been blocked by moderation');
}
function getErrorEmbed(user, message, behavior) {
    return getBaseEmbed(user, message, behavior)
        .setColor(discord_js_1.Colors.Red)
        .setTitle('There was an error while creating a thread');
}
