
// A simple wrapper for IndexedDB to handle large-scale client-side storage,
// replacing the restrictive localStorage API.

const DB_NAME = 'web-inspector-db';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const KV_STORE = 'kv_store'; // For storing history, settings, etc.

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                const db = request.result;
                // If the connection closes unexpectedly, nullify the promise
                // so it can be re-established on the next call.
                db.onclose = () => {
                    console.warn('Database connection closed.');
                    dbPromise = null;
                };
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
                    // keyPath is 'url', which will exist on the session objects we store.
                    db.createObjectStore(SESSIONS_STORE, { keyPath: 'url' });
                }
                if (!db.objectStoreNames.contains(KV_STORE)) {
                    // A simple key-value store with no keyPath.
                    db.createObjectStore(KV_STORE);
                }
            };
        });
    }
    return dbPromise;
}

/**
 * A generic helper function to perform an IndexedDB transaction.
 * @param storeName The name of the object store.
 * @param mode The transaction mode ('readonly' or 'readwrite').
 * @param action A callback that receives the object store and performs an action (e.g., get, put).
 * @returns A Promise that resolves with the result of the action or completes when the transaction is done.
 */
async function performTx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest | void
): Promise<T> {
    const db = await getDb();
    return new Promise<T>((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = action(store);

            // For actions that return a request object (like get, put, delete)
            if (request) {
                request.onsuccess = () => resolve(request.result as T);
                request.onerror = () => reject(request.error);
            }
            
            // For actions that don't return a request (like clear) or for write
            // operations where we just need to know it completed.
            tx.oncomplete = () => {
                if (!request) {
                    resolve(undefined as T);
                }
            };

            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        } catch (e) {
            // This can catch "InvalidStateError" if the db connection is closed.
            console.error("Transaction failed to start:", e);
            // Invalidate the promise and reject to allow for a retry.
            dbPromise = null; 
            reject(e);
        }
    });
}

// --- EXPORTED API ---

export const getKV = <T>(key: IDBValidKey): Promise<T | undefined> =>
    performTx<T | undefined>(KV_STORE, 'readonly', store => store.get(key));

export const setKV = (key: IDBValidKey, value: any): Promise<void> =>
    performTx<void>(KV_STORE, 'readwrite', store => store.put(value, key));

export const getSession = <T>(url: string): Promise<T | undefined> =>
    performTx<T | undefined>(SESSIONS_STORE, 'readonly', store => store.get(url));

export const setSession = (data: any): Promise<void> =>
    performTx<void>(SESSIONS_STORE, 'readwrite', store => store.put(data));

export const deleteSession = (url: string): Promise<void> =>
    performTx<void>(SESSIONS_STORE, 'readwrite', store => store.delete(url));
    
export const clearAll = async (): Promise<void> => {
    await performTx<void>(SESSIONS_STORE, 'readwrite', store => store.clear());
    await performTx<void>(KV_STORE, 'readwrite', store => store.clear());
};