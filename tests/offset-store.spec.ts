import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileOffsetStore } from '../src/offset-store.ts'

const roots: string[] = []

async function statePath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-telegram-offset-'))
  roots.push(root)
  return path.join(root, 'nested', 'state.json')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('FileOffsetStore', () => {
  it('returns zero when no state exists', async () => {
    expect(await new FileOffsetStore(await statePath()).load()).toBe(0)
  })

  it('atomically saves and reloads the next offset', async () => {
    const file = await statePath()
    const store = new FileOffsetStore(file)

    await store.save(190_098_938)

    expect(await store.load()).toBe(190_098_938)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      nextUpdateOffset: 190_098_938,
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await readdir(path.dirname(file))).filter(name => name.endsWith('.tmp')))
      .toEqual([])
  })

  it.each([
    ['not-json', 'not valid JSON'],
    [JSON.stringify({ version: 2, nextUpdateOffset: 1 }), 'unsupported format'],
    [JSON.stringify({ version: 1, nextUpdateOffset: -1 }), 'unsupported format'],
  ])('rejects corrupted state: %s', async (content, message) => {
    const file = await statePath()
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)

    await expect(new FileOffsetStore(file).load()).rejects.toThrow(message)
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid offsets: %s',
    async (offset) => {
      await expect(new FileOffsetStore(await statePath()).save(offset))
        .rejects.toThrow('non-negative safe integer')
    },
  )
})
