import { DiscordEvent } from 'discord-module-loader';
import { Client, DMChannel, Events, Message, ThreadChannel } from 'discord.js';
import { ChatCompletionRequestMessage } from 'openai';

import config from '@/config';
import { getChatResponse } from '@/lib/openai';
import Conversation from '@/models/conversation';

async function handleThreadMessage(
  client: Client<true>,
  channel: ThreadChannel,
  message: Message
) {
  if (channel.ownerId !== client.user.id) {
    return;
  }

  if (channel.archived || channel.locked || !channel.name.startsWith('💬')) {
    return;
  }

  await channel.sendTyping();

  const messages = await channel.messages.fetch();
  const latestMessage = messages.first();

  const parsedMessages = messages
    .filter((message) => message.content)
    .map((message) => {
      return {
        role: message.author.id === client.user.id ? 'assistant' : 'user',
        content: message.content,
      };
    })
    .reverse() as Array<ChatCompletionRequestMessage>;

  try {
    const response = await getChatResponse(parsedMessages);

    await channel.send(response);
  } catch (err) {
    if (err instanceof Error) {
      await latestMessage?.reply(err.message);

      // TODO: Delete the thread right away.
      //       The automatic pruner will assume it is inactive.
      const pruneInterval = Math.ceil(config.bot.prune_interval as number);

      if (err.message.includes('token') && pruneInterval > 0) {
        const conversation = await Conversation.findOne({
          where: { threadId: channel.id },
        });

        if (!conversation || conversation.get('expiresAt')) {
          return;
        }

        await conversation.update({
          expiresAt: new Date(Date.now() + 3600000 * pruneInterval),
        });
      }
    } else {
      await latestMessage?.reply(
        'There was an error while processing your response.'
      );
    }
  }
}

// TODO: Retain previous messages with constraints (e.g. 10 messages max).
async function handleDirectMessage(
  client: Client<true>,
  channel: DMChannel,
  message: Message
) {
  await channel.sendTyping();

  try {
    const response = await getChatResponse([
      { role: 'user', content: message.content },
    ]);

    await channel.send(response);
  } catch (err) {
    await message.reply(
      err instanceof Error
        ? err.message
        : 'There was an error while processing your response.'
    );
  }
}

export default new DiscordEvent(
  Events.MessageCreate,
  async (message: Message) => {
    const client = message.client;

    if (message.author.id === client.user.id) {
      return;
    }

    const channel = message.channel;

    if (channel.isThread()) {
      handleThreadMessage(client, channel, message);
    } else if (channel.isDMBased()) {
      handleDirectMessage(client, channel as DMChannel, message);
    }
  }
);
