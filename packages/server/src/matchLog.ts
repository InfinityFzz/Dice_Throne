/**
 * 对局日志的文件后端 —— 只负责「读 / 追加」，重建语义在 `shared/engine/persistence.ts`。
 *
 * 追加写入（append-only）+ 周期快照：进程被 kill 时最多丢最后一行，
 * 且半行会被 `parseLog` 丢弃，因此**永远是可恢复的**，不需要 fsync 级别的保证。
 */
import { readFile, appendFile, mkdir, rename, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseLog, type LogEntry } from '../../shared/src/index.js';

export class MatchLog {
  private chain: Promise<unknown> = Promise.resolve();
  /** 待写入的行，合并成一次 appendFile，减少 syscall */
  private pending: string[] = [];

  private constructor(
    readonly roomId: string,
    readonly file: string,
    private entries: LogEntry[],
  ) {}

  static async open(dir: string, roomId: string): Promise<MatchLog> {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${roomId}.jsonl`);
    const text = existsSync(file) ? await readFile(file, 'utf8') : '';
    return new MatchLog(roomId, file, [...parseLog(text)]);
  }

  get snapshot(): readonly LogEntry[] {
    return this.entries;
  }

  /** 追加一行。内部串行化 —— 调用方（MatchActor）已串行，这里是第二道保险。 */
  append(entry: LogEntry): Promise<void> {
    this.entries.push(entry);
    this.pending.push(`${JSON.stringify(entry)}\n`);
    return this.enqueue(() => this.writePending());
  }

  /** 立即把待写行刷盘（对局结束 / 关键节点用） */
  flush(): Promise<void> {
    if (this.pending.length === 0) return Promise.resolve();
    return this.enqueue(() => this.writePending());
  }

  /**
   * 日志压缩：把历史全部替换成一条当前快照。
   * 默认不调用（append-only 更利于排错），保留给日志过长的场景。
   */
  async compact(current: LogEntry): Promise<void> {
    return this.enqueue(async () => {
      await this.writePending();
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(current)}\n`, 'utf8');
      await rename(tmp, this.file);
      this.entries = [current];
    });
  }

  private writePending(): Promise<void> {
    if (this.pending.length === 0) return Promise.resolve();
    const lines = this.pending;
    this.pending = [];
    return appendFile(this.file, lines.join(''), 'utf8');
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }
}

/** 列出持久化目录里所有已有对局（用于启动恢复） */
export async function listMatchIds(dir: string): Promise<readonly string[]> {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -'.jsonl'.length));
}
