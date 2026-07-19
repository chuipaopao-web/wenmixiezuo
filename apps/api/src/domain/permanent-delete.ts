import { createHash } from 'node:crypto';
import { DomainError, errorCodes } from './errors.js';

export function requiredPermanentDeleteText(_title?: string, _bookId?: string): string {
  return 'YES';
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
