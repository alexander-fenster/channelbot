import * as fs from 'fs';
import * as path from 'path';
import {Telegraf} from 'telegraf';
import {editedMessage, message} from 'telegraf/filters';
import {OpenAI} from 'openai';
import {ReactionType} from 'telegraf/typings/core/types/typegram';

const moderationThrottlingSeconds = 20;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

const ALLOWED_CHAT_IDS =
  process.env.ALLOWED_CHAT_IDS?.split(',').map(id => parseInt(id)) ?? [];
if (ALLOWED_CHAT_IDS.length === 0) {
  throw new Error('ALLOWED_CHAT_IDS is not set');
}

const LOG_DIR = process.env.LOG_DIR ?? './logs';
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, {recursive: true});
}

interface ModerationRequest {
  text: string;
  chatId: number;
  messageId: number;
}

const moderationQueue: ModerationRequest[] = [];
let lastModerationTime = 0;
let timeout: NodeJS.Timeout | null = null;

function enqueueForModeration(request: ModerationRequest) {
  if (!ALLOWED_CHAT_IDS.includes(request.chatId)) {
    return;
  }
  moderationQueue.push(request);
  if (timeout) {
    return;
  }
  processModerationQueue();
}

function processModerationQueue() {
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
  const now = Date.now();
  if (now - lastModerationTime > moderationThrottlingSeconds * 1000) {
    lastModerationTime = now;
    const request = moderationQueue.shift();
    if (request) {
      processModerationRequest(request).catch(err => {
        console.error(err);
      });
    }
    if (moderationQueue.length > 0) {
      processModerationQueue();
    }
  } else {
    const waitTime =
      moderationThrottlingSeconds * 1000 - (now - lastModerationTime);
    timeout = setTimeout(() => {
      processModerationQueue();
    }, waitTime);
  }
}

async function processModerationRequest(request: ModerationRequest) {
  const moderationResponse = await openai.moderations.create({
    model: 'omni-moderation-latest',
    input: request.text,
  });
  const moderationResult = moderationResponse.results[0];

  const logFile = path.join(
    LOG_DIR,
    `${request.chatId.toString().replace(/^-100/, '')}-${request.messageId}.json`,
  );
  await fs.promises.writeFile(
    logFile,
    JSON.stringify(
      {
        input: request.text,
        response: moderationResponse,
      },
      null,
      2,
    ),
  );

  if (!moderationResult.flagged) {
    return;
  }
  const scores = moderationResult.category_scores;
  let maxCategory: string | null = null;
  let maxScore: number | null = null;
  for (const [category, score] of Object.entries(scores)) {
    if (score > (maxScore ?? 0)) {
      maxCategory = category;
      maxScore = score;
    }
  }
  let emojiReaction: '😡' | '🤬' | '😱' | '😨' | '🤔' | null = null;
  switch (maxCategory) {
    case 'sexual':
    case 'sexual/minors':
      emojiReaction = '😡';
      break;
    case 'harassment':
    case 'harassment/threatening':
    case 'hate':
    case 'hate/threatening':
      emojiReaction = '🤬';
      break;
    case 'illicit':
    case 'illicit/violent':
    case 'violence':
    case 'violence/graphic':
      emojiReaction = '😱';
      break;
    case 'self-harm':
    case 'self-harm/intent':
    case 'self-harm/instructions':
      emojiReaction = '😨';
      break;
    default:
      emojiReaction = '🤔';
      break;
  }
  if (emojiReaction) {
    const reaction: ReactionType = {
      type: 'emoji',
      emoji: emojiReaction,
    };
    await bot.telegram.setMessageReaction(request.chatId, request.messageId, [
      reaction,
    ]);
  }
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({apiKey: OPENAI_API_KEY});

bot.on(message('text'), async ctx => {
  const message = ctx.message;
  const text = message.text;
  // remove @usernames and links
  const cleanedText = text
    .replace(/@[^\s]+/g, '')
    .replace(/https?:\/\/[^\s]+/g, '');
  enqueueForModeration({
    text: cleanedText,
    chatId: message.chat.id,
    messageId: message.message_id,
  });
});

bot.on(editedMessage('text'), async ctx => {
  const message = ctx.editedMessage;
  const text = message.text;
  const cleanedText = text
    .replace(/@[^\s]+/g, '')
    .replace(/https?:\/\/[^\s]+/g, '');
  enqueueForModeration({
    text: cleanedText,
    chatId: message.chat.id,
    messageId: message.message_id,
  });
});

bot.launch().catch(err => {
  throw err;
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
