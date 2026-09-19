import {
  Chat,
  MessageEntity,
  MessageOriginChannel,
  MessageOriginChat,
  MessageOriginHiddenUser,
  MessageOriginUser,
  User,
} from 'telegraf/typings/core/types/typegram';

// telegraf re-exports the individual origin interfaces but not the union
// itself, so we reconstruct it here.
export type MessageOrigin =
  | MessageOriginUser
  | MessageOriginHiddenUser
  | MessageOriginChat
  | MessageOriginChannel;

// A message is "long" when it spans more than this many lines...
export const LONG_MESSAGE_LINE_THRESHOLD = 10;
// ...or is longer than this many characters.
export const LONG_MESSAGE_CHAR_THRESHOLD = 1000;

// Minimal structural interface of the OpenAI client so tests can pass a fake.
export interface TldrClient {
  chat: {
    completions: {
      create(request: {
        model: string;
        messages: Array<{role: 'system' | 'user'; content: string}>;
      }): Promise<{
        choices: Array<{message: {content: string | null}}>;
      }>;
    };
  };
}

export interface RepostMessage {
  text: string;
  entities: MessageEntity[];
}

// Telegram caps media captions at 1024 UTF-16 code units. A repost that would
// exceed this must move the collapsed original into a follow-up text message.
export const TELEGRAM_CAPTION_LIMIT = 1024;
// Use UTF-16 lengths conservatively so entity offsets share the same units.
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function isLongMessage(text: string): boolean {
  if (text.length > LONG_MESSAGE_CHAR_THRESHOLD) {
    return true;
  }
  const newlines = text.match(/\n/g)?.length ?? 0;
  // N newlines means N+1 lines, so "longer than the threshold" needs at
  // least LONG_MESSAGE_LINE_THRESHOLD newlines.
  return newlines >= LONG_MESSAGE_LINE_THRESHOLD;
}

export interface Mention {
  text: string;
  // Mention entity positioned at offset 0; null when the author is unknown.
  entity: MessageEntity | null;
}

export function buildMention(user: User | undefined): Mention {
  if (!user) {
    return {text: 'Someone', entity: null};
  }
  if (user.username) {
    const text = `@${user.username}`;
    return {
      text,
      entity: {type: 'mention', offset: 0, length: text.length},
    };
  }
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    'Someone';
  return {
    text: name,
    entity: {type: 'text_mention', offset: 0, length: name.length, user},
  };
}

export interface ForwardSource {
  // Display name for the source (channel/chat title or user name).
  name: string;
  // Permalink to the original post, or null when none can be built (private
  // sources without a public username, or hidden senders).
  url: string | null;
}

function channelPermalink(chat: Chat, messageId: number): string {
  if ('username' in chat && chat.username) {
    return `https://t.me/${chat.username}/${messageId}`;
  }
  // Private channels/supergroups are reachable via the internal /c/<shortId>
  // form, dropping the -100 supergroup prefix from the numeric id.
  const shortId = chat.id.toString().replace(/^-100/, '');
  return `https://t.me/c/${shortId}/${messageId}`;
}

// Derives the source of a forwarded message from its forward_origin: a display
// name and (when possible) a permalink. Returns null for non-forwarded
// messages so callers fall back to the plain "posted a long message" wording.
export function buildForwardSource(
  origin: MessageOrigin | undefined,
): ForwardSource | null {
  if (!origin) {
    return null;
  }
  switch (origin.type) {
    case 'channel':
      return {
        name: 'title' in origin.chat ? origin.chat.title : 'a channel',
        url: channelPermalink(origin.chat, origin.message_id),
      };
    case 'chat': {
      const chat = origin.sender_chat;
      const name = 'title' in chat ? chat.title : 'a chat';
      const url =
        'username' in chat && chat.username
          ? `https://t.me/${chat.username}`
          : null;
      return {name, url};
    }
    case 'user': {
      const u = origin.sender_user;
      const name =
        [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
        'a user';
      const url = u.username ? `https://t.me/${u.username}` : null;
      return {name, url};
    }
    case 'hidden_user':
      return {name: origin.sender_user_name, url: null};
    default:
      return null;
  }
}

// Builds the "<mention> posted/forwarded ...; TL;DR: <tldr>" header line
// (without a trailing newline) plus its entities: the author mention and, for
// forwards, a text_link to the source pointing at `source.url`.
function buildHeader(
  user: User | undefined,
  tldr: string,
  source: ForwardSource | null,
  limit = TELEGRAM_MESSAGE_LIMIT,
): {text: string; entities: MessageEntity[]} {
  const mention = buildMention(user);
  const entities: MessageEntity[] = [];
  if (mention.entity) {
    entities.push(mention.entity);
  }
  let text = mention.text;
  if (source) {
    text += ' forwarded a long message from ';
    if (source.url) {
      entities.push({
        type: 'text_link',
        offset: text.length,
        length: source.name.length,
        url: source.url,
      });
    }
    text += source.name;
  } else {
    text += ' posted a long message';
  }
  text += `; TL;DR: ${tldr}`;
  if (text.length > limit) {
    let end = limit - 1;
    // Never cut an emoji's surrogate pair in half.
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    text = text.slice(0, end) + '…';
    return {
      text,
      entities: entities.filter(entity => entity.offset + entity.length <= end),
    };
  }
  return {text, entities};
}

export async function getTldr(
  client: TldrClient,
  text: string,
): Promise<string> {
  const response = await client.chat.completions.create({
    model: 'deepseek-v4-flash',
    messages: [
      {
        role: 'system',
        content:
          'You summarize chat messages. Reply with a one-sentence TL;DR of ' +
          'the user message, in the same language as the message. Reply with ' +
          'the sentence only: no quotes, no prefix, no commentary.',
      },
      {role: 'user', content: text},
    ],
  });
  const tldr = response.choices[0]?.message?.content?.trim();
  if (!tldr) {
    throw new Error('Empty TL;DR response from the model');
  }
  return tldr;
}

export function buildRepost(
  user: User | undefined,
  tldr: string,
  originalText: string,
  originalEntities: MessageEntity[] = [],
  source: ForwardSource | null = null,
): RepostMessage {
  const header = buildHeader(user, tldr, source);
  const prefix = `${header.text}\n`;
  // Entity offsets and lengths are in UTF-16 code units, which is exactly
  // what JavaScript string .length counts.
  const blockquote: MessageEntity = {
    type: 'expandable_blockquote',
    offset: prefix.length,
    length: originalText.length,
  };
  const shifted = originalEntities.map(entity => ({
    ...entity,
    offset: entity.offset + prefix.length,
  }));
  return {
    text: prefix + originalText,
    entities: [...header.entities, blockquote, ...shifted],
  };
}

// Keep the original intact in a follow-up when adding the header would exceed
// the limit. Very large originals are split without losing text or formatting.
export function buildTextRepost(
  user: User | undefined,
  tldr: string,
  originalText: string,
  originalEntities: MessageEntity[] = [],
  source: ForwardSource | null = null,
): RepostMessage[] {
  const full = buildRepost(user, tldr, originalText, originalEntities, source);
  if (full.text.length <= TELEGRAM_MESSAGE_LIMIT) return [full];

  const messages: RepostMessage[] = [buildHeader(user, tldr, source)];
  for (let start = 0; start < originalText.length; ) {
    let end = Math.min(start + TELEGRAM_MESSAGE_LIMIT, originalText.length);
    if (
      end < originalText.length &&
      /[\uD800-\uDBFF]/.test(originalText[end - 1])
    ) {
      end--;
    }
    const entities = originalEntities.flatMap(entity => {
      const from = Math.max(start, entity.offset);
      const to = Math.min(end, entity.offset + entity.length);
      return from < to
        ? [{...entity, offset: from - start, length: to - from}]
        : [];
    });
    messages.push({
      text: originalText.slice(start, end),
      entities: [
        {type: 'expandable_blockquote', offset: 0, length: end - start},
        ...entities,
      ],
    });
    start = end;
  }
  return messages;
}

export interface CaptionRepost {
  // Caption to set on the re-posted media message.
  caption: string;
  captionEntities: MessageEntity[];
  // When the collapsed original does not fit within the caption limit, it is
  // carried in this separate text message instead; null when it fit inline.
  followUp: RepostMessage | null;
}

// Builds the caption (and optional follow-up) for re-posting a media message
// whose caption was long. When the "<user> ... TL;DR\n<original>" text fits
// within the caption limit it mirrors buildRepost exactly (single message).
// Otherwise the caption carries only the mention + TL;DR, and the full
// original is returned as a follow-up text message wrapped in an expandable
// blockquote.
export function buildCaptionRepost(
  user: User | undefined,
  tldr: string,
  originalCaption: string,
  originalEntities: MessageEntity[] = [],
  source: ForwardSource | null = null,
): CaptionRepost {
  const full = buildRepost(
    user,
    tldr,
    originalCaption,
    originalEntities,
    source,
  );
  if (full.text.length <= TELEGRAM_CAPTION_LIMIT) {
    return {caption: full.text, captionEntities: full.entities, followUp: null};
  }
  const header = buildHeader(user, tldr, source, TELEGRAM_CAPTION_LIMIT);
  const followUp: RepostMessage = {
    text: originalCaption,
    entities: [
      {
        type: 'expandable_blockquote',
        offset: 0,
        length: originalCaption.length,
      },
      ...originalEntities,
    ],
  };
  return {
    caption: header.text,
    captionEntities: header.entities,
    followUp,
  };
}
