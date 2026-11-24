// src/services/syncEngine.js - Automated Background Order Sync & Portal Bridge
import { 
  getPendingSyncOrders, 
  removeSyncedOrders, 
  getPendingSyncCount, 
  saveBootstrapConfig,
  getBootstrapConfig 
} from './offlineDb.js';

function resolveInitialSyncServerUrl() {
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol;
    if (proto === 'http:' || proto === 'https:') {
      return window.location.origin.replace(/\/+$/, '');
    }
    const saved = localStorage.getItem('cp_pos_server_url');
    if (saved && saved.startsWith('http')) return saved.replace(/\/+$/, '');
  }
  return 'http://localhost:4000';
}

let serverBaseUrl = resolveInitialSyncServerUrl();
let terminalId = (typeof window !== 'undefined' ? (localStorage.getItem('cp_pos_terminal_id') || 'MOB-COUNTER-01') : 'MOB-COUNTER-01');
let apiKey = (typeof window !== 'undefined' ? (localStorage.getItem('cp_pos_api_key') || '') : '');

let currentStatus = 'ONLINE_SYNCED';
let statusListeners = [];
let syncIntervalTimer = null;
let isSyncInProgress = false;

export function configureSyncEngine({ serverUrl, terminal, key }) {
  if (serverUrl) {
    serverBaseUrl = serverUrl.replace(/\/+$/, '');
    localStorage.setItem('cp_pos_server_url', serverBaseUrl);
  }
  if (terminal) {
    terminalId = terminal;
    localStorage.setItem('cp_pos_terminal_id', terminalId);
  }
  if (key) {
    apiKey = key;
    localStorage.setItem('cp_pos_api_key', apiKey);
  }
  notifyStatusChange();
}

export function subscribeSyncStatus(listener) {
  if (typeof listener === 'function') {
    statusListeners.push(listener);
    notifyStatusChange();
  }
  return () => {
    statusListeners = statusListeners.filter(l => l !== listener);
  };
}

async function notifyStatusChange() {
  const pendingCount = typeof window !== 'undefined' && window.OfflineDb 
    ? await window.OfflineDb.getPendingSyncCount() 
    : await getPendingSyncCount();

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  let badgeState = 'ONLINE_SYNCED';
  let badgeLabel = 'Online • Synced';
  let badgeClass = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  if (!isOnline) {
    badgeState = 'OFFLINE_PENDING';
    badgeLabel = pendingCount > 0 ? `Offline • ${pendingCount} Pending` : 'Offline (Ready)';
    badgeClass = pendingCount > 0 
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse'
      : 'bg-slate-800 text-slate-400 border-slate-700';
  } else if (isSyncInProgress) {
    badgeState = 'SYNCING';
    badgeLabel = `Syncing (${pendingCount})...`;
    badgeClass = 'bg-sky-500/20 text-sky-400 border-sky-500/30 animate-pulse';
  } else if (pendingCount > 0) {
    badgeState = 'OFFLINE_PENDING';
    badgeLabel = `${pendingCount} Bills Queued`;
    badgeClass = 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  }

  currentStatus = badgeState;
  const payload = {
    status: badgeState,
    label: badgeLabel,
    badgeClass,
    pendingCount,
    isOnline,
    serverUrl: serverBaseUrl,
    terminalId
  };

  statusListeners.forEach(fn => {
    try { fn(payload); } catch (e) {}
  });

  // Also update UI element if present on page
  if (typeof document !== 'undefined') {
    const el = document.getElementById('mobile-sync-status-badge');
    if (el) {
      el.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${badgeClass}`;
      el.innerHTML = `
        <span class="w-2 h-2 rounded-full ${badgeState === 'SYNCING' ? 'bg-sky-400 animate-spin' : (badgeState === 'ONLINE_SYNCED' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse')}"></span>
        <span>${badgeLabel}</span>
      `;
    }
  }
}

// 1. Pull Bootstrap from Web Portal
export async function pullMobileBootstrap(targetUrl = serverBaseUrl, termId = terminalId) {
  const url = `${targetUrl.replace(/\/+$/, '')}/api/pos/mobile-bootstrap?terminal_id=${encodeURIComponent(termId)}`;
  const headers = {
    'Accept': 'application/json',
    'x-terminal-id': termId
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bootstrap failed (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  if (typeof window !== 'undefined' && window.OfflineDb) {
    await window.OfflineDb.saveBootstrapConfig(data);
  } else {
    await saveBootstrapConfig(data);
  }

  notifyStatusChange();
  return data;
}

// 2. Register Terminal with Web Portal
export async function registerTerminalWithPortal({ serverUrl, terminal_id, device_name, mode, admin_pin }) {
  const base = (serverUrl || serverBaseUrl).replace(/\/+$/, '');
  const res = await fetch(`${base}/api/pos/register-terminal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      terminal_id,
      device_name: device_name || terminal_id,
      mode: mode || 'BILLING_COUNTER',
      admin_pin
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Registration failed' }));
    throw new Error(err.error || 'Terminal registration failed');
  }

  const result = await res.json();
  configureSyncEngine({
    serverUrl: base,
    terminal: terminal_id,
    key: result.terminal?.api_key || ''
  });

  if (result.bootstrap) {
    if (typeof window !== 'undefined' && window.OfflineDb) {
      await window.OfflineDb.saveBootstrapConfig(result.bootstrap);
    } else {
      await saveBootstrapConfig(result.bootstrap);
    }
  }

  return result;
}

// 3. Flush Outbox (Uploads queued bills with strict idempotency)
export async function flushSyncOutbox() {
  if (isSyncInProgress) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    notifyStatusChange();
    return;
  }

  const pending = typeof window !== 'undefined' && window.OfflineDb
    ? await window.OfflineDb.getPendingSyncOrders()
    : await getPendingSyncOrders();

  if (!pending || pending.length === 0) {
    notifyStatusChange();
    return;
  }

  isSyncInProgress = true;
  notifyStatusChange();

  try {
    const url = `${serverBaseUrl}/api/pos/sync-orders`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-terminal-id': terminalId,
        'x-api-key': apiKey
      },
      body: JSON.stringify({ orders: pending })
    });

    if (!res.ok) throw new Error(`Sync HTTP error ${res.status}`);

    const result = await res.json();
    if (result.synced_uuids && result.synced_uuids.length > 0) {
      if (typeof window !== 'undefined' && window.OfflineDb) {
        await window.OfflineDb.removeSyncedOrders(result.synced_uuids);
      } else {
        await removeSyncedOrders(result.synced_uuids);
      }
    }
  } catch (err) {
    console.warn('[SyncEngine] Background order sync retry postponed:', err.message);
  } finally {
    isSyncInProgress = false;
    notifyStatusChange();
  }
}

// 4. Background Sync Scheduler (30-sec loop + online trigger)
export function startBackgroundSync() {
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);

  // Immediate check on start
  flushSyncOutbox();

  // 30-second background cycle
  syncIntervalTimer = setInterval(flushSyncOutbox, 30000);

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      notifyStatusChange();
      flushSyncOutbox();
    });
    window.addEventListener('offline', () => {
      notifyStatusChange();
    });
  }
}

export function stopBackgroundSync() {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
    syncIntervalTimer = null;
  }
}

// Expose on window for browser scripts
if (typeof window !== 'undefined') {
  window.SyncEngine = {
    configureSyncEngine,
    subscribeSyncStatus,
    pullMobileBootstrap,
    registerTerminalWithPortal,
    flushSyncOutbox,
    startBackgroundSync,
    stopBackgroundSync,
    getStatus: () => currentStatus
  };
}
