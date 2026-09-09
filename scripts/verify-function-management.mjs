import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export function functionSourceDigest(root, paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const absolute = resolve(root, path), rel = relative(root, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) throw Error('功能来源超出项目');
    hash.update(path + '\n'); hash.update(readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n')); hash.update('\n');
  }
  return hash.digest('hex');
}
export function verifyFunctionManagement(root) {
  const doc = readFileSync(resolve(root, 'docs/REBUILD_EXECUTION_PLAN.md'), 'utf8');
  verifyPlanCardNames(doc);
  const sections = doc.split(/^### /m).filter(s => /^RB-/.test(s));
  let count = 0;
  for (const section of sections) {
    if (!section.includes('**管理·功能介绍**')) continue;
    const value = key => section.match(new RegExp('^- \\*\\*管理·' + key + '\\*\\*：(.+)$', 'm'))?.[1]?.trim();
    for (const key of ['名称','工位','岗位','任务类型','用户操作','流程','资料供给','注入与压缩','格式化输入','输出与校验','系统职责','思考与解释','调整边界','代码来源','代码核对']) {
      if (!value(key)) throw Error(`${section.split('\n')[0]} 缺少管理字段：${key}`);
    }
    if (functionSourceDigest(root, value('代码来源').split(',')) !== value('代码核对')) throw Error(`${section.split('\n')[0]} 执行来源已变化，请核对功能说明、资料及失败规则后更新代码核对值`);
    count++;
  }
  if (!count) throw Error('功能管理档案未登记');
  return count;
}

// Run in static-only releases too: the admin API rejects the entire map when a
// renamed table entry retains an old card title, even if code digests match.
export function verifyPlanCardNames(doc) {
  const table = doc.match(/^## 5\.[\s\S]*?(?=^## 6\.)/m)?.[0];
  const cards = doc.match(/^## 6\.[\s\S]*?(?=^## 7\.)/m)?.[0];
  if (!table || !cards) throw Error('功能地图缺少顺序表或详情区');
  const names = new Map();
  for (const match of table.matchAll(/^\| \[(RB-\d{2}(?:\.\d+)?)\]\([^)]*\)\s*\|\s*([^|]+)\|/gm)) {
    if (names.has(match[1])) throw Error(`功能地图顺序表重复：${match[1]}`);
    names.set(match[1], match[2].trim());
  }
  const seen = new Set();
  for (const match of cards.matchAll(/^### (RB-\d{2}(?:\.\d+)?) ([^\r\n]+)\r?$/gm)) {
    if (!names.has(match[1]) || seen.has(match[1]) || names.get(match[1]) !== match[2]) {
      throw Error(`功能地图详情与顺序表不一致：${match[1]}，请同步名称，不能发布`);
    }
    seen.add(match[1]);
  }
  if (!names.size || seen.size !== names.size) throw Error('功能地图详情不完整，不能发布');
  for (const card of cards.split(/^### /m).slice(1)) {
    const id = card.match(/^RB-\d{2}(?:\.\d+)?/)?.[0];
    for (const label of ['线上现状', '执行归属', '剩余工作', '旧实现退出']) {
      const entries = [...card.matchAll(new RegExp(`^- \\*\\*收尾·${label}\\*\\*：([^\\r\\n]+)`, 'gm'))];
      if (entries.length !== 1 || !entries[0][1].trim()) throw Error(`${id} 收尾说明缺失或重复：${label}`);
    }
  }
  return names.size;
}
