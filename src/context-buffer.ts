import * as fs from 'fs';
import * as path from 'path';

export interface ContextEntry {
  messageId: number;
  userId: number | null;
  text: string;
}

export class ContextBuffer {
  private readonly buffers = new Map<string, ContextEntry[]>();

  constructor(private readonly maxSize: number) {}

  private key(chatId: number, topicId: number | null): string {
    return `${chatId}:${topicId ?? 0}`;
  }

  append(chatId: number, topicId: number | null, entry: ContextEntry): void {
    const k = this.key(chatId, topicId);
    const buf = this.buffers.get(k) ?? [];
    const idx = buf.findIndex(e => e.messageId === entry.messageId);
    if (idx >= 0) {
      buf[idx] = entry;
    } else {
      buf.push(entry);
    }
    if (buf.length > this.maxSize) {
      buf.splice(0, buf.length - this.maxSize);
    }
    this.buffers.set(k, buf);
  }

  getPrevious(
    chatId: number,
    topicId: number | null,
    beforeMessageId: number,
  ): Array<{userId: number | null; text: string}> {
    const buf = this.buffers.get(this.key(chatId, topicId));
    if (!buf) return [];
    return buf
      .filter(e => e.messageId < beforeMessageId)
      .slice(-this.maxSize)
      .map(({userId, text}) => ({userId, text}));
  }

  async preloadFromLogs(
    logDir: string,
    windowMs: number = 24 * 60 * 60 * 1000,
  ): Promise<number> {
    const cutoff = Date.now() - windowMs;
    let files: string[];
    try {
      files = await fs.promises.readdir(logDir);
    } catch (err) {
      console.error('[context] failed to read log dir:', err);
      return 0;
    }

    const grouped = new Map<string, ContextEntry[]>();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(logDir, file);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat || stat.mtimeMs < cutoff) continue;

      try {
        const raw = await fs.promises.readFile(full, 'utf-8');
        const parsed = JSON.parse(raw);
        const req = parsed?.request;
        if (
          !req ||
          typeof req.text !== 'string' ||
          typeof req.chatId !== 'number' ||
          typeof req.messageId !== 'number'
        ) {
          continue;
        }
        const topicId: number | null =
          typeof req.topicId === 'number' ? req.topicId : null;
        const userId: number | null =
          typeof req.fromUser?.id === 'number' ? req.fromUser.id : null;
        const k = this.key(req.chatId, topicId);
        const arr = grouped.get(k) ?? [];
        arr.push({
          messageId: req.messageId,
          userId,
          text: req.text,
        });
        grouped.set(k, arr);
      } catch {
        // skip malformed
      }
    }

    for (const [k, arr] of grouped) {
      arr.sort((a, b) => a.messageId - b.messageId);
      this.buffers.set(k, arr.slice(-this.maxSize));
    }
    return grouped.size;
  }
}
