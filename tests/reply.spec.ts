import { describe, expect, it, vi } from 'vitest'
import { HttpError } from 'grammy'
import {
  sendTelegramText,
  splitTelegramText,
} from '../src/reply.ts'
import type { TelegramClient } from '../src/telegram-client.ts'

const delivery = {
  retryMinMilliseconds: 1,
  retryMaxMilliseconds: 2,
}

function client(sendMessage: TelegramClient['sendMessage']): TelegramClient {
  return {
    getMe: vi.fn(),
    getUpdates: vi.fn(),
    sendMessage,
  }
}

describe('splitTelegramText', () => {
  it('keeps short and exact-limit text in one piece', () => {
    expect(splitTelegramText('hello')).toEqual(['hello'])
    expect(splitTelegramText('a'.repeat(4_096))).toEqual(['a'.repeat(4_096)])
    expect(splitTelegramText('')).toEqual([])
  })

  it('splits long text without changing its content', () => {
    const text = 'a'.repeat(4_097)
    const chunks = splitTelegramText(text)

    expect(chunks.map(chunk => chunk.length)).toEqual([4_096, 1])
    expect(chunks.join('')).toBe(text)
  })

  it('never splits a Unicode surrogate pair', () => {
    const text = '😀'.repeat(2_049)
    const chunks = splitTelegramText(text)

    expect(chunks.map(chunk => chunk.length)).toEqual([4_096, 2])
    expect(chunks.join('')).toBe(text)
  })
})

describe('sendTelegramText', () => {
  it('sends all chunks in order as plain text', async () => {
    const sendMessage = vi.fn().mockResolvedValue(1)
    const signal = new AbortController().signal

    await sendTelegramText(
      client(sendMessage),
      '123',
      'a'.repeat(4_097),
      delivery,
      { warn: vi.fn() },
      signal,
    )

    expect(sendMessage.mock.calls.map(call => call[1].length)).toEqual([4_096, 1])
    expect(sendMessage.mock.calls.every(call => call[0] === '123' && call[2] === signal))
      .toBe(true)
  })

  it('retries transport errors without resplitting the reply', async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new HttpError('network', new Error('offline')))
      .mockResolvedValueOnce(9)
    const warn = vi.fn()

    await sendTelegramText(
      client(sendMessage),
      '123',
      'hello',
      delivery,
      { warn },
      new AbortController().signal,
    )

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      'telegram-relay: sendMessage retry (telegram_network_error) in 1ms',
    )
  })

  it('returns a stable error for permanent failures', async () => {
    await expect(sendTelegramText(
      client(vi.fn().mockRejectedValue(new Error('secret request payload'))),
      '123',
      'hello',
      delivery,
      { warn: vi.fn() },
      new AbortController().signal,
    )).rejects.toThrow('sendMessage failed (telegram_unknown_error)')
  })
})
