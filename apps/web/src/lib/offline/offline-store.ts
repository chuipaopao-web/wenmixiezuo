const DATABASE_NAME = 'wenmai-writing-offline';
const DATABASE_VERSION = 1;

interface CachedSnapshot<T> {
  cacheKey: string;
  bookId: string;
  canonRevision: number;
  value: T;
  cachedAt: string;
}

function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolvePromise, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts', { keyPath: 'bookId' });
      if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots', { keyPath: 'cacheKey' });
    };
    request.onsuccess = () => resolvePromise(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开离线数据库'));
  });
}

export async function saveDraft(bookId: string, content: string): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  const database = await openOfflineDatabase();
  await transactionPromise(database, 'drafts', 'readwrite', (store) => store.put({ bookId, content, updatedAt: new Date().toISOString() }));
  database.close();
}

export async function loadDraft(bookId: string): Promise<string> {
  if (!('indexedDB' in globalThis)) return '';
  const database = await openOfflineDatabase();
  const value = await requestPromise<{ content?: string } | undefined>(database.transaction('drafts').objectStore('drafts').get(bookId));
  database.close();
  return value?.content ?? '';
}

export async function cacheSnapshot<T>(cacheKey: string, bookId: string, canonRevision: number, value: T): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  const database = await openOfflineDatabase();
  const snapshot: CachedSnapshot<T> = { cacheKey, bookId, canonRevision, value, cachedAt: new Date().toISOString() };
  await transactionPromise(database, 'snapshots', 'readwrite', (store) => store.put(snapshot));
  database.close();
}

export async function loadSnapshot<T>(cacheKey: string, canonRevision: number): Promise<T | null> {
  if (!('indexedDB' in globalThis)) return null;
  const database = await openOfflineDatabase();
  const transaction = database.transaction('snapshots', 'readwrite');
  const store = transaction.objectStore('snapshots');
  const snapshot = await requestPromise<CachedSnapshot<T> | undefined>(store.get(cacheKey));
  if (snapshot !== undefined && snapshot.canonRevision !== canonRevision) store.delete(cacheKey);
  await completePromise(transaction);
  database.close();
  return snapshot?.canonRevision === canonRevision ? snapshot.value : null;
}

function transactionPromise(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest
): Promise<void> {
  const transaction = database.transaction(storeName, mode);
  operation(transaction.objectStore(storeName));
  return completePromise(transaction);
}

function completePromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    transaction.oncomplete = () => resolvePromise();
    transaction.onerror = () => reject(transaction.error ?? new Error('离线数据库事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('离线数据库事务已取消'));
  });
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    request.onsuccess = () => resolvePromise(request.result);
    request.onerror = () => reject(request.error ?? new Error('离线数据库请求失败'));
  });
}
