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
