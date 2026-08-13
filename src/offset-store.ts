/**
 * Telegram update offset 的持久化。
 *
 * @module offset-store
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface OffsetDocument {
  readonly version: 1
  readonly nextUpdateOffset: number
}

/** Polling 只依赖这两个操作，测试无需访问真实文件。 */
export interface OffsetStore {
  load(): Promise<number>
  save(nextUpdateOffset: number): Promise<void>
}

/** 将 offset 保存为一个权限受限的 JSON 文件。 */
export class FileOffsetStore implements OffsetStore {
  /** @param stateFile - 状态文件的绝对路径。 */
  constructor(private readonly stateFile: string) {}

  /** @inheritdoc */
  async load(): Promise<number> {
    let content: string
    try {
      content = await readFile(this.stateFile, 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return 0
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (cause) {
      throw new Error('telegram-relay: offset state is not valid JSON', { cause })
    }
    if (!isOffsetDocument(parsed)) {
      throw new Error('telegram-relay: offset state has an unsupported format')
    }
    return parsed.nextUpdateOffset
  }

  /** @inheritdoc */
  async save(nextUpdateOffset: number): Promise<void> {
    if (!Number.isSafeInteger(nextUpdateOffset) || nextUpdateOffset < 0) {
      throw new Error('telegram-relay: next update offset must be a non-negative safe integer')
    }

    const directory = path.dirname(this.stateFile)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`
    const document: OffsetDocument = { version: 1, nextUpdateOffset }
    try {
      await writeFile(temporary, `${JSON.stringify(document)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporary, this.stateFile)
    } finally {
      // rename 成功后临时文件已不存在；失败时尽力清理，原始异常仍应保留。
      await unlink(temporary).catch((error: unknown) => {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error
        }
      })
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isOffsetDocument(value: unknown): value is OffsetDocument {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.version === 1
    && Number.isSafeInteger(record.nextUpdateOffset)
    && (record.nextUpdateOffset as number) >= 0
}
