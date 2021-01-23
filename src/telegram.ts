// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {Telegraf, Context, Markup} from 'telegraf';
import * as tt from 'telegraf/typings/telegram-types';
import {Config} from './config';

const postCommand = 'post';

function info(user: tt.User) {
  const segments = [user.id.toString()];
  if (user.username) {
    segments.push(`@${user.username}`);
  }
  if (user.first_name) {
    segments.push(user.first_name);
  }
  if (user.last_name) {
    segments.push(user.last_name);
  }
  return segments.join(' ');
}

function log(message: string) {
  console.log(`${new Date().toISOString()}: ${message}`);
}

export class Telegram {
  private bot: Telegraf;
  private config: Config;
  private admins: Map<number, NodeJS.Timeout>;
  private pendingMessageContexts: Map<number, Context>;

  constructor(config: Config) {
    this.admins = new Map<number, NodeJS.Timeout>();
    this.pendingMessageContexts = new Map<number, Context>();
    this.config = config;
    this.bot = new Telegraf(config.telegramToken);
    this.bot.start((ctx: Context) => {
      this.handleStart(ctx);
    });
    this.bot.command(postCommand, (ctx: Context) => {
      this.handlePost(ctx);
    });
    this.bot.on('message', (ctx: Context) => {
      this.handleMessage(ctx);
    });
    this.bot.action('send', (ctx: Context) => {
      this.forwardMessage(ctx);
    });
    this.bot.action('cancel', (ctx: Context) => {
      this.cancelMessage(ctx);
    });
  }

  async start() {
    log('bot is launching');
    await this.bot.launch();
    log('bot is listening for updates');
  }

  stop() {
    log('bot is stopping.');
    this.bot.stop();
  }

  private async handleStart(ctx: Context) {
    const user = ctx.from;
    if (!user) {
      return;
    }
    try {
      log(`/start received from ${info(user)}`);
      await ctx.reply(
        'Добрый день! Чтобы создать пост в канале, напишите текст поста сюда и я ' +
          'перешлю это сообщение в канал. Вы также можете получить права администратора ' +
          `на ${this.config.adminTimeoutMinutes} мин. для создания поста в канале напрямую; ` +
          `для этого отправьте мне команду /${postCommand}.`
      );
    } catch (err) {
      log(`error trying to process /start from ${info(user)}: ${err}`);
    }
  }

  private async handleMessage(ctx: Context) {
    const user = ctx.from;
    if (!user) {
      return;
    }
    try {
      log(`message received from ${info(user)}, asking to confirm`);
      this.pendingMessageContexts.set(user.id, ctx);
      await ctx.reply(
        'Переслать это сообщение в канал?',
        Markup.inlineKeyboard([
          Markup.button.callback('Переслать', 'send'),
          Markup.button.callback('Отмена', 'cancel'),
        ])
      );
    } catch (err) {
      log(`error trying to ask for confirmation from ${info(user)}: ${err}`);
    }
  }

  private async forwardMessage(ctx: Context) {
    const user = ctx.from;
    if (!user) {
      return;
    }
    try {
      const messageContext = this.pendingMessageContexts.get(user.id);
      if (!messageContext) {
        log(`no message from ${info(user)} to send`);
        await ctx.reply('Напишите мне сообщение, и я перешлю его в канал.');
        await ctx.answerCbQuery();
        return;
      }
      this.pendingMessageContexts.delete(user.id);
      log(`forwarding message from ${info(user)} to the channel`);
      await messageContext.forwardMessage(this.config.channelId);
      await ctx.answerCbQuery('Сообщение отправлено.');
    } catch (err) {
      log(`error trying to forward a message from ${info(user)}: ${err}`);
    }
  }

  private async cancelMessage(ctx: Context) {
    const user = ctx.from;
    if (!user) {
      return;
    }
    try {
      this.pendingMessageContexts.delete(user.id);
      log(`canceling message from ${info(user)}`);
      await ctx.answerCbQuery('Сообщение отменено.');
    } catch (err) {
      log(`error trying to cancel a message from ${info(user)}: ${err}`);
    }
  }

  private async demoteAdmin(userId: number, userInfo: string) {
    try {
      log(`demoting user ${userInfo}`);
      await this.bot.telegram.promoteChatMember(this.config.channelId, userId, {
        is_anonymous: false,
        can_change_info: false,
        can_delete_messages: false,
        can_edit_messages: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_post_messages: false,
        can_promote_members: false,
        can_restrict_members: false,
      });
    } catch (err) {
      log(`error trying to demote ${userInfo}: ${err}`);
    }
  }

  private async handlePost(ctx: Context) {
    const user = ctx.from;
    if (!user) {
      return;
    }
    try {
      log(`/${postCommand} received from ${info(user)}`);
      // 1. Schedule removal from temporary admins
      if (this.config.admins.includes(user.id)) {
        log(`user ${info(user)} is a known admin, doing nothing.`);
        await ctx.reply('Вы уже являетесь администратором канала.');
        return;
      }
      if (this.admins.has(user.id)) {
        clearTimeout(this.admins.get(user.id)!);
      }
      const timeout = setTimeout(() => {
        this.demoteAdmin(user.id, info(user));
      }, this.config.adminTimeoutMinutes * 60 * 1000);
      this.admins.set(user.id, timeout);

      // 2. Allow posting messages
      await this.bot.telegram.promoteChatMember(
        this.config.channelId,
        user.id,
        {
          is_anonymous: false,
          can_change_info: false,
          can_delete_messages: false,
          can_edit_messages: false,
          can_invite_users: false,
          can_pin_messages: false,
          can_post_messages: true,
          can_promote_members: false,
          can_restrict_members: false,
        }
      );

      await ctx.reply(
        `Вы можете писать в канал в течение ${this.config.adminTimeoutMinutes} мин.`
      );
    } catch (err) {
      log(`error trying to process /${postCommand} from ${info(user)}: ${err}`);
    }
  }
}
