import {ContractError} from './contracts.js';
/** 第23.2节编号显示。内部ID永不变；显示代码由采用事务分配的编号派生，归档号码不复用。 */
function positive(number: number): number {
  if (!Number.isSafeInteger(number) || number < 1) throw new ContractError('编号必须为正整数');
  return number;
}
/** 卷显示字母：1→A、26→Z、27→AA、28→AB。统一大写，书内作用域。 */
export function volumeDisplayCode(number: number): string {
  let n = positive(number), code = '';
  while (n > 0) { const rest = (n - 1) % 26; code = String.fromCharCode(65 + rest) + code; n = Math.floor((n - 1) / 26); }
  return code;
}
/** 主线/支线书内独立序列：主线1、支线3。 */
export function lineDisplayCode(kind: 'main'|'branch', number: number): string {
  return `${kind === 'main' ? '主线' : '支线'}${positive(number)}`;
}
/** 链在卷内1起：链A1。编号分配在卷A方案采用时进行；此处只是未来编号的显示合同，不提前创建链。 */
export function chainDisplayCode(volumeCode: string, number: number): string {
  if (!/^[A-Z]+$/.test(volumeCode)) throw new ContractError('卷显示代码格式错误');
  return `链${volumeCode}${positive(number)}`;
}
/** 章为书内连续阅读编号，不每卷重置：章115。分配在链内章节规划采用时进行。 */
export function chapterDisplayCode(number: number): string {
  return `章${positive(number)}`;
}
/** 从卷显示字母反解编号，用于旧引用按代码+编号版本解析；歧义时由工具返回候选供成员补查。 */
export function volumeNumberFromDisplayCode(code: string): number {
  if (!/^[A-Z]+$/.test(code)) throw new ContractError('卷显示代码格式错误');
  let n = 0;
  for (const ch of code) n = n * 26 + (ch.charCodeAt(0) - 64);
  return positive(n);
}
