export interface TokenBudget {
  modelContextTokens: number;
  outputReserved: number;
  toolReserved: number;
  safetyReserved: number;
  inputAvailable: number;
}

export class TokenBudgetService {
  public allocate(input: { modelContextTokens: number; requestedOutputTokens: number; toolTokens?: number }): TokenBudget {
    for (const value of [input.modelContextTokens, input.requestedOutputTokens, input.toolTokens ?? 0]) {
      if (!Number.isInteger(value) || value < 0) throw new Error('Token预算必须是非负整数');
    }
    const safetyReserved = Math.ceil(input.modelContextTokens * 0.2);
    const toolReserved = input.toolTokens ?? 0;
    const inputAvailable = input.modelContextTokens - input.requestedOutputTokens - toolReserved - safetyReserved;
    if (inputAvailable <= 0) throw new Error('模型上下文不足以预留输出、工具和20%安全边界');
    return { modelContextTokens: input.modelContextTokens, outputReserved: input.requestedOutputTokens, toolReserved, safetyReserved, inputAvailable };
  }
}
