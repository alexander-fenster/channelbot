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

import Telegram from 'telegraf/typings/telegram';
import * as tt from 'telegraf/typings/telegram-types';

function prettyName(user: tt.User) {
  const nameParts = [];
  if (user.first_name) {
    nameParts.push(user.first_name);
  }
  if (user.last_name) {
    nameParts.push(user.last_name);
  }
  if (nameParts.length === 0 && user.username) {
    nameParts.push(`@${user.username}`);
  }
  if (nameParts.length === 0) {
    nameParts.push(user.id.toString());
  }
  return nameParts.join(' ');
}

export function formatMessage(
  from: tt.User,
  message:
    | tt.Message.TextMessage
    | tt.Message.CaptionableMessage
    | tt.Message.AudioMessage
    | tt.Message.DocumentMessage
    | tt.Message.AnimationMessage
    | tt.Message.PhotoMessage
    | tt.Message.VideoMessage
    | tt.Message.VoiceMessage
) {
  const name = prettyName(from);
  const prefixes = ['Автор:', name];
  const prefixEntities: tt.MessageEntity[] = [
    {
      type: 'bold',
      offset: 0,
      length: prefixes[0].length,
    },
    {
      type: 'text_mention',
      offset: prefixes[0].length + 1,
      length: prefixes[1].length,
      user: from,
    },
  ];
  const prefix = prefixes.join(' ') + '\n';
  if ('text' in message) {
    const textMessage = message as tt.Message.TextMessage;
    textMessage.text = prefix + textMessage.text;
    if (!('entities' in textMessage)) {
      textMessage.entities = [];
    }
    textMessage.entities!.forEach(entity => (entity.offset += prefix.length));
    textMessage.entities!.unshift(...prefixEntities);
    return textMessage;
  }
  if (
    'audio' in message ||
    'document' in message ||
    'animation' in message ||
    'photo' in message ||
    'video' in message ||
    'voice' in message
  ) {
    const captionableMessage = message as tt.Message.CaptionableMessage;
    if (typeof captionableMessage.caption === 'undefined') {
      captionableMessage.caption = '';
    }
    captionableMessage.caption = prefix + captionableMessage.caption;
    if (!('caption_entities' in captionableMessage)) {
      captionableMessage.caption_entities = [];
    }
    captionableMessage.caption_entities!.forEach(
      entity => (entity.offset += prefix.length)
    );
    captionableMessage.caption_entities!.unshift(...prefixEntities);
    return captionableMessage;
  }
  return null;
}

export async function sendFormattedMessage(
  telegram: Telegram,
  channelId: number,
  message:
    | tt.Message.TextMessage
    | tt.Message.CaptionableMessage
    | tt.Message.AudioMessage
    | tt.Message.DocumentMessage
    | tt.Message.AnimationMessage
    | tt.Message.PhotoMessage
    | tt.Message.VideoMessage
    | tt.Message.VoiceMessage
) {
  if ('text' in message) {
    return await telegram.sendMessage(channelId, message.text, {
      entities: message.entities,
    });
  }
  if (!('caption' in message)) {
    throw new Error(
      `Neither text nor caption found in message ${JSON.stringify(message)}`
    );
  }
  const captionProperties = {
    caption: message.caption,
    caption_entities: message.caption_entities,
  };
  if ('audio' in message) {
    return await telegram.sendAudio(
      channelId,
      message.audio.file_id,
      captionProperties
    );
  }
  if ('document' in message) {
    return await telegram.sendDocument(
      channelId,
      message.document.file_id,
      captionProperties
    );
  }
  if ('animation' in message) {
    return await telegram.sendAnimation(
      channelId,
      (message as tt.Message.AnimationMessage).animation.file_id,
      captionProperties
    );
  }
  if ('photo' in message) {
    return await telegram.sendPhoto(
      channelId,
      message.photo?.[0].file_id,
      captionProperties
    );
  }
  if ('video' in message) {
    return await telegram.sendVideo(
      channelId,
      message.video.file_id,
      captionProperties
    );
  }
  if ('voice' in message) {
    return await telegram.sendVoice(
      channelId,
      message.voice.file_id,
      captionProperties
    );
  }
  throw new Error(
    `Cannot determine message type for message ${JSON.stringify(
      message
    )}, cannot send.`
  );
}

export async function editFormattedMessage(
  telegram: Telegram,
  channelId: number,
  message: tt.Message.TextMessage | tt.Message.CaptionableMessage
) {
  if ('text' in message) {
    return await telegram.editMessageText(
      channelId,
      message.message_id,
      undefined,
      message.text,
      {entities: message.entities}
    );
  }
  if ('caption' in message) {
    return await telegram.editMessageCaption(
      channelId,
      message.message_id,
      undefined,
      message.caption,
      ({
        caption_entities: message.caption_entities,
      } as unknown) as tt.ExtraEditMessageCaption // wrong type in .d.ts
    );
  }
  throw new Error(
    `Cannot determine message type for editing message ${JSON.stringify(
      message
    )}, cannot edit.`
  );
}
