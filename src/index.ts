/**
 * DeepSeek Harness 的 Telegram 私聊入口。
 *
 * @module dsh-telegram-relay
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TelegramAgentManager } from './agent-manager.ts'
import { createUpdateHandler } from './bridge.ts'
import { Config, resolveConfig } from './config.ts'
import { FileOffsetStore } from './offset-store.ts'
import { runPollingLoop, type PollingLogger } from './polling-loop.ts'
import {
  classifyTelegramFailure,
  GrammyTelegramClient,
} from './telegram-client.ts'

export { Config } from './config.ts'
export type { Config as TelegramRelayConfig, ResolvedConfig } from './config.ts'

/** Cordis 插件名。 */
export const name = 'telegram-relay'

/** 启动对话桥接前必须存在的 DSH 服务。 */
export const inject = [
  'agents',
  'agentDefaultModel',
  'sessions',
  'sessionPersistence',
]

/**
 * 校验配置并在 Cordis 生命周期内运行 Telegram 长轮询。
 *
 * @param ctx - 当前 Cordis 上下文。
 * @param config - Telegram Relay 配置。
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.effect(async () => {
    const controller = new AbortController()
    const client = new GrammyTelegramClient(resolved.token)
    let identity
    try {
      identity = await client.getMe(controller.signal)
    } catch (error) {
      const failure = classifyTelegramFailure(error)
      throw new Error(`telegram-relay: Bot authentication failed (${failure.code})`)
    }

    const logger: PollingLogger = {
      warn: message => ctx.logger.warn(message),
    }
    const agents = new TelegramAgentManager(ctx, resolved.cwd)
    const offsets = new FileOffsetStore(resolved.stateFile)
    const handler = createUpdateHandler(ctx, client, resolved, agents, logger)
    const polling = runPollingLoop(client, offsets, {
      timeoutSeconds: resolved.pollTimeoutSeconds,
      retryMinMilliseconds: resolved.retryMinMilliseconds,
      retryMaxMilliseconds: resolved.retryMaxMilliseconds,
    }, handler, logger, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'unknown failure'
        ctx.logger.error(`telegram-relay: polling stopped: ${message}`)
      }
    })

    ctx.logger.info(`telegram-relay: connected as @${identity.username}`)
    return async () => {
      controller.abort(new Error('telegram-relay: plugin disposed'))
      await polling
      await agents.dispose()
    }
  })
}
