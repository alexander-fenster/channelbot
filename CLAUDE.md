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

5. **Logging**: Every request logged as JSON to `logs/{chatId}-{messageId}.json`

6. **Truth Post Verification** (`src/truth-verifier.ts`): When photos are posted, runs Tesseract OCR. If text looks like a Trump Truth post (@realDonaldTrump or "Donald J. Trump"), fuzzy-matches against `/tmp/trump/trump.json` using two-phase matching:
   - Phase 1: Inverted word index finds candidates sharing significant words
   - Phase 2: Dice coefficient similarity scoring on candidates (threshold: 70%)

**Additional files:**
- `serve.js`: HTTP server (port 5001) serving last 10 moderation logs with sensitive data stripped

## Environment Variables

Required (see `env.sh` template):
- `TELEGRAM_BOT_TOKEN` - Bot authentication
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `ALLOWED_CHAT_IDS` - Comma-separated chat IDs to moderate
- `TOPIC_IDS_TO_REPLY_IN` - Topic IDs where bot adds reactions/replies
- `ADMIN_USER_IDS` - Admin user IDs to notify of violations
- `LOG_DIR` - Log directory (defaults to `./logs`)

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
