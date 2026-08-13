/**
 * Telegram Bot API 的最小适配层。
 *
 * @module telegram-client
 */

import { Api, GrammyError, HttpError } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'

export type { Update as TelegramUpdate, UserFromGetMe as TelegramBotIdentity }

type GrammyAbortSignal = NonNullable<Parameters<Api['getMe']>[0]>

/**
 * grammY 的 Node 声明仍引用 abort-controller 包；Node 原生 signal 在运行时实现相同接口。
 */
function toGrammySignal(signal: AbortSignal): GrammyAbortSignal {
  return signal as unknown as GrammyAbortSignal
}

/** Polling 与对话层依赖的 Telegram 操作，测试可提供内存实现。 */
export interface TelegramClient {
  getMe(signal: AbortSignal): Promise<UserFromGetMe>
  getUpdates(offset: number, timeoutSeconds: number, signal: AbortSignal): Promise<Update[]>
  sendMessage(chatId: string, text: string, signal: AbortSignal): Promise<number>
}

/** 使用 grammY 调用官方 Telegram Bot API。 */
export class GrammyTelegramClient implements TelegramClient {
  private readonly api: Api

  /**
   * @param token - BotFather 分配的 Token；客户端默认不会把 Token写入错误日志。
   */
  constructor(token: string) {
    this.api = new Api(token, { sensitiveLogs: false })
  }

  /** @inheritdoc */
  async getMe(signal: AbortSignal): Promise<UserFromGetMe> {
    return await this.api.getMe(toGrammySignal(signal))
  }

  /** @inheritdoc */
  async getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal: AbortSignal,
  ): Promise<Update[]> {
    return await this.api.getUpdates({
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message'],
    }, toGrammySignal(signal))
  }

  /** @inheritdoc */
  async sendMessage(chatId: string, text: string, signal: AbortSignal): Promise<number> {
    const message = await this.api.sendMessage(chatId, text, {}, toGrammySignal(signal))
    return message.message_id
  }
}

/** Telegram 请求失败后的稳定重试判定，不向上层暴露包含请求参数的错误对象。 */
export type TelegramFailure =
  | { readonly retry: true; readonly waitMilliseconds?: number; readonly code: string }
  | { readonly retry: false; readonly code: string }

/**
 * 将 grammY 错误压缩成不含 Token 和请求参数的稳定结果。
 *
 * @param error - grammY 或底层网络抛出的错误。
 * @returns 是否可重试及 Telegram 建议的等待时间。
 */
export function classifyTelegramFailure(error: unknown): TelegramFailure {
  if (error instanceof GrammyError) {
    if (error.error_code === 429) {
      const retryAfter = error.parameters.retry_after
      return {
        retry: true,
        code: 'rate_limited',
        ...(retryAfter === undefined ? {} : { waitMilliseconds: retryAfter * 1_000 }),
      }
    }
    if (error.error_code >= 500) return { retry: true, code: 'telegram_server_error' }
    return { retry: false, code: `telegram_${error.error_code}` }
  }
  if (error instanceof HttpError) return { retry: true, code: 'telegram_network_error' }
  return { retry: false, code: 'telegram_unknown_error' }
}
