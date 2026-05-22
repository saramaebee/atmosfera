import { deleteMessageById } from '@atmosfera/user-roast';
import { Listener } from '@sapphire/framework';
import { Events, type Message, type PartialMessage } from 'discord.js';

/**
 * Mirror in-Discord single-message deletes by dropping the row from
 * messages_recent. No partial fetch needed — the ID alone is enough, and
 * fetching a just-deleted message would fail anyway.
 *
 * No opt-out / indexing-enabled gate either: deletes should always go
 * through. A stale row from a flag flip we don't know about is exactly what
 * we want to clean up.
 */
export class MessageDeleteCaptureListener extends Listener<typeof Events.MessageDelete> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageDelete });
  }

  public override run(message: Message | PartialMessage): void {
    deleteMessageById(message.id);
  }
}
