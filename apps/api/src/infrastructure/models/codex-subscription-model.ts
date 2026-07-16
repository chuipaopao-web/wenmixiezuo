import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { RoleKey } from '../../domain/roles.js';
import { buildRoleSystemPrompt } from '../../domain/role-prompts.js';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';
import type { ModelPurpose } from './model-runtime-config.js';

export interface CodexRunInput {
  executable: string;
  args: string[];
  workingDirectory: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CodexRunResult {
  output: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CodexProcessRunner {
  run(input: CodexRunInput): Promise<CodexRunResult>;
}

export interface CodexSubscriptionModelOptions {
  executable: string;
  provider: 'openai-codex-subscription';
  modelId: string;
  workingDirectory: string;
  timeoutMs: number;
  purpose: ModelPurpose;
  roleKey: RoleKey;
}

interface CodexJsonEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class SpawnCodexProcessRunner implements CodexProcessRunner {
  public async run(input: CodexRunInput): Promise<CodexRunResult> {
    if (input.signal?.aborted === true) throw input.signal.reason ?? new DOMException('Codex调用已取消', 'AbortError');
    return await new Promise<CodexRunResult>((resolvePromise, rejectPromise) => {
      const child = spawn(input.executable, input.args, {
        cwd: input.workingDirectory,
        env: safeCodexEnvironment(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      let settled = false;
      let output = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let stdoutBuffer = '';
      let stderr = '';
      let terminationError: Error | undefined;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abortHandler);
        if (error !== undefined) rejectPromise(error);
        else if (output.trim().length === 0) rejectPromise(new Error('Codex订阅通道没有返回文字'));
        else resolvePromise({ output: output.trim(), inputTokens, outputTokens });
      };
      const abortHandler = (): void => {
        terminationError = input.signal?.reason instanceof Error
          ? input.signal.reason
          : new DOMException('Codex调用已取消', 'AbortError');
        child.kill('SIGTERM');
      };
      const timer = setTimeout(() => {
        terminationError = new Error(`Codex订阅通道在${input.timeoutMs}毫秒内未完成`);
        child.kill('SIGTERM');
      }, input.timeoutMs);
      input.signal?.addEventListener('abort', abortHandler, { once: true });

      const consumeLine = (line: string): void => {
        if (line.trim().length === 0) return;
        try {
          const event = JSON.parse(line) as CodexJsonEvent;
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
            output = event.item.text;
          }
          if (event.type === 'turn.completed') {
            inputTokens = validTokenCount(event.usage?.input_tokens);
            outputTokens = validTokenCount(event.usage?.output_tokens);
          }
        } catch {
          // Codex JSONL之外的诊断行不进入模型结果或业务日志。
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/u);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-2_000);
      });
      child.once('error', (error) => finish(error));
      child.once('close', (code, signal) => {
        consumeLine(stdoutBuffer);
        if (terminationError !== undefined) {
          finish(terminationError);
          return;
        }
        if (code !== 0) {
          finish(new Error(`Codex订阅通道异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}${stderr.trim().length === 0 ? '' : ` ${sanitizeProcessDiagnostic(stderr).slice(0, 300)}`}`));
          return;
        }
        finish();
      });
      child.stdin.once('error', (error) => finish(error));
      child.stdin.end(input.prompt, 'utf8');
    });
  }
}

export class CodexSubscriptionModelAdapter implements ModelAdapter {
  public readonly provider: string;
  public readonly modelId: string;

  public constructor(
    private readonly options: CodexSubscriptionModelOptions,
    private readonly runner: CodexProcessRunner = new SpawnCodexProcessRunner()
  ) {
    this.provider = options.provider;
    this.modelId = options.modelId;
    if (options.modelId !== 'gpt-5.6-sol' && options.modelId !== 'gpt-5.6') {
      throw new Error(`未批准的Codex订阅模型：${options.modelId}`);
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 30_000 || options.timeoutMs > 900_000) {
      throw new Error('Codex调用超时必须在30秒至15分钟之间');
    }
    mkdirSync(options.workingDirectory, { recursive: true });
  }

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted === true) throw signal.reason ?? new DOMException('Codex调用已取消', 'AbortError');
    const system = buildRoleSystemPrompt(this.options.roleKey, this.options.purpose);
    const prompt = [
      system,
      '运行限制：不得调用工具、命令、联网、MCP、子Agent或读写文件；不要解释运行限制，只完成文本任务。',
      `输出上限：${request.maxOutputTokens} Token。`,
      '【本次任务输入】',
      request.prompt
    ].join('\n\n');
    const args = [
      'exec', '--ephemeral', '--ignore-user-config',
      '--model', this.modelId,
      '--config', 'model_reasoning_effort="xhigh"',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '--cd', this.options.workingDirectory,
      '--json', '-'
    ];
    const result = await this.runner.run({
      executable: this.options.executable,
      args,
      workingDirectory: this.options.workingDirectory,
      prompt,
      timeoutMs: this.options.timeoutMs,
      ...(signal === undefined ? {} : { signal })
    });
    return {
      provider: this.provider,
      modelId: this.modelId,
      output: result.output,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cashCostCny: 0,
      state: 'succeeded'
    };
  }
}

function validTokenCount(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : 0;
}

function sanitizeProcessDiagnostic(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, '$1***@')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .trim();
}

function safeCodexEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'WINDIR', 'USERPROFILE', 'HOME',
    'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CODEX_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'
  ];
  const target: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = source[name];
    if (value !== undefined) target[name] = value;
  }
  return target;
}
