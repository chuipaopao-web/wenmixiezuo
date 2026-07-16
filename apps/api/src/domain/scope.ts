import { DomainError, errorCodes } from './errors.js';

export interface OwnerScope {
  ownerId: string;
}

export interface BookScope extends OwnerScope {
  bookId: string;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/;

export function assertOwnerScope(scope: OwnerScope): void {
  if (!idPattern.test(scope.ownerId)) {
    throw new DomainError(errorCodes.validation, 'owner_id格式无效');
  }
}

export function assertBookScope(scope: BookScope): void {
  assertOwnerScope(scope);
  if (!idPattern.test(scope.bookId)) {
    throw new DomainError(errorCodes.validation, 'book_id格式无效');
  }
}

export function sameScope(left: BookScope, right: BookScope): boolean {
  return left.ownerId === right.ownerId && left.bookId === right.bookId;
}

