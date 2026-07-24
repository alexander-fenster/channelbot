import {MessageEntity, User} from 'telegraf/typings/core/types/typegram';

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
): RepostMessage {
  const mention = buildMention(user);
  const prefix = `${mention.text} posted a long message; TL;DR: ${tldr}\n`;
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
    entities: [
      ...(mention.entity ? [mention.entity] : []),
      blockquote,
      ...shifted,
    ],
  };
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
): CaptionRepost {
  const full = buildRepost(user, tldr, originalCaption, originalEntities);
  if (full.text.length <= TELEGRAM_CAPTION_LIMIT) {
    return {caption: full.text, captionEntities: full.entities, followUp: null};
  }
  const mention = buildMention(user);
  const caption = `${mention.text} posted a long message; TL;DR: ${tldr}`;
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
    caption,
    captionEntities: mention.entity ? [mention.entity] : [],
    followUp,
  };
}
