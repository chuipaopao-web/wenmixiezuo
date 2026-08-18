const fs = require('fs');
const p = 'apps/api/src/application/discussions/discussion-pipeline-service.ts';
let s = fs.readFileSync(p, 'utf8');
const oldFn = /function parseModelJsonFields\(raw: string\): Record<string, unknown> \| null \{\r?\n  try \{\r?\n    const root = JSON\.parse\(raw\) as unknown;\r?\n    if \(typeof root !== 'object' \|\| root === null \|\| Array\.isArray\(root\)\) return null;\r?\n    const fields = \(root as Record<string, unknown>\)\.fields;\r?\n    return typeof fields === 'object' && fields !== null && !Array\.isArray\(fields\)\r?\n      \? fields as Record<string, unknown>\r?\n      : null;\r?\n  \} catch \{\r?\n    return null;\r?\n  \}\r?\n\}/;
if (!oldFn.test(s)) throw new Error('parseModelJsonFields not found');
const newFn = `function parseModelJsonFields(raw: string): Record<string, unknown> | null {
  // 真实模型常把 JSON 包在 markdown 围栏里；先取围栏内文本再严格 JSON.parse。
  // 只对围栏做宽容，JSON 笔误（如属性名少引号）仍然解析失败，保住 DEC-CURRENT-052
  // 第 6 款的坏输出判无效门禁。
  const fenced = raw.match(/\`\`\`(?:json)?\\s*\\n([\\s\\S]*?)\\n?\\s*\`\`\`/);
  const candidates = fenced === null ? [raw] : [fenced[1] ?? '', raw];
  for (const candidate of candidates) {
    try {
      const root = JSON.parse(candidate) as unknown;
      if (typeof root !== 'object' || root === null || Array.isArray(root)) continue;
      const fields = (root as Record<string, unknown>).fields;
      if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) {
        return fields as Record<string, unknown>;
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}`;
s = s.replace(oldFn, newFn);
fs.writeFileSync(p, s);
console.log('parseModelJsonFields patched');
