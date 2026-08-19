/**
 * 普通用户可见文本中的模型信息清洗：隐藏供应商与模型名，保留可读的错误原因
 *（如限流、额度、超时），让前端只表达"创作服务"状态，不暴露工作逻辑。
 */
const PROVIDER_TOKENS = [
  'volcengine-ark-agent-plan',
  'volcengine-ark-coding-plan',
  'openai-codex-subscription',
  'local-deterministic',
  'opencodego',
  'volcengine',
  'volces'
];

const MODEL_WORD_PATTERN = /(deepseek|doubao|minimax|moonshot|kimi|glm|seed|gpt|claude|qwen|ark)[\w./:-]*/giu;

export function sanitizeModelLeak(text: string | null): string | null {
  if (text === null) return null;
  let output = text;
  for (const token of PROVIDER_TOKENS) output = output.split(token).join('创作服务');
  output = output.replace(MODEL_WORD_PATTERN, '创作服务');
  return output.replace(/(创作服务[\s./:-]*){2,}/gu, '创作服务').trim();
}
