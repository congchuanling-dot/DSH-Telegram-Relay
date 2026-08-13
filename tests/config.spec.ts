import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'

const base = {
  allowedChatIds: ['123456789'],
  cwd: '/tmp/project',
  stateFile: '/tmp/telegram/state.json',
}

describe('resolveConfig', () => {
  it('resolves defaults without exposing chat IDs as numbers', () => {
    const resolved = resolveConfig(base, { TELEGRAM_BOT_TOKEN: 'secret' })

    expect(resolved).toMatchObject({
      token: 'secret',
      cwd: '/tmp/project',
      pollTimeoutSeconds: 30,
      retryMinMilliseconds: 1_000,
      retryMaxMilliseconds: 30_000,
    })
    expect([...resolved.allowedChatIds]).toEqual(['123456789'])
  })

  it('reads a custom token environment variable', () => {
    const resolved = resolveConfig(
      { ...base, tokenEnv: 'MY_BOT_TOKEN' },
      { MY_BOT_TOKEN: 'custom-secret' },
    )

    expect(resolved.token).toBe('custom-secret')
  })

  it.each([
    [{ ...base, allowedChatIds: [] }, 'allowedChatIds must not be empty'],
    [{ ...base, allowedChatIds: ['1', '1'] }, 'duplicate private chat id'],
    [{ ...base, allowedChatIds: ['-100'] }, 'invalid private chat id'],
    [{ ...base, cwd: 'relative' }, 'cwd must be an absolute path'],
    [{ ...base, stateFile: 'relative' }, 'stateFile must be an absolute path'],
    [
      { ...base, retryMinMilliseconds: 2_000, retryMaxMilliseconds: 1_000 },
      'retryMinMilliseconds must not exceed',
    ],
  ])('rejects unsafe config: %s', (config, message) => {
    expect(() => resolveConfig(config, { TELEGRAM_BOT_TOKEN: 'secret' }))
      .toThrow(message)
  })

  it('rejects a missing or blank token', () => {
    expect(() => resolveConfig(base, {})).toThrow('TELEGRAM_BOT_TOKEN is required')
    expect(() => resolveConfig(base, { TELEGRAM_BOT_TOKEN: '  ' }))
      .toThrow('TELEGRAM_BOT_TOKEN is required')
  })

  it('lets the Cordis schema apply defaults and reject out-of-range polling', () => {
    expect(Config(base)).toMatchObject({ pollTimeoutSeconds: 30 })
    expect(() => Config({ ...base, pollTimeoutSeconds: 0 })).toThrow()
  })
})
