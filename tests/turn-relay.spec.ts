import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  createAssistantMessage,
  createUserMessage,
  MessageId,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  runAgentTurn,
  summarizeTurn,
} from '../src/turn-relay.ts'

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test', model: 'test' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('summarizeTurn', () => {
  it('returns the answer belonging to the exact user message', () => {
    const session = Session.create(SessionId('chat'))
    const previous = createUserMessage({
      content: [{ type: 'text', text: 'previous' }],
      source: { kind: 'user' },
    })
    const target = createUserMessage({
      content: [{ type: 'text', text: 'target' }],
      source: { kind: 'user' },
    })
    const later = createUserMessage({
      content: [{ type: 'text', text: 'later' }],
      source: { kind: 'user' },
    })
    appendTurn(session, 1, previous, 'previous answer')
    appendTurn(session, 2, target, 'target answer')
    appendTurn(session, 3, later, 'later answer')

    expect(summarizeTurn(session.events, target.id)).toEqual({
      text: 'target answer',
      reason: { kind: 'completed' },
    })
  })

  it('rejects a message outside a turn and an unfinished target turn', () => {
    const id = MessageId('target')
    const user = createUserMessage({
      content: [{ type: 'text', text: 'target' }],
      source: { kind: 'user' },
    })
    const outside = [{
      type: 'user/message',
      seq: 0,
      time: 1,
      data: { ...user, id },
      surfaceOp: 'append',
    }] as SessionEvent[]
    const unfinished = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { ...outside[0]!, seq: 1 },
    ] as SessionEvent[]

    expect(() => summarizeTurn(outside, id)).toThrow('has no open turn')
    expect(() => summarizeTurn(unfinished, id)).toThrow('did not finish')
  })
})

describe('runAgentTurn', () => {
  it('waits for idle, flushes persistence, and returns the generated answer', async () => {
    const session = Session.create(SessionId('chat'))
    const whenIdle = vi.fn().mockResolvedValue(undefined)
    const followup = vi.fn((message: UserMessage) => {
      appendTurn(session, 1, message, 'hello from DSH')
    })
    const agent = { session, whenIdle, followup } as unknown as Agent
    const flush = vi.fn().mockResolvedValue(true)
    const ctx = { sessions: { flush } } as unknown as Context

    await expect(runAgentTurn(ctx, agent, 'hello')).resolves.toEqual({
      text: 'hello from DSH',
      reason: { kind: 'completed' },
    })
    expect(whenIdle).toHaveBeenCalledTimes(2)
    expect(followup).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledWith(session)
  })
})
