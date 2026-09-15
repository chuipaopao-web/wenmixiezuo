#!/usr/bin/env node
// CTX-01 阶段一运行器（在服务器上运行，从环境变量读取套餐凭证，凭证不落盘不进日志）。
// 对指定题材的请求文件逐个调用 deepseek-v4-pro（火山方舟 Coding Plan，/api/coding/v1/messages，
// Anthropic 式报文，与 apps/api ark-plan-model 适配器同构），记录完整用量、耗时、停止原因。
// 用法：node run-phase1.mjs <evidence目录> --genre <genreId> [--max-calls N]
// 输入：evidence/samples/*.request.json（仅选中 --genre 指定题材）
// 输出：evidence/outputs/<requestId>.output.json + evidence/run-log.jsonl
// 预算纪律：默认 maxCalls=20；鉴权失败立即终止；网络/5xx/超时每个请求最多重试一次；
// 输出达长度上限（max_tokens）记录 truncated=true，不自动加大额度重试。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding';
const ENDPOINT = `${BASE_URL}/v1/messages`;
const TIMEOUT_MS = 900_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const evidenceDir = args[0];
  if (!evidenceDir) throw new Error('用法：node run-phase1.mjs <evidence目录> --genre <genreId> [--max-calls N]');
  const genreIdx = args.indexOf('--genre');
  const genre = genreIdx >= 0 ? args[genreIdx + 1] : undefined;
  if (!genre) throw new Error('缺少 --genre <genreId>');
  const maxCallsIdx = args.indexOf('--max-calls');
  const maxCalls = maxCallsIdx >= 0 ? Number.parseInt(args[maxCallsIdx + 1], 10) : 20;
  return { evidenceDir, genre, maxCalls };
}

function logLine(logPath, record) {
  appendFileSync(logPath, `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`);
}

async function callModel(apiKey, request, logPath) {
  const body = {
    model: request.modelParams.model,
    max_tokens: request.modelParams.maxTokensWithHeadroom,
    thinking: request.modelParams.thinking,
    system: request.system,
    messages: [{ role: 'user', content: request.user }]
  };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('CTX-01 调用超时', 'TimeoutError')), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replaceAll(apiKey, '***').slice(0, 240);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      return { ok: false, latencyMs, status: response.status, detail, retryable, auth: response.status === 401 || response.status === 403 };
    }
    const payload = await response.json();
    const output = (payload.content ?? [])
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    return {
      ok: true,
      latencyMs,
      output,
      stopReason: payload.stop_reason ?? 'unknown',
      truncated: payload.stop_reason === 'max_tokens' || payload.stop_reason === 'length',
      usage: {
        input_tokens: Number.isInteger(payload.usage?.input_tokens) ? payload.usage.input_tokens : 0,
        output_tokens: Number.isInteger(payload.usage?.output_tokens) ? payload.usage.output_tokens : 0
      }
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      status: 0,
      detail: `请求中断：${error instanceof Error ? error.name : String(error)}`,
      retryable: true,
      auth: false
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { evidenceDir, genre, maxCalls } = parseArgs();
  const apiKey = process.env.WENMI_ARK_CODING_PLAN_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('WENMI_ARK_CODING_PLAN_API_KEY 未配置，无法执行（不新增付费通道，受阻即终止）');
  }
  const samplesDir = join(evidenceDir, 'samples');
  const outputsDir = join(evidenceDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });
  const logPath = join(evidenceDir, 'run-log.jsonl');

  const requests = readdirSync(samplesDir)
    .filter((f) => f.endsWith('.request.json'))
    .map((f) => JSON.parse(readFileSync(join(samplesDir, f), 'utf8')))
    .filter((r) => r.genreId === genre)
    .filter((r) => !existsSync(join(outputsDir, `${r.id}.output.json`)))
    .sort((a, b) => a.id.localeCompare(b.id));

  logLine(logPath, { event: 'phase1_begin', genre, planned: requests.length, maxCalls });
  let calls = 0;
  for (const request of requests) {
    if (calls >= maxCalls) {
      logLine(logPath, { event: 'budget_stop', calls });
      break;
    }
    calls += 1;
    logLine(logPath, {
      event: 'call_begin',
      id: request.id,
      totalInputChars: request.totalInputChars,
      effectiveBodyChars: request.effectiveBodyChars,
      modelParams: request.modelParams
    });
    let result = await callModel(apiKey, request, logPath);
    if (!result.ok && result.auth) {
      logLine(logPath, { event: 'auth_failure', id: request.id, status: result.status, detail: result.detail });
      console.error(`鉴权失败（${result.status}），终止：${result.detail}`);
      process.exit(2);
    }
    if (!result.ok && result.retryable) {
      logLine(logPath, { event: 'call_retry_wait', id: request.id, status: result.status, detail: result.detail });
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      result = await callModel(apiKey, request, logPath);
      if (!result.ok && result.auth) {
        logLine(logPath, { event: 'auth_failure', id: request.id, status: result.status, detail: result.detail });
        process.exit(2);
      }
    }
    if (!result.ok) {
      logLine(logPath, { event: 'call_failed', id: request.id, status: result.status, detail: result.detail, latencyMs: result.latencyMs });
      writeFileSync(join(outputsDir, `${request.id}.output.json`), JSON.stringify({
        id: request.id,
        failed: true,
        status: result.status,
        detail: result.detail,
        latencyMs: result.latencyMs,
        output: '',
        usage: null,
        stopReason: null,
        truncated: false
      }, null, 2));
      continue;
    }
    logLine(logPath, {
      event: 'call_complete',
      id: request.id,
      latencyMs: result.latencyMs,
      stopReason: result.stopReason,
      truncated: result.truncated,
      usage: result.usage,
      outputChars: result.output.length
    });
    writeFileSync(join(outputsDir, `${request.id}.output.json`), JSON.stringify({
      id: request.id,
      failed: false,
      output: result.output,
      usage: result.usage,
      latencyMs: result.latencyMs,
      stopReason: result.stopReason,
      truncated: result.truncated
    }, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  logLine(logPath, { event: 'phase1_end', calls });
  console.log(`done: ${calls} calls, outputs in ${outputsDir}`);
}

await main();
