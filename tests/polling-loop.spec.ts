import { describe, expect, it, vi } from 'vitest'
import { HttpError } from 'grammy'
import type { OffsetStore } from '../src/offset-store.ts'
import { runPollingLoop } from '../src/polling-loop.ts'
import type { TelegramClient, TelegramUpdate } from '../src/telegram-client.ts'

const options = {
  timeoutSeconds: 30,
  retryMinMilliseconds: 1,
  retryMaxMilliseconds: 2,
}

function update(updateId: number): TelegramUpdate {
  return { update_id: updateId } as TelegramUpdate
}

function client(
  getUpdates: TelegramClient['getUpdates'],
): TelegramClient {
  return {
    getMe: vi.fn(),
    getUpdates,
    sendMessage: vi.fn(),
  }
}

function store(initial = 0): OffsetStore & {
  load: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
} {
  return {
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
  }
}

describe('runPollingLoop', () => {
  it('processes updates serially and saves only completed offsets', async () => {
    const controller = new AbortController()
    const offsets = store()
    const seen: number[] = []
    const telegram = client(vi.fn().mockResolvedValue([update(1), update(2)]))

    await runPollingLoop(
      telegram,
      offsets,
      options,
      async (item) => {
        seen.push(item.update_id)
        if (item.update_id === 2) controller.abort()
      },
      { warn: vi.fn() },
      controller.signal,
    )

    expect(seen).toEqual([1, 2])
    expect(offsets.save.mock.calls.map(call => call[0])).toEqual([2, 3])
  })

  it('skips updates older than the persisted offset', async () => {
    const controller = new AbortController()
    const offsets = store(10)
    const seen: number[] = []

    await runPollingLoop(
      client(vi.fn().mockResolvedValue([update(9), update(10)])),
      offsets,
      options,
      async (item) => {
        seen.push(item.update_id)
        controller.abort()
      },
      { warn: vi.fn() },
      controller.signal,
    )

    expect(seen).toEqual([10])
    expect(offsets.save).toHaveBeenCalledOnce()
    expect(offsets.save).toHaveBeenCalledWith(11)
  })

  it('does not acknowledge an update when its handler fails', async () => {
    const offsets = store()

    await expect(runPollingLoop(
      client(vi.fn().mockResolvedValue([update(1)])),
      offsets,
      options,
      async () => { throw new Error('handler failed') },
      { warn: vi.fn() },
      new AbortController().signal,
    )).rejects.toThrow('handler failed')

    expect(offsets.save).not.toHaveBeenCalled()
  })

  it('retries a transport failure before processing the next batch', async () => {
    const controller = new AbortController()
    const getUpdates = vi.fn()
      .mockRejectedValueOnce(new HttpError('network', new Error('offline')))
      .mockResolvedValueOnce([update(5)])
    const warn = vi.fn()

    await runPollingLoop(
      client(getUpdates),
      store(),
      options,
      async () => { controller.abort() },
      { warn },
      controller.signal,
    )

    expect(getUpdates).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      'telegram-relay: polling retry (telegram_network_error) in 1ms',
    )
  })

  it('stops on a permanent polling failure', async () => {
    await expect(runPollingLoop(
      client(vi.fn().mockRejectedValue(new Error('bad request'))),
      store(),
      options,
      vi.fn(),
      { warn: vi.fn() },
      new AbortController().signal,
    )).rejects.toThrow('polling failed (telegram_unknown_error)')
  })
})
