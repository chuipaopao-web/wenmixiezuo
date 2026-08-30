import type { Server } from 'node:http';

export function createV7StaticServer(input: {
  releaseDirectory: string;
  apiHost?: string;
  apiPort?: number;
}): Promise<Server>;
