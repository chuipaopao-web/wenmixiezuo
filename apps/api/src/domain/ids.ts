import { randomUUID } from 'node:crypto';

export type EntityId = string;

export interface IdGenerator {
  next(): EntityId;
}

export class UuidGenerator implements IdGenerator {
  public next(): EntityId {
    return randomUUID();
  }
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

