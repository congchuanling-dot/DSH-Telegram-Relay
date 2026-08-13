/**
 * Telegram Relay 的外部配置与启动时校验。
 *
 * @module config
 */

import path from 'node:path'
import z from '@deepseek-ai/schemastery'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PRIVATE_CHAT_ID_PATTERN = /^[1-9]\d*$/

/** 用户可在 `cordis.patch.yml` 中调整的插件配置。 */
export interface Config {
  /** 保存 Bot Token 的环境变量名。 */
  tokenEnv?: string
  /** 允许访问 DSH 的 Telegram 私聊 ID。 */
  allowedChatIds: string[]
  /** `getUpdates` 单次长轮询的服务端等待秒数。 */
  pollTimeoutSeconds?: number
  /** 网络错误后的最短重试等待时间。 */
  retryMinMilliseconds?: number
  /** 网络错误后的最长重试等待时间。 */
  retryMaxMilliseconds?: number
  /** 持久化 Telegram update offset 的绝对路径。 */
  stateFile: string
}

/** Cordis 在插件启动前执行的基础字段校验。 */
export const Config: z<Config> = z.object({
  tokenEnv: z.string().pattern(ENV_NAME_PATTERN).default('TELEGRAM_BOT_TOKEN'),
  allowedChatIds: z.array(z.string().pattern(PRIVATE_CHAT_ID_PATTERN)).min(1).required(),
  pollTimeoutSeconds: z.number().step(1).min(1).max(50).default(30),
  retryMinMilliseconds: z.number().step(1).min(100).max(60_000).default(1_000),
  retryMaxMilliseconds: z.number().step(1).min(100).max(300_000).default(30_000),
  stateFile: z.string().min(1).required(),
})

/** 插件内部使用的完整配置。 */
export interface ResolvedConfig {
  /** Telegram Bot Token，仅保存在进程内存中。 */
  readonly token: string
  readonly allowedChatIds: ReadonlySet<string>
  readonly pollTimeoutSeconds: number
  readonly retryMinMilliseconds: number
  readonly retryMaxMilliseconds: number
  readonly stateFile: string
}

/**
 * 完成 Schema 无法表达的跨字段与运行环境校验。
 *
 * @param config - Cordis 已解析的插件配置。
 * @param env - Token 来源；测试可传入隔离环境。
 * @returns 插件运行时使用的只读配置。
 */
export function resolveConfig(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const tokenEnv = config.tokenEnv ?? 'TELEGRAM_BOT_TOKEN'
  if (!ENV_NAME_PATTERN.test(tokenEnv)) {
    throw new Error('telegram-relay: tokenEnv must be a valid environment variable name')
  }

  const token = env[tokenEnv]
  if (token === undefined || token.trim() === '') {
    throw new Error(`telegram-relay: environment variable ${tokenEnv} is required`)
  }

  if (config.allowedChatIds.length === 0) {
    throw new Error('telegram-relay: allowedChatIds must not be empty')
  }
  const allowedChatIds = new Set<string>()
  for (const chatId of config.allowedChatIds) {
    if (!PRIVATE_CHAT_ID_PATTERN.test(chatId)) {
      throw new Error(`telegram-relay: invalid private chat id ${JSON.stringify(chatId)}`)
    }
    if (allowedChatIds.has(chatId)) {
      throw new Error(`telegram-relay: duplicate private chat id ${JSON.stringify(chatId)}`)
    }
    allowedChatIds.add(chatId)
  }

  const pollTimeoutSeconds = config.pollTimeoutSeconds ?? 30
  const retryMinMilliseconds = config.retryMinMilliseconds ?? 1_000
  const retryMaxMilliseconds = config.retryMaxMilliseconds ?? 30_000
  if (retryMinMilliseconds > retryMaxMilliseconds) {
    throw new Error('telegram-relay: retryMinMilliseconds must not exceed retryMaxMilliseconds')
  }
  if (!path.isAbsolute(config.stateFile)) {
    throw new Error('telegram-relay: stateFile must be an absolute path')
  }

  return {
    token,
    allowedChatIds,
    pollTimeoutSeconds,
    retryMinMilliseconds,
    retryMaxMilliseconds,
    stateFile: config.stateFile,
  }
}
