/**
 * Telegram 文本分片与安全重试。
 *
 * @module reply
 */

import { setTimeout as sleep } from 'node:timers/promises'
import {
  classifyTelegramFailure,
  type TelegramClient,
} from './telegram-client.ts'
import type { PollingLogger } from './polling-loop.ts'

const TELEGRAM_TEXT_LIMIT = 4_096

/** 发送失败后的退避范围。 */
export interface DeliveryOptions {
  readonly retryMinMilliseconds: number
  readonly retryMaxMilliseconds: number
}

/**
 * 按 Unicode code point 切分文本，每片的 UTF-16 长度不超过 Telegram 上限。
 *
 * @param text - DSH 最终回答。
 * @returns 保持原顺序的非空文本片段。
 */
export function splitTelegramText(text: string): string[] {
  if (text === '') return []
  const chunks: string[] = []
  let current = ''
  for (const point of text) {
    if (current.length + point.length > TELEGRAM_TEXT_LIMIT) {
      chunks.push(current)
      current = point
    } else {
      current += point
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}

/**
 * 顺序发送完整回答；可重试错误使用有上限的指数退避。
 *
 * @param client - Telegram API 客户端。
 * @param chatId - 已授权的目标私聊。
 * @param text - 要发送的纯文本，不启用 Markdown 或 HTML。
 * @param options - 退避范围。
 * @param logger - 只记录稳定错误码。
 * @param signal - 插件生命周期取消信号。
 */
export async function sendTelegramText(
  client: TelegramClient,
  chatId: string,
  text: string,
  options: DeliveryOptions,
  logger: PollingLogger,
  signal: AbortSignal,
): Promise<void> {
  for (const chunk of splitTelegramText(text)) {
    await sendChunk(client, chatId, chunk, options, logger, signal)
  }
}

async function sendChunk(
  client: TelegramClient,
  chatId: string,
  text: string,
  options: DeliveryOptions,
  logger: PollingLogger,
  signal: AbortSignal,
): Promise<void> {
  let retryMilliseconds = options.retryMinMilliseconds
  while (true) {
    signal.throwIfAborted()
    try {
      await client.sendMessage(chatId, text, signal)
      return
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const failure = classifyTelegramFailure(error)
      if (!failure.retry) {
        throw new Error(`telegram-relay: sendMessage failed (${failure.code})`)
      }
      const waitMilliseconds = Math.min(
        failure.waitMilliseconds ?? retryMilliseconds,
        options.retryMaxMilliseconds,
      )
      logger.warn(`telegram-relay: sendMessage retry (${failure.code}) in ${waitMilliseconds}ms`)
      await sleep(waitMilliseconds, undefined, { signal })
      retryMilliseconds = Math.min(
        retryMilliseconds * 2,
        options.retryMaxMilliseconds,
      )
    }
  }
}
