import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api, GrammyError, HttpError } from 'grammy'
import {
  classifyTelegramFailure,
  GrammyTelegramClient,
} from '../src/telegram-client.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

function apiError(
  errorCode: number,
  parameters: Record<string, number> = {},
): GrammyError {
  return new GrammyError(
    'Telegram failed',
    {
      ok: false,
      error_code: errorCode,
      description: 'failed',
      parameters,
    } as ConstructorParameters<typeof GrammyError>[1],
    'getUpdates',
    {},
  )
}

describe('GrammyTelegramClient', () => {
  it('requests only message updates with offset and long-poll timeout', async () => {
    const getUpdates = vi.spyOn(Api.prototype, 'getUpdates').mockResolvedValue([])
    const signal = new AbortController().signal

    await new GrammyTelegramClient('secret').getUpdates(42, 30, signal)

    expect(getUpdates).toHaveBeenCalledWith({
      offset: 42,
      timeout: 30,
      allowed_updates: ['message'],
    }, signal)
  })

  it('returns the sent Telegram message id', async () => {
    const sendMessage = vi.spyOn(Api.prototype, 'sendMessage')
      .mockResolvedValue({ message_id: 77 } as never)
    const signal = new AbortController().signal

    const id = await new GrammyTelegramClient('secret')
      .sendMessage('123', 'hello', signal)

    expect(id).toBe(77)
    expect(sendMessage).toHaveBeenCalledWith('123', 'hello', {}, signal)
  })
})

describe('classifyTelegramFailure', () => {
  it('honors Telegram rate-limit advice', () => {
    expect(classifyTelegramFailure(apiError(429, { retry_after: 3 }))).toEqual({
      retry: true,
      code: 'rate_limited',
      waitMilliseconds: 3_000,
    })
  })

  it('retries server and transport failures', () => {
    expect(classifyTelegramFailure(apiError(502))).toEqual({
      retry: true,
      code: 'telegram_server_error',
    })
    expect(classifyTelegramFailure(new HttpError('network', new Error('offline'))))
      .toEqual({ retry: true, code: 'telegram_network_error' })
  })

  it('rejects permanent and unknown failures without leaking payloads', () => {
    expect(classifyTelegramFailure(apiError(403))).toEqual({
      retry: false,
      code: 'telegram_403',
    })
    expect(classifyTelegramFailure(new Error('secret payload'))).toEqual({
      retry: false,
      code: 'telegram_unknown_error',
    })
  })
})
