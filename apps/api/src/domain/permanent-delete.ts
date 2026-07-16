import { createHash } from 'node:crypto';
import { DomainError, errorCodes } from './errors.js';

export function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-6);
}

export function requiredPermanentDeleteText(title: string, bookId: string): string {
  return `YES ${title} ${shortId(bookId)}`;
}

export function validatePermanentDeleteText(title: string, bookId: string, confirmationText: string): string {
  const required = requiredPermanentDeleteText(title, bookId);
  if (confirmationText !== required) {
    throw new DomainError(
      errorCodes.permanentDeleteConfirmationInvalid,
      '永久删除确认词不匹配',
      { required },
      false,
      409
    );
  }
  return createHash('sha256').update(confirmationText).digest('hex');
}

