import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {ContextBuffer} from '../src/context-buffer';

describe('ContextBuffer', () => {
  describe('append + getPrevious', () => {
    it('returns empty when nothing appended', () => {
      const cb = new ContextBuffer(5);
      assert.deepStrictEqual(cb.getPrevious(1, null, 100), []);
    });

    it('returns entries with messageId < beforeMessageId', () => {
      const cb = new ContextBuffer(5);
      cb.append(1, null, {messageId: 10, userId: 100, text: 'one'});
      cb.append(1, null, {messageId: 11, userId: 200, text: 'two'});
      cb.append(1, null, {messageId: 12, userId: 100, text: 'three'});
      assert.deepStrictEqual(cb.getPrevious(1, null, 12), [
        {userId: 100, text: 'one'},
        {userId: 200, text: 'two'},
      ]);
    });

    it('caps at maxSize when appending', () => {
      const cb = new ContextBuffer(3);
      for (let i = 1; i <= 5; i++) {
        cb.append(1, null, {messageId: i, userId: 999, text: `m${i}`});
      }
      assert.deepStrictEqual(cb.getPrevious(1, null, 100), [
        {userId: 999, text: 'm3'},
        {userId: 999, text: 'm4'},
        {userId: 999, text: 'm5'},
      ]);
    });

    it('keeps separate buffers per chat and topic', () => {
      const cb = new ContextBuffer(5);
      cb.append(1, 100, {messageId: 1, userId: 10, text: 'topic100'});
      cb.append(1, 200, {messageId: 2, userId: 20, text: 'topic200'});
      cb.append(2, 100, {messageId: 3, userId: 30, text: 'chat2'});
      cb.append(1, null, {messageId: 4, userId: 40, text: 'no-topic'});
      assert.deepStrictEqual(cb.getPrevious(1, 100, 999), [
        {userId: 10, text: 'topic100'},
      ]);
      assert.deepStrictEqual(cb.getPrevious(1, 200, 999), [
        {userId: 20, text: 'topic200'},
      ]);
      assert.deepStrictEqual(cb.getPrevious(2, 100, 999), [
        {userId: 30, text: 'chat2'},
      ]);
      assert.deepStrictEqual(cb.getPrevious(1, null, 999), [
        {userId: 40, text: 'no-topic'},
      ]);
    });

    it('updates entry in place when same messageId appended again (edit)', () => {
      const cb = new ContextBuffer(5);
      cb.append(1, null, {messageId: 10, userId: 100, text: 'original'});
      cb.append(1, null, {messageId: 11, userId: 200, text: 'next'});
      cb.append(1, null, {messageId: 10, userId: 100, text: 'edited'});
      assert.deepStrictEqual(cb.getPrevious(1, null, 999), [
        {userId: 100, text: 'edited'},
        {userId: 200, text: 'next'},
      ]);
    });

    it('excludes message itself when beforeMessageId equals its own id', () => {
      const cb = new ContextBuffer(5);
      cb.append(1, null, {messageId: 10, userId: 100, text: 'one'});
      cb.append(1, null, {messageId: 11, userId: 200, text: 'two'});
      assert.deepStrictEqual(cb.getPrevious(1, null, 11), [
        {userId: 100, text: 'one'},
      ]);
    });

    it('accepts null userId (channel posts)', () => {
      const cb = new ContextBuffer(5);
      cb.append(1, null, {messageId: 10, userId: null, text: 'channel post'});
      assert.deepStrictEqual(cb.getPrevious(1, null, 999), [
        {userId: null, text: 'channel post'},
      ]);
    });
  });

  describe('preloadFromLogs', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ctx-test-'));
    });

    afterEach(async () => {
      await fs.promises.rm(tempDir, {recursive: true, force: true});
    });

    async function writeLog(
      name: string,
      data: object,
      mtime?: Date,
    ): Promise<void> {
      const full = path.join(tempDir, name);
      await fs.promises.writeFile(full, JSON.stringify(data, null, 2));
      if (mtime) {
        await fs.promises.utimes(full, mtime, mtime);
      }
    }

    it('loads recent log files grouped by chat+topic, sorted by messageId', async () => {
      await writeLog('a.json', {
        request: {
          text: 'second',
          chatId: -100123,
          topicId: 5,
          messageId: 102,
          fromUser: {id: 7777, is_bot: false, first_name: 'A'},
        },
      });
      await writeLog('b.json', {
        request: {
          text: 'first',
          chatId: -100123,
          topicId: 5,
          messageId: 101,
          fromUser: {
            id: 8888,
            is_bot: false,
            first_name: 'Alice',
            username: 'alice',
          },
        },
      });
      const cb = new ContextBuffer(5);
      const groups = await cb.preloadFromLogs(tempDir);
      assert.strictEqual(groups, 1);
      assert.deepStrictEqual(cb.getPrevious(-100123, 5, 999), [
        {userId: 8888, text: 'first'},
        {userId: 7777, text: 'second'},
      ]);
    });

    it('skips files older than the window', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await writeLog(
        'old.json',
        {
          request: {
            text: 'too old',
            chatId: 1,
            topicId: null,
            messageId: 1,
            fromUser: {id: 1, is_bot: false, first_name: 'X'},
          },
        },
        oldDate,
      );
      await writeLog('new.json', {
        request: {
          text: 'fresh',
          chatId: 1,
          topicId: null,
          messageId: 2,
          fromUser: {id: 2, is_bot: false, first_name: 'Y'},
        },
      });
      const cb = new ContextBuffer(5);
      await cb.preloadFromLogs(tempDir);
      assert.deepStrictEqual(cb.getPrevious(1, null, 999), [
        {userId: 2, text: 'fresh'},
      ]);
    });

    it('caps preloaded entries at maxSize per group', async () => {
      for (let i = 1; i <= 10; i++) {
        await writeLog(`m${i}.json`, {
          request: {
            text: `msg${i}`,
            chatId: 1,
            topicId: null,
            messageId: i,
            fromUser: {id: 99, is_bot: false, first_name: 'X'},
          },
        });
      }
      const cb = new ContextBuffer(3);
      await cb.preloadFromLogs(tempDir);
      assert.deepStrictEqual(cb.getPrevious(1, null, 999), [
        {userId: 99, text: 'msg8'},
        {userId: 99, text: 'msg9'},
        {userId: 99, text: 'msg10'},
      ]);
    });

    it('skips malformed files', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'bad.json'), 'not json');
      await writeLog('ok.json', {
        request: {
          text: 'ok',
          chatId: 1,
          topicId: null,
          messageId: 1,
          fromUser: {id: 1, is_bot: false, first_name: 'X'},
        },
      });
      const cb = new ContextBuffer(5);
      const groups = await cb.preloadFromLogs(tempDir);
      assert.strictEqual(groups, 1);
    });

    it('returns 0 and does not throw when dir does not exist', async () => {
      const cb = new ContextBuffer(5);
      const groups = await cb.preloadFromLogs(path.join(tempDir, 'nope'));
      assert.strictEqual(groups, 0);
    });

    it('treats missing fromUser as null userId', async () => {
      await writeLog('a.json', {
        request: {
          text: 'orphan',
          chatId: 1,
          topicId: null,
          messageId: 1,
        },
      });
      const cb = new ContextBuffer(5);
      await cb.preloadFromLogs(tempDir);
      assert.deepStrictEqual(cb.getPrevious(1, null, 999), [
        {userId: null, text: 'orphan'},
      ]);
    });

    it('does not store username or first_name from fromUser', async () => {
      await writeLog('a.json', {
        request: {
          text: 'hello',
          chatId: 1,
          topicId: null,
          messageId: 1,
          fromUser: {
            id: 4242,
            is_bot: false,
            first_name: 'Alice',
            last_name: 'Smith',
            username: 'asmith',
          },
        },
      });
      const cb = new ContextBuffer(5);
      await cb.preloadFromLogs(tempDir);
      const entries = cb.getPrevious(1, null, 999);
      assert.deepStrictEqual(entries, [{userId: 4242, text: 'hello'}]);
      // Sanity-check: no PII keys leaked into the entry
      const keys = Object.keys(entries[0]).sort();
      assert.deepStrictEqual(keys, ['text', 'userId']);
    });
  });
});
