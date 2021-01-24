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

import * as fs from 'fs';
import * as path from 'path';
import {Config} from './config';

// We'll just use the filesystem for storing messages for now.
// As (if) we grow larger, we'll switch to Redis or anything else.

export class MessageDatabase {
  private dbPath: string;

  constructor(config: Config) {
    this.dbPath = config.messageDatabase;
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath);
    }
  }

  async getChannelMessageId(chatId: number, messageId: number) {
    if (
      !chatId?.toString()?.match(/^\d+$/) ||
      !messageId?.toString()?.match(/^\d+$/)
    ) {
      throw new Error(
        `Wrong chat ID ${chatId} and/or message ID ${messageId} given`
      );
    }
    const chatPath = path.join(this.dbPath, chatId.toString());
    if (!fs.existsSync(chatPath)) {
      return null;
    }
    const messagePath = path.join(
      this.dbPath,
      chatId.toString(),
      messageId.toString()
    );
    if (!fs.existsSync(messagePath)) {
      return null;
    }
    const content = await fs.promises.readFile(messagePath);
    return Number.parseInt(content.toString());
  }

  async saveChannelMessageId(
    chatId: number,
    messageId: number,
    channelMessageId: number
  ) {
    if (
      !chatId?.toString()?.match(/^\d+$/) ||
      !messageId?.toString()?.match(/^\d+$/)
    ) {
      throw new Error(
        `Wrong chat ID ${chatId} and/or message ID ${messageId} given`
      );
    }
    const chatPath = path.join(this.dbPath, chatId.toString());
    if (!fs.existsSync(chatPath)) {
      await fs.promises.mkdir(chatPath);
    }
    const messagePath = path.join(
      this.dbPath,
      chatId.toString(),
      messageId.toString()
    );
    await fs.promises.writeFile(
      messagePath,
      channelMessageId.toString() + '\n'
    );
  }
}
