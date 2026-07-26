import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { AttributeFormulaRepository, type AttributeFormulaRow } from '../../infrastructure/db/repositories/attribute-formula-repository.js';

export interface FormulaVariable {
  key: string;
  label: string;
  defaultValue?: number;
}

export interface AttributeFormulaRecord {
  formulaId: string;
  formulaKey: string;
  label: string;
  category: string;
  expression: string;
  variables: FormulaVariable[];
  unit: string | null;
  version: number;
  status: 'active' | 'superseded' | 'archived';
}

type Token = { type: 'number'; value: number } | { type: 'identifier'; value: string } | { type: 'operator'; value: string } | { type: 'eof'; value: '' };

export class AttributeFormulaService {
  private readonly repository: AttributeFormulaRepository;

  public constructor(database: DatabaseSync, private readonly ids: IdGenerator, private readonly clock: Clock) {
    this.repository = new AttributeFormulaRepository(database);
  }

  public create(scope: BookScope, input: {
    formulaKey: string; label: string; category?: string; expression: string; variables: FormulaVariable[]; unit?: string | null;
  }): AttributeFormulaRecord {
    assertBookScope(scope);
    const formulaKey = normalizedKey(input.formulaKey, '公式键');
    const label = requiredText(input.label, '公式名称', 120);
    const category = optionalCategory(input.category);
    const expression = requiredText(input.expression, '公式表达式', 500);
    const variables = validateVariables(input.variables);
    evaluateArithmetic(expression, Object.fromEntries(variables.map((item) => [item.key, item.defaultValue ?? 1])));
    const now = this.clock.now().toISOString();
    const version = this.repository.maxVersion(scope, formulaKey) + 1;
    const formulaId = this.ids.next();
    this.repository.runInTransaction(() => {
      this.repository.supersedeActive(scope, formulaKey, now);
      this.repository.insert(scope, {
        formulaId, formulaKey, label, category, expression, variablesJson: JSON.stringify(variables),
        unit: input.unit?.trim() || null, version, now
      });
    });
    return this.require(scope, formulaId);
  }

  public list(scope: BookScope, includeInactive = false): AttributeFormulaRecord[] {
    assertBookScope(scope);
    const rows = this.repository.list(scope, includeInactive);
    return rows.map(mapFormula);
  }

  public evaluate(scope: BookScope, formulaId: string, values: Record<string, number>): { formula: AttributeFormulaRecord; values: Record<string, number>; result: number } {
    const formula = this.require(scope, formulaId);
    if (formula.status !== 'active') throw new DomainError(errorCodes.operationIncomplete, '只能计算当前活动公式', {}, false, 409);
    const allowed = new Set(formula.variables.map((item) => item.key));
    for (const key of Object.keys(values)) if (!allowed.has(key)) throw new DomainError(errorCodes.validation, `公式不接受变量：${key}`);
    const resolved = Object.fromEntries(formula.variables.map((item) => {
      const value = values[item.key] ?? item.defaultValue;
      if (value === undefined || !Number.isFinite(value)) throw new DomainError(errorCodes.validation, `变量缺失或不是有限数字：${item.key}`);
      return [item.key, value];
    }));
    return { formula, values: resolved, result: evaluateArithmetic(formula.expression, resolved) };
  }

  public archive(scope: BookScope, formulaId: string): AttributeFormulaRecord {
    const formula = this.require(scope, formulaId);
    if (formula.status === 'archived') return formula;
    const changes = this.repository.archive(scope, formulaId, this.clock.now().toISOString());
    if (changes !== 1) throw new DomainError(errorCodes.bookScopeViolation, '公式不存在或越权', {}, false, 404);
    return this.require(scope, formulaId);
  }

  private require(scope: BookScope, formulaId: string): AttributeFormulaRecord {
    assertBookScope(scope);
    const row = this.repository.find(scope, formulaId);
    if (row === undefined) throw new DomainError(errorCodes.bookScopeViolation, '公式不存在或越权', {}, false, 404);
    return mapFormula(row);
  }
}

export function evaluateArithmetic(expression: string, variables: Record<string, number>): number {
  const tokens = tokenize(expression);
  let index = 0;
  let depth = 0;
  const current = (): Token => tokens[index] ?? { type: 'eof', value: '' };
  const consume = (): Token => tokens[index++] ?? { type: 'eof', value: '' };
  const isOperator = (operators: string[]): boolean => {
    const token = current();
    return token.type === 'operator' && operators.includes(token.value);
  };
  const parsePrimary = (): number => {
    const token = consume();
    if (token.type === 'number') return token.value;
    if (token.type === 'identifier') {
      const value = variables[token.value];
      if (value === undefined || !Number.isFinite(value)) throw validationError(`未知或无效变量：${token.value}`);
      return value;
    }
    if (token.type === 'operator' && token.value === '(') {
      depth += 1;
      if (depth > 32) throw validationError('公式括号嵌套过深');
      const value = parseExpression();
      const closing = consume();
      depth -= 1;
      if (closing.type !== 'operator' || closing.value !== ')') throw validationError('公式缺少右括号');
      return value;
    }
    throw validationError('公式缺少数字、变量或左括号');
  };
  const parseUnary = (): number => {
    const token = current();
    if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
      consume();
      const value = parseUnary();
      return token.value === '-' ? -value : value;
    }
    return parsePrimary();
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (isOperator(['*', '/', '%'])) {
      const operatorToken = consume();
      if (operatorToken.type !== 'operator') throw validationError('公式运算符状态无效');
      const operator = operatorToken.value;
      const right = parseUnary();
      if ((operator === '/' || operator === '%') && right === 0) throw validationError('公式不能除以零');
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
      if (!Number.isFinite(value)) throw validationError('公式结果不是有限数字');
    }
    return value;
  };
  const parseExpression = (): number => {
    let value = parseTerm();
    while (isOperator(['+', '-'])) {
      const operatorToken = consume();
      if (operatorToken.type !== 'operator') throw validationError('公式运算符状态无效');
      const operator = operatorToken.value;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) throw validationError('公式结果不是有限数字');
    }
    return value;
  };
  const result = parseExpression();
  if (current().type !== 'eof') throw validationError('公式包含无法解析的多余内容');
  if (!Number.isFinite(result)) throw validationError('公式结果不是有限数字');
  return result;
}

function tokenize(expression: string): Token[] {
  const input = requiredText(expression, '公式表达式', 500);
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/u.test(char)) { index += 1; continue; }
    if (/[0-9.]/u.test(char)) {
      const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/u);
      if (match === null) throw validationError('数字格式无效');
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw validationError('数字不是有限值');
      tokens.push({ type: 'number', value });
      index += match[0].length;
    } else if (/[\p{L}_]/u.test(char)) {
      const match = input.slice(index).match(/^[\p{L}_][\p{L}\p{N}_]*/u)!;
      tokens.push({ type: 'identifier', value: match[0] });
      index += match[0].length;
    } else if ('+-*/%()'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
    } else {
      throw validationError(`公式包含不允许的字符：${char}`);
    }
    if (tokens.length > 256) throw validationError('公式过于复杂');
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function validateVariables(input: FormulaVariable[]): FormulaVariable[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) throw validationError('公式变量必须为1至32项');
  const seen = new Set<string>();
  return input.map((item) => {
    const key = normalizedKey(item.key, '变量键');
    if (seen.has(key)) throw validationError(`变量重复：${key}`);
    seen.add(key);
    const result: FormulaVariable = { key, label: requiredText(item.label, '变量名称', 80) };
    if (item.defaultValue !== undefined) {
      if (!Number.isFinite(item.defaultValue)) throw validationError(`变量默认值不是有限数字：${key}`);
      result.defaultValue = item.defaultValue;
    }
    return result;
  });
}

function normalizedKey(value: string, label: string): string {
  const key = requiredText(value, label, 64);
  if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(key)) throw validationError(`${label}只能使用文字、数字、下划线和连字符，且不能以数字开头`);
  return key;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0 || normalized.length > maxLength) throw validationError(`${label}长度必须为1至${maxLength}`);
  return normalized;
}

function optionalCategory(value: string | undefined): string {
  const normalized = value?.trim() || 'uncategorized';
  if (normalized.length > 64) throw validationError('公式分类不能超过64个字符');
  return normalized;
}

function validationError(message: string): DomainError {
  return new DomainError(errorCodes.validation, message);
}

function mapFormula(row: AttributeFormulaRow): AttributeFormulaRecord {
  return {
    formulaId: row.attribute_formula_id,
    formulaKey: row.formula_key,
    label: row.label,
    category: row.category,
    expression: row.expression,
    variables: JSON.parse(row.variables_json) as FormulaVariable[],
    unit: row.unit,
    version: row.version,
    status: row.status
  };
}
