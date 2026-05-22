import {
  applyMessageEdit,
  getGuildConfig,
  getRoastOptoutState,
  recordMessage,
} from '@atmosfera/user-roast';
import { Listener } from '@sapphire/framework';
import { Events, type Message, type PartialMessage } from 'discord.js';

/**
 * Mirror in-Discord edits into the messages_recent table so the roast-hot-path
 * always sees the user's *current* text. Same gating as MessageCreate: skip
 * bots/system/no-guild, require indexing enabled, honor roast opt-out.
 *
 * Discord may deliver the event with a partial `newMessage` (no cached
 * pre-state). Partials are fetched on demand; if the fetch fails (channel
 * access revoked, message already deleted), bail silently.
 */
export class MessageEditCaptureListener extends Listener<typeof Events.MessageUpdate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageUpdate });
  }

  public override async run(
    _oldMessage: Message | PartialMessage,
    newMessage: Message | PartialMessage,
  ): Promise<void> {
    let resolved: Message;
    if (newMessage.partial) {
      try {
        resolved = await newMessage.fetch();
      } catch {
        return;
      }
    } else {
      resolved = newMessage;
    }

    if (resolved.author.bot) return;
    if (!resolved.guild) return;
    if (resolved.system) return;

    const config = getGuildConfig(resolved.guild.id);
    if (!config.indexing_enabled) return;

    const guildId = resolved.guild.id;
    const authorId = resolved.author.id;
    if (getRoastOptoutState(authorId, guildId).optedOut) return;

    const content = resolved.content ?? '';
    const editedAt = resolved.editedTimestamp ?? Date.now();

    if (content.length === 0) {
      // Edit removed all text — drop the row rather than store an empty one.
      // applyMessageEdit with empty would also work, but a deletion is cleaner.
      // We don't fall through to deleteMessageById here because the edit could
      // have happened on a sticker-only message that was never stored in the
      // first place; an UPDATE with no matching row is the same no-op.
      applyMessageEdit(resolved.id, '', editedAt);
      return;
    }

    // The first create event may have been missed (bot down, race with
    // gateway resume). Use recordMessage's INSERT OR IGNORE as a safety net,
    // then apply the edit. Net effect: row exists with current content.
    recordMessage({
      messageId: resolved.id,
      guildId,
      channelId: resolved.channelId,
      authorId,
      content,
      createdAt: resolved.createdTimestamp,
      isReply: resolved.reference !== null && resolved.type === 19,
      replyToId: resolved.reference?.messageId ?? null,
    });
    applyMessageEdit(resolved.id, content, editedAt);
  }
}
