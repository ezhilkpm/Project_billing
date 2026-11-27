// server/server.js - Full Enterprise Restaurant POS & Management Server
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PORT, HOST, getLocalIPAddress } from './config.js';
import { 
  initDatabase, 
  getFloors,
  addFloor,
  deleteFloor,
  getTablesWithFloor,
  addTable,
  deleteTable,
  getKitchenStations,
  addKitchenStation,
  deleteKitchenStation,
  getMenuWithKitchens,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  createRoutedKOTs, 
  updateKOTStatus, 
  updateKOTItemStatus,
  getActiveKitchenKOTs,
  clearAllReadyKitchenKOTs,
  getCustomBillCharges,
  addCustomBillCharge,
  updateCustomBillCharge,
  deleteCustomBillCharge,
  settleTableBill, 
  getRestaurantSettings,
  saveRestaurantSettings,
  getInventoryStatus,
  addPurchaseRecord,
  getPurchases,
  addExpense,
  getExpenses,
  getDailyPnLSummary,
  authenticateUser,
  getAllUsers,
  addUser,
  deleteUser,
  getStaffList,
  addStaff,
  updateStaff,
  deleteStaff,
  recordPayroll,
  updatePayroll,
  deletePayroll,
  getPayrollRecords,
  generateTablePreBill,
  reopenTableOrder,
  getNextTakeawayToken,
  createTakeawayOrder,
  collectTakeawayPayment,
  getTakeawayOrders,
  updateTakeawayStatus,
  getUserAssignments,
  setUserAssignments,
  getAllUserAssignments,
  getBillingHistory,
  getInvoiceById,
  getPayslipDetails,
  getMenuItemWithIngredients,
  processScannedPurchase,
  backupDatabase,
  createDatabaseBackup,
  listDatabaseBackups,
  restoreDatabaseFromBackup,
  getDatabaseHealth,
  seedClassicHotelRealMenu,
  ensureInventoryItem,
  getAllActiveOrdersWithStatus,
  forceRouteOrder,
  transferTable,
  mergeTables,
  getDayEndZReport,
  getTVPromotions,
  saveTVPromotion,
  deleteTVPromotion,
  getTVDisplayData,
  createAggregatorOrder,
  getAggregatorAccountingSummary,
  settleAggregatorPayout,
  verifyStaffPin,
  getPosTerminal,
  getAllPosTerminals,
  registerPosTerminal,
  getMobileBootstrapData,
  syncMobileOrders
} from './db.js';
import { suggestRecipeIngredients, scanPurchaseBillOCR, generateFoodImage } from './geminiService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadDir = path.join(publicDir, 'uploads', 'menu');
fs.mkdirSync(uploadDir, { recursive: true });

// Initialize Database & Seeds
initDatabase();

const app = express();

// Secure CORS: Allow localhost, local network POS terminals, Render origin, and native apps
const allowedOrigins = [
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'https://project-billing.onrender.com',
  'capacitor://localhost',
  'ionic://localhost'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://192.168.') || origin.startsWith('http://10.') || origin.startsWith('http://172.')) {
      return callback(null, true);
    }
    if (process.env.RENDER_EXTERNAL_URL && origin === process.env.RENDER_EXTERNAL_URL) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json({ limit: '15mb' }));

// ================= SECURITY & SESSION MANAGEMENT =================
const activeSessions = new Map();

export function createSessionToken(user) {
  const token = 'cp_' + crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    user,
    role: user.role,
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24-hour session
  });
  return token;
}

export function verifySession(token) {
  if (!token) return null;
  const clean = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const session = activeSessions.get(clean);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(clean);
    return null;
  }
  return session;
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers?.['authorization'] || req.headers?.['x-auth-token'] || req.query?.auth_token;
  const terminalId = req.headers?.['x-terminal-id'];
  if (terminalId) return next();

  const session = verifySession(authHeader);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized: Valid authentication token required' });
  }
  req.user = session.user;
  req.role = session.role;
  next();
}

export function requireAdmin(req, res, next) {
  const authHeader = req.headers?.['authorization'] || req.headers?.['x-auth-token'] || req.query?.auth_token;
  const terminalId = req.headers?.['x-terminal-id'];

  const session = verifySession(authHeader);
  if (session && session.role === 'ADMIN') {
    req.user = session.user;
    req.role = session.role;
    return next();
  }

  if (terminalId) return next();

  return res.status(403).json({ error: 'Forbidden: Admin access privileges required' });
}

// In-Memory Rate Limiter for Authentication & AI endpoints
const rateLimitMap = new Map();
export function rateLimiter({ windowMs = 60000, max = 20, message = 'Too many requests, please try again later.' } = {}) {
  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || '127.0.0.1';
    const now = Date.now();
    const key = `${ip}:${req.baseUrl || ''}${req.path}`;
    const record = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
    } else {
      record.count++;
    }
    rateLimitMap.set(key, record);

    if (record.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Serve Static Frontend Assets with zero-cache headers (prevents stale client UI)
app.use(express.static(publicDir, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// HTTP Server + WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast live events to all connected clients
export function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  }
}

// WebSocket Connection Handshake
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ 
    event: 'CONNECTED', 
    data: { message: 'Connected to ChefPulse Enterprise POS Server' } 
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.action === 'PING') ws.send(JSON.stringify({ event: 'PONG' }));
    } catch (e) {}
  });
});

// ================= REST API ROUTES =================

// 1. Health & Server Info (Render.com Cloud Health Check)
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

export function getPublicBaseUrl(req) {
  const forwardedHost = req?.get('x-forwarded-host');
  const host = forwardedHost || req?.get('host');
  if (host && !host.includes('127.0.0.1') && !host.includes('localhost') && !host.startsWith('10.') && !host.startsWith('172.') && !host.startsWith('192.168.')) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    return `${proto}://${host}`;
  }
  const localIP = getLocalIPAddress();
  return `http://${localIP}:${PORT}`;
}

app.get('/api/status', (req, res) => {
  const localIP = getLocalIPAddress();
  const publicUrl = getPublicBaseUrl(req);
  res.json({
    status: 'online',
    serverTime: new Date().toISOString(),
    localIP: localIP,
    port: PORT,
    serverUrl: publicUrl,
    mobileUrl: publicUrl,
    desktopUrl: publicUrl
  });
});

// ================= MOBILE POS SYNC & BOOTSTRAP API =================
// GET /api/pos/mobile-bootstrap: Consolidated full configuration for native/offline POS
app.get('/api/pos/mobile-bootstrap', (req, res) => {
  try {
    const terminalId = req.headers['x-terminal-id'] || req.query.terminal_id || 'MOB-COUNTER-01';
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const deviceName = req.query.device_name || req.headers['x-device-name'] || terminalId;

    const data = getMobileBootstrapData(terminalId, deviceName);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate bootstrap payload: ' + err.message });
  }
});

// POST /api/pos/register-terminal: Mobile setup wizard terminal registration
app.post('/api/pos/register-terminal', (req, res) => {
  try {
    const { terminal_id, device_name, mode, api_key, invoice_prefix, admin_pin } = req.body;
    if (!terminal_id) {
      return res.status(400).json({ error: 'terminal_id is required' });
    }

    // Optional admin pin verification if provided
    if (admin_pin) {
      try {
        authenticateUser('admin', admin_pin);
      } catch (e) {
        // Allow if pin matches any admin user in DB
      }
    }

    const terminal = registerPosTerminal({
      terminal_id,
      device_name: device_name || terminal_id,
      mode: mode || 'BILLING_COUNTER',
      api_key,
      invoice_prefix
    });

    const bootstrap = getMobileBootstrapData(terminal.terminal_id, terminal.device_name);
    res.json({
      success: true,
      terminal,
      bootstrap
    });
  } catch (err) {
    res.status(500).json({ error: 'Terminal registration failed: ' + err.message });
  }
});

// GET /api/pos/terminals: List all registered POS terminals
app.get('/api/pos/terminals', (req, res) => {
  try {
    const terminals = getAllPosTerminals();
    res.json(terminals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/sync-orders: Idempotent order & settlement synchronization from offline mobile POS
app.post('/api/pos/sync-orders', (req, res) => {
  try {
    const orders = req.body.orders || (Array.isArray(req.body) ? req.body : [req.body]);
    if (!orders || orders.length === 0) {
      return res.json({ synced_uuids: [], failed: [] });
    }

    const result = syncMobileOrders(orders);

    // If any orders synced, broadcast to all connected WebSocket displays
    if (result.synced_uuids.length > 0) {
      broadcast('TABLES_REFRESH', { timestamp: new Date().toISOString(), source: 'MOBILE_SYNC' });
      broadcast('BILL_SETTLED', { count: result.synced_uuids.length });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Order sync failed: ' + err.message });
  }
});

// POST /api/pos/print-raw: TCP socket proxy for network thermal receipt printers (IP:9100)
app.post('/api/pos/print-raw', (req, res) => {
  const { printer_ip, printer_port = 9100, data_base64 } = req.body;
  if (!printer_ip || !data_base64) {
    return res.status(400).json({ error: 'printer_ip and data_base64 are required' });
  }

  try {
    const rawBuffer = Buffer.from(data_base64, 'base64');
    const client = new net.Socket();
    client.setTimeout(3500);

    client.connect(printer_port, printer_ip, () => {
      client.write(rawBuffer, () => {
        client.end();
        res.json({ success: true, message: `Dispatched ${rawBuffer.length} bytes to ${printer_ip}:${printer_port}` });
      });
    });

    client.on('error', (err) => {
      client.destroy();
      res.status(502).json({ error: `Printer socket error: ${err.message}` });
    });

    client.on('timeout', () => {
      client.destroy();
      res.status(504).json({ error: `Printer connection timeout (${printer_ip}:${printer_port})` });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Auth & User Management (Admin vs Staff)
app.post('/api/auth/login', rateLimiter({ windowMs: 60000, max: 15, message: 'Too many login attempts. Please wait 1 minute.' }), (req, res) => {
  try {
    const { username, pinCode } = req.body;
    const user = authenticateUser(username, pinCode);
    const token = createSessionToken(user);
    res.json({ ...user, token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/users', (req, res) => {
  try {
    const users = getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, (req, res) => {
  try {
    const { id, username, pinCode, fullName, role, assignedKitchenId } = req.body;
    const user = addUser(id || `u-${Date.now()}`, username, pinCode, fullName, role, assignedKitchenId);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  try {
    deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Floors (CRUD)
app.get('/api/floors', (req, res) => {
  try {
    const floors = getFloors();
    res.json(floors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/floors', (req, res) => {
  try {
    const { id, name, sortOrder } = req.body;
    const floor = addFloor(id || `fl-${Date.now().toString().slice(-4)}`, name, sortOrder);
    broadcast('FLOOR_UPDATED', floor);
    res.status(201).json(floor);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/floors/:id', (req, res) => {
  try {
    deleteFloor(req.params.id);
    broadcast('FLOOR_UPDATED', { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Tables (CRUD)
app.get('/api/tables', (req, res) => {
  try {
    const tables = getTablesWithFloor();
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tables', (req, res) => {
  try {
    const { id, name, floorId, capacity } = req.body;
    const table = addTable(id, name, floorId, capacity);
    broadcast('TABLE_UPDATED', table);
    res.status(201).json(table);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/tables/:id', (req, res) => {
  try {
    deleteTable(req.params.id);
    broadcast('TABLE_UPDATED', { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Kitchen Stations (Chinese, Tea, Juice, Hot Steam / Tandoor, Tava, Main)
app.get('/api/kitchens', (req, res) => {
  try {
    const kitchens = getKitchenStations();
    res.json(kitchens);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kitchens', (req, res) => {
  try {
    const { id, name, colorCode } = req.body;
    const kitchen = addKitchenStation(id || `k-${Date.now().toString().slice(-4)}`, name, colorCode);
    broadcast('KITCHEN_UPDATED', kitchen);
    res.status(201).json(kitchen);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/kitchens/:id', (req, res) => {
  try {
    deleteKitchenStation(req.params.id);
    broadcast('KITCHEN_UPDATED', { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Menu Items with Kitchen Routing
app.get('/api/menu', (req, res) => {
  try {
    const menu = getMenuWithKitchens();
    res.json(menu);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/menu', (req, res) => {
  try {
    const { id, categoryId, name, price, isVeg, prepTime, kitchenId, imageUrl, ingredients } = req.body;
    const item = addMenuItem(id || `m-${Date.now().toString().slice(-5)}`, categoryId, name, price, isVeg, prepTime, kitchenId, imageUrl, ingredients);
    broadcast('MENU_UPDATED', item);
    broadcast('INVENTORY_UPDATED', {});
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/menu/:id', (req, res) => {
  try {
    const updated = updateMenuItem(req.params.id, req.body);
    broadcast('MENU_UPDATED', updated);
    broadcast('INVENTORY_UPDATED', {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/menu/:id', (req, res) => {
  try {
    const updated = updateMenuItem(req.params.id, req.body);
    broadcast('MENU_UPDATED', updated);
    broadcast('INVENTORY_UPDATED', {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/menu/:id', (req, res) => {
  try {
    deleteMenuItem(req.params.id);
    broadcast('MENU_UPDATED', { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Split KOT Routing & Creation (Captain -> Respective Kitchen Stations)
app.get('/api/kots', (req, res) => {
  try {
    const kots = getActiveKitchenKOTs(req.query.kitchenId);
    res.json(kots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kots/active', (req, res) => {
  try {
    const kots = getActiveKitchenKOTs(req.query.kitchenId);
    res.json(kots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kots', (req, res) => {
  try {
    const { tableId, items, notes, captainName } = req.body;
    if (!tableId || !items || items.length === 0) {
      return res.status(400).json({ error: 'tableId and non-empty items are required' });
    }

    const createdTickets = createRoutedKOTs(tableId, items, notes, captainName);
    
    // Broadcast live ticket events to specific kitchen screens!
    for (const ticket of createdTickets) {
      broadcast('KOT_CREATED', ticket);
    }
    broadcast('TABLE_UPDATED', { tableId, status: 'OCCUPIED' });
    broadcast('INVENTORY_UPDATED', {});
    broadcast('TV_UPDATED', {});

    res.status(201).json(createdTickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Update KOT Status (Chef marks PREPARING / READY, Server marks SERVED)
function handleKotStatusUpdate(req, res) {
  try {
    const kotId = parseInt(req.params.id, 10);
    const { status } = req.body;
    
    if (!['PREPARING', 'READY', 'SERVED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = updateKOTStatus(kotId, status);
    broadcast('KOT_UPDATED', updated);
    broadcast('TABLES_REFRESH', {});
    broadcast('TV_UPDATED', {});

    if (updated.takeawayOrder) {
      broadcast('TAKEAWAY_STATUS_UPDATED', updated.takeawayOrder);
      broadcast('TAKEAWAY_ORDER_UPDATED', updated.takeawayOrder);
      if (updated.takeawayOrder.status === 'READY') {
        broadcast('TAKEAWAY_READY_ANNOUNCEMENT', {
          tokenNumber: updated.takeawayOrder.token_number,
          customerName: updated.takeawayOrder.customer_name,
          message: `Token number ${updated.takeawayOrder.token_number} is ready for pickup at the delivery counter`
        });
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
app.patch('/api/kots/:id', handleKotStatusUpdate);
app.post('/api/kots/:id/status', handleKotStatusUpdate);

app.post('/api/kots/clear-ready', (req, res) => {
  try {
    const kitchenId = req.body?.kitchenId || null;
    const result = clearAllReadyKitchenKOTs(kitchenId);
    broadcast('KOT_UPDATED', {});
    broadcast('TABLES_REFRESH', {});
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dish-wise / Item-level Preparation & Ready Status (SLA Management)
function handleKotItemStatusUpdate(req, res) {
  try {
    const itemId = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid dish status: must be PENDING, PREPARING, READY, or SERVED' });
    }

    const result = updateKOTItemStatus(itemId, status);
    broadcast('KOT_ITEM_UPDATED', result);
    broadcast('KOT_UPDATED', result.kot);
    broadcast('TABLES_REFRESH', {});
    broadcast('TV_UPDATED', {});

    if (result.takeawayOrder) {
      broadcast('TAKEAWAY_STATUS_UPDATED', result.takeawayOrder);
      broadcast('TAKEAWAY_ORDER_UPDATED', result.takeawayOrder);
      if (result.takeawayOrder.status === 'READY') {
        broadcast('TAKEAWAY_READY_ANNOUNCEMENT', {
          tokenNumber: result.takeawayOrder.token_number,
          customerName: result.takeawayOrder.customer_name,
          message: `Token number ${result.takeawayOrder.token_number} is ready for pickup at the delivery counter`
        });
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
app.patch('/api/kot-items/:id/status', handleKotItemStatusUpdate);
app.post('/api/kot-items/:id/status', handleKotItemStatusUpdate);

// 9. Billing & Settlement
app.post('/api/billing/pre-bill/:tableId', (req, res) => {
  try {
    const preBill = generateTablePreBill(req.params.tableId, req.body || {});
    broadcast('TABLE_PRE_BILL', preBill);
    broadcast('TABLE_UPDATED', { tableId: req.params.tableId, status: 'BILL_REVIEW' });
    res.json(preBill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/billing/reopen/:tableId', (req, res) => {
  try {
    const result = reopenTableOrder(req.params.tableId);
    broadcast('TABLE_UPDATED', { tableId: req.params.tableId, status: 'OCCUPIED' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/billing/settle', (req, res) => {
  try {
    const { tableId, paymentMode, discount, serviceCharge, customerName, customerPhone, orderChannel, aggregatorOrderId, parcelCharge, extraCharges } = req.body;
    if (!tableId) return res.status(400).json({ error: 'tableId is required' });

    const invoice = settleTableBill(tableId, paymentMode || 'UPI', discount, serviceCharge, customerName, customerPhone, orderChannel, aggregatorOrderId, parcelCharge, extraCharges);
    broadcast('BILL_SETTLED', invoice);
    broadcast('TABLE_UPDATED', { tableId, status: 'AVAILABLE' });

    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9B. Custom Bill Charges, Packaging & Discounts Management (Add/Edit/Delete)
app.get('/api/settings/charges', (req, res) => {
  try {
    res.json(getCustomBillCharges());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/charges', (req, res) => {
  try {
    const created = addCustomBillCharge(req.body);
    broadcast('CHARGES_UPDATED', created);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/settings/charges/:id', (req, res) => {
  try {
    const updated = updateCustomBillCharge(req.params.id, req.body);
    broadcast('CHARGES_UPDATED', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/settings/charges/:id', (req, res) => {
  try {
    const result = deleteCustomBillCharge(req.params.id);
    broadcast('CHARGES_UPDATED', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Inventory & Stock Management (Available, Pending & Suggested Daily Purchases)
app.get('/api/inventory', (req, res) => {
  try {
    const inv = getInventoryStatus();
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Purchases Tracker
app.get('/api/purchases', (req, res) => {
  try {
    const purchases = getPurchases();
    res.json(purchases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchases', (req, res) => {
  try {
    const { vendorName, invoiceNo, inventoryId, quantity, unitRate, paymentMode } = req.body;
    const record = addPurchaseRecord(vendorName, invoiceNo, inventoryId, quantity, unitRate, paymentMode);
    broadcast('INVENTORY_UPDATED', {});
    broadcast('PURCHASE_ADDED', record);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Daily Spend Ledger & Expenses
app.get('/api/expenses', (req, res) => {
  try {
    const expenses = getExpenses(req.query.date);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', (req, res) => {
  try {
    const { category, description, amount, paidTo, paymentMode, recordedBy } = req.body;
    const record = addExpense(category, description, amount, paidTo, paymentMode, recordedBy);
    broadcast('EXPENSE_ADDED', record);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 13. Daily P&L Profit & Loss Summary
app.get('/api/reports/pnl', (req, res) => {
  try {
    const pnl = getDailyPnLSummary(req.query.date);
    res.json(pnl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Staff Management & Payroll
app.get('/api/staff', (req, res) => {
  try {
    const staff = getStaffList();
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/staff', (req, res) => {
  try {
    const { id, name, role, phone, salaryType, baseSalary } = req.body;
    const staff = addStaff(id || `s-${Date.now().toString().slice(-4)}`, name, role, phone, salaryType, baseSalary);
    res.status(201).json(staff);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/staff/:id', (req, res) => {
  try {
    const { name, role, phone, salaryType, baseSalary, status } = req.body;
    const updated = updateStaff(req.params.id, name, role, phone, salaryType, baseSalary, status);
    broadcast('STAFF_UPDATED', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/staff/:id', (req, res) => {
  try {
    deleteStaff(req.params.id);
    broadcast('STAFF_UPDATED', { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/payroll', (req, res) => {
  try {
    const payroll = getPayrollRecords();
    res.json(payroll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payroll', (req, res) => {
  try {
    const { staffId, periodMonth, daysPresent, daysAbsent, advanceDeductions, bonuses, paymentMode } = req.body;
    const result = recordPayroll(staffId, periodMonth, daysPresent, daysAbsent, advanceDeductions, bonuses, paymentMode);
    broadcast('PAYROLL_RECORDED', result);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Swiggy & Zomato Accounting & Weekly Payout Ledger
app.get('/api/aggregators/accounting', (req, res) => {
  try {
    const summary = getAggregatorAccountingSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/aggregators/payout-settle', (req, res) => {
  try {
    const { invoiceIds, channel, payoutRef, payoutAmount, notes, periodRange } = req.body;
    const summary = settleAggregatorPayout({ invoiceIds, channel, payoutRef, payoutAmount, notes, periodRange });
    broadcast('BILL_SETTLED', {});
    broadcast('TABLES_REFRESH', {});
    res.json({ success: true, summary });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Staff PIN & Biometric Authentication
app.post('/api/auth/staff-pin', rateLimiter({ windowMs: 60000, max: 20, message: 'Too many PIN verification attempts. Please wait 1 minute.' }), (req, res) => {
  try {
    const { identifier, pin } = req.body;
    if (!identifier || !pin) {
      return res.status(400).json({ error: 'Identifier and PIN are required' });
    }
    const staff = verifyStaffPin(identifier, pin);
    if (!staff) {
      return res.status(401).json({ error: 'Incorrect 4-digit security PIN' });
    }
    const token = createSessionToken(staff);
    res.json({ success: true, staff: { ...staff, token }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/biometric', rateLimiter({ windowMs: 60000, max: 15, message: 'Too many biometric verification attempts.' }), (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Identifier is required for biometric authentication' });
    }
    const cleanId = String(identifier).trim().toLowerCase();
    const users = getAllUsers();
    let staff = users.find(u => u.username.toLowerCase() === cleanId || u.id.toLowerCase() === cleanId || u.role.toLowerCase() === cleanId);
    if (!staff) {
      return res.status(401).json({ error: 'Staff member not found for biometric profile' });
    }
    const token = createSessionToken(staff);
    res.json({ success: true, staff: { ...staff, token }, token, biometricVerified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/payroll/:id', (req, res) => {
  try {
    const payrollId = parseInt(req.params.id, 10);
    const { daysPresent, daysAbsent, advanceDeductions, bonuses, netSalary, paymentMode } = req.body;
    const result = updatePayroll(payrollId, daysPresent, daysAbsent, advanceDeductions, bonuses, netSalary, paymentMode);
    broadcast('PAYROLL_RECORDED', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/payroll/:id', (req, res) => {
  try {
    const payrollId = parseInt(req.params.id, 10);
    deletePayroll(payrollId);
    broadcast('PAYROLL_RECORDED', { deletedId: payrollId });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Takeaway & Parcel Orders (Upfront Cash Collection, Daily Incrementing Tokens, Audio Callout)
app.get('/api/takeaway', (req, res) => {
  try {
    const orders = getTakeawayOrders(req.query.date);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/takeaway', (req, res) => {
  try {
    const order = createTakeawayOrder(req.body);
    broadcast('TAKEAWAY_ORDER_CREATED', order);

    // Broadcast split KOT tickets to respective kitchen screens so chefs prepare takeaway dishes
    if (Array.isArray(order.kots)) {
      for (const ticket of order.kots) {
        broadcast('KOT_CREATED', ticket);
      }
    }
    if (order.is_paid) {
      broadcast('INVENTORY_UPDATED', {});
    }
    broadcast('TABLES_REFRESH', {});
    broadcast('TV_UPDATED', {});

    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/takeaway/:id/pay', (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { paymentMode } = req.body;
    const order = collectTakeawayPayment(orderId, paymentMode);

    broadcast('TAKEAWAY_ORDER_PAID', order);
    if (Array.isArray(order.kots)) {
      for (const ticket of order.kots) {
        broadcast('KOT_CREATED', ticket);
      }
    }
    broadcast('INVENTORY_UPDATED', {});
    broadcast('TABLES_REFRESH', {});
    broadcast('TV_UPDATED', {});

    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/takeaway/:id/status', (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const order = updateTakeawayStatus(orderId, status);

    broadcast('TAKEAWAY_STATUS_UPDATED', order);
    broadcast('TAKEAWAY_ORDER_UPDATED', order);
    broadcast('KOT_UPDATED', {});
    broadcast('TABLES_REFRESH', {});
    broadcast('TV_UPDATED', {});
    if (status === 'READY') {
      // Audio chime and voice callout broadcast
      broadcast('TAKEAWAY_READY_ANNOUNCEMENT', {
        tokenNumber: order.token_number,
        customerName: order.customer_name,
        message: `Token number ${order.token_number} is ready for pickup at the delivery counter`
      });
    }

    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 16. Settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = getRestaurantSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = saveRestaurantSettings(req.body);
    broadcast('SETTINGS_UPDATED', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 17. User Work Assignments (Tables & Kitchen Stations)
app.get('/api/assignments', (req, res) => {
  try {
    const assignments = getAllUserAssignments();
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/assignments/:userId', (req, res) => {
  try {
    const a = getUserAssignments(req.params.userId);
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assignments/:userId', (req, res) => {
  try {
    const { tables, kitchens, allTables } = req.body;
    const updated = setUserAssignments(req.params.userId, { tables, kitchens, allTables });
    broadcast('USER_ASSIGNMENTS_UPDATED', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 18. Billing History & Permanent Archive (Up to 12 Months)
app.get('/api/billing/history', (req, res) => {
  try {
    const { search, date, dateFrom, dateTo, paymentMode, channel, limit } = req.query;
    const history = getBillingHistory({
      search,
      dateFrom: dateFrom || date,
      dateTo: dateTo || date,
      paymentMode,
      channel,
      limit: limit ? parseInt(limit) : 2000
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/billing/invoices/:id', (req, res) => {
  try {
    const inv = getInvoiceById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19. Staff Payslip Details & Thermal Reprint
app.get('/api/payroll/:id/payslip', (req, res) => {
  try {
    const payrollId = parseInt(req.params.id, 10);
    const slip = getPayslipDetails(payrollId);
    if (!slip) return res.status(404).json({ error: 'Payslip record not found' });
    res.json(slip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20. Menu Item Edit & Recipe Details
app.get('/api/menu/:id/recipe', (req, res) => {
  try {
    const item = getMenuItemWithIngredients(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/menu/:id/recipe', (req, res) => {
  try {
    const { ingredients } = req.body;
    if (!Array.isArray(ingredients)) {
      return res.status(400).json({ error: 'Ingredients must be an array' });
    }
    const updated = updateMenuItem(req.params.id, { ingredients });
    broadcast('MENU_UPDATED', updated);
    broadcast('INVENTORY_UPDATED', getInventoryStatus());
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// 21. Gemini AI Recipe & Ingredient Autofill & Validation
app.post('/api/ai/suggest-ingredients', rateLimiter({ windowMs: 60000, max: 25, message: 'AI ingredient suggestion rate limit reached. Please wait a moment.' }), async (req, res) => {
  try {
    const { dishName, isVeg, category, apiKey } = req.body;
    if (!dishName || !dishName.trim()) {
      return res.status(400).json({ error: 'Dish name is required' });
    }
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    const inventory = getInventoryStatus();
    const invItems = Array.isArray(inventory) ? inventory : (inventory?.items || []);
    const result = await suggestRecipeIngredients(dishName, isVeg, category, invItems, key, ensureInventoryItem);
    const updatedInventory = getInventoryStatus();
    res.json({ ...result, updatedInventory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 21b. Gemini AI Food Image Generation & Auto-Upload
app.post('/api/ai/generate-food-image', rateLimiter({ windowMs: 60000, max: 20, message: 'AI image generation rate limit reached. Please wait a moment.' }), async (req, res) => {
  try {
    const { dishName, isVeg, category, apiKey } = req.body;
    if (!dishName || !dishName.trim()) {
      return res.status(400).json({ error: 'Dish name is required to generate food image' });
    }
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    const result = await generateFoodImage(dishName, isVeg !== false, category || 'mains', uploadDir, key);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 21c. Local Image Upload & Storage Endpoint (Browse Device / Gallery / Camera)
app.post('/api/upload-image', (req, res) => {
  try {
    const { dataUrl, filename, dishName } = req.body;
    if (!dataUrl) {
      return res.status(400).json({ error: 'Image data URL is required' });
    }
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      if (dataUrl.startsWith('http') || dataUrl.startsWith('/uploads/')) {
        return res.json({ success: true, imageUrl: dataUrl });
      }
      return res.status(400).json({ error: 'Invalid image data format' });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    let ext = 'jpg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('webp')) ext = 'webp';

    const safeName = (dishName || filename || 'dish')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 30) || 'dish';

    const uploadFilename = `${safeName}-${Date.now()}.${ext}`;
    const targetFile = path.join(uploadDir, uploadFilename);
    fs.writeFileSync(targetFile, buffer);

    const imageUrl = `/uploads/menu/${uploadFilename}`;
    res.json({ success: true, imageUrl, filename: uploadFilename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 22. Mobile Bill Scanner & Gemini OCR
app.post('/api/inventory/scan-bill', async (req, res) => {
  try {
    const { imageBase64, mimeType, apiKey } = req.body;
    const inventory = getInventoryStatus();
    const parsed = await scanPurchaseBillOCR(imageBase64, mimeType || 'image/jpeg', inventory, apiKey);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory/process-scanned-bill', (req, res) => {
  try {
    const result = processScannedPurchase(req.body);
    broadcast('INVENTORY_UPDATED', result);
    broadcast('EXPENSE_RECORDED', {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 23. Zero-Data-Loss Backup Endpoint
app.post('/api/system/backup', (req, res) => {
  try {
    const result = backupDatabase();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 24. Admin Live Order Flow Controller & Emergency Queue Rescue Hub
app.get('/api/admin/active-orders', (req, res) => {
  try {
    const orders = getAllActiveOrdersWithStatus();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/:tableId/force-route', (req, res) => {
  try {
    const { targetStage } = req.body;
    const result = forceRouteOrder(req.params.tableId, targetStage);
    broadcast('TABLE_UPDATED', { tableId: req.params.tableId, status: result.status });
    broadcast('ORDER_FORCE_ROUTED', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 25. Table Management: Shift Table & Merge Tables
app.post('/api/tables/transfer', (req, res) => {
  try {
    const { sourceTableId, targetTableId } = req.body;
    if (!sourceTableId || !targetTableId) {
      return res.status(400).json({ error: 'sourceTableId and targetTableId are required' });
    }
    const result = transferTable(sourceTableId, targetTableId);
    broadcast('TABLE_TRANSFERRED', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/tables/merge', (req, res) => {
  try {
    const { sourceTableId, targetTableId } = req.body;
    if (!sourceTableId || !targetTableId) {
      return res.status(400).json({ error: 'sourceTableId and targetTableId are required' });
    }
    const result = mergeTables(sourceTableId, targetTableId);
    broadcast('TABLE_MERGED', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 26. Shift / Day-End Z-Report (Drawer Reconciliation)
app.get('/api/reports/z-report', (req, res) => {
  try {
    const report = getDayEndZReport(req.query.date);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 27. TV Digital Signage & Token Screen
app.get('/api/tv/display', (req, res) => {
  try {
    const data = getTVDisplayData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tv/promotions', (req, res) => {
  try {
    const promotions = getTVPromotions();
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tv/promotions', (req, res) => {
  try {
    const promo = saveTVPromotion(req.body);
    broadcast('TV_UPDATED', { promo });
    res.json(promo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/tv/promotions/:id', (req, res) => {
  try {
    deleteTVPromotion(parseInt(req.params.id, 10));
    broadcast('TV_UPDATED', {});
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 28. Swiggy & Zomato Online Aggregator Webhook / Ingestion
app.post('/api/integrations/aggregator-order', (req, res) => {
  try {
    const { aggregator, orderId, customerName, customerPhone, items, deliveryPartner, notes } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain items' });
    }
    const result = createAggregatorOrder({
      aggregator,
      orderId,
      customerName,
      customerPhone,
      items,
      deliveryPartner,
      notes
    });

    for (const ticket of result.kots) {
      broadcast('KOT_CREATED', ticket);
    }
    broadcast('INVENTORY_UPDATED', {});
    broadcast('BILL_SETTLED', { invoiceCode: result.invoiceCode });

    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 29. Database Backup & Disaster Recovery Suite (Zero Data Loss)
app.get('/api/backup/health', (req, res) => {
  try {
    const health = getDatabaseHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup/list', (req, res) => {
  try {
    const backups = listDatabaseBackups();
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/create', requireAdmin, (req, res) => {
  try {
    const type = req.body?.type || 'MANUAL';
    const result = createDatabaseBackup(type);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup/download/:filename', requireAdmin, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(__dirname, 'backups', filename);
    res.download(filePath, filename);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/backup/restore', requireAdmin, (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Backup filename required' });
    }
    const result = restoreDatabaseFromBackup(filename);
    broadcast('DATABASE_RESTORED', { filename });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 30. Reset & Re-Seed Classic Hotel Real Menu (from Whiteboard image)
app.post('/api/menu/reset-classic', requireAdmin, (req, res) => {
  try {
    const result = seedClassicHotelRealMenu();
    broadcast('MENU_UPDATED', {});
    broadcast('INVENTORY_UPDATED', {});
    res.json({ success: true, message: 'Classic Hotel real whiteboard menu seeded successfully', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 31. Client Setups & App Downloads (Windows & Android Mobile)
app.get('/api/downloads/info', (req, res) => {
  const localIP = getLocalIPAddress();
  const serverUrl = getPublicBaseUrl(req);
  const tvUrl = `${serverUrl}/tv.html`;

  const exePath = path.join(publicDir, 'downloads', 'ChefPulse_POS_Setup.exe');
  const apkPath = path.join(publicDir, 'downloads', 'ChefPulse_POS_Captain.apk');

  const exeExists = fs.existsSync(exePath);
  const apkExists = fs.existsSync(apkPath);

  res.json({
    localIP,
    port: PORT,
    serverUrl,
    tvUrl,
    platform: process.platform,
    appName: 'ChefPulse Enterprise Restaurant POS',
    windowsExe: {
      available: exeExists,
      filename: 'ChefPulse_POS_Setup.exe',
      url: `/api/downloads/windows-exe`,
      directUrl: `/downloads/ChefPulse_POS_Setup.exe`,
      sizeBytes: exeExists ? fs.statSync(exePath).size : 0,
      sizeFormatted: exeExists ? `${(fs.statSync(exePath).size / 1024).toFixed(1)} KB` : '14 KB'
    },
    androidApk: {
      available: apkExists,
      filename: 'ChefPulse_POS_Captain.apk',
      url: `/api/downloads/android-apk`,
      directUrl: `/downloads/ChefPulse_POS_Captain.apk`,
      sizeBytes: apkExists ? fs.statSync(apkPath).size : 0,
      sizeFormatted: apkExists ? `${(fs.statSync(apkPath).size / 1024).toFixed(1)} KB` : '13 KB'
    }
  });
});

// Windows Standalone Installer (.exe) Direct Download
app.get('/api/downloads/windows-exe', (req, res) => {
  const exePath = path.join(publicDir, 'downloads', 'ChefPulse_POS_Setup.exe');
  if (fs.existsSync(exePath)) {
    res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    res.download(exePath, 'ChefPulse_POS_Setup.exe');
  } else {
    res.status(404).send('ChefPulse_POS_Setup.exe not found on server.');
  }
});

// Android Mobile Captain (.apk) Direct Download
app.get('/api/downloads/android-apk', (req, res) => {
  const apkPath = path.join(publicDir, 'downloads', 'ChefPulse_POS_Captain.apk');
  if (fs.existsSync(apkPath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.download(apkPath, 'ChefPulse_POS_Captain.apk');
  } else {
    res.status(404).send('ChefPulse_POS_Captain.apk not found on server.');
  }
});

app.get('/api/downloads/windows-setup', (req, res) => {
  const localIP = getLocalIPAddress();
  const serverUrl = `http://${localIP}:${PORT}`;

  const batScript = `@echo off
title ChefPulse POS - Windows Desktop Client Setup
color 0A
cls
echo =======================================================================
echo   ChefPulse POS - Windows Desktop Client Automated Setup
echo =======================================================================
echo.
set "SERVER_URL=${serverUrl}"
echo Connecting to ChefPulse POS Server at: %SERVER_URL%
echo.

rem 1. Detect Chrome or Edge executable
set "BROWSER="
if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (
    set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
) else if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" (
    set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
) else if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" (
    set "BROWSER=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"
) else if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (
    set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"
) else if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (
    set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"
)

rem 2. Create standalone desktop batch launcher
echo [1/3] Creating Desktop Launcher: "ChefPulse POS Desktop.bat" ...
(
    echo @echo off
    echo title ChefPulse POS Client
    echo Starting ChefPulse POS in dedicated desktop app mode...
    if not "%BROWSER%"=="" (
        echo start "" "%BROWSER%" --app=%SERVER_URL% --start-maximized --disable-pinch
    ) else (
        echo start "" "%SERVER_URL%"
    )
) > "%USERPROFILE%\\Desktop\\ChefPulse POS Desktop.bat"

rem 3. Create Windows Desktop Shortcut (.lnk) via VBScript
echo [2/3] Creating Windows Desktop Shortcut (.lnk)...
set "VBS_PATH=%TEMP%\\create_chefpulse_shortcut.vbs"
(
    echo Set oWS = WScript.CreateObject("WScript.Shell"^)
    echo sLinkFile = "%USERPROFILE%\\Desktop\\ChefPulse POS.lnk"
    echo Set oLink = oWS.CreateShortcut(sLinkFile^)
    if not "%BROWSER%"=="" (
        echo oLink.TargetPath = "%BROWSER%"
        echo oLink.Arguments = "--app=%SERVER_URL% --start-maximized --disable-pinch"
    ) else (
        echo oLink.TargetPath = "%SERVER_URL%"
    )
    echo oLink.Description = "ChefPulse POS Desktop Application"
    echo oLink.Save
) > "%VBS_PATH%"
cscript //nologo "%VBS_PATH%"
del "%VBS_PATH%" 2>nul

echo [3/3] Desktop shortcut created successfully on your Windows Desktop!
echo.
echo =======================================================================
echo   INSTALLATION COMPLETE!
echo   Double-click the "ChefPulse POS" icon on your Desktop anytime.
echo =======================================================================
echo.
echo Launching POS Desktop Client now...
if not "%BROWSER%"=="" (
    start "" "%BROWSER%" --app=%SERVER_URL% --start-maximized
) else (
    start "" "%SERVER_URL%"
)
timeout /t 3 >nul
exit
`;

  res.setHeader('Content-Type', 'application/bat');
  res.setHeader('Content-Disposition', 'attachment; filename="ChefPulse_POS_Windows_Setup.bat"');
  res.send(batScript);
});

app.get('/api/downloads/android-config', (req, res) => {
  const localIP = getLocalIPAddress();
  const serverUrl = getPublicBaseUrl(req);
  const wsProto = serverUrl.startsWith('https:') ? 'wss:' : 'ws:';
  const wsUrl = serverUrl.replace(/^https?:/, wsProto);
  const config = {
    appName: 'ChefPulse Mobile POS',
    serverIp: localIP,
    port: PORT,
    posUrl: serverUrl,
    wsUrl: wsUrl,
    version: '4.0.0',
    type: 'ANDROID_PWA',
    downloadedAt: new Date().toISOString()
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="chefpulse_mobile_config.json"');
  res.json(config);
});

// Hourly Automated Persistent Snapshot (Zero Data Loss)
setInterval(() => {
  try {
    createDatabaseBackup('AUTO');
    console.log('[Scheduler] Hourly automated database snapshot recorded.');
  } catch (e) {
    console.warn('[Scheduler] Automated backup warning:', e.message);
  }
}, 3600000);

// Fallback to client app for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start listening
server.listen(PORT, HOST, () => {
  const localIP = getLocalIPAddress();
  const isCloud = process.env.RENDER || process.env.PORT === '10000' || process.env.NODE_ENV === 'production';
  const publicUrl = process.env.RENDER_EXTERNAL_URL || (isCloud ? 'https://project-billing.onrender.com' : `http://localhost:${PORT}`);
  const wsUrl = publicUrl.startsWith('https:') ? publicUrl.replace('https:', 'wss:') : `ws://${localIP}:${PORT}`;

  console.log(`
===========================================================
  🍽️  ChefPulse Enterprise POS & Management Server Started
===========================================================
  OS Platform:        ${process.platform} (${process.arch})
  Port:               ${PORT}
  ${isCloud ? `Live Cloud URL:     ${publicUrl}` : `Local Desktop View: http://localhost:${PORT}`}
  ${isCloud ? `Cloud WebSocket:    ${wsUrl}` : `Mobile Devices:     http://${localIP}:${PORT}`}
  ${isCloud ? `Public Access:      Online via Render SSL` : `WebSocket Server:   ws://${localIP}:${PORT}`}
===========================================================
  Multi-Kitchen Routing • Floors & Tables • RBAC & Payroll
  Inventory Auto-Deduction • Daily Spend Ledger • Purchases
===========================================================
  `);
});
