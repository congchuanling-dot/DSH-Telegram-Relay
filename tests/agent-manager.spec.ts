import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

const installModelSelection = vi.hoisted(() => vi.fn())

vi.mock('@deepseek-ai/dsh-agent', () => ({ installModelSelection }))

import { TelegramAgentManager } from '../src/agent-manager.ts'

interface Bench {
  readonly ctx: Context
  readonly agent: Agent
  readonly handle: AgentHandle
  readonly get: ReturnType<typeof vi.fn>
  readonly create: ReturnType<typeof vi.fn>
  readonly resume: ReturnType<typeof vi.fn>
  readonly list: ReturnType<typeof vi.fn>
  readonly dispose: ReturnType<typeof vi.fn>
}

function bench(stored = false): Bench {
  const requestHeader = vi.fn().mockReturnValue(undefined)
  const agent = {
    id: SessionId('123'),
    session: { requestHeader },
  } as unknown as Agent
  const agentCtx = { agent } as unknown as Context
  const dispose = vi.fn().mockResolvedValue(undefined)
  const handle: AgentHandle = { agent, dispose }
  const get = vi.fn().mockReturnValue(undefined)
  const create = vi.fn(async (options: CreateAgentOptions) => {
    await options.setup?.(agentCtx)
    return handle
  })
  const resume = vi.fn(async (options: ResumeAgentOptions) => {
    await options.setup?.(agentCtx)
    return handle
  })
  const list = vi.fn().mockResolvedValue(
    stored ? [{ id: SessionId('123') }] : [],
  )
  const ctx = {
    agents: { get, create, resume },
    sessionPersistence: { list },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek', model: 'chat' }),
    },
  } as unknown as Context
  return { ctx, agent, handle, get, create, resume, list, dispose }
}

beforeEach(() => {
  installModelSelection.mockReset()
})

describe('TelegramAgentManager', () => {
  it('creates a new Agent whose Session ID is the Telegram chat ID', async () => {
    const state = bench()
    const manager = new TelegramAgentManager(state.ctx, '/workspace')
    const signal = new AbortController().signal

    await expect(manager.get('123', signal)).resolves.toBe(state.agent)

    expect(state.create).toHaveBeenCalledOnce()
    expect(state.create.mock.calls[0]![0]).toMatchObject({
      sessionId: '123',
      meta: { cwd: '/workspace' },
      agentOptions: { provider: 'deepseek', model: 'chat' },
      signal,
    })
    expect(state.resume).not.toHaveBeenCalled()
    expect(installModelSelection).toHaveBeenCalledOnce()
  })

  it('resumes a persisted Session and keeps its logged model selection', async () => {
    const state = bench(true)
    vi.mocked(state.agent.session.requestHeader).mockReturnValue({
      config: { provider: 'logged-provider', model: 'logged-model' },
    } as never)
    const manager = new TelegramAgentManager(state.ctx, '/workspace')

    await manager.get('123', new AbortController().signal)

    expect(state.resume).toHaveBeenCalledOnce()
    expect(state.resume.mock.calls[0]![0]).toMatchObject({
      resumeSessionId: '123',
    })
    expect(state.create).not.toHaveBeenCalled()
    expect(installModelSelection.mock.calls[0]![1]).toMatchObject({
      current: { provider: 'logged-provider', model: 'logged-model' },
    })
  })

  it('deduplicates initialization and disposes its owned handle', async () => {
    const state = bench()
    const manager = new TelegramAgentManager(state.ctx, '/workspace')
    const signal = new AbortController().signal

    const [first, second] = await Promise.all([
      manager.get('123', signal),
      manager.get('123', signal),
    ])
    await manager.dispose()

    expect(first).toBe(second)
    expect(state.create).toHaveBeenCalledOnce()
    expect(state.dispose).toHaveBeenCalledOnce()
  })

  it('drops a failed initialization so the next message can retry', async () => {
    const state = bench()
    state.create
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce(state.handle)
    const manager = new TelegramAgentManager(state.ctx, '/workspace')
    const signal = new AbortController().signal

    await expect(manager.get('123', signal)).rejects.toThrow('create failed')
    await expect(manager.get('123', signal)).resolves.toBe(state.agent)

    expect(state.create).toHaveBeenCalledTimes(2)
  })
})
