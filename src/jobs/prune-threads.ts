import {
  Client,
  Colors,
  DiscordAPIError,
  EmbedBuilder,
  RESTJSONErrorCodes,
} from 'discord.js';
import { Op } from 'sequelize';

import { destroyThread } from '@/lib/helpers';
import Conversation from '@/models/conversation';

export default async function pruneThreads(
  client: Client<boolean>
): Promise<void> {
  try {
    const conversations = await Conversation.findAll({
      where: {
        expiresAt: {
          [Op.lte]: new Date(),
        },
      },
    });

    for (const conversation of conversations) {
      let channel = null;

      try {
        channel = await client.channels.fetch(conversation.channelId);
      } catch (err) {
        if (
          !(
            err instanceof DiscordAPIError &&
            err.code === RESTJSONErrorCodes.UnknownChannel
          )
        ) {
          console.error(err);
        }
      }

      if (channel && channel.isThread()) {
        let message = null;

        try {
          message = await channel.parent?.messages.fetch(
            conversation.messageId
          );
        } catch (err) {
          if (
            !(
              err instanceof DiscordAPIError &&
              err.code === RESTJSONErrorCodes.UnknownMessage
            )
          ) {
            console.error(err);
          }
        }

        if (message && message.embeds.length > 0) {
          const embed = message.embeds[0];

          await message.edit({
            embeds: [
              new EmbedBuilder()
                .setColor(Colors.Yellow)
                .setTitle(embed.title)
                .setDescription('Conversation deleted due to inactivity.')
                .setFields(
                  embed.fields.filter((field) => field.name !== 'Thread')
                ),
            ],
          });
        }

        await destroyThread(channel);
      }

      await conversation.destroy();
    }

    if (conversations.length > 0) {
      console.log(`Pruned ${conversations.length} expired conversations.`);
    }
  } catch (err) {
    console.error(err);
  }
}
