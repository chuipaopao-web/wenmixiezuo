import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';

export interface ToolRequest {
  toolCallId: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
}

export interface ToolAdapter {
  readonly toolName: string;
  execute(request: ToolRequest, signal: AbortSignal): Promise<ToolResult>;
}

export class RestrictedHttpToolAdapter implements ToolAdapter {
  public readonly toolName = 'restricted_http';

  public constructor(private readonly allowedOrigins: ReadonlySet<string>, private readonly maxBytes = 1_000_000) {}

  public async execute(request: ToolRequest, signal: AbortSignal): Promise<ToolResult> {
    const url = String(request.parameters.url ?? '');
    const parsed = new URL(url);
    if (!this.allowedOrigins.has(parsed.origin)) throw new Error('HTTP工具目标不在允许列表');
    const response = await fetch(parsed, {
      method: 'GET', redirect: 'error', signal,
      headers: { accept: 'application/json,text/plain;q=0.9,*/*;q=0.1' }
    });
    if (!response.ok) throw new Error(`HTTP工具请求失败：${response.status}`);
    const output = await response.text();
    if (Buffer.byteLength(output, 'utf8') > this.maxBytes) throw new Error('HTTP工具响应超过安全上限');
    return { output };
  }
}

export class RestrictedSubprocessToolAdapter implements ToolAdapter {
  public readonly toolName = 'restricted_subprocess';
  readonly #active = new Set<ChildProcessWithoutNullStreams>();
  readonly #workingDirectory: string;

  public constructor(
    private readonly executable: string,
    workingDirectory: string,
    private readonly maxBytes = 1_000_000
  ) {
    this.#workingDirectory = resolve(workingDirectory);
  }

  public get activeProcessCount(): number {
    return this.#active.size;
  }

  public execute(request: ToolRequest, signal: AbortSignal): Promise<ToolResult> {
    const args = request.parameters.args;
    if (!Array.isArray(args) || !args.every((value) => typeof value === 'string')) throw new Error('子进程参数必须是字符串数组');
    return new Promise<ToolResult>((resolvePromise, reject) => {
      const child = spawn(this.executable, args, {
        cwd: this.#workingDirectory,
        env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdin.end();
      this.#active.add(child);
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      let size = 0;
      let aborted = false;
      let settled = false;

      const finish = (error: Error | null, result?: ToolResult): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        this.#active.delete(child);
        if (error !== null) reject(error);
        else resolvePromise(result!);
      };
      const abort = (): void => {
        aborted = true;
        child.kill();
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBytes) child.kill();
        else output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBytes) child.kill();
        else errors.push(chunk);
      });
      child.once('error', (error) => finish(error));
      child.once('close', (code) => {
        if (aborted) finish(new DOMException('工具调用已取消', 'AbortError'));
        else if (size > this.maxBytes) finish(new Error('子进程输出超过安全上限'));
        else if (code !== 0) finish(new Error(`子进程失败：${Buffer.concat(errors).toString('utf8').trim() || `exit ${String(code)}`}`));
        else finish(null, { output: Buffer.concat(output).toString('utf8') });
      });
    });
  }
}
