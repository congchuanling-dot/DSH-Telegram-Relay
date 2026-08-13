import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TelegramAgentManager } from '../src/agent-manager.ts'
import type { ResolvedConfig } from '../src/config.ts'
import type { TelegramClient, TelegramUpdate } from '../src/telegram-client.ts'

const runAgentTurn = vi.hoisted(() => vi.fn())

vi.mock('../src/turn-relay.ts', () => ({ runAgentTurn }))

import { createUpdateHandler } from '../src/bridge.ts'

function config(): ResolvedConfig {
  return {
    token: 'secret',
    allowedChatIds: new Set(['123']),
    cwd: '/workspace',
    pollTimeoutSeconds: 30,
    retryMinMilliseconds: 1,
    retryMaxMilliseconds: 2,
    stateFile: '/tmp/state.json',
  }
}

function textUpdate(chatId: number, text: string, type = 'private'): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: chatId, type },
      text,
    },
  } as TelegramUpdate
}

function nonTextUpdate(chatId: number): TelegramUpdate {
  return {
    update_id: 2,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: chatId, type: 'private' },
      photo: [],
    },
  } as unknown as TelegramUpdate
}

function dependencies() {
  const sendMessage = vi.fn().mockResolvedValue(1)
  const client: TelegramClient = {
    getMe: vi.fn(),
    getUpdates: vi.fn(),
    sendMessage,
  }
  const get = vi.fn().mockResolvedValue({} as Agent)
  const agents = { get } as unknown as TelegramAgentManager
  const warn = vi.fn()
  const handler = createUpdateHandler(
    {} as Context,
    client,
    config(),
    agents,
    { warn },
  )
  return { handler, sendMessage, get, warn }
}

beforeEach(() => {
  runAgentTurn.mockReset()
})

describe('createUpdateHandler', () => {
  it('silently rejects non-private and non-allowlisted chats', async () => {
    const state = dependencies()
    const signal = new AbortController().signal

    await state.handler(textUpdate(123, 'group', 'group'), signal)
    await state.handler(textUpdate(999, 'unauthorized'), signal)

    expect(state.get).not.toHaveBeenCalled()
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(runAgentTurn).not.toHaveBeenCalled()
  })

  it('answers unsupported messages without creating a DSH Agent', async () => {
    const state = dependencies()

    await state.handler(nonTextUpdate(123), new AbortController().signal)

    expect(state.get).not.toHaveBeenCalled()
    expect(state.sendMessage).toHaveBeenCalledWith(
      '123',
      '当前仅支持文本消息。',
      expect.any(AbortSignal),
    )
  })

  it('routes allowed text through DSH and replies to the same chat', async () => {
    const state = dependencies()
    runAgentTurn.mockResolvedValue({
      text: 'DSH answer',
      reason: { kind: 'completed' },
    })

    await state.handler(textUpdate(123, 'hello'), new AbortController().signal)

    expect(state.get).toHaveBeenCalledWith('123', expect.any(AbortSignal))
    expect(runAgentTurn).toHaveBeenCalledWith({}, {}, 'hello')
    expect(state.sendMessage).toHaveBeenCalledWith(
      '123',
      'DSH answer',
      expect.any(AbortSignal),
    )
  })

  it('returns a stable message when DSH processing fails', async () => {
    const state = dependencies()
    runAgentTurn.mockRejectedValue(new Error('sensitive internal detail'))

    await state.handler(textUpdate(123, 'hello'), new AbortController().signal)

    expect(state.sendMessage).toHaveBeenCalledWith(
      '123',
      '请求处理失败，请稍后重试。',
      expect.any(AbortSignal),
    )
    expect(state.warn).toHaveBeenCalledWith(
      'telegram-relay: update 1 failed (Error)',
    )
  })
})
