// src/services/offlineDb.js - High-Performance Native IndexedDB Storage Engine
// Provides zero-latency offline persistence for tables, catalog, active orders & outbox

const DB_NAME = 'ChefPulseMobilePOS';
const DB_VERSION = 1;

let dbInstance = null;

export function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Config Cache Store (Bootstrap payload, outlet, catalog, staff, terminal)
      if (!db.objectStoreNames.contains('config_cache')) {
        db.createObjectStore('config_cache', { keyPath: 'key' });
      }

      // 2. Active Orders Store (Running table carts, local KOTs)
      if (!db.objectStoreNames.contains('active_orders')) {
        const orderStore = db.createObjectStore('active_orders', { keyPath: 'id' });
        orderStore.createIndex('table_id', 'table_id', { unique: false });
        orderStore.createIndex('updated_at', 'updated_at', { unique: false });
      }

      // 3. Pending Sync Outbox Store (Settled offline bills to flush to server)
      if (!db.objectStoreNames.contains('pending_sync_outbox')) {
        const outboxStore = db.createObjectStore('pending_sync_outbox', { keyPath: 'mobile_bill_uuid' });
        outboxStore.createIndex('created_at', 'created_at', { unique: false });
        outboxStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error('IndexedDB open failed: ' + event.target.error));
    };
  });
}

// ================= CONFIG CACHE =================
export async function saveBootstrapConfig(payload) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('config_cache', 'readwrite');
    const store = tx.objectStore('config_cache');

    store.put({ key: 'bootstrap', data: payload, timestamp: Date.now() });
    if (payload.outlet) store.put({ key: 'outlet', data: payload.outlet });
    if (payload.catalog) store.put({ key: 'catalog', data: payload.catalog });
    if (payload.tables) store.put({ key: 'tables', data: payload.tables });
    if (payload.floors) store.put({ key: 'floors', data: payload.floors });
    if (payload.staff) store.put({ key: 'staff', data: payload.staff });
    if (payload.charges) store.put({ key: 'charges', data: payload.charges });
    if (payload.terminal_config) store.put({ key: 'terminal_config', data: payload.terminal_config });

    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getBootstrapConfig() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('config_cache', 'readonly');
    const req = tx.objectStore('config_cache').get('bootstrap');
    req.onsuccess = () => resolve(req.result ? req.result.data : null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getConfigItem(key, defaultValue = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('config_cache', 'readonly');
    const req = tx.objectStore('config_cache').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.data : defaultValue);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function setConfigItem(key, data) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('config_cache', 'readwrite');
    tx.objectStore('config_cache').put({ key, data, timestamp: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ================= ACTIVE RUNNING ORDERS =================
export async function saveActiveOrder(order) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_orders', 'readwrite');
    const record = {
      ...order,
      id: order.id || order.table_id || `ORD-${Date.now()}`,
      updated_at: new Date().toISOString()
    };
    tx.objectStore('active_orders').put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getActiveOrder(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_orders', 'readonly');
    const req = tx.objectStore('active_orders').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getAllActiveOrders() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_orders', 'readonly');
    const req = tx.objectStore('active_orders').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteActiveOrder(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_orders', 'readwrite');
    tx.objectStore('active_orders').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ================= PENDING SYNC OUTBOX =================
export async function queueSettledOrderForSync(order) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sync_outbox', 'readwrite');
    const uuid = order.mobile_bill_uuid || `mob-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const record = {
      ...order,
      mobile_bill_uuid: uuid,
      status: 'PENDING',
      created_at: order.created_at || new Date().toISOString(),
      retry_count: 0
    };
    tx.objectStore('pending_sync_outbox').put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getPendingSyncOrders() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sync_outbox', 'readonly');
    const req = tx.objectStore('pending_sync_outbox').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function removeSyncedOrders(uuids = []) {
  if (!uuids || uuids.length === 0) return true;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sync_outbox', 'readwrite');
    const store = tx.objectStore('pending_sync_outbox');
    for (const uuid of uuids) {
      store.delete(uuid);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getPendingSyncCount() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sync_outbox', 'readonly');
    const req = tx.objectStore('pending_sync_outbox').count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => resolve(0);
  });
}

// Expose on window for vanilla browser script usage
if (typeof window !== 'undefined') {
  window.OfflineDb = {
    openDb,
    saveBootstrapConfig,
    getBootstrapConfig,
    getConfigItem,
    setConfigItem,
    saveActiveOrder,
    getActiveOrder,
    getAllActiveOrders,
    deleteActiveOrder,
    queueSettledOrderForSync,
    getPendingSyncOrders,
    removeSyncedOrders,
    getPendingSyncCount
  };
}
