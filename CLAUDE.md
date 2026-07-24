# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Channel-Moderator-Bot is a Telegram bot that automatically moderates messages in Russian-language chat groups using AI-powered content analysis. It uses the DeepSeek API to evaluate messages against community rules and flags violations for admin review.

## Commands

```bash
npm run compile   # Build TypeScript to build/
npm start         # Run compiled bot (build/src/index.js)
npx gts check     # Lint check (preferred over npm run lint)
npx gts fix       # Auto-fix linting/formatting issues
npm run clean     # Clean generated files
```

Note: `npm test` is a placeholder and not implemented.

## Architecture

**Single-file implementation** in `src/index.ts` (~350 lines) with these components:

1. **Message Ingestion**: Listens via Telegraf webhook, handles new and edited messages, strips @mentions and URLs before analysis

2. **Moderation Queue**: Rate-limited processing (1 msg/sec via `moderationThrottlingSeconds`) to prevent API throttling

3. **AI Analysis**: Calls DeepSeek API with detailed system prompt containing 5 moderation rules. Returns JSON with rule violations and severity scores (0-10). Only flags messages with severity >= 9

4. **Response Actions**: For flagged messages:
   - Notifies admins via private message with deep-link to offending message
   - Optionally adds emoji reaction (configurable by topic)
   - Optionally replies with violation reason (only for specified topics)

5. **Logging**: Every request logged as JSON to `${LOG_DIR}/{chatId}-{messageId}.json`

5a. **Long Message TL;DR** (`src/long-message.ts`): Messages longer than 10 lines (10+ `\n` characters) or 1000 characters are summarized via DeepSeek into a one-sentence TL;DR, reposted to the same topic as "<user> posted a long message; TL;DR: <tldr>" with the original text in an `expandable_blockquote` entity (original entities shifted by the prefix length), and the original message is deleted. Reposts are sent with `link_preview_options.is_disabled` so no link in the collapsed original (or the source link below) generates a preview card. Requires `@telegraf/types` override in `package.json` (telegraf 4.16.3 pins 7.1.0 which predates the entity type) plus `skipLibCheck` in `tsconfig.json` (newer types break telegraf's own typings).

   **Forwarded-source attribution**: when the triggering message is a forward, `buildForwardSource(message.forward_origin)` derives a `{name, url}` for the origin, and the header becomes "<user> forwarded a long message from <source>; TL;DR: <tldr>" where `<source>` is a `text_link` entity to the origin. URL rules by origin type: `channel` → `https://t.me/<username>/<msgId>` (public) or `https://t.me/c/<shortId>/<msgId>` (private, `-100` stripped); `chat` → `https://t.me/<username>` when public else unlinked; `user` → `https://t.me/<username>` when public else unlinked (name from first/last); `hidden_user` → name only, no link. Non-forwards pass `null` and keep the plain "posted a long message" wording. telegraf re-exports the individual `MessageOrigin*` interfaces but not the union, so `long-message.ts` reconstructs and exports the `MessageOrigin` type.

   The same treatment applies to **captioned media** (photos, videos, documents, animations, audio, voice) whose `caption` is long — this covers forwarded channel posts, which are usually media+caption rather than plain text. `handleLongCaption` re-posts the media via `copyMessage` (preserving the image/file) with a new short TL;DR caption. Because Telegram caps captions at 1024 chars (`TELEGRAM_CAPTION_LIMIT`), `buildCaptionRepost` inlines the collapsed original into the caption when `prefix + original` fits, otherwise it keeps only the header (mention + source link + TL;DR) in the caption and sends the full original as a follow-up text reply (also preview-disabled). The forwarded-source attribution described above applies here too — most forwards are media+caption, so this is the common path. The `document` handler is registered before `animation` because a GIF carries both fields and telegraf runs only the first matching handler. Plain forwarded *text* already flows through the normal `message('text')` path unchanged. Note: captions are still not sent to the moderation LLM (only `message('text')` is).

6. **Truth Post Verification** (`src/truth-verifier.ts`): When photos are posted, runs Tesseract OCR. If text looks like a Trump Truth post (@realDonaldTrump or "Donald J. Trump"), fuzzy-matches against `/tmp/trump/trump.json` using two-phase matching:
   - Phase 1: Inverted word index finds candidates sharing significant words
   - Phase 2: Dice coefficient similarity scoring on candidates (threshold: 70%)

   The archive at `/tmp/trump/trump.json` is fetched in-process by `startTrumpArchiveFetcher()` every 5 minutes from `https://ix.cnn.io/data/truth-social/truth_archive.json`, with an inline `RT: <url>` spacing fixup, written via tmp-file + atomic rename. No external cronjob is required.

7. **HTTP Server** (in `src/index.ts`): Listens on `PORT` (default 8080):
   - `GET /healthz` → `200 ok` (for Decloud health checks)
   - `GET /recent` → last 10 moderation log files (sorted by name) as concatenated pretty-printed JSON, with `request.fromUser` stripped per record
   - Anything else → 404

## Environment Variables

Required (see `env.sh` template):
- `TELEGRAM_BOT_TOKEN` - Bot authentication
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `ALLOWED_CHAT_IDS` - Comma-separated chat IDs to moderate
- `TOPIC_IDS_TO_REPLY_IN` - Topic IDs where bot adds reactions/replies
- `ADMIN_USER_IDS` - Admin user IDs to notify of violations

Optional:
- `LOG_DIR` - Log directory (defaults to `./logs`; production sets to `/data` so logs land in the mounted volume)
- `PORT` - HTTP server port (defaults to `8080`)

## Deployment

Deployed to Decloud on `hosting.fenster.name` as `rodinamsftbot`, served at `rodinamsftbot.apps.fenster.name`.

- **`Dockerfile`** — `node:24-alpine` + `tesseract-ocr` + `tesseract-ocr-data-eng`. `npm ci`'s `prepare` script compiles TypeScript automatically. The image needs `package-lock.json` (tracked in git).
- **`deploy.sh`** — `git archive HEAD | ssh root@hosting.fenster.name` to `/root/staging/rodinamsftbot/deploy/`, then invokes the remote `deploy.sh`.
- **Remote `/root/staging/rodinamsftbot/deploy.sh`** runs `decloud deploy service` with `--mount /root/data/rodinamsftbot:/data` so moderation logs survive container restarts. Production `env.sh` lives next to it (also remote, not in this repo).

## Key Data Structures

```typescript
interface ModerationRequest {
  text: string;           // Cleaned message text
  chatId: number;
  topicId: number | null;
  messageId: number;
  fromUser: User;
}

interface ModerationResult {
  evaluation: Array<{
    rule: number;         // Rule 1-4
    ruleText: string;
    reason: string;
    severity: number;     // 0-10
  }>;
}
```

## Code Style

Uses Google TypeScript Style (gts) with 2-space indentation. Run `npx gts fix` before committing.
