import * as assert from 'assert';
import {MessageEntity, User} from 'telegraf/typings/core/types/typegram';
import {
  buildRepost,
  formatUserName,
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

describe('formatUserName', () => {
  it('uses first name', () => {
    assert.strictEqual(formatUserName(makeUser()), 'Alice');
  });

  it('uses first and last name when both present', () => {
    assert.strictEqual(
      formatUserName(makeUser({last_name: 'Smith'})),
      'Alice Smith',
    );
  });

  it('falls back to username when names are empty', () => {
    assert.strictEqual(
      formatUserName(makeUser({first_name: '', username: 'asmith'})),
      'asmith',
    );
  });

  it('falls back to "Someone" when nothing is available', () => {
    assert.strictEqual(formatUserName(makeUser({first_name: ''})), 'Someone');
    assert.strictEqual(formatUserName(undefined), 'Someone');
  });
});

describe('buildRepost', () => {
  const originalText = 'first line\nsecond line';

  it('prepends the user and TL;DR line to the original text', () => {
    const repost = buildRepost('Alice', 'a summary', originalText);
    assert.strictEqual(
      repost.text,
      `Alice posted a long message; TL;DR: a summary\n${originalText}`,
    );
  });

  it('wraps the original text in an expandable blockquote entity', () => {
    const repost = buildRepost('Alice', 'a summary', originalText);
    const prefixLength = 'Alice posted a long message; TL;DR: a summary\n'
      .length;
    assert.deepStrictEqual(repost.entities[0], {
      type: 'expandable_blockquote',
      offset: prefixLength,
      length: originalText.length,
    });
  });

  it('shifts existing entities by the prefix length', () => {
    const entities: MessageEntity[] = [
      {type: 'bold', offset: 0, length: 5},
      {type: 'italic', offset: 11, length: 6},
    ];
    const repost = buildRepost('Alice', 'a summary', originalText, entities);
    const prefixLength = 'Alice posted a long message; TL;DR: a summary\n'
      .length;
    assert.deepStrictEqual(repost.entities.slice(1), [
      {type: 'bold', offset: prefixLength, length: 5},
      {type: 'italic', offset: prefixLength + 11, length: 6},
    ]);
  });

  it('does not mutate the original entities array', () => {
    const entities: MessageEntity[] = [{type: 'bold', offset: 0, length: 5}];
    buildRepost('Alice', 'a summary', originalText, entities);
    assert.deepStrictEqual(entities, [{type: 'bold', offset: 0, length: 5}]);
  });

  it('preserves entity-specific fields like text_link url', () => {
    const entities: MessageEntity[] = [
      {type: 'text_link', offset: 0, length: 10, url: 'https://example.com'},
    ];
    const repost = buildRepost('Alice', 'a summary', originalText, entities);
    const prefixLength = 'Alice posted a long message; TL;DR: a summary\n'
      .length;
    assert.deepStrictEqual(repost.entities[1], {
      type: 'text_link',
      offset: prefixLength,
      length: 10,
      url: 'https://example.com',
    });
  });

  it('produces only the blockquote entity when the original has none', () => {
    const repost = buildRepost('Alice', 'a summary', originalText);
    assert.strictEqual(repost.entities.length, 1);
  });

  it('computes offsets in UTF-16 code units for non-BMP characters', () => {
    // '😀' is one code point but two UTF-16 code units.
    const repost = buildRepost('Алиса 😀', 'итог 🎉', originalText, [
      {type: 'bold', offset: 0, length: 5},
    ]);
    const prefix = 'Алиса 😀 posted a long message; TL;DR: итог 🎉\n';
    assert.strictEqual(repost.text, prefix + originalText);
    assert.strictEqual(repost.entities[0].offset, prefix.length);
    assert.strictEqual(repost.entities[1].offset, prefix.length);
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
