import { deleteMessagesByIds } from '@atmosfera/user-roast';
import { Listener } from '@sapphire/framework';
import {
  Events,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
  type Snowflake,
} from 'discord.js';

/**
 * Mirror Discord's bulk-delete event (used by mod tools and "delete N
 * messages" actions). Single DELETE … IN (?, ?, …) keeps the SQLite work
 * proportional to the batch size.
 */
export class MessageDeleteBulkCaptureListener extends Listener<typeof Events.MessageBulkDelete> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageBulkDelete });
  }

  public override run(
    messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>,
    _channel: GuildTextBasedChannel,
  ): void {
    deleteMessagesByIds([...messages.keys()]);
  }
}
