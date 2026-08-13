/**
 * 可中止的 Telegram 长轮询循环。
 *
 * @module polling-loop
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type { OffsetStore } from './offset-store.ts'
import {
  classifyTelegramFailure,
  type TelegramClient,
  type TelegramUpdate,
} from './telegram-client.ts'

/** 长轮询和网络退避参数。 */
export interface PollingOptions {
  readonly timeoutSeconds: number
  readonly retryMinMilliseconds: number
  readonly retryMaxMilliseconds: number
}

/** Polling 只记录稳定错误码，避免错误对象携带 Telegram 请求参数。 */
export interface PollingLogger {
  warn(message: string): void
}

/** 一个 Update 处理成功后才会推进持久化 offset。 */
export type TelegramUpdateHandler = (
  update: TelegramUpdate,
  signal: AbortSignal,
) => Promise<void>

/**
 * 持续拉取并串行处理 Telegram Update，直到 signal 被中止。
 *
 * `await getUpdates()` 期间由网络 I/O 挂起，不会进行 CPU 忙等。
 *
 * @param client - Telegram API 客户端。
 * @param offsets - 已确认 Update 的持久化位置。
 * @param options - 长轮询和退避参数。
 * @param handleUpdate - 单个 Update 的业务处理函数。
 * @param logger - 仅接收脱敏后的稳定错误码。
 * @param signal - 插件生命周期的取消信号。
 */
export async function runPollingLoop(
  client: TelegramClient,
  offsets: OffsetStore,
  options: PollingOptions,
  handleUpdate: TelegramUpdateHandler,
  logger: PollingLogger,
  signal: AbortSignal,
): Promise<void> {
  let offset = await offsets.load()
  let retryMilliseconds = options.retryMinMilliseconds

  while (!signal.aborted) {
    let updates: TelegramUpdate[]
    try {
      updates = await client.getUpdates(offset, options.timeoutSeconds, signal)
      retryMilliseconds = options.retryMinMilliseconds
    } catch (error) {
      if (signal.aborted) return
      const failure = classifyTelegramFailure(error)
      if (!failure.retry) {
        throw new Error(`telegram-relay: polling failed (${failure.code})`)
      }
      const waitMilliseconds = Math.min(
        failure.waitMilliseconds ?? retryMilliseconds,
        options.retryMaxMilliseconds,
      )
      logger.warn(`telegram-relay: polling retry (${failure.code}) in ${waitMilliseconds}ms`)
      if (!await wait(waitMilliseconds, signal)) return
      retryMilliseconds = Math.min(
        retryMilliseconds * 2,
        options.retryMaxMilliseconds,
      )
      continue
    }

    for (const update of updates) {
      if (update.update_id < offset) continue
      await handleUpdate(update, signal)
      offset = update.update_id + 1
      await offsets.save(offset)
    }
  }
}

/** 等待退避时间；取消属于正常停机，不向外抛出 AbortError。 */
async function wait(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(milliseconds, undefined, { signal })
    return true
  } catch (error) {
    if (signal.aborted) return false
    throw error
  }
}
