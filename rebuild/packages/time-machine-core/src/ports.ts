import type { Scope, Manifest, Candidate, Member } from './contracts.js';
/** Host adapters authenticate first; no API may accept a browser-provided owner or review verdict. */
export interface BookAccess { authorize(session: unknown, bookId: string): Promise<Scope> }
export interface SourceRead { manifest(scope: Scope): Promise<Manifest>; read(scope: Scope, sourceId: string, revision: string): Promise<{text: string; hash: string}> }
export interface AssetRead { search(purpose: string, cursor?: string): Promise<{id:string;name:string;description:string}[]>; read(id: string, revision: string): Promise<{text:string;revision:string}> }
export interface ModelGateway {
  execute(request: {scope:Scope;attemptId:string;member:Member;system:string;input:string;maxOutputTokens:number;tools:string[]}): Promise<{text:string;inputTokens:number;outputTokens:number;finish:'complete'|'length'|'unknown'}>;
  lookup(attemptId:string,scope:Scope):Promise<'missing'|'running'|'complete'|'unknown'>;
}
export interface PlanRepository {
  saveCandidate(scope:Scope,id:string,expectedRevision:number,candidate:Candidate):number;
  readCandidate(scope:Scope,id:string,revision:number):Candidate|null;
}
export interface FormalTextRead { read(scope:Scope,chapterId:string,revision:string):Promise<{text:string;hash:string;orderRevision:string}> }
export interface OutboxConsumer { acknowledge(scope:Scope,eventId:string,consumer:string):void }
