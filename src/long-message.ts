import {MessageEntity, User} from 'telegraf/typings/core/types/typegram';

// A message is "long" when it spans more than this many lines.
export const LONG_MESSAGE_LINE_THRESHOLD = 10;

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

export function isLongMessage(text: string): boolean {
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
    model: 'deepseek-chat',
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
