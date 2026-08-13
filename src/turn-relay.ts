/**
 * 将一条 Telegram 文本驱动为一个 DSH turn，并提取对应回答。
 *
 * @module turn-relay
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'

/** 一个已结束 turn 可回传给 Telegram 的结果。 */
export interface TurnReply {
  readonly text: string
  readonly reason: TurnEndReason
}

/**
 * 提交用户文本并等待该输入对应的 turn 完成。
 *
 * @param ctx - 提供 Session flush 的 Cordis 上下文。
 * @param agent - chat 对应的 DSH Agent。
 * @param text - Telegram 用户文本。
 * @returns 最终 assistant 文本和 turn 结束原因。
 */
export async function runAgentTurn(
  ctx: Context,
  agent: Agent,
  text: string,
): Promise<TurnReply> {
  // whenIdle 只负责建立无并发起点；回答归属仍由消息 ID 精确定位。
  await agent.whenIdle()
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
  agent.followup(message)
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
  return summarizeTurn(agent.session.events, message.id)
}

/**
 * 从 Session 日志中定位包含指定用户消息的 turn。
 *
 * @param events - Agent 的完整 Session 日志。
 * @param messageId - 本次 Telegram 输入对应的 DSH 消息 ID。
 * @returns 该 turn 的最后一条非空 assistant 文本。
 */
export function summarizeTurn(
  events: readonly SessionEvent[],
  messageId: MessageId,
): TurnReply {
  let openTurn: number | undefined
  let targetTurn: number | undefined
  let text = ''

  for (const event of events) {
    if (event.type === 'turn/start') {
      openTurn = event.data.turn
      continue
    }
    if (event.type === 'user/message' && event.data.id === messageId) {
      if (openTurn === undefined) {
        throw new Error('telegram-relay: target user message has no open turn')
      }
      targetTurn = openTurn
      continue
    }
    if (targetTurn !== undefined
      && event.type === 'assistant/message'
      && event.data.turn === targetTurn) {
      const candidate = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (candidate !== '') text = candidate
      continue
    }
    if (event.type === 'turn/end') {
      if (event.data.turn === targetTurn) {
        return { text, reason: event.data.reason }
      }
      if (event.data.turn === openTurn) openTurn = undefined
    }
  }
  throw new Error('telegram-relay: target turn did not finish')
}
