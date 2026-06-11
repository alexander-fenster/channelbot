import * as assert from 'assert';
import {MessageEntity, User} from 'telegraf/typings/core/types/typegram';
import {
  buildMention,
  buildRepost,
  getTldr,
  isLongMessage,
  TldrClient,
} from '../src/long-message';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    is_bot: false,
    first_name: 'Alice',
    ...overrides,
  };
}

describe('isLongMessage', () => {
  it('returns false for a single-line message', () => {
    assert.strictEqual(isLongMessage('hello'), false);
  });

  it('returns false for an empty message', () => {
    assert.strictEqual(isLongMessage(''), false);
  });

  it('returns false for exactly 10 lines (9 newlines)', () => {
    const text = Array.from({length: 10}, (_, i) => `line${i}`).join('\n');
    assert.strictEqual(isLongMessage(text), false);
  });

  it('returns true for 11 lines (10 newlines)', () => {
    const text = Array.from({length: 11}, (_, i) => `line${i}`).join('\n');
    assert.strictEqual(isLongMessage(text), true);
  });

  it('counts newline characters, not visual lines', () => {
    assert.strictEqual(isLongMessage('\n'.repeat(10)), true);
    assert.strictEqual(isLongMessage('\n'.repeat(9)), false);
  });
});

describe('buildMention', () => {
  it('uses @username with a mention entity when available', () => {
    const mention = buildMention(makeUser({username: 'asmith'}));
    assert.strictEqual(mention.text, '@asmith');
    assert.deepStrictEqual(mention.entity, {
      type: 'mention',
      offset: 0,
      length: '@asmith'.length,
    });
  });

  it('uses full name with a text_mention entity when no username', () => {
    const user = makeUser({last_name: 'Smith'});
    const mention = buildMention(user);
    assert.strictEqual(mention.text, 'Alice Smith');
    assert.deepStrictEqual(mention.entity, {
      type: 'text_mention',
      offset: 0,
      length: 'Alice Smith'.length,
      user,
    });
  });

  it('uses first name only when there is no last name', () => {
    const user = makeUser();
    const mention = buildMention(user);
    assert.strictEqual(mention.text, 'Alice');
    assert.deepStrictEqual(mention.entity, {
      type: 'text_mention',
      offset: 0,
      length: 'Alice'.length,
      user,
    });
  });

  it('falls back to "Someone" with a text_mention when the name is empty', () => {
    const user = makeUser({first_name: ''});
    const mention = buildMention(user);
    assert.strictEqual(mention.text, 'Someone');
    assert.deepStrictEqual(mention.entity, {
      type: 'text_mention',
      offset: 0,
      length: 'Someone'.length,
      user,
    });
  });

  it('returns "Someone" without an entity when the user is unknown', () => {
    assert.deepStrictEqual(buildMention(undefined), {
      text: 'Someone',
      entity: null,
    });
  });
});

describe('buildRepost', () => {
  const originalText = 'first line\nsecond line';
  // makeUser() has no username, so the prefix starts with 'Alice'.
  const prefix = 'Alice posted a long message; TL;DR: a summary\n';

  it('prepends the user and TL;DR line to the original text', () => {
    const repost = buildRepost(makeUser(), 'a summary', originalText);
    assert.strictEqual(repost.text, prefix + originalText);
  });

  it('starts with a mention entity for @username users', () => {
    const repost = buildRepost(
      makeUser({username: 'asmith'}),
      'a summary',
      originalText,
    );
    assert.strictEqual(
      repost.text,
      `@asmith posted a long message; TL;DR: a summary\n${originalText}`,
    );
    assert.deepStrictEqual(repost.entities[0], {
      type: 'mention',
      offset: 0,
      length: '@asmith'.length,
    });
  });

  it('starts with a text_mention entity for users without a username', () => {
    const user = makeUser();
    const repost = buildRepost(user, 'a summary', originalText);
    assert.deepStrictEqual(repost.entities[0], {
      type: 'text_mention',
      offset: 0,
      length: 'Alice'.length,
      user,
    });
  });

  it('omits the mention entity when the user is unknown', () => {
    const repost = buildRepost(undefined, 'a summary', originalText);
    assert.strictEqual(
      repost.text,
      `Someone posted a long message; TL;DR: a summary\n${originalText}`,
    );
    assert.strictEqual(repost.entities.length, 1);
    assert.strictEqual(repost.entities[0].type, 'expandable_blockquote');
  });

  it('wraps the original text in an expandable blockquote entity', () => {
    const repost = buildRepost(makeUser(), 'a summary', originalText);
    assert.deepStrictEqual(repost.entities[1], {
      type: 'expandable_blockquote',
      offset: prefix.length,
      length: originalText.length,
    });
  });

  it('shifts existing entities by the prefix length', () => {
    const entities: MessageEntity[] = [
      {type: 'bold', offset: 0, length: 5},
      {type: 'italic', offset: 11, length: 6},
    ];
    const repost = buildRepost(makeUser(), 'a summary', originalText, entities);
    assert.deepStrictEqual(repost.entities.slice(2), [
      {type: 'bold', offset: prefix.length, length: 5},
      {type: 'italic', offset: prefix.length + 11, length: 6},
    ]);
  });

  it('does not mutate the original entities array', () => {
    const entities: MessageEntity[] = [{type: 'bold', offset: 0, length: 5}];
    buildRepost(makeUser(), 'a summary', originalText, entities);
    assert.deepStrictEqual(entities, [{type: 'bold', offset: 0, length: 5}]);
  });

  it('preserves entity-specific fields like text_link url', () => {
    const entities: MessageEntity[] = [
      {type: 'text_link', offset: 0, length: 10, url: 'https://example.com'},
    ];
    const repost = buildRepost(makeUser(), 'a summary', originalText, entities);
    assert.deepStrictEqual(repost.entities[2], {
      type: 'text_link',
      offset: prefix.length,
      length: 10,
      url: 'https://example.com',
    });
  });

  it('computes offsets in UTF-16 code units for non-BMP characters', () => {
    // '😀' is one code point but two UTF-16 code units.
    const user = makeUser({first_name: 'Алиса 😀'});
    const repost = buildRepost(user, 'итог 🎉', originalText, [
      {type: 'bold', offset: 0, length: 5},
    ]);
    const emojiPrefix = 'Алиса 😀 posted a long message; TL;DR: итог 🎉\n';
    assert.strictEqual(repost.text, emojiPrefix + originalText);
    assert.deepStrictEqual(repost.entities[0], {
      type: 'text_mention',
      offset: 0,
      length: 'Алиса 😀'.length,
      user,
    });
    assert.strictEqual(repost.entities[1].offset, emojiPrefix.length);
    assert.strictEqual(repost.entities[2].offset, emojiPrefix.length);
  });
});

describe('getTldr', () => {
  function makeClient(content: string | null): {
    client: TldrClient;
    requests: Array<{
      model: string;
      messages: Array<{role: 'system' | 'user'; content: string}>;
    }>;
  } {
    const requests: Array<{
      model: string;
      messages: Array<{role: 'system' | 'user'; content: string}>;
    }> = [];
    const client: TldrClient = {
      chat: {
        completions: {
          create: async request => {
            requests.push(request);
            return {choices: [{message: {content}}]};
          },
        },
      },
    };
    return {client, requests};
  }

  it('returns the trimmed model response', async () => {
    const {client} = makeClient('  A concise summary.  \n');
    assert.strictEqual(
      await getTldr(client, 'long text'),
      'A concise summary.',
    );
  });

  it('sends the message text to the deepseek-chat model', async () => {
    const {client, requests} = makeClient('summary');
    await getTldr(client, 'the long message text');
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].model, 'deepseek-chat');
    const userMessages = requests[0].messages.filter(m => m.role === 'user');
    assert.deepStrictEqual(
      userMessages.map(m => m.content),
      ['the long message text'],
    );
  });

  it('rejects when the model returns no content', async () => {
    const {client} = makeClient(null);
    await assert.rejects(getTldr(client, 'long text'), /Empty TL;DR/);
  });

  it('rejects when the model returns whitespace only', async () => {
    const {client} = makeClient('   \n');
    await assert.rejects(getTldr(client, 'long text'), /Empty TL;DR/);
  });
});
