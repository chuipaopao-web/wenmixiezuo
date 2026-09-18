import { createHash } from 'node:crypto';
import { DomainError, errorCodes } from './errors.js';

export function requiredPermanentDeleteText(_title?: string, _bookId?: string): string {
  return 'YES';
}

/** 第二道确认：除 YES 外必须逐字输入，防止单一动作误删。 */
export function requiredPermanentDeleteSecondText(): string {
  return '确认删除书籍';
}

export function validatePermanentDeleteText(confirmationText: string): string {
  const required = requiredPermanentDeleteText();
  const normalized = confirmationText.trim().toUpperCase();
  if (normalized !== required) {
    throw new DomainError(
      errorCodes.permanentDeleteConfirmationInvalid,
      '永久删除确认词不匹配',
      { required },
      false,
      409
    );
  }
  return createHash('sha256').update(required).digest('hex');
}

export function validatePermanentDeleteSecondText(confirmationText: string): string {
  const required = requiredPermanentDeleteSecondText();
  if (confirmationText.trim() !== required) {
    throw new DomainError(
      errorCodes.permanentDeleteConfirmationInvalid,
      '永久删除二次确认词不匹配',
      { required },
      false,
      409
    );
  }
  return createHash('sha256').update(required).digest('hex');
}
