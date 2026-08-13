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
import { Config, resolveConfig } from './config.ts'

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
 * 校验 Telegram Relay 配置。
 *
 * 后续模块将在该入口挂载长轮询；当前骨架先保证错误配置不会被静默接受。
 *
 * @param _ctx - 当前 Cordis 上下文。
 * @param config - Telegram Relay 配置。
 */
export function apply(_ctx: Context, config: Config): void {
  resolveConfig(config)
}
