/**
 * Telegram chat 与 DSH Agent 生命周期的连接。
 *
 * @module agent-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

/** 一个 chat 只初始化一次 Agent，失败后允许下一条消息重试。 */
export class TelegramAgentManager {
  private readonly handles = new Map<string, Promise<AgentHandle>>()

  /**
   * @param ctx - 提供 Agent、默认模型与 Session 持久化服务的 Cordis 上下文。
   * @param cwd - 新 Session 的工具工作目录。
   */
  constructor(
    private readonly ctx: Context,
    private readonly cwd: string,
  ) {}

  /**
   * 获取 chat 对应的 Agent；Session ID 直接使用 chat ID。
   *
   * @param chatId - 已通过 allowlist 的 Telegram 私聊 ID。
   * @param signal - 插件生命周期取消信号。
   * @returns 已恢复或新建的 DSH Agent。
   */
  async get(chatId: string, signal: AbortSignal): Promise<Agent> {
    const sessionId = SessionId(chatId)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live

    let pending = this.handles.get(chatId)
    if (pending === undefined) {
      pending = this.open(sessionId, signal)
      this.handles.set(chatId, pending)
      void pending.catch(() => {
        if (this.handles.get(chatId) === pending) this.handles.delete(chatId)
      })
    }
    return (await pending).agent
  }

  /** 停止本插件创建或恢复的全部 Agent。 */
  async dispose(): Promise<void> {
    const settled = await Promise.allSettled(this.handles.values())
    await Promise.all(settled.flatMap(result =>
      result.status === 'fulfilled' ? [result.value.dispose()] : [],
    ))
    this.handles.clear()
  }

  /** 根据持久化列表选择 resume 或 create。 */
  private async open(sessionId: SessionId, signal: AbortSignal): Promise<AgentHandle> {
    const stored = (await this.ctx.sessionPersistence.list(signal))
      .some(header => header.id === sessionId)
    const selection = this.ctx.agentDefaultModel.currentSelection()
    if (stored) {
      return await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: {
          provider: selection.provider,
          model: selection.model,
        },
        signal,
        setup: agentCtx => installSelection(agentCtx, selection),
      })
    }
    return await this.ctx.agents.create({
      sessionId,
      meta: { cwd: this.cwd },
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
      },
      signal,
      setup: agentCtx => installSelection(agentCtx, selection),
    })
  }
}

/** 恢复时优先沿用 Session 已记录的模型，否则使用当前默认模型。 */
function installSelection(agentCtx: Context, fallback: ModelSelection): void {
  const agent = agentCtx.agent
  if (agent === undefined) {
    throw new Error('telegram-relay: agent setup has no scoped agent')
  }
  const logged = agent.session.requestHeader()?.config
  const current: ModelSelection = logged === undefined
    ? fallback
    : {
        provider: logged.provider,
        model: logged.model,
        ...(logged.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: logged.reasoningEffort }),
      }
  const selection: ModelSelectionRef = { current, assembled: undefined }
  installModelSelection(agentCtx, selection)
}
