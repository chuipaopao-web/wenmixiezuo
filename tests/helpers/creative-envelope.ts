/**
 * 创作偏好信封：书籍带偏好快照时，withBookCreativeProfile 会把纯文本 sourcePrompt
 * 包成 {task, creativeDirection}；经过运行时提示编译器后，stageTaskPayload 里可能是
 * 已解析的对象。测试夹具按原提示路由前先统一解包，避免把信封转义当成提示内容。
 */
export function isCreativeEnvelope(value: unknown): value is { task: string; creativeDirection: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { task?: unknown }).task === 'string'
    && (value as { creativeDirection?: unknown }).creativeDirection !== undefined;
}

export function unwrapCreativeEnvelope(prompt: string): string {
  try {
    const value: unknown = JSON.parse(prompt);
    if (isCreativeEnvelope(value)) return value.task;
  } catch { /* 非信封，原样返回。 */ }
  return prompt;
}
