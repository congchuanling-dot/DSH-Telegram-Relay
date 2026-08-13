/**
 * Telegram Update 到 DSH turn 的业务路由。
 *
 * @module bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { TelegramAgentManager } from './agent-manager.ts'
import type { ResolvedConfig } from './config.ts'
import type {
  PollingLogger,
  TelegramUpdateHandler,
} from './polling-loop.ts'
import { sendTelegramText } from './reply.ts'
import type { TelegramClient, TelegramUpdate } from './telegram-client.ts'
import { runAgentTurn } from './turn-relay.ts'

const UNSUPPORTED_MESSAGE = '当前仅支持文本消息。'
const EMPTY_RESPONSE = 'DSH 没有返回可显示的文本。'
const FAILED_RESPONSE = '请求处理失败，请稍后重试。'

/**
 * 创建一个只接受 allowlist 私聊文本的 Update 处理器。
 *
 * @param ctx - DSH Cordis 上下文。
 * @param client - Telegram API 客户端。
 * @param config - 已完成安全校验的运行配置。
 * @param agents - chat 对应的 Agent 管理器。
 * @param logger - 脱敏日志出口。
 * @returns 可交给 polling loop 的串行处理函数。
 */
export function createUpdateHandler(
  ctx: Context,
  client: TelegramClient,
  config: ResolvedConfig,
  agents: TelegramAgentManager,
  logger: PollingLogger,
): TelegramUpdateHandler {
  return async (update, signal) => {
    const message = update.message
    if (message === undefined || message.chat.type !== 'private') return

    const chatId = String(message.chat.id)
    if (!config.allowedChatIds.has(chatId)) return
    if (!hasText(message)) {
      await sendReply(client, chatId, UNSUPPORTED_MESSAGE, config, logger, signal)
      return
    }

    let response: string
    try {
      const agent = await agents.get(chatId, signal)
      const result = await runAgentTurn(ctx, agent, message.text)
      response = responseFor(result.text, result.reason.kind)
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      logger.warn(`telegram-relay: update ${update.update_id} failed (${errorName})`)
      response = FAILED_RESPONSE
    }
    await sendReply(client, chatId, response, config, logger, signal)
  }
}

function hasText(
  message: NonNullable<TelegramUpdate['message']>,
): message is NonNullable<TelegramUpdate['message']> & { text: string } {
  return 'text' in message && typeof message.text === 'string'
}

function responseFor(text: string, reason: string): string {
  if (reason === 'error'
    || reason === 'aborted'
    || reason === 'blocked'
    || reason === 'interrupted') {
    return FAILED_RESPONSE
  }
  return text === '' ? EMPTY_RESPONSE : text
}

function sendReply(
  client: TelegramClient,
  chatId: string,
  text: string,
  config: ResolvedConfig,
  logger: PollingLogger,
  signal: AbortSignal,
): Promise<void> {
  return sendTelegramText(client, chatId, text, {
    retryMinMilliseconds: config.retryMinMilliseconds,
    retryMaxMilliseconds: config.retryMaxMilliseconds,
  }, logger, signal)
}
