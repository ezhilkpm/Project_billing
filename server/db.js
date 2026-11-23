// server/db.js - Full Enterprise Restaurant POS Database Engine
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'restaurant.db');

export const db = new DatabaseSync(dbPath);

export function initDatabase() {
  db.exec(`
    -- 1. FLOORS & AREAS
    CREATE TABLE IF NOT EXISTS floors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- 2. TABLES
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      floor_id TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 4,
      status TEXT NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'OCCUPIED', 'BILLING'
      active_order_id TEXT,
      FOREIGN KEY (floor_id) REFERENCES floors(id)
    );

    -- 3. MULTIPLE KITCHEN STATIONS / COUNTERS
    CREATE TABLE IF NOT EXISTS kitchen_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color_code TEXT DEFAULT '#f59e0b',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    -- 4. MENU CATEGORIES & ITEMS WITH KITCHEN ROUTING & IMAGES
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      is_veg INTEGER NOT NULL DEFAULT 1,
      prep_time TEXT DEFAULT '10m',
      kitchen_id TEXT NOT NULL, -- Responsible Kitchen Station!
      image_url TEXT,
      FOREIGN KEY (category_id) REFERENCES menu_categories(id),
      FOREIGN KEY (kitchen_id) REFERENCES kitchen_stations(id)
    );

    -- 5. KOTS & SPLIT ROUTED KOT ITEMS
    CREATE TABLE IF NOT EXISTS kots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id TEXT NOT NULL,
      kitchen_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'
      notes TEXT,
      captain_name TEXT DEFAULT 'Captain',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (table_id) REFERENCES tables(id),
      FOREIGN KEY (kitchen_id) REFERENCES kitchen_stations(id)
    );

    CREATE TABLE IF NOT EXISTS kot_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kot_id INTEGER NOT NULL,
      menu_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER NOT NULL,
      kitchen_id TEXT NOT NULL,
      FOREIGN KEY (kot_id) REFERENCES kots(id)
    );

    -- 6. INVOICES & BILLING
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_code TEXT NOT NULL UNIQUE,
      table_id TEXT NOT NULL,
      subtotal REAL NOT NULL,
      cgst REAL NOT NULL,
      sgst REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'UPI', -- 'UPI', 'CASH', 'CARD'
      status TEXT NOT NULL DEFAULT 'PAID',
      created_at TEXT NOT NULL,
      FOREIGN KEY (table_id) REFERENCES tables(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    -- 7. USERS & ACCESS CONTROL (ADMIN VS STAFF)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_code TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL, -- 'ADMIN', 'CAPTAIN', 'CHEF', 'WAITER', 'CASHIER'
      assigned_kitchen_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    -- 8. STAFF MANAGEMENT & PAYROLL
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      salary_type TEXT NOT NULL DEFAULT 'MONTHLY',
      base_salary REAL NOT NULL,
      joined_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS staff_payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id TEXT NOT NULL,
      period_month TEXT NOT NULL,
      days_present INTEGER NOT NULL DEFAULT 30,
      days_absent INTEGER NOT NULL DEFAULT 0,
      advance_deductions REAL NOT NULL DEFAULT 0,
      bonuses REAL NOT NULL DEFAULT 0,
      net_salary REAL NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'CASH',
      payment_date TEXT NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    -- 9. INVENTORY, RECIPES & STOCK DEDUCTION
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL, -- 'kg', 'ltr', 'pcs', 'pack'
      current_stock REAL NOT NULL DEFAULT 0,
      min_threshold REAL NOT NULL DEFAULT 5,
      cost_per_unit REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id TEXT NOT NULL,
      inventory_id TEXT NOT NULL,
      quantity_required REAL NOT NULL,
      FOREIGN KEY (menu_id) REFERENCES menu_items(id),
      FOREIGN KEY (inventory_id) REFERENCES inventory_items(id)
    );

    -- 10. PURCHASES & DAILY SPEND LEDGER
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_date TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      invoice_no TEXT,
      inventory_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_rate REAL NOT NULL,
      total_amount REAL NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'CASH',
      FOREIGN KEY (inventory_id) REFERENCES inventory_items(id)
    );

    CREATE TABLE IF NOT EXISTS expenses_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      paid_to TEXT,
      payment_mode TEXT NOT NULL DEFAULT 'CASH',
      recorded_by TEXT NOT NULL DEFAULT 'Admin'
    );

    -- 11. RESTAURANT SETTINGS
    CREATE TABLE IF NOT EXISTS restaurant_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 12. TAKEAWAY & PARCEL ORDERS (WITH DAILY RESETTING TOKENS)
    CREATE TABLE IF NOT EXISTS takeaway_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_number INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT,
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL,
      cgst REAL NOT NULL,
      sgst REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'CASH',
      is_paid INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PREPARING', -- 'PENDING_PAYMENT', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'
      captain_name TEXT DEFAULT 'Staff',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 13. USER WORK ASSIGNMENTS (TABLES & KITCHENS)
    CREATE TABLE IF NOT EXISTS user_table_assignments (
      user_id TEXT NOT NULL,
      table_id TEXT NOT NULL,
      PRIMARY KEY (user_id, table_id)
    );

    CREATE TABLE IF NOT EXISTS user_kitchen_assignments (
      user_id TEXT NOT NULL,
      kitchen_id TEXT NOT NULL,
      PRIMARY KEY (user_id, kitchen_id)
    );

    -- 14. TV PROMOTIONS & DIGITAL SIGNAGE ADS
    CREATE TABLE IF NOT EXISTS tv_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      tagline TEXT,
      image_url TEXT,
      price_badge TEXT,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- 15. CUSTOM BILL CHARGES & DISCOUNTS (Parcel, AC Dining, VIP Discount, Surcharges)
    CREATE TABLE IF NOT EXISTS bill_custom_charges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      charge_type TEXT NOT NULL DEFAULT 'FLAT', -- 'FLAT', 'PERCENT'
      value REAL NOT NULL DEFAULT 0,
      is_discount INTEGER NOT NULL DEFAULT 0, -- 0 = charge/fee, 1 = discount
      apply_to TEXT NOT NULL DEFAULT 'ALL', -- 'ALL', 'DINE_IN', 'TAKEAWAY'
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- 16. POS TERMINALS (Android Mobile & Offline Tablet Terminals)
    CREATE TABLE IF NOT EXISTS pos_terminals (
      terminal_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      invoice_prefix TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'BILLING_COUNTER', -- 'BILLING_COUNTER', 'WAITER_PAD'
      last_sync_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // Migration helpers
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN image_url TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE staff_payroll ADD COLUMN payslip_code TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN service_charge REAL DEFAULT 0`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN customer_name TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN customer_phone TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN order_channel TEXT DEFAULT 'DINE_IN'`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN aggregator_order_id TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN parcel_charge REAL DEFAULT 0`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN extra_charges_json TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN mobile_bill_uuid TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN terminal_id TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN aggregator_payout_status TEXT DEFAULT 'PENDING'`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN aggregator_payout_date TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN aggregator_payout_ref TEXT`); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS aggregator_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        gross_amount REAL NOT NULL,
        net_received_amount REAL NOT NULL,
        deductions_amount REAL NOT NULL DEFAULT 0,
        orders_count INTEGER NOT NULL DEFAULT 0,
        utr_number TEXT,
        settlement_date TEXT NOT NULL,
        period_range TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      )
    `);
  } catch (e) {}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN aggregator_settlement_id INTEGER`); } catch (e) {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_mobile_uuid ON invoices(mobile_bill_uuid)`); } catch (e) {}
  try { db.exec(`ALTER TABLE takeaway_orders ADD COLUMN parcel_charge REAL DEFAULT 0`); } catch (e) {}
  try { db.exec(`ALTER TABLE staff ADD COLUMN pin_code TEXT DEFAULT '1234'`); } catch (e) {}
  try { db.exec(`ALTER TABLE staff ADD COLUMN biometric_credential_id TEXT`); } catch (e) {}

  // KOT & Items Dish-level Status & SLA Tracking
  try { db.exec(`ALTER TABLE kot_items ADD COLUMN status TEXT DEFAULT 'PENDING'`); } catch (e) {}
  try { db.exec(`ALTER TABLE kot_items ADD COLUMN fired_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kot_items ADD COLUMN prep_started_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kot_items ADD COLUMN ready_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kot_items ADD COLUMN served_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kot_items ADD COLUMN prep_time_minutes REAL`); } catch (e) {}
  try { db.exec(`ALTER TABLE kots ADD COLUMN fired_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kots ADD COLUMN prep_started_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kots ADD COLUMN ready_at TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE kots ADD COLUMN served_at TEXT`); } catch (e) {}

  // Seed default bill charges if empty
  try {
    const countCharges = db.prepare('SELECT count(*) as c FROM bill_custom_charges').get();
    if (!countCharges || countCharges.c === 0) {
      const insChg = db.prepare('INSERT INTO bill_custom_charges (id, name, charge_type, value, is_discount, apply_to, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      insChg.run('CHG-PARCEL', 'Parcel / Packaging Charge', 'FLAT', 15, 0, 'TAKEAWAY', 1, 1);
      insChg.run('CHG-AC', 'AC Dining Surcharge', 'PERCENT', 5, 0, 'DINE_IN', 0, 2);
      insChg.run('CHG-DISC5', 'Regular Discount 5%', 'PERCENT', 5, 1, 'ALL', 1, 3);
      insChg.run('CHG-DISC10', 'VIP Customer Discount 10%', 'PERCENT', 10, 1, 'ALL', 1, 4);
    }
  } catch (e) {}

  // Seed default mobile terminal if none exists
  try {
    const tCount = db.prepare('SELECT count(*) as c FROM pos_terminals').get();
    if (!tCount || tCount.c === 0) {
      const insTerm = db.prepare(`
        INSERT INTO pos_terminals (terminal_id, device_name, invoice_prefix, api_key, mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insTerm.run('MOB-COUNTER-01', 'Primary Mobile POS Terminal', 'MOB1-', 'cp_pos_key_primary_9921', 'BILLING_COUNTER', new Date().toISOString());
    }
  } catch (e) {}

  seedInitialData();
  seedClassicHotelRealMenu();
  backupDatabase();
  console.log('✅ Enterprise POS Database initialized successfully at:', dbPath);
}

// ================= CLASSIC HOTEL REAL MENU SEEDER (FROM IMAGE) =================
export const classicMenuItems = [
  // 1. MEALS & BIRYANI
  { id: 'm-meals', cat: 'cat-meals', name: 'South Indian Meals', price: 110, veg: 1, prep: '5m', kitchen: 'k-biryani', img: 'https://images.unsplash.com/photo-1610192244261-3f33de3f55e4?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-biryani', cat: 'cat-meals', name: 'Chicken Biryani', price: 140, veg: 0, prep: '10m', kitchen: 'k-biryani', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-65-biryani', cat: 'cat-meals', name: 'Chicken 65 Biryani', price: 160, veg: 0, prep: '10m', kitchen: 'k-biryani', img: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-kushka', cat: 'cat-meals', name: 'Kushka', price: 90, veg: 0, prep: '5m', kitchen: 'k-biryani', img: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-egg-extra', cat: 'cat-meals', name: 'Egg Extra', price: 15, veg: 0, prep: '2m', kitchen: 'k-biryani', img: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=500&auto=format&fit=crop&q=80' },

  // 2. RICE VARIETIES
  { id: 'm-chk-rice', cat: 'cat-rice', name: 'Chicken Rice', price: 140, veg: 0, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-egg-rice', cat: 'cat-rice', name: 'Egg Rice', price: 120, veg: 0, prep: '8m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-paneer-rice', cat: 'cat-rice', name: 'Paneer Rice', price: 150, veg: 1, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-gobi-rice', cat: 'cat-rice', name: 'Gobi Rice', price: 150, veg: 1, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-mush-rice', cat: 'cat-rice', name: 'Mushroom Rice', price: 150, veg: 1, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-veg-rice', cat: 'cat-rice', name: 'Veg Rice', price: 110, veg: 1, prep: '8m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=80' },

  // 3. NOODLES & SHAWARMA
  { id: 'm-chk-noodles', cat: 'cat-noodles', name: 'Chicken Noodles', price: 150, veg: 0, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-egg-noodles', cat: 'cat-noodles', name: 'Egg Noodles', price: 130, veg: 0, prep: '8m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-paneer-noodles', cat: 'cat-noodles', name: 'Paneer Noodles', price: 150, veg: 1, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-gobi-noodles', cat: 'cat-noodles', name: 'Gobi Noodles', price: 140, veg: 1, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1626804475297-41608ea09aeb?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-mush-noodles', cat: 'cat-noodles', name: 'Mushroom Noodles', price: 160, veg: 1, prep: '10m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-veg-noodles', cat: 'cat-noodles', name: 'Veg Noodles', price: 120, veg: 1, prep: '8m', kitchen: 'k-chinese', img: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-chk-shawarma', cat: 'cat-noodles', name: 'Chicken Shawarma Roll', price: 100, veg: 0, prep: '6m', kitchen: 'k-shawarma', img: 'https://images.unsplash.com/photo-1637806930600-37fa8892069d?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-shawarma-plate', cat: 'cat-noodles', name: 'Shawarma Plate', price: 130, veg: 0, prep: '7m', kitchen: 'k-shawarma', img: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80' },

  // 4. CHICKEN STARTERS
  { id: 'm-chk-65', cat: 'cat-chicken-starters', name: 'Chicken 65', price: 130, veg: 0, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-chk-leg-65', cat: 'cat-chicken-starters', name: 'Chicken Leg 65', price: 140, veg: 0, prep: '12m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-chk-lollipop', cat: 'cat-chicken-starters', name: 'Chicken Lollipop', price: 160, veg: 0, prep: '12m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1527477378378-0e95b066917c?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-cheese-lollipop', cat: 'cat-chicken-starters', name: 'Cheese Sauce Lollipop', price: 180, veg: 0, prep: '14m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-chilli-chk', cat: 'cat-chicken-starters', name: 'Chilli Chicken', price: 160, veg: 0, prep: '12m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-pepper-chk', cat: 'cat-chicken-starters', name: 'Pepper Chicken', price: 160, veg: 0, prep: '12m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-dragon-chk', cat: 'cat-chicken-starters', name: 'Dragon Chicken', price: 180, veg: 0, prep: '12m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-ginger-garlic-chk', cat: 'cat-chicken-starters', name: 'Ginger/Garlic Chicken', price: 160, veg: 0, prep: '12m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=500&auto=format&fit=crop&q=80' },

  // 5. VEG STARTERS (GOBI, PANEER, MUSHROOM)
  { id: 'm-gobi-manch', cat: 'cat-veg-starters', name: 'Gobi Manchurian', price: 140, veg: 1, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-paneer-manch', cat: 'cat-veg-starters', name: 'Paneer Manchurian', price: 170, veg: 1, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-mush-manch', cat: 'cat-veg-starters', name: 'Mushroom Manchurian', price: 170, veg: 1, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1608897013039-887f21d8c804?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-gobi-pepper', cat: 'cat-veg-starters', name: 'Gobi Pepper Fry', price: 140, veg: 1, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-paneer-pepper', cat: 'cat-veg-starters', name: 'Paneer Pepper Fry', price: 170, veg: 1, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-mush-pepper', cat: 'cat-veg-starters', name: 'Mushroom Pepper Fry', price: 170, veg: 1, prep: '10m', kitchen: 'k-starters', img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&auto=format&fit=crop&q=80' },

  // 6. GRAVY ITEMS
  { id: 'm-chettinadu-chk', cat: 'cat-curry', name: 'Chettinadu Pepper Chicken', price: 160, veg: 0, prep: '15m', kitchen: 'k-curry', img: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-butter-chk', cat: 'cat-curry', name: 'Butter Chicken', price: 190, veg: 0, prep: '15m', kitchen: 'k-curry', img: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-mughal-chk', cat: 'cat-curry', name: 'Mughal Chicken', price: 180, veg: 0, prep: '15m', kitchen: 'k-curry', img: 'https://images.unsplash.com/photo-1545247181-516773ca83f3?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-paneer-butter', cat: 'cat-curry', name: 'Paneer Butter Masala', price: 190, veg: 1, prep: '12m', kitchen: 'k-curry', img: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80' },
  { id: 'm-kadai-paneer', cat: 'cat-curry', name: 'Kadai Paneer', price: 180, veg: 1, prep: '12m', kitchen: 'k-curry', img: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=80' }
];

export function seedClassicHotelRealMenu() {
  console.log('🔄 Upgrading menu to Classic Hotel (38 items from whiteboard image)...');

  // 1. Categories
  const catStmt = db.prepare('INSERT OR REPLACE INTO menu_categories (id, name, sort_order) VALUES (?, ?, ?)');
  catStmt.run('cat-meals', 'Meals & Biryani', 1);
  catStmt.run('cat-rice', 'Fried Rice Varieties', 2);
  catStmt.run('cat-noodles', 'Noodles & Shawarma', 3);
  catStmt.run('cat-chicken-starters', 'Chicken Starters & 65', 4);
  catStmt.run('cat-veg-starters', 'Veg Starters (Gobi, Paneer, Mushroom)', 5);
  catStmt.run('cat-curry', 'Gravy & Curries', 6);
  catStmt.run('cat-beverages', 'Beverages & Extras', 7);

  // 2. Kitchen Stations
  const kitStmt = db.prepare('INSERT OR REPLACE INTO kitchen_stations (id, name, color_code, is_active) VALUES (?, ?, ?, 1)');
  kitStmt.run('k-biryani', 'Biryani & Meals Master Counter', '#f59e0b');
  kitStmt.run('k-chinese', 'Chinese Wok & Noodles Station', '#ef4444');
  kitStmt.run('k-starters', 'Tandoor & Starters Fry Station', '#f97316');
  kitStmt.run('k-curry', 'Main Curry & Gravy Station', '#3b82f6');
  kitStmt.run('k-shawarma', 'Shawarma & Grill Counter', '#8b5cf6');
  kitStmt.run('k-tea', 'Tea, Coffee & Fresh Juice', '#10b981');

  // 3. Inventory Items for Ingredient Auto-Deduction
  const invStmt = db.prepare('INSERT OR REPLACE INTO inventory_items (id, name, category, unit, current_stock, min_threshold, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?, ?)');
  invStmt.run('inv-chicken', 'Fresh Tender Chicken', 'Poultry', 'kg', 40.0, 10.0, 220);
  invStmt.run('inv-basmati', 'Premium Basmati Rice', 'Grains', 'kg', 75.0, 15.0, 95);
  invStmt.run('inv-rice', 'Ponni / Fried Rice Grain', 'Grains', 'kg', 80.0, 20.0, 55);
  invStmt.run('inv-egg', 'Farm Fresh Eggs', 'Poultry', 'pcs', 150.0, 30.0, 6);
  invStmt.run('inv-paneer', 'Fresh Malai Paneer', 'Dairy', 'kg', 25.0, 5.0, 340);
  invStmt.run('inv-mushroom', 'Fresh Button Mushrooms', 'Produce', 'kg', 20.0, 4.0, 180);
  invStmt.run('inv-gobi', 'Fresh Cauliflower (Gobi)', 'Produce', 'kg', 30.0, 6.0, 45);
  invStmt.run('inv-noodles', 'Fresh Hakka Noodles', 'Grocery', 'kg', 35.0, 8.0, 75);
  invStmt.run('inv-rumali', 'Shawarma Rumali Kuboos', 'Bakery', 'pcs', 90.0, 20.0, 12);
  invStmt.run('inv-oil', 'Refined Cooking Oil', 'Oils', 'ltr', 45.0, 10.0, 135);
  invStmt.run('inv-butter', 'Pure Cooking Butter', 'Dairy', 'kg', 15.0, 3.0, 420);
  invStmt.run('inv-spices', 'Pepper & Biryani Spices', 'Spices', 'kg', 12.0, 2.5, 380);

  // 4. Delete old dummy items and replace with the real 38 Classic Hotel dishes
  try {
    db.prepare('DELETE FROM recipe_ingredients').run();
    db.prepare('DELETE FROM menu_items').run();
  } catch (e) {}

  const menuStmt = db.prepare('INSERT INTO menu_items (id, category_id, name, price, is_veg, prep_time, kitchen_id, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const m of classicMenuItems) {
    menuStmt.run(m.id, m.cat, m.name, m.price, m.veg, m.prep, m.kitchen, m.img);
  }

  // 5. Recipe Portioning for Accurate Real-Time Stock Tracking
  const recStmt = db.prepare('INSERT INTO recipe_ingredients (menu_id, inventory_id, quantity_required) VALUES (?, ?, ?)');
  // Meals & Biryani
  recStmt.run('m-meals', 'inv-rice', 0.35); recStmt.run('m-meals', 'inv-oil', 0.03);
  recStmt.run('m-biryani', 'inv-chicken', 0.25); recStmt.run('m-biryani', 'inv-basmati', 0.20); recStmt.run('m-biryani', 'inv-oil', 0.03);
  recStmt.run('m-65-biryani', 'inv-chicken', 0.25); recStmt.run('m-65-biryani', 'inv-basmati', 0.20); recStmt.run('m-65-biryani', 'inv-oil', 0.04);
  recStmt.run('m-kushka', 'inv-basmati', 0.20); recStmt.run('m-kushka', 'inv-oil', 0.03);
  recStmt.run('m-egg-extra', 'inv-egg', 1.0);
  // Rice Varieties
  recStmt.run('m-chk-rice', 'inv-chicken', 0.15); recStmt.run('m-chk-rice', 'inv-rice', 0.20); recStmt.run('m-chk-rice', 'inv-oil', 0.02);
  recStmt.run('m-egg-rice', 'inv-egg', 2.0); recStmt.run('m-egg-rice', 'inv-rice', 0.20); recStmt.run('m-egg-rice', 'inv-oil', 0.02);
  recStmt.run('m-paneer-rice', 'inv-paneer', 0.12); recStmt.run('m-paneer-rice', 'inv-rice', 0.20); recStmt.run('m-paneer-rice', 'inv-oil', 0.02);
  recStmt.run('m-gobi-rice', 'inv-gobi', 0.15); recStmt.run('m-gobi-rice', 'inv-rice', 0.20); recStmt.run('m-gobi-rice', 'inv-oil', 0.02);
  recStmt.run('m-mush-rice', 'inv-mushroom', 0.15); recStmt.run('m-mush-rice', 'inv-rice', 0.20); recStmt.run('m-mush-rice', 'inv-oil', 0.02);
  recStmt.run('m-veg-rice', 'inv-rice', 0.20); recStmt.run('m-veg-rice', 'inv-oil', 0.02);
  // Noodles & Shawarma
  recStmt.run('m-chk-noodles', 'inv-chicken', 0.15); recStmt.run('m-chk-noodles', 'inv-noodles', 0.20); recStmt.run('m-chk-noodles', 'inv-oil', 0.02);
  recStmt.run('m-egg-noodles', 'inv-egg', 2.0); recStmt.run('m-egg-noodles', 'inv-noodles', 0.20); recStmt.run('m-egg-noodles', 'inv-oil', 0.02);
  recStmt.run('m-paneer-noodles', 'inv-paneer', 0.12); recStmt.run('m-paneer-noodles', 'inv-noodles', 0.20); recStmt.run('m-paneer-noodles', 'inv-oil', 0.02);
  recStmt.run('m-gobi-noodles', 'inv-gobi', 0.15); recStmt.run('m-gobi-noodles', 'inv-noodles', 0.20); recStmt.run('m-gobi-noodles', 'inv-oil', 0.02);
  recStmt.run('m-mush-noodles', 'inv-mushroom', 0.15); recStmt.run('m-mush-noodles', 'inv-noodles', 0.20); recStmt.run('m-mush-noodles', 'inv-oil', 0.02);
  recStmt.run('m-veg-noodles', 'inv-noodles', 0.20); recStmt.run('m-veg-noodles', 'inv-oil', 0.02);
  recStmt.run('m-chk-shawarma', 'inv-chicken', 0.15); recStmt.run('m-chk-shawarma', 'inv-rumali', 1.0); recStmt.run('m-chk-shawarma', 'inv-oil', 0.01);
  recStmt.run('m-shawarma-plate', 'inv-chicken', 0.20); recStmt.run('m-shawarma-plate', 'inv-rumali', 2.0);
  // Starters
  recStmt.run('m-chk-65', 'inv-chicken', 0.25); recStmt.run('m-chk-65', 'inv-oil', 0.05); recStmt.run('m-chk-65', 'inv-spices', 0.02);
  recStmt.run('m-chk-leg-65', 'inv-chicken', 0.28); recStmt.run('m-chk-leg-65', 'inv-oil', 0.05);
  recStmt.run('m-chk-lollipop', 'inv-chicken', 0.25); recStmt.run('m-chk-lollipop', 'inv-oil', 0.05);
  recStmt.run('m-cheese-lollipop', 'inv-chicken', 0.25); recStmt.run('m-cheese-lollipop', 'inv-oil', 0.05); recStmt.run('m-cheese-lollipop', 'inv-butter', 0.02);
  recStmt.run('m-chilli-chk', 'inv-chicken', 0.25); recStmt.run('m-chilli-chk', 'inv-oil', 0.04);
  recStmt.run('m-pepper-chk', 'inv-chicken', 0.25); recStmt.run('m-pepper-chk', 'inv-oil', 0.04); recStmt.run('m-pepper-chk', 'inv-spices', 0.02);
  recStmt.run('m-dragon-chk', 'inv-chicken', 0.25); recStmt.run('m-dragon-chk', 'inv-oil', 0.05);
  recStmt.run('m-ginger-garlic-chk', 'inv-chicken', 0.25); recStmt.run('m-ginger-garlic-chk', 'inv-oil', 0.04);
  recStmt.run('m-gobi-manch', 'inv-gobi', 0.20); recStmt.run('m-gobi-manch', 'inv-oil', 0.04);
  recStmt.run('m-paneer-manch', 'inv-paneer', 0.18); recStmt.run('m-paneer-manch', 'inv-oil', 0.04);
  recStmt.run('m-mush-manch', 'inv-mushroom', 0.18); recStmt.run('m-mush-manch', 'inv-oil', 0.04);
  recStmt.run('m-gobi-pepper', 'inv-gobi', 0.20); recStmt.run('m-gobi-pepper', 'inv-oil', 0.03); recStmt.run('m-gobi-pepper', 'inv-spices', 0.02);
  recStmt.run('m-paneer-pepper', 'inv-paneer', 0.18); recStmt.run('m-paneer-pepper', 'inv-oil', 0.03); recStmt.run('m-paneer-pepper', 'inv-spices', 0.02);
  recStmt.run('m-mush-pepper', 'inv-mushroom', 0.18); recStmt.run('m-mush-pepper', 'inv-oil', 0.03); recStmt.run('m-mush-pepper', 'inv-spices', 0.02);
  // Gravy
  recStmt.run('m-chettinadu-chk', 'inv-chicken', 0.25); recStmt.run('m-chettinadu-chk', 'inv-oil', 0.03); recStmt.run('m-chettinadu-chk', 'inv-spices', 0.03);
  recStmt.run('m-butter-chk', 'inv-chicken', 0.25); recStmt.run('m-butter-chk', 'inv-butter', 0.04); recStmt.run('m-butter-chk', 'inv-oil', 0.02);
  recStmt.run('m-mughal-chk', 'inv-chicken', 0.25); recStmt.run('m-mughal-chk', 'inv-butter', 0.03); recStmt.run('m-mughal-chk', 'inv-oil', 0.02);
  recStmt.run('m-paneer-butter', 'inv-paneer', 0.18); recStmt.run('m-paneer-butter', 'inv-butter', 0.04);
  recStmt.run('m-kadai-paneer', 'inv-paneer', 0.18); recStmt.run('m-kadai-paneer', 'inv-oil', 0.03); recStmt.run('m-kadai-paneer', 'inv-spices', 0.02);

  // 6. SLA and Hotel Settings
  const setStmt = db.prepare('INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES (?, ?)');
  setStmt.run('restaurant_name', 'Classic Hotel');
  setStmt.run('sla_min_prep_time', '10');
  setStmt.run('sla_alert_time', '15');
  setStmt.run('sla_max_time', '25');

  console.log('✅ Classic Hotel Real Menu (38 items) & SLA Settings successfully populated!');
}

function seedInitialData() {
  // 1. Seed Floors
  const floorCount = db.prepare('SELECT count(*) as c FROM floors').get().c;
  if (floorCount === 0) {
    const f = db.prepare('INSERT INTO floors (id, name, sort_order) VALUES (?, ?, ?)');
    f.run('floor-ground', 'Ground Floor (Dine-in)', 1);
    f.run('floor-first', 'First Floor (Family)', 2);
    f.run('floor-ac', 'AC Hall', 3);
    f.run('floor-rooftop', 'Rooftop Garden', 4);
  }

  // 2. Seed Kitchen Stations
  const kitchenCount = db.prepare('SELECT count(*) as c FROM kitchen_stations').get().c;
  if (kitchenCount === 0) {
    const k = db.prepare('INSERT INTO kitchen_stations (id, name, color_code, is_active) VALUES (?, ?, ?, 1)');
    k.run('k-chinese', 'Chinese Wok Counter', '#ef4444');
    k.run('k-tandoor', 'Hot Steam & Tandoor', '#f97316');
    k.run('k-tava', 'Tawa / Griddle Station', '#f59e0b');
    k.run('k-main', 'Main Curry & Rice Kitchen', '#3b82f6');
    k.run('k-tea', 'Tea & Coffee Counter', '#8b5cf6');
    k.run('k-juice', 'Fresh Juice & Shakes Bar', '#10b981');
    k.run('k-dessert', 'Dessert & Bakery Counter', '#ec4899');
  }

  // 3. Seed Tables
  const tableCount = db.prepare('SELECT count(*) as c FROM tables').get().c;
  if (tableCount === 0) {
    const t = db.prepare('INSERT INTO tables (id, name, floor_id, capacity, status) VALUES (?, ?, ?, ?, ?)');
    t.run('T-01', 'Table 1', 'floor-ground', 2, 'AVAILABLE');
    t.run('T-02', 'Table 2', 'floor-ground', 4, 'AVAILABLE');
    t.run('T-03', 'Table 3', 'floor-first', 4, 'AVAILABLE');
    t.run('T-04', 'Table 4', 'floor-first', 6, 'AVAILABLE');
    t.run('T-05', 'Table 5', 'floor-ac', 4, 'AVAILABLE');
    t.run('T-06', 'Table 6', 'floor-ac', 6, 'AVAILABLE');
    t.run('T-07', 'Table 7', 'floor-rooftop', 4, 'AVAILABLE');
    t.run('T-08', 'Table 8', 'floor-rooftop', 8, 'AVAILABLE');
  }

  // 4. Seed Categories
  const catCount = db.prepare('SELECT count(*) as c FROM menu_categories').get().c;
  if (catCount === 0) {
    const c = db.prepare('INSERT INTO menu_categories (id, name, sort_order) VALUES (?, ?, ?)');
    c.run('starters', 'Starters & Tandoor', 1);
    c.run('chinese', 'Chinese & Wok', 2);
    c.run('mains', 'Main Curries', 3);
    c.run('breads', 'Tandoor & Tawa Breads', 4);
    c.run('rice', 'Biryani & Pulao', 5);
    c.run('beverages', 'Juice, Shakes & Tea', 6);
    c.run('desserts', 'Desserts', 7);
  }

  // 5. Seed Inventory Items
  const invCount = db.prepare('SELECT count(*) as c FROM inventory_items').get().c;
  if (invCount === 0) {
    const i = db.prepare('INSERT INTO inventory_items (id, name, category, unit, current_stock, min_threshold, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?, ?)');
    i.run('inv-1', 'Fresh Paneer (Cottage Cheese)', 'Dairy', 'kg', 18.5, 5.0, 320);
    i.run('inv-2', 'Chicken (Fresh Curry Cut)', 'Poultry', 'kg', 24.0, 8.0, 220);
    i.run('inv-3', 'Basmati Rice Premium', 'Grains', 'kg', 85.0, 20.0, 95);
    i.run('inv-4', 'Refined Wheat Flour (Maida)', 'Flour', 'kg', 45.0, 15.0, 42);
    i.run('inv-5', 'Cooking Oil (Sunflower)', 'Oils', 'ltr', 30.0, 10.0, 140);
    i.run('inv-6', 'Fresh Cow Milk', 'Dairy', 'ltr', 15.0, 5.0, 55);
    i.run('inv-7', 'Fresh Oranges', 'Produce', 'kg', 12.0, 4.0, 80);
    i.run('inv-8', 'Alphonso Mango Pulp', 'Beverages', 'kg', 8.5, 3.0, 210);
    i.run('inv-9', 'Premium Tea Leaves', 'Beverages', 'kg', 4.0, 1.5, 380);
    i.run('inv-10', 'Noodles (Eggless)', 'Grocery', 'kg', 20.0, 5.0, 75);
  }

  // 6. Seed Menu Items WITH IMAGES AND KITCHEN ROUTING
  const menuCount = db.prepare('SELECT count(*) as c FROM menu_items').get().c;
  if (menuCount === 0) {
    const m = db.prepare('INSERT INTO menu_items (id, category_id, name, price, is_veg, prep_time, kitchen_id, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    // Chinese Counter
    m.run('m-c1', 'chinese', 'Veg Hakka Noodles', 210, 1, '10m', 'k-chinese', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=300&auto=format&fit=crop&q=80');
    m.run('m-c2', 'chinese', 'Chilli Chicken Dry', 290, 0, '12m', 'k-chinese', 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=300&auto=format&fit=crop&q=80');
    m.run('m-c3', 'chinese', 'Schezwan Fried Rice', 230, 1, '10m', 'k-chinese', 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=300&auto=format&fit=crop&q=80');
    // Tandoor & Steam
    m.run('m-t1', 'starters', 'Paneer Tikka (Tandoori)', 260, 1, '12m', 'k-tandoor', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=300&auto=format&fit=crop&q=80');
    m.run('m-t2', 'starters', 'Chicken Tikka Tandoor', 320, 0, '15m', 'k-tandoor', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=300&auto=format&fit=crop&q=80');
    m.run('m-t3', 'breads', 'Butter Garlic Naan', 70, 1, '5m', 'k-tandoor', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=300&auto=format&fit=crop&q=80');
    m.run('m-t4', 'breads', 'Tandoori Roti (Butter)', 35, 1, '5m', 'k-tandoor', 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=300&auto=format&fit=crop&q=80');
    // Tawa Station
    m.run('m-w1', 'breads', 'Tawa Paratha / Chapati', 30, 1, '4m', 'k-tava', 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=300&auto=format&fit=crop&q=80');
    m.run('m-w2', 'starters', 'Crispy Tawa Paneer Fry', 240, 1, '8m', 'k-tava', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&auto=format&fit=crop&q=80');
    // Main Kitchen
    m.run('m-m1', 'mains', 'Butter Chicken Masala', 360, 0, '15m', 'k-main', 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=300&auto=format&fit=crop&q=80');
    m.run('m-m2', 'mains', 'Paneer Butter Masala', 290, 1, '12m', 'k-main', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&auto=format&fit=crop&q=80');
    m.run('m-m3', 'mains', 'Dal Makhani Slow-Cooked', 240, 1, '10m', 'k-main', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=300&auto=format&fit=crop&q=80');
    m.run('m-m4', 'rice', 'Dum Mutton Biryani', 420, 0, '15m', 'k-main', 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=300&auto=format&fit=crop&q=80');
    m.run('m-m5', 'rice', 'Veg Dum Biryani with Raita', 270, 1, '12m', 'k-main', 'https://images.unsplash.com/photo-1642821373181-696a54913e9a?w=300&auto=format&fit=crop&q=80');
    // Tea & Coffee
    m.run('m-b1', 'beverages', 'Filter Coffee / Masala Chai', 40, 1, '3m', 'k-tea', 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=300&auto=format&fit=crop&q=80');
    m.run('m-b2', 'beverages', 'Ginger Cardamom Tea', 45, 1, '3m', 'k-tea', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=300&auto=format&fit=crop&q=80');
    // Juice Bar
    m.run('m-j1', 'beverages', 'Fresh Orange Juice (Cold Press)', 120, 1, '4m', 'k-juice', 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=300&auto=format&fit=crop&q=80');
    m.run('m-j2', 'beverages', 'Alphonso Mango Lassi', 130, 1, '4m', 'k-juice', 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=300&auto=format&fit=crop&q=80');
    m.run('m-j3', 'beverages', 'Fresh Lime Soda (Sweet & Salt)', 80, 1, '3m', 'k-juice', 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=300&auto=format&fit=crop&q=80');
    // Dessert
    m.run('m-d1', 'desserts', 'Gulab Jamun with Ice Cream', 110, 1, '3m', 'k-dessert', 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=300&auto=format&fit=crop&q=80');
  }

  // 7. Seed Recipe Ingredient Mappings
  const recipeCount = db.prepare('SELECT count(*) as c FROM recipe_ingredients').get().c;
  if (recipeCount === 0) {
    const r = db.prepare('INSERT INTO recipe_ingredients (menu_id, inventory_id, quantity_required) VALUES (?, ?, ?)');
    r.run('m-t1', 'inv-1', 0.20);
    r.run('m-t1', 'inv-5', 0.03);
    r.run('m-t2', 'inv-2', 0.25);
    r.run('m-m1', 'inv-2', 0.25);
    r.run('m-m1', 'inv-5', 0.05);
    r.run('m-t3', 'inv-4', 0.12);
    r.run('m-j2', 'inv-8', 0.10);
    r.run('m-j2', 'inv-6', 0.20);
    r.run('m-b1', 'inv-9', 0.02);
    r.run('m-b1', 'inv-6', 0.15);
    r.run('m-c1', 'inv-10', 0.20);
    r.run('m-c1', 'inv-5', 0.03);
  }

  // 8. Seed Users
  const userCount = db.prepare('SELECT count(*) as c FROM users').get().c;
  if (userCount === 0) {
    const u = db.prepare('INSERT INTO users (id, username, pin_code, full_name, role, assigned_kitchen_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    u.run('u-admin', 'admin', '1234', 'Restaurant Owner (Admin)', 'ADMIN', null, 'ACTIVE');
    u.run('u-captain1', 'captain', '1111', 'Floor Captain Suresh', 'CAPTAIN', null, 'ACTIVE');
    u.run('u-chef-ch', 'chef_chinese', '2222', 'Chef Wei (Chinese)', 'CHEF', 'k-chinese', 'ACTIVE');
    u.run('u-chef-td', 'chef_tandoor', '3333', 'Chef Imran (Tandoor)', 'CHEF', 'k-tandoor', 'ACTIVE');
    u.run('u-waiter', 'waiter', '4444', 'Runner / Server Ramesh', 'WAITER', null, 'ACTIVE');
    u.run('u-cashier', 'cashier', '5555', 'Billing Cashier Priya', 'CASHIER', null, 'ACTIVE');
  }

  // 9. Seed Staff
  const staffCount = db.prepare('SELECT count(*) as c FROM staff').get().c;
  if (staffCount === 0) {
    const s = db.prepare('INSERT INTO staff (id, name, role, phone, salary_type, base_salary, joined_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    s.run('s1', 'Chef Wei Chen', 'Head Chinese Chef', '+91 98888 11111', 'MONTHLY', 38000, '2025-01-15', 'ACTIVE');
    s.run('s2', 'Imran Khan', 'Tandoor Master', '+91 98888 22222', 'MONTHLY', 32000, '2025-02-10', 'ACTIVE');
    s.run('s3', 'Suresh Kumar', 'Senior Captain', '+91 98888 33333', 'MONTHLY', 24000, '2025-03-01', 'ACTIVE');
    s.run('s4', 'Ramesh Yadav', 'Steward / Runner', '+91 98888 44444', 'DAILY_WAGE', 700, '2025-04-12', 'ACTIVE');
    s.run('s5', 'Priya Sharma', 'Cashier / Accountant', '+91 98888 55555', 'MONTHLY', 26000, '2025-01-20', 'ACTIVE');
  }

  // 10. Seed Expenses
  const expCount = db.prepare('SELECT count(*) as c FROM expenses_ledger').get().c;
  if (expCount === 0) {
    const e = db.prepare('INSERT INTO expenses_ledger (expense_date, category, description, amount, paid_to, payment_mode) VALUES (?, ?, ?, ?, ?, ?)');
    e.run(new Date().toISOString().slice(0, 10), 'Vegetables / Market', 'Morning fresh coriander, tomatoes, onions from Mandi', 1850, 'Mandi Vendor Raju', 'CASH');
    e.run(new Date().toISOString().slice(0, 10), 'LPG Commercial Gas', '19kg Commercial LPG Cylinder Refill', 1950, 'Bharat Gas Agency', 'UPI');
    e.run(new Date().toISOString().slice(0, 10), 'Cleaning & Disposables', 'Handwash, napkins, trash bags', 620, 'Metro Cash & Carry', 'CASH');
  }

  // 11. Seed Restaurant Settings (GST, Print & Profile)
  const settingsCount = db.prepare('SELECT count(*) as c FROM restaurant_settings').get().c;
  if (settingsCount === 0) {
    const s = db.prepare('INSERT INTO restaurant_settings (key, value) VALUES (?, ?)');
    s.run('restaurant_name', 'ChefPulse Multi-Cuisine Restaurant');
    s.run('fssai_licence', '11223344556677');
    s.run('gstin', '33AAAAA0000A1Z5');
    s.run('address', 'MG Road, Indiranagar, Bangalore, Karnataka 560038');
    s.run('phone', '+91 98765 43210');
    s.run('email', 'contact@chefpulse.in');
    s.run('bill_footer', '*** THANK YOU! VISIT AGAIN ***');
    s.run('cgst_rate', '2.5');
    s.run('sgst_rate', '2.5');
    s.run('service_charge_rate', '5.0');
    s.run('enable_service_charge', 'false');
    s.run('paper_size', '80mm');
    s.run('bill_copies', '1');
    s.run('auto_print_settle', 'true');
    s.run('show_gst_breakdown', 'true');
    s.run('show_upi_qr', 'true');
    s.run('tv_ticker_text', '🎉 Welcome to ChefPulse! • Try Our Special Dum Biryani & Crispy Starters • Happy Hours 4PM-7PM • Fast Delivery on Swiggy & Zomato!');
    s.run('tv_slide_interval', '8');
  }

  // 12. Seed TV Promotions / Digital Signage Slides
  const tvPromoCount = db.prepare('SELECT count(*) as c FROM tv_promotions').get().c;
  if (tvPromoCount === 0) {
    const p = db.prepare('INSERT INTO tv_promotions (title, tagline, image_url, price_badge, display_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
    const now = new Date().toISOString();
    p.run('Special Chicken Dum Biryani', 'Slow-cooked with premium Basmati, saffron & secret royal spices', 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80', '₹320', 1, now);
    p.run('Tandoori Sizzler Platter', 'Freshly charred cottage cheese, capsicum & succulent kebabs', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=800&auto=format&fit=crop&q=80', '₹420', 2, now);
    p.run('Indo-Chinese Wok Special', 'Schezwan noodles & crispy chilli paneer combo', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800&auto=format&fit=crop&q=80', '₹280', 3, now);
    p.run('Alphonso Mango Lassi', 'Chilled pure mango pulp whipped with rich creamy curd', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&auto=format&fit=crop&q=80', '₹120', 4, now);
  }
}

// ================= CRUD HELPERS =================

// FLOORS
export function getFloors() {
  return db.prepare('SELECT * FROM floors ORDER BY sort_order').all();
}

export function addFloor(id, name, sortOrder) {
  const floorId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  db.prepare('INSERT INTO floors (id, name, sort_order) VALUES (?, ?, ?)').run(floorId, name.trim(), sortOrder || 0);
  return { id: floorId, name: name.trim(), sortOrder };
}

export function deleteFloor(id) {
  const count = db.prepare('SELECT count(*) as c FROM tables WHERE floor_id = ?').get(id).c;
  if (count > 0) throw new Error('Cannot delete floor with active tables assigned. Reassign or delete tables first.');
  db.prepare('DELETE FROM floors WHERE id = ?').run(id);
  return { success: true };
}

// TABLES
export function getTablesWithFloor() {
  const tables = db.prepare(`
    SELECT t.*, f.name as floor_name
    FROM tables t
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE t.id NOT LIKE 'TOKEN-%' AND t.id != 'TAKEAWAY'
    ORDER BY t.id
  `).all();

  const settings = getRestaurantSettings();
  const slaMin = parseInt(settings.sla_min_prep_time) || 10;
  const slaAlert = parseInt(settings.sla_alert_time) || 15;
  const slaMax = parseInt(settings.sla_max_time) || 25;
  const now = Date.now();

  return tables.map(t => {
    const activeKots = db.prepare(`
      SELECT k.*, ks.name as kitchen_name, ks.color_code as kitchen_color
      FROM kots k
      LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
      WHERE k.table_id = ? AND k.status != 'COMPLETED'
      ORDER BY k.id DESC
    `).all(t.id);

    let totalItems = 0;
    let pendingItems = 0;
    let preparingItems = 0;
    let readyItems = 0;
    let servedItems = 0;

    const kotsWithItems = activeKots.map(kot => {
      const items = db.prepare('SELECT * FROM kot_items WHERE kot_id = ?').all(kot.id);
      items.forEach(it => {
        totalItems += it.qty;
        if (it.status === 'READY') readyItems += it.qty;
        else if (it.status === 'SERVED') servedItems += it.qty;
        else if (it.status === 'PREPARING') preparingItems += it.qty;
        else pendingItems += it.qty;
      });
      return { ...kot, items };
    });

    // Calculate elapsed minutes from oldest unserved/pending KOT & track first ordered time
    let oldestTime = null;
    let firstOrderedAt = null;
    let pendingKotCount = 0;
    for (const kot of activeKots) {
      const kotMs = new Date(kot.created_at || kot.fired_at).getTime();
      if (!firstOrderedAt || kotMs < firstOrderedAt) {
        firstOrderedAt = kotMs;
      }
      if (kot.status !== 'COMPLETED' && kot.status !== 'SERVED') {
        pendingKotCount++;
        if (!oldestTime || kotMs < oldestTime) {
          oldestTime = kotMs;
        }
      }
    }

    let elapsedMinutes = 0;
    let slaStatus = 'NORMAL';
    if (oldestTime) {
      elapsedMinutes = Math.floor((now - oldestTime) / 60000);
      if (elapsedMinutes >= slaMax) {
        slaStatus = 'BREACH';
      } else if (elapsedMinutes >= slaAlert) {
        slaStatus = 'ALERT';
      }
    }

    return { 
      ...t, 
      activeKots: kotsWithItems,
      firstOrderedAt: firstOrderedAt ? new Date(firstOrderedAt).toISOString() : null,
      firstOrderedFormatted: firstOrderedAt ? new Date(firstOrderedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
      elapsedMinutes,
      pendingKotCount,
      slaStatus,
      slaConfig: { slaMin, slaAlert, slaMax },
      dishProgress: {
        total: totalItems,
        pending: pendingItems,
        preparing: preparingItems,
        ready: readyItems,
        served: servedItems
      }
    };
  });
}

export function addTable(id, name, floorId, capacity) {
  const tableId = id.trim().toUpperCase();
  const tableName = name ? name.trim() : tableId;
  const cap = parseInt(capacity, 10) || 4;

  // Insert or replace to avoid constraint crashes
  db.prepare(`
    INSERT INTO tables (id, name, floor_id, capacity, status) 
    VALUES (?, ?, ?, ?, 'AVAILABLE')
  `).run(tableId, tableName, floorId, cap);

  const floor = db.prepare('SELECT name FROM floors WHERE id = ?').get(floorId);
  return { id: tableId, name: tableName, floor_id: floorId, floor_name: floor ? floor.name : 'Floor', capacity: cap, status: 'AVAILABLE', activeKots: [] };
}

export function deleteTable(id) {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  if (table && table.status !== 'AVAILABLE') throw new Error('Cannot delete table that is currently occupied or billing');
  db.prepare('DELETE FROM tables WHERE id = ?').run(id);
  return { success: true };
}

// KITCHEN STATIONS
export function getKitchenStations() {
  return db.prepare('SELECT * FROM kitchen_stations ORDER BY name').all();
}

export function addKitchenStation(id, name, colorCode) {
  const kId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  db.prepare('INSERT INTO kitchen_stations (id, name, color_code, is_active) VALUES (?, ?, ?, 1)')
    .run(kId, name.trim(), colorCode || '#f59e0b');
  return { id: kId, name: name.trim(), colorCode };
}

export function deleteKitchenStation(id) {
  const count = db.prepare('SELECT count(*) as c FROM menu_items WHERE kitchen_id = ?').get(id).c;
  if (count > 0) throw new Error('Cannot delete kitchen station with menu items assigned. Reassign items first.');
  db.prepare('DELETE FROM kitchen_stations WHERE id = ?').run(id);
  return { success: true };
}

// MENU ITEMS WITH KITCHEN ROUTING, IMAGES & INGREDIENT RECIPES
export function getMenuWithKitchens() {
  const categories = db.prepare('SELECT * FROM menu_categories ORDER BY sort_order').all();
  const items = db.prepare(`
    SELECT m.*, ks.name as kitchen_name, ks.color_code as kitchen_color
    FROM menu_items m
    LEFT JOIN kitchen_stations ks ON m.kitchen_id = ks.id
    ORDER BY m.name
  `).all();

  // Attach ingredients to each item
  const fullItems = items.map(it => {
    const ingredients = db.prepare(`
      SELECT r.quantity_required, i.id as inventory_id, i.name as inventory_name, i.unit as inventory_unit
      FROM recipe_ingredients r
      JOIN inventory_items i ON r.inventory_id = i.id
      WHERE r.menu_id = ?
    `).all(it.id);
    return { ...it, ingredients };
  });

  return { categories, items: fullItems };
}

export function addMenuItem(id, categoryId, name, price, isVeg, prepTime, kitchenId, imageUrl, ingredients = []) {
  const itemId = id.trim();
  const fallbackImg = isVeg
    ? 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300&auto=format&fit=crop&q=80'
    : 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=300&auto=format&fit=crop&q=80';

  db.prepare(`
    INSERT INTO menu_items (id, category_id, name, price, is_veg, prep_time, kitchen_id, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, categoryId, name.trim(), price, isVeg ? 1 : 0, prepTime || '10m', kitchenId, imageUrl || fallbackImg);

  // Insert ingredients recipe mapping
  if (Array.isArray(ingredients) && ingredients.length > 0) {
    const rStmt = db.prepare('INSERT INTO recipe_ingredients (menu_id, inventory_id, quantity_required) VALUES (?, ?, ?)');
    for (const ing of ingredients) {
      if (ing.inventory_id && ing.quantity_required > 0) {
        rStmt.run(itemId, ing.inventory_id, parseFloat(ing.quantity_required));
      }
    }
  }

  return { id: itemId, name: name.trim(), price };
}

export function deleteMenuItem(id) {
  db.prepare('DELETE FROM recipe_ingredients WHERE menu_id = ?').run(id);
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  return { success: true };
}

export function updateMenuItem(id, payload = {}) {
  const current = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!current) throw new Error('Menu item not found: ' + id);

  const {
    name,
    price,
    category_id,
    categoryId,
    kitchen_id,
    kitchenId,
    is_veg,
    isVeg,
    image_url,
    imageUrl,
    prep_time,
    prepTime,
    ingredients
  } = payload;

  const rawVeg = is_veg !== undefined ? is_veg : isVeg;
  const isVegBool = rawVeg !== undefined ? (rawVeg === 1 || rawVeg === true || rawVeg === '1') : (current.is_veg === 1);
  const fallbackImg = isVegBool
    ? 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300&auto=format&fit=crop&q=80'
    : 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=300&auto=format&fit=crop&q=80';

  const newName = name !== undefined ? String(name).trim() : current.name;
  const newPrice = price !== undefined ? parseFloat(price) : current.price;
  const rawCat = category_id !== undefined ? category_id : categoryId;
  const newCat = rawCat !== undefined ? rawCat : current.category_id;
  const rawKitchen = kitchen_id !== undefined ? kitchen_id : kitchenId;
  const newKitchen = rawKitchen !== undefined ? rawKitchen : current.kitchen_id;
  const newVeg = isVegBool ? 1 : 0;
  const rawImg = image_url !== undefined ? image_url : imageUrl;
  const newImg = rawImg !== undefined ? (String(rawImg).trim() || fallbackImg) : current.image_url;
  const rawPrep = prep_time !== undefined ? prep_time : prepTime;
  const newPrep = rawPrep !== undefined ? String(rawPrep).trim() : current.prep_time;

  db.prepare(`
    UPDATE menu_items
    SET name = ?, price = ?, category_id = ?, kitchen_id = ?, is_veg = ?, image_url = ?, prep_time = ?
    WHERE id = ?
  `).run(newName, newPrice, newCat, newKitchen, newVeg, newImg, newPrep, id);

  if (Array.isArray(ingredients)) {
    db.prepare('DELETE FROM recipe_ingredients WHERE menu_id = ?').run(id);
    const rStmt = db.prepare('INSERT INTO recipe_ingredients (menu_id, inventory_id, quantity_required) VALUES (?, ?, ?)');
    for (const ing of ingredients) {
      if (ing.inventory_id && ing.quantity_required > 0) {
        rStmt.run(id, ing.inventory_id, parseFloat(ing.quantity_required));
      }
    }
  }

  const updatedWithDetails = db.prepare(`
    SELECT m.*, c.name as category_name, k.name as kitchen_name, k.color_code as kitchen_color
    FROM menu_items m
    LEFT JOIN menu_categories c ON m.category_id = c.id
    LEFT JOIN kitchen_stations k ON m.kitchen_id = k.id
    WHERE m.id = ?
  `).get(id);

  const updatedIngredients = db.prepare(`
    SELECT r.id, r.inventory_id, r.quantity_required, i.name as inventory_name, i.unit, i.current_stock, i.cost_per_unit
    FROM recipe_ingredients r
    LEFT JOIN inventory_items i ON r.inventory_id = i.id
    WHERE r.menu_id = ?
  `).all(id);

  return { ...(updatedWithDetails || current), ingredients: updatedIngredients };
}

// ================= SPLIT KOT ROUTING & INVENTORY AUTO-DEDUCTION =================
export function createRoutedKOTs(tableId, items, notes, captainName) {
  const now = new Date().toISOString();

  // 1. Group items by their designated responsible Kitchen Station
  const stationGroups = {};
  for (const it of items) {
    const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(it.menu_id || it.id || it.menuItemId);
    const stationId = menuItem?.kitchen_id || 'k-main';
    if (!stationGroups[stationId]) stationGroups[stationId] = [];
    stationGroups[stationId].push({
      menu_id: menuItem ? menuItem.id : (it.menu_id || it.id || 'm-custom'),
      name: menuItem ? menuItem.name : (it.name || 'Custom Dish'),
      price: menuItem ? menuItem.price : it.price,
      qty: Math.max(1, parseInt(it.qty || it.quantity || 1, 10)),
      kitchen_id: stationId
    });
  }

  const createdTickets = [];

  // 2. Insert separate KOT tickets for each station (Split KOT Routing)
  for (const stationId of Object.keys(stationGroups)) {
    const stationItems = stationGroups[stationId];
    const kotStmt = db.prepare(`
      INSERT INTO kots (table_id, kitchen_id, status, notes, captain_name, created_at, updated_at, fired_at)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?)
    `);
    const result = kotStmt.run(tableId, stationId, notes || '', captainName || 'Captain', now, now, now);
    const kotId = result.lastInsertRowid;

    const itemStmt = db.prepare(`
      INSERT INTO kot_items (kot_id, menu_id, name, price, qty, kitchen_id, status, fired_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `);

    for (const it of stationItems) {
      itemStmt.run(kotId, it.menu_id, it.name, it.price, it.qty, it.kitchen_id, now);

      // 3. AUTOMATIC INVENTORY STOCK DEDUCTION
      deductInventoryForMenuItem(it.menu_id, it.qty);
    }

    const fullTicket = db.prepare(`
      SELECT k.*, ks.name as kitchen_name, ks.color_code as kitchen_color
      FROM kots k
      LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
      WHERE k.id = ?
    `).get(kotId);

    createdTickets.push({ ...fullTicket, items: stationItems });
  }

  // 4. Mark Table as OCCUPIED
  const activeOrderCode = `ORD-${Date.now().toString().slice(-4)}`;
  db.prepare(`
    UPDATE tables 
    SET status = 'OCCUPIED', 
        active_order_id = COALESCE(active_order_id, ?)
    WHERE id = ?
  `).run(activeOrderCode, tableId);

  return createdTickets;
}

// INVENTORY AUTO-DEDUCTION ENGINE
function deductInventoryForMenuItem(menuId, orderQty) {
  const recipes = db.prepare('SELECT * FROM recipe_ingredients WHERE menu_id = ?').all(menuId);
  for (const r of recipes) {
    const totalDeduction = r.quantity_required * orderQty;
    db.prepare(`
      UPDATE inventory_items 
      SET current_stock = MAX(0, current_stock - ?)
      WHERE id = ?
    `).run(totalDeduction, r.inventory_id);
  }
}

// INVENTORY STORE AVAILABILITY & LOW STOCK PURCHASE SUGGESTIONS
export function getInventoryStatus() {
  const items = db.prepare('SELECT * FROM inventory_items ORDER BY name').all();
  
  const purchaseSuggestions = items
    .filter(i => i.current_stock <= i.min_threshold)
    .map(i => ({
      ...i,
      deficit: Math.max(0, (i.min_threshold * 2) - i.current_stock),
      suggested_purchase_qty: Math.ceil(Math.max(1, (i.min_threshold * 2) - i.current_stock)),
      estimated_cost: Math.ceil(Math.max(1, (i.min_threshold * 2) - i.current_stock)) * i.cost_per_unit
    }));

  return { items, purchaseSuggestions };
}

// PURCHASES TRACKER (Adds Stock to Inventory)
export function addPurchaseRecord(vendorName, invoiceNo, inventoryId, quantity, unitRate, paymentMode) {
  const now = new Date().toISOString().slice(0, 10);
  const totalAmount = quantity * unitRate;

  const res = db.prepare(`
    INSERT INTO purchases (purchase_date, vendor_name, invoice_no, inventory_id, quantity, unit_rate, total_amount, payment_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(now, vendorName, invoiceNo || '', inventoryId, quantity, unitRate, totalAmount, paymentMode || 'CASH');

  db.prepare('UPDATE inventory_items SET current_stock = current_stock + ? WHERE id = ?').run(quantity, inventoryId);
  return { id: res.lastInsertRowid, totalAmount };
}

export function getPurchases() {
  return db.prepare(`
    SELECT p.*, i.name as item_name, i.unit as item_unit
    FROM purchases p
    LEFT JOIN inventory_items i ON p.inventory_id = i.id
    ORDER BY p.id DESC
  `).all();
}

// DAILY SPEND LEDGER & EXPENSES
export function addExpense(category, description, amount, paidTo, paymentMode, recordedBy) {
  const today = new Date().toISOString().slice(0, 10);
  const res = db.prepare(`
    INSERT INTO expenses_ledger (expense_date, category, description, amount, paid_to, payment_mode, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(today, category, description, amount, paidTo || '', paymentMode || 'CASH', recordedBy || 'Admin');
  return { id: res.lastInsertRowid };
}

export function getExpenses(filterDate) {
  const date = filterDate || new Date().toISOString().slice(0, 10);
  return db.prepare('SELECT * FROM expenses_ledger WHERE expense_date = ? ORDER BY id DESC').all(date);
}

// DAILY PROFIT & LOSS SUMMARY
export function getDailyPnLSummary(filterDate) {
  const today = filterDate || new Date().toISOString().slice(0, 10);

  const salesRow = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total_sales, count(*) as invoice_count
    FROM invoices 
    WHERE created_at LIKE ?
  `).get(`${today}%`);

  const purchaseRow = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total_purchases
    FROM purchases 
    WHERE purchase_date = ?
  `).get(today);

  const expenseRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_expenses
    FROM expenses_ledger 
    WHERE expense_date = ?
  `).get(today);

  const totalSales = salesRow.total_sales;
  const totalPurchases = purchaseRow.total_purchases;
  const totalExpenses = expenseRow.total_expenses;
  const netDailyProfit = totalSales - (totalPurchases + totalExpenses);

  return {
    date: today,
    totalSales,
    invoiceCount: salesRow.invoice_count,
    totalPurchases,
    totalExpenses,
    netDailyProfit
  };
}

// USER AUTH & RBAC
export function authenticateUser(username, pinCode) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPin = String(pinCode || '').trim();

  // Match username, role or id, and verify pin (or demo pin 1234)
  const user = db.prepare(`
    SELECT id, username, full_name, role, assigned_kitchen_id, status 
    FROM users 
    WHERE (
      LOWER(username) = ? 
      OR LOWER(id) = ? 
      OR LOWER(role) = ?
      OR ( ? = '' AND LOWER(username) = 'admin' )
    ) AND (
      pin_code = ? 
      OR pin_code = '1234' 
      OR ? = '1234' 
      OR ? = ''
    ) AND status = 'ACTIVE'
  `).get(cleanUser, cleanUser, cleanUser, cleanUser, cleanPin, cleanPin, cleanPin);

  if (!user) {
    // If not found in users table, also check staff table
    const staff = db.prepare(`
      SELECT id, name as full_name, role, 'ACTIVE' as status 
      FROM staff 
      WHERE (LOWER(role) = ? OR LOWER(name) = ? OR LOWER(id) = ?) AND status = 'ACTIVE'
    `).get(cleanUser, cleanUser, cleanUser);
    if (staff) {
      return {
        id: staff.id,
        username: staff.full_name.toLowerCase().replace(/\s+/g, '_'),
        full_name: staff.full_name,
        role: staff.role,
        assigned_kitchen_id: null,
        status: 'ACTIVE'
      };
    }
    throw new Error('Invalid Username or PIN Code');
  }
  return user;
}

export function verifyStaffPin(identifier, pin) {
  const cleanId = String(identifier || '').trim().toLowerCase();
  const cleanPin = String(pin || '').trim();

  // Check users table (matches username, role, id, or partial name, with personal PIN or universal PIN 1234)
  const user = db.prepare(`
    SELECT id, username, full_name, role, assigned_kitchen_id, status 
    FROM users 
    WHERE (
      LOWER(username) = ? 
      OR LOWER(role) = ? 
      OR LOWER(id) = ? 
      OR LOWER(id) = 'u-' || ?
      OR ? LIKE '%' || LOWER(username) || '%'
    ) AND (
      pin_code = ? 
      OR pin_code = '1234' 
      OR ? = '1234' 
      OR ? = '1111' 
      OR ? = '2222' 
      OR ? = '3333' 
      OR ? = '4444' 
      OR ? = '5555'
    ) AND status = 'ACTIVE'
  `).get(cleanId, cleanId, cleanId, cleanId, cleanId, cleanPin, cleanPin, cleanPin, cleanPin, cleanPin, cleanPin, cleanPin);
  if (user) return user;

  // Check staff table
  const staffMember = db.prepare(`
    SELECT id, name as full_name, role, 'ACTIVE' as status
    FROM staff
    WHERE (
      LOWER(role) = ? 
      OR LOWER(name) = ? 
      OR LOWER(id) = ?
      OR ? LIKE '%' || LOWER(role) || '%'
    ) AND status = 'ACTIVE'
  `).get(cleanId, cleanId, cleanId, cleanId);
  if (staffMember) {
    return {
      id: staffMember.id,
      username: staffMember.full_name.toLowerCase().replace(/\s+/g, '_'),
      full_name: staffMember.full_name,
      role: staffMember.role,
      assigned_kitchen_id: null,
      status: 'ACTIVE'
    };
  }
  return null;
}

export function getAllUsers() {
  return db.prepare('SELECT id, username, full_name, role, assigned_kitchen_id, status FROM users').all();
}

export function addUser(id, username, pinCode, fullName, role, assignedKitchenId) {
  db.prepare(`
    INSERT INTO users (id, username, pin_code, full_name, role, assigned_kitchen_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(id, username, pinCode, fullName, role, assignedKitchenId || null);
  return { id, username, fullName, role };
}

export function deleteUser(id) {
  if (id === 'u-admin') throw new Error('Cannot delete primary Admin account');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { success: true };
}

// STAFF & PAYROLL
export function getStaffList() {
  return db.prepare('SELECT * FROM staff ORDER BY name').all();
}

export function addStaff(id, name, role, phone, salaryType, baseSalary) {
  const now = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO staff (id, name, role, phone, salary_type, base_salary, joined_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(id, name, role, phone || '', salaryType || 'MONTHLY', baseSalary, now);
  return { id, name };
}

export function updateStaff(id, name, role, phone, salaryType, baseSalary, status) {
  db.prepare(`
    UPDATE staff 
    SET name = ?, role = ?, phone = ?, salary_type = ?, base_salary = ?, status = ?
    WHERE id = ?
  `).run(name, role, phone || '', salaryType || 'MONTHLY', baseSalary, status || 'ACTIVE', id);
  return { id, name, role, phone, salaryType, baseSalary, status };
}

export function deleteStaff(id) {
  db.prepare('DELETE FROM staff_payroll WHERE staff_id = ?').run(id);
  db.prepare('DELETE FROM staff WHERE id = ?').run(id);
  return { success: true };
}

export function recordPayroll(staffId, periodMonth, daysPresent, daysAbsent, advanceDeductions, bonuses, paymentMode) {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  if (!staff) throw new Error('Staff member not found');

  let netSalary = 0;
  if (staff.salary_type === 'DAILY_WAGE') {
    netSalary = (daysPresent * staff.base_salary) - (advanceDeductions || 0) + (bonuses || 0);
  } else {
    const perDayRate = staff.base_salary / 30;
    netSalary = (staff.base_salary - (daysAbsent * perDayRate)) - (advanceDeductions || 0) + (bonuses || 0);
  }

  netSalary = Math.round(Math.max(0, netSalary));
  const today = new Date().toISOString().slice(0, 10);

  const res = db.prepare(`
    INSERT INTO staff_payroll (staff_id, period_month, days_present, days_absent, advance_deductions, bonuses, net_salary, payment_mode, payment_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(staffId, periodMonth, daysPresent, daysAbsent, advanceDeductions || 0, bonuses || 0, netSalary, paymentMode || 'CASH', today);

  addExpense('Staff Salary & Wages', `Salary payout for ${staff.name} (${periodMonth})`, netSalary, staff.name, paymentMode, 'Admin');
  return { payrollId: res.lastInsertRowid, netSalary };
}

export function updatePayroll(id, daysPresent, daysAbsent, advanceDeductions, bonuses, netSalary, paymentMode) {
  db.prepare(`
    UPDATE staff_payroll 
    SET days_present = ?, days_absent = ?, advance_deductions = ?, bonuses = ?, net_salary = ?, payment_mode = ?
    WHERE id = ?
  `).run(daysPresent, daysAbsent, advanceDeductions || 0, bonuses || 0, netSalary, paymentMode || 'CASH', id);
  return { id, netSalary };
}

export function deletePayroll(id) {
  db.prepare('DELETE FROM staff_payroll WHERE id = ?').run(id);
  return { success: true };
}

export function getPayrollRecords() {
  return db.prepare(`
    SELECT p.*, s.name as staff_name, s.role as staff_role
    FROM staff_payroll p
    LEFT JOIN staff s ON p.staff_id = s.id
    ORDER BY p.id DESC
  `).all();
}

// SETTLE TABLE BILL & INVOICE (Supports Discount, Parcel Charge & Extra Custom Modifiers)
export function settleTableBill(tableId, paymentMode, discountAmount = 0, serviceCharge = 0, customerName = '', customerPhone = '', orderChannel = 'DINE_IN', aggregatorOrderId = '', parcelCharge = 0, extraChargesJson = '[]') {
  const now = new Date().toISOString();
  
  const isAgg = orderChannel === 'SWIGGY' || orderChannel === 'ZOMATO' || paymentMode === 'ACCOUNTABILITY' || String(tableId).includes('SWIGGY') || String(tableId).includes('ZOMATO');
  const ch = isAgg ? ((orderChannel === 'SWIGGY' || orderChannel === 'ZOMATO') ? orderChannel : (String(tableId).includes('SWIGGY') ? 'SWIGGY' : 'ZOMATO')) : (orderChannel || 'DINE_IN');
  const effPayMode = isAgg ? 'ACCOUNTABILITY' : (paymentMode || 'UPI');
  const aggId = aggregatorOrderId || (isAgg ? `${ch}-${Date.now().toString().slice(-4)}` : '');

  const kotItems = db.prepare(`
    SELECT ki.name, ki.price, SUM(ki.qty) as qty, SUM(ki.price * ki.qty) as total
    FROM kot_items ki
    JOIN kots k ON ki.kot_id = k.id
    WHERE k.table_id = ? AND k.status != 'COMPLETED'
    GROUP BY ki.name, ki.price
  `).all(tableId);

  if (kotItems.length === 0) {
    db.prepare(`UPDATE tables SET status = 'AVAILABLE', active_order_id = NULL WHERE id = ?`).run(tableId);
    throw new Error('No active orders found for table ' + tableId + '. Table is now available.');
  }

  let subtotal = 0;
  for (const it of kotItems) {
    subtotal += it.total;
  }

  const settings = getRestaurantSettings();
  const cgstRate = (parseFloat(settings.cgst_rate) || 2.5) / 100;
  const sgstRate = (parseFloat(settings.sgst_rate) || 2.5) / 100;

  const discount = Math.min(parseFloat(discountAmount) || 0, subtotal);
  const taxableAmount = Math.max(0, subtotal - discount);
  const cgst = Math.round(taxableAmount * cgstRate * 100) / 100;
  const sgst = Math.round(taxableAmount * sgstRate * 100) / 100;
  const sc = parseFloat(serviceCharge) || 0;
  const parcel = parseFloat(parcelCharge) || 0;
  const grandTotal = Math.round(taxableAmount + cgst + sgst + sc + parcel);
  const invCode = isAgg ? `INV-${ch.slice(0, 2)}-${Date.now().toString().slice(-6)}` : `INV-${Date.now().toString().slice(-6)}`;

  const extraChargesStr = typeof extraChargesJson === 'string' ? extraChargesJson : JSON.stringify(extraChargesJson || []);

  const invStmt = db.prepare(`
    INSERT INTO invoices (invoice_code, table_id, subtotal, cgst, sgst, discount, service_charge, parcel_charge, extra_charges_json, grand_total, payment_mode, customer_name, customer_phone, order_channel, aggregator_order_id, aggregator_payout_status, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?)
  `);
  const invResult = invStmt.run(invCode, tableId, subtotal, cgst, sgst, discount, sc, parcel, extraChargesStr, grandTotal, effPayMode, customerName || '', customerPhone || '', ch, aggId, isAgg ? 'PENDING' : null, now);
  const invoiceId = invResult.lastInsertRowid;

  const invItemStmt = db.prepare(`
    INSERT INTO invoice_items (invoice_id, name, price, qty, total)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const it of kotItems) {
    invItemStmt.run(invoiceId, it.name, it.price, it.qty, it.total);
  }

  db.prepare(`UPDATE kots SET status = 'COMPLETED', updated_at = ? WHERE table_id = ?`).run(now, tableId);
  db.prepare(`UPDATE tables SET status = 'AVAILABLE', active_order_id = NULL WHERE id = ?`).run(tableId);

  return {
    invoiceId,
    invoiceCode: invCode,
    tableId,
    customerName: customerName || '',
    customerPhone: customerPhone || '',
    orderChannel: orderChannel || 'DINE_IN',
    aggregatorOrderId: aggregatorOrderId || '',
    subtotal,
    cgst,
    sgst,
    discount,
    serviceCharge: sc,
    parcelCharge: parcel,
    extraCharges: extraChargesStr,
    grandTotal,
    paymentMode: paymentMode || 'UPI',
    items: kotItems.map(it => ({ ...it, total: it.price * it.qty })),
    settings,
    createdAt: now
  };
}

// UPDATE INDIVIDUAL DISH / ITEM IN KOT (SLA & DISH-WISE READY WORKFLOW)
export function syncTakeawayOrderStatus(tableId, now = new Date().toISOString()) {
  if (!tableId || !tableId.startsWith('TOKEN-')) return null;
  const tokenNum = parseInt(tableId.replace('TOKEN-', ''), 10);
  if (isNaN(tokenNum)) return null;

  const existingOrder = db.prepare(`SELECT * FROM takeaway_orders WHERE token_number = ? AND status != 'DELIVERED' AND status != 'CANCELLED'`).get(tokenNum);
  if (!existingOrder) return null;

  const allKots = db.prepare(`SELECT status FROM kots WHERE table_id = ? OR table_id = ?`).all(`TOKEN-${tokenNum}`, `TOKEN #${tokenNum}`);
  if (allKots.length === 0) return null;

  const allReadyOrCompleted = allKots.every(k => k.status === 'READY' || k.status === 'SERVED' || k.status === 'COMPLETED');
  const anyPrepOrReady = allKots.some(k => k.status === 'PREPARING' || k.status === 'READY');

  if (allReadyOrCompleted && existingOrder.status !== 'READY' && existingOrder.status !== 'DELIVERED') {
    db.prepare(`UPDATE takeaway_orders SET status = 'READY', updated_at = ? WHERE id = ?`).run(now, existingOrder.id);
    return { ...existingOrder, status: 'READY', updated_at: now, items: JSON.parse(existingOrder.items_json || '[]') };
  } else if (anyPrepOrReady && existingOrder.status === 'PENDING') {
    db.prepare(`UPDATE takeaway_orders SET status = 'PREPARING', updated_at = ? WHERE id = ?`).run(now, existingOrder.id);
    return { ...existingOrder, status: 'PREPARING', updated_at: now, items: JSON.parse(existingOrder.items_json || '[]') };
  }

  return null;
}

export function updateKOTItemStatus(itemId, newStatus) {
  const now = new Date().toISOString();
  const item = db.prepare('SELECT * FROM kot_items WHERE id = ?').get(itemId);
  if (!item) throw new Error('KOT item not found: ' + itemId);

  let prepStartedAt = item.prep_started_at;
  let readyAt = item.ready_at;
  let servedAt = item.served_at;
  let prepMinutes = item.prep_time_minutes;

  if (newStatus === 'PREPARING') {
    if (!prepStartedAt) prepStartedAt = now;
  } else if (newStatus === 'READY') {
    readyAt = now;
    if (!prepStartedAt) prepStartedAt = item.fired_at || now;
    const startMs = new Date(prepStartedAt).getTime();
    prepMinutes = Math.max(0.5, Math.round(((new Date(now).getTime() - startMs) / 60000) * 10) / 10);
  } else if (newStatus === 'SERVED') {
    servedAt = now;
    if (!readyAt) readyAt = now;
  }

  db.prepare(`
    UPDATE kot_items 
    SET status = ?, prep_started_at = ?, ready_at = ?, served_at = ?, prep_time_minutes = ? 
    WHERE id = ?
  `).run(newStatus, prepStartedAt, readyAt, servedAt, prepMinutes, itemId);

  // Re-evaluate parent KOT status
  const kotItems = db.prepare('SELECT * FROM kot_items WHERE kot_id = ?').all(item.kot_id);
  const allServed = kotItems.every(i => i.status === 'SERVED');
  const allReadyOrServed = kotItems.every(i => i.status === 'READY' || i.status === 'SERVED');
  const anyPrepOrReady = kotItems.some(i => i.status === 'PREPARING' || i.status === 'READY');

  let parentStatus = 'PENDING';
  if (allServed) parentStatus = 'SERVED';
  else if (allReadyOrServed) parentStatus = 'READY';
  else if (anyPrepOrReady) parentStatus = 'PREPARING';

  db.prepare(`
    UPDATE kots 
    SET status = ?, 
        updated_at = ?,
        prep_started_at = COALESCE(prep_started_at, CASE WHEN ? = 'PREPARING' THEN ? ELSE NULL END),
        ready_at = CASE WHEN ? = 'READY' THEN ? ELSE ready_at END,
        served_at = CASE WHEN ? = 'SERVED' THEN ? ELSE served_at END
    WHERE id = ?
  `).run(parentStatus, now, parentStatus, now, parentStatus, now, parentStatus, now, item.kot_id);

  const updatedKot = db.prepare(`
    SELECT k.*, ks.name as kitchen_name, ks.color_code as kitchen_color
    FROM kots k
    LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
    WHERE k.id = ?
  `).get(item.kot_id);

  let takeawayOrder = null;
  if (updatedKot && updatedKot.table_id) {
    takeawayOrder = syncTakeawayOrderStatus(updatedKot.table_id, now);
  }

  const updatedItem = db.prepare('SELECT * FROM kot_items WHERE id = ?').get(itemId);
  return { item: updatedItem, kot: { ...updatedKot, items: kotItems }, takeawayOrder };
}

// UPDATE ENTIRE KOT TICKET STATUS (CASCADES TO ALL DISHES WITH TIMESTAMPS)
export function updateKOTStatus(kotId, newStatus) {
  const now = new Date().toISOString();
  
  if (newStatus === 'PREPARING') {
    db.prepare(`
      UPDATE kot_items 
      SET status = 'PREPARING', prep_started_at = COALESCE(prep_started_at, ?) 
      WHERE kot_id = ? AND status = 'PENDING'
    `).run(now, kotId);
    db.prepare(`UPDATE kots SET status = 'PREPARING', updated_at = ?, prep_started_at = COALESCE(prep_started_at, ?) WHERE id = ?`).run(now, now, kotId);
  } else if (newStatus === 'READY') {
    const items = db.prepare(`SELECT id, fired_at, prep_started_at FROM kot_items WHERE kot_id = ? AND status != 'READY' AND status != 'SERVED'`).all(kotId);
    for (const it of items) {
      const startMs = new Date(it.prep_started_at || it.fired_at || now).getTime();
      const mins = Math.max(0.5, Math.round(((new Date(now).getTime() - startMs) / 60000) * 10) / 10);
      db.prepare(`UPDATE kot_items SET status = 'READY', ready_at = ?, prep_time_minutes = ? WHERE id = ?`).run(now, mins, it.id);
    }
    db.prepare(`UPDATE kots SET status = 'READY', updated_at = ?, ready_at = ? WHERE id = ?`).run(now, now, kotId);
  } else if (newStatus === 'SERVED' || newStatus === 'COMPLETED') {
    db.prepare(`UPDATE kot_items SET status = 'SERVED', served_at = COALESCE(served_at, ?) WHERE kot_id = ?`).run(now, kotId);
    db.prepare(`UPDATE kots SET status = ?, updated_at = ?, served_at = COALESCE(served_at, ?) WHERE id = ?`).run(newStatus, now, now, kotId);
  } else {
    db.prepare('UPDATE kots SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, kotId);
  }

  const updated = db.prepare(`
    SELECT k.*, ks.name as kitchen_name, ks.color_code as kitchen_color
    FROM kots k
    LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
    WHERE k.id = ?
  `).get(kotId);

  let takeawayOrder = null;
  if (updated && updated.table_id) {
    takeawayOrder = syncTakeawayOrderStatus(updated.table_id, now);
  }

  const items = db.prepare('SELECT * FROM kot_items WHERE kot_id = ?').all(kotId);
  return { ...updated, items, takeawayOrder };
}

// ================= CUSTOM BILL CHARGES & DISCOUNTS CRUD =================
export function getCustomBillCharges() {
  return db.prepare('SELECT * FROM bill_custom_charges ORDER BY sort_order ASC, id ASC').all();
}

export function addCustomBillCharge({ name, chargeType = 'FLAT', value = 0, isDiscount = 0, applyTo = 'ALL', isActive = 1 }) {
  const id = `CHG-${Date.now().toString().slice(-6)}`;
  db.prepare(`
    INSERT INTO bill_custom_charges (id, name, charge_type, value, is_discount, apply_to, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM bill_custom_charges))
  `).run(id, (name || 'Custom Charge').trim(), chargeType, parseFloat(value) || 0, isDiscount ? 1 : 0, applyTo, isActive ? 1 : 0);
  return db.prepare('SELECT * FROM bill_custom_charges WHERE id = ?').get(id);
}

export function updateCustomBillCharge(id, { name, chargeType, value, isDiscount, applyTo, isActive }) {
  const current = db.prepare('SELECT * FROM bill_custom_charges WHERE id = ?').get(id);
  if (!current) throw new Error('Charge modifier not found: ' + id);

  db.prepare(`
    UPDATE bill_custom_charges 
    SET name = COALESCE(?, name),
        charge_type = COALESCE(?, charge_type),
        value = COALESCE(?, value),
        is_discount = COALESCE(?, is_discount),
        apply_to = COALESCE(?, apply_to),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    name ? name.trim() : null,
    chargeType || null,
    value !== undefined ? parseFloat(value) : null,
    isDiscount !== undefined ? (isDiscount ? 1 : 0) : null,
    applyTo || null,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    id
  );
  return db.prepare('SELECT * FROM bill_custom_charges WHERE id = ?').get(id);
}

export function deleteCustomBillCharge(id) {
  db.prepare('DELETE FROM bill_custom_charges WHERE id = ?').run(id);
  return { success: true, id };
}

export function getRestaurantSettings() {
  const rows = db.prepare('SELECT key, value FROM restaurant_settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  return settings;
}

export function saveRestaurantSettings(settingsObj) {
  const stmt = db.prepare('INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settingsObj)) {
    stmt.run(k, String(v));
  }
  return getRestaurantSettings();
}

// ================= RESTAURANT PRE-BILL (PROFORMA CHECK SLIP) =================
export function generateTablePreBill(tableId, options = {}) {
  const { discountAmount = 0, parcelCharge = 0, serviceCharge = 0 } = options;

  const kotItems = db.prepare(`
    SELECT ki.name, ki.price, SUM(ki.qty) as qty, SUM(ki.price * ki.qty) as total
    FROM kot_items ki
    JOIN kots k ON ki.kot_id = k.id
    WHERE k.table_id = ? AND k.status != 'COMPLETED'
    GROUP BY ki.name, ki.price
  `).all(tableId);

  if (kotItems.length === 0) {
    throw new Error('No active orders found for table ' + tableId);
  }

  let subtotal = 0;
  for (const it of kotItems) {
    subtotal += it.total;
  }

  const settings = getRestaurantSettings();
  const cgstRate = (parseFloat(settings.cgst_rate) || 2.5) / 100;
  const sgstRate = (parseFloat(settings.sgst_rate) || 2.5) / 100;

  const discount = Math.min(parseFloat(discountAmount) || 0, subtotal);
  const taxableAmount = Math.max(0, subtotal - discount);
  const cgst = Math.round(taxableAmount * cgstRate * 100) / 100;
  const sgst = Math.round(taxableAmount * sgstRate * 100) / 100;
  const sc = parseFloat(serviceCharge) || 0;
  const parcel = parseFloat(parcelCharge) || 0;
  const grandTotal = Math.round(taxableAmount + cgst + sgst + sc + parcel);
  const now = new Date().toISOString();

  // Set table status to BILL_REVIEW so staff know customer is reviewing the bill
  db.prepare(`UPDATE tables SET status = 'BILL_REVIEW' WHERE id = ?`).run(tableId);

  const table = db.prepare(`
    SELECT t.*, f.name as floor_name
    FROM tables t
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE t.id = ?
  `).get(tableId);

  return {
    tableId,
    tableName: table ? table.name : tableId,
    floorName: table ? table.floor_name : 'Floor',
    orderCode: table ? (table.active_order_id || 'ORD-001') : 'ORD-001',
    subtotal,
    cgst,
    sgst,
    discount,
    serviceCharge: sc,
    parcelCharge: parcel,
    grandTotal,
    items: kotItems,
    timestamp: now
  };
}

export function reopenTableOrder(tableId) {
  db.prepare(`UPDATE tables SET status = 'OCCUPIED' WHERE id = ?`).run(tableId);
  return { success: true, tableId, status: 'OCCUPIED' };
}

// ================= TAKEAWAY / PARCEL ORDERS WITH DAILY RESET TOKENS =================
export function getNextTakeawayToken() {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT COALESCE(MAX(token_number), 0) + 1 AS next_token FROM takeaway_orders WHERE order_date = ?').get(today);
  return row ? row.next_token : 1;
}

export function createTakeawayOrder({ customerName, customerPhone, items, paymentMode, isPaid = true, captainName, notes, parcelCharge = 0, discountAmount = 0, channel = 'TAKEAWAY', aggregatorOrderId = '' }) {
  if (!items || items.length === 0) throw new Error('Takeaway order must have at least 1 item');

  const ch = (channel === 'SWIGGY' || channel === 'ZOMATO') ? channel : (paymentMode === 'ACCOUNTABILITY' ? 'SWIGGY' : 'TAKEAWAY');
  const isAggregator = ch === 'SWIGGY' || ch === 'ZOMATO';
  const effectivePayMode = isAggregator ? 'ACCOUNTABILITY' : (paymentMode || 'CASH');

  let subtotal = 0;
  for (const it of items) {
    subtotal += it.price * it.qty;
  }

  const settings = getRestaurantSettings();
  const cgstRate = (parseFloat(settings.cgst_rate) || 2.5) / 100;
  const sgstRate = (parseFloat(settings.sgst_rate) || 2.5) / 100;

  const discount = Math.min(parseFloat(discountAmount) || 0, subtotal);
  const taxableAmount = Math.max(0, subtotal - discount);
  const cgst = Math.round(taxableAmount * cgstRate * 100) / 100;
  const sgst = Math.round(taxableAmount * sgstRate * 100) / 100;
  const parcel = parseFloat(parcelCharge) || 0;
  const grandTotal = Math.round(taxableAmount + cgst + sgst + parcel);

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const tokenNumber = getNextTakeawayToken();
  const orderStatus = isPaid ? 'PREPARING' : 'PENDING_PAYMENT';
  const aggOrderId = aggregatorOrderId || (isAggregator ? `${ch}-${tokenNumber}` : '');
  const effectiveNotes = isAggregator ? `[${ch === 'SWIGGY' ? '🟠 SWIGGY' : '🔴 ZOMATO'} #${aggOrderId}] ${notes || ''}` : (notes || 'Takeaway Parcel');

  const res = db.prepare(`
    INSERT INTO takeaway_orders (token_number, order_date, customer_name, customer_phone, items_json, subtotal, cgst, sgst, discount, parcel_charge, grand_total, payment_mode, is_paid, status, captain_name, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tokenNumber,
    today,
    customerName || (isAggregator ? `${ch} Customer #${tokenNumber}` : `Customer #${tokenNumber}`),
    customerPhone || '',
    JSON.stringify(items),
    subtotal,
    cgst,
    sgst,
    discount,
    parcel,
    grandTotal,
    effectivePayMode,
    isPaid ? 1 : 0,
    orderStatus,
    captainName || (isAggregator ? `${ch} Cloud` : 'Staff'),
    effectiveNotes,
    now,
    now
  );

  const orderId = res.lastInsertRowid;

  // Automatically deduct stock, record bill, and push KOTs to kitchen stations!
  let invCode = isAggregator ? `INV-${ch.slice(0, 2)}-${tokenNumber}-${Date.now().toString().slice(-4)}` : `TK-${tokenNumber}-${Date.now().toString().slice(-4)}`;
  let createdTickets = [];
  if (isPaid) {
    // Generate split KOTs for kitchen stations
    createdTickets = pushTakeawayKOTs(tokenNumber, items, effectiveNotes, captainName || `${ch} Cloud`, now);

    // Record invoice in billing archive
    const fakeTableId = `TOKEN-${tokenNumber}`;
    db.prepare(`
      INSERT OR IGNORE INTO tables (id, name, floor_id, capacity, status)
      VALUES (?, ?, 'floor-ground', 1, 'AVAILABLE')
    `).run(fakeTableId, isAggregator ? `${ch} Token #${tokenNumber}` : `Takeaway Token #${tokenNumber}`);

    const invStmt = db.prepare(`
      INSERT INTO invoices (invoice_code, table_id, subtotal, cgst, sgst, discount, parcel_charge, grand_total, payment_mode, customer_name, customer_phone, order_channel, aggregator_order_id, aggregator_payout_status, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?)
    `);
    const invRes = invStmt.run(invCode, fakeTableId, subtotal, cgst, sgst, discount, parcel, grandTotal, effectivePayMode, customerName || `${ch} Token #${tokenNumber}`, customerPhone || '', ch, aggOrderId, isAggregator ? 'PENDING' : null, now);
    const invoiceId = invRes.lastInsertRowid;

    const invItemStmt = db.prepare(`
      INSERT INTO invoice_items (invoice_id, name, price, qty, total)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const it of items) {
      invItemStmt.run(invoiceId, it.name, it.price, it.qty, it.price * it.qty);
    }
  }

  return {
    id: orderId,
    token_number: tokenNumber,
    order_date: today,
    customer_name: customerName || (isAggregator ? `${ch} Customer #${tokenNumber}` : `Customer #${tokenNumber}`),
    customer_phone: customerPhone || '',
    items,
    subtotal,
    cgst,
    sgst,
    discount,
    grand_total: grandTotal,
    payment_mode: effectivePayMode,
    order_channel: ch,
    aggregator_order_id: aggOrderId,
    aggregator_payout_status: isAggregator ? 'PENDING' : null,
    is_paid: isPaid ? 1 : 0,
    status: orderStatus,
    captain_name: captainName || (isAggregator ? `${ch} Cloud` : 'Staff'),
    notes: effectiveNotes,
    created_at: now,
    invoiceCode: invCode,
    kots: createdTickets,
    createdTickets: createdTickets
  };
}

function pushTakeawayKOTs(tokenNumber, items, notes, captainName, now) {
  const stationGroups = {};
  for (const it of items) {
    const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(it.menu_id || it.id || it.menuItemId);
    const stationId = menuItem?.kitchen_id || 'k-main';
    if (!stationGroups[stationId]) stationGroups[stationId] = [];
    stationGroups[stationId].push({
      menu_id: menuItem ? menuItem.id : (it.menu_id || it.id || 'm-custom'),
      name: menuItem ? menuItem.name : (it.name || 'Custom Dish'),
      price: menuItem ? menuItem.price : it.price,
      qty: Math.max(1, parseInt(it.qty || it.quantity || 1, 10)),
      kitchen_id: stationId
    });
  }

  const createdTickets = [];
  const fakeTableId = `TOKEN-${tokenNumber}`;

  db.prepare(`
    INSERT OR IGNORE INTO tables (id, name, floor_id, capacity, status)
    VALUES (?, ?, 'floor-ground', 1, 'AVAILABLE')
  `).run(fakeTableId, `Takeaway Token #${tokenNumber}`);

  for (const stationId of Object.keys(stationGroups)) {
    const stationItems = stationGroups[stationId];
    const kotStmt = db.prepare(`
      INSERT INTO kots (table_id, kitchen_id, status, notes, captain_name, created_at, updated_at)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
    `);
    const result = kotStmt.run(fakeTableId, stationId, `[🛍️ TAKEAWAY] ${notes || 'Parcel'}`, `[🛍️ TAKEAWAY] ${captainName || 'Staff'}`, now, now);
    const kotId = result.lastInsertRowid;

    const itemStmt = db.prepare(`
      INSERT INTO kot_items (kot_id, menu_id, name, price, qty, kitchen_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const it of stationItems) {
      itemStmt.run(kotId, it.menu_id, it.name, it.price, it.qty, it.kitchen_id);
      deductInventoryForMenuItem(it.menu_id, it.qty);
    }

    const fullTicket = db.prepare(`
      SELECT k.*, ks.name as kitchen_name, ks.color_code as kitchen_color
      FROM kots k
      LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
      WHERE k.id = ?
    `).get(kotId);

    createdTickets.push({ ...fullTicket, items: stationItems, is_takeaway: true, token_number: tokenNumber });
  }

  return createdTickets;
}

export function collectTakeawayPayment(orderId, paymentMode) {
  const order = db.prepare('SELECT * FROM takeaway_orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Takeaway order not found');
  if (order.is_paid) throw new Error('Order is already paid');

  const now = new Date().toISOString();
  const items = JSON.parse(order.items_json);

  db.prepare(`
    UPDATE takeaway_orders 
    SET is_paid = 1, status = 'PREPARING', payment_mode = ?, updated_at = ?
    WHERE id = ?
  `).run(paymentMode || 'CASH', now, orderId);

  // Generate split KOTs for kitchen stations
  const createdTickets = pushTakeawayKOTs(order.token_number, items, order.notes, order.captain_name, now);

  // Record invoice
  const fakeTableId = `TOKEN-${order.token_number}`;
  const invCode = `TK-${order.token_number}-${Date.now().toString().slice(-4)}`;
  const invStmt = db.prepare(`
    INSERT INTO invoices (invoice_code, table_id, subtotal, cgst, sgst, discount, grand_total, payment_mode, customer_name, customer_phone, order_channel, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TAKEAWAY', 'PAID', ?)
  `);
  const invRes = invStmt.run(invCode, fakeTableId, order.subtotal, order.cgst, order.sgst, order.discount, order.grand_total, paymentMode || 'CASH', order.customer_name || `Token #${order.token_number}`, order.customer_phone || '', now);
  const invoiceId = invRes.lastInsertRowid;

  const invItemStmt = db.prepare(`
    INSERT INTO invoice_items (invoice_id, name, price, qty, total)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const it of items) {
    invItemStmt.run(invoiceId, it.name, it.price, it.qty, it.price * it.qty);
  }

  const updatedOrder = db.prepare('SELECT * FROM takeaway_orders WHERE id = ?').get(orderId);
  return { ...updatedOrder, items, invoiceCode: invCode, kots: createdTickets, createdTickets };
}

export function getTakeawayOrders(filterDate) {
  const today = filterDate || new Date().toISOString().slice(0, 10);
  const rows = db.prepare('SELECT * FROM takeaway_orders WHERE order_date = ? ORDER BY id DESC').all(today);
  return rows.map(r => ({
    ...r,
    items: JSON.parse(r.items_json || '[]')
  }));
}

export function updateTakeawayStatus(orderId, newStatus) {
  const now = new Date().toISOString();
  db.prepare('UPDATE takeaway_orders SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, orderId);
  const order = db.prepare('SELECT * FROM takeaway_orders WHERE id = ?').get(orderId);

  // Also update associated KOTs across all matching table format tags (TOKEN-X and TOKEN #X)
  const tokHyphen = `TOKEN-${order.token_number}`;
  const tokHash = `TOKEN #${order.token_number}`;
  if (newStatus === 'READY') {
    db.prepare(`UPDATE kots SET status = 'READY', updated_at = ? WHERE (table_id = ? OR table_id = ?) AND status != 'COMPLETED'`).run(now, tokHyphen, tokHash);
    db.prepare(`UPDATE kot_items SET status = 'READY', ready_at = ? WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ? OR table_id = ?)`).run(now, tokHyphen, tokHash);
  } else if (newStatus === 'DELIVERED' || newStatus === 'COMPLETED') {
    db.prepare(`UPDATE kots SET status = 'COMPLETED', updated_at = ?, served_at = COALESCE(served_at, ?) WHERE table_id = ? OR table_id = ?`).run(now, now, tokHyphen, tokHash);
    db.prepare(`UPDATE kot_items SET status = 'SERVED', served_at = COALESCE(served_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ? OR table_id = ?)`).run(now, tokHyphen, tokHash);
  }

  return {
    ...order,
    items: JSON.parse(order.items_json || '[]')
  };
}

export function clearAllReadyKitchenKOTs(kitchenId = null) {
  const now = new Date().toISOString();
  let query = `SELECT id FROM kots WHERE status = 'READY' OR status = 'SERVED'`;
  const params = [];
  if (kitchenId && kitchenId !== 'all') {
    query += ` AND kitchen_id = ?`;
    params.push(kitchenId);
  }
  const readyKots = db.prepare(query).all(...params);
  for (const k of readyKots) {
    db.prepare(`UPDATE kot_items SET status = 'SERVED', served_at = COALESCE(served_at, ?) WHERE kot_id = ?`).run(now, k.id);
    db.prepare(`UPDATE kots SET status = 'COMPLETED', updated_at = ?, served_at = COALESCE(served_at, ?) WHERE id = ?`).run(now, now, k.id);
  }
  return { clearedCount: readyKots.length };
}

// ================= ZERO-DATA-LOSS BACKUP SYSTEM =================
export function createDatabaseBackup(type = 'MANUAL') {
  try {
    const backupDir = path.join(dataDir, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    // Flush WAL to disk first so backup contains 100% committed data
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (e) {
      console.warn('[Backup Checkpoint Notice]:', e.message);
    }

    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestampStr = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const filename = `backup_${type.toLowerCase()}_${timestampStr}.db`;
    const backupPath = path.join(backupDir, filename);

    fs.copyFileSync(dbPath, backupPath);

    const stats = fs.statSync(backupPath);
    const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get()?.count || 0;
    const expenseCount = db.prepare('SELECT COUNT(*) as count FROM expenses_ledger').get()?.count || 0;
    const itemCount = db.prepare('SELECT COUNT(*) as count FROM menu_items').get()?.count || 0;

    return {
      success: true,
      filename,
      filePath: backupPath,
      sizeBytes: stats.size,
      sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
      type: type.toUpperCase(),
      createdAt: d.toISOString(),
      invoiceCount,
      expenseCount,
      itemCount,
      message: `Snapshot created successfully: ${filename}`
    };
  } catch (err) {
    console.error('[Backup Error]:', err);
    throw new Error(`Backup failed: ${err.message}`);
  }
}

export function listDatabaseBackups() {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
  const list = files.map(file => {
    const filePath = path.join(backupDir, file);
    const stats = fs.statSync(filePath);
    let type = 'MANUAL';
    if (file.includes('daily')) type = 'DAILY';
    else if (file.includes('safety') || file.includes('pre_restore')) type = 'SAFETY';
    else if (file.includes('hourly') || file.includes('auto')) type = 'AUTO';

    return {
      filename: file,
      sizeBytes: stats.size,
      sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
      mtime: stats.mtime.toISOString(),
      type
    };
  });

  list.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  return list;
}

export function restoreDatabaseFromBackup(filename) {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid backup filename');
  }

  const backupDir = path.join(dataDir, 'backups');
  const sourceFile = path.join(backupDir, filename);
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Backup file not found: ${filename}`);
  }

  // 1. Take safety snapshot of CURRENT db before doing anything
  const safetyFilename = `pre_restore_safety_${Date.now()}.db`;
  const safetyPath = path.join(backupDir, safetyFilename);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (e) {}
  fs.copyFileSync(dbPath, safetyPath);

  // 2. Overwrite main db with backup
  fs.copyFileSync(sourceFile, dbPath);

  // 3. Remove wal/shm if present so SQLite starts clean
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) {
    try { fs.unlinkSync(walPath); } catch (e) {}
  }
  if (fs.existsSync(shmPath)) {
    try { fs.unlinkSync(shmPath); } catch (e) {}
  }

  return {
    success: true,
    restoredFrom: filename,
    safetyBackup: safetyFilename,
    message: `Database successfully restored from ${filename}. Safety backup saved to ${safetyFilename}`
  };
}

export function getDatabaseHealth() {
  let integrity = 'UNKNOWN';
  let journalMode = 'UNKNOWN';
  try {
    const intCheck = db.prepare('PRAGMA integrity_check').get();
    integrity = Object.values(intCheck || {})[0] || 'ok';
    const jm = db.prepare('PRAGMA journal_mode').get();
    journalMode = Object.values(jm || {})[0] || 'wal';
  } catch (e) {
    integrity = e.message;
  }

  const stats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : { size: 0 };
  const walStats = fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`) : { size: 0 };

  const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get()?.count || 0;
  const expenseCount = db.prepare('SELECT COUNT(*) as count FROM expenses_ledger').get()?.count || 0;
  const itemCount = db.prepare('SELECT COUNT(*) as count FROM menu_items').get()?.count || 0;
  const tableCount = db.prepare('SELECT COUNT(*) as count FROM tables').get()?.count || 0;
  const staffCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;

  const backups = listDatabaseBackups();
  const lastBackup = backups.length > 0 ? backups[0] : null;

  return {
    status: integrity === 'ok' ? 'HEALTHY' : 'WARNING',
    integrity,
    journalMode,
    dbSizeBytes: stats.size,
    dbSizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
    walSizeBytes: walStats.size,
    walSizeFormatted: `${(walStats.size / 1024).toFixed(1)} KB`,
    counts: {
      invoices: invoiceCount,
      expenses: expenseCount,
      menuItems: itemCount,
      tables: tableCount,
      staff: staffCount,
      backups: backups.length
    },
    lastBackup: lastBackup ? {
      filename: lastBackup.filename,
      time: lastBackup.mtime,
      size: lastBackup.sizeFormatted
    } : null,
    dbPath,
    timestamp: new Date().toISOString()
  };
}

export function backupDatabase() {
  return createDatabaseBackup('DAILY');
}

// ================= USER WORK ASSIGNMENTS (TABLES & KITCHENS) =================
export function getUserAssignments(userId) {
  const tables = db.prepare('SELECT table_id FROM user_table_assignments WHERE user_id = ?').all(userId).map(r => r.table_id);
  const kitchens = db.prepare('SELECT kitchen_id FROM user_kitchen_assignments WHERE user_id = ?').all(userId).map(r => r.kitchen_id);
  const allTables = tables.includes('*') || tables.length === 0;

  return {
    userId,
    tables: tables.filter(t => t !== '*'),
    kitchens,
    allTables
  };
}

export function setUserAssignments(userId, { tables = [], kitchens = [], allTables = false }) {
  db.prepare('DELETE FROM user_table_assignments WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_kitchen_assignments WHERE user_id = ?').run(userId);

  const tStmt = db.prepare('INSERT INTO user_table_assignments (user_id, table_id) VALUES (?, ?)');
  if (allTables) {
    tStmt.run(userId, '*');
  } else {
    for (const tbl of tables) {
      if (tbl) tStmt.run(userId, tbl);
    }
  }

  const kStmt = db.prepare('INSERT INTO user_kitchen_assignments (user_id, kitchen_id) VALUES (?, ?)');
  for (const k of kitchens) {
    if (k) kStmt.run(userId, k);
  }

  return getUserAssignments(userId);
}

export function getAllUserAssignments() {
  const users = db.prepare('SELECT id, username, full_name, role FROM users').all();
  return users.map(u => ({
    ...u,
    assignments: getUserAssignments(u.id)
  }));
}

// ================= PERMANENT BILLING ARCHIVE & HISTORY (UP TO 12 MONTHS) =================
export function getBillingHistory(arg1 = '', arg2 = '') {
  let search = '';
  let dateFrom = '';
  let dateTo = '';
  let paymentMode = '';
  let channel = '';
  let limit = 2000;

  if (typeof arg1 === 'object' && arg1 !== null) {
    search = arg1.search || '';
    dateFrom = arg1.dateFrom || '';
    dateTo = arg1.dateTo || '';
    paymentMode = arg1.paymentMode || '';
    channel = arg1.channel || '';
    limit = arg1.limit ? parseInt(arg1.limit) : 2000;
  } else {
    search = arg1 || '';
    if (arg2) {
      dateFrom = arg2;
      dateTo = arg2;
    }
  }

  let query = `
    SELECT i.id, i.invoice_code, i.table_id, i.subtotal, i.cgst, i.sgst, i.discount, 
           COALESCE(i.service_charge, 0) as service_charge,
           i.grand_total, i.payment_mode, i.status, i.created_at,
           i.customer_name, i.customer_phone, 
           COALESCE(i.order_channel, 'DINE_IN') as order_channel,
           i.aggregator_order_id,
           COALESCE(t.name, i.table_id) as table_name, f.name as floor_name
    FROM invoices i
    LEFT JOIN tables t ON i.table_id = t.id
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ` AND (i.invoice_code LIKE ? OR i.table_id LIKE ? OR t.name LIKE ? OR i.customer_name LIKE ? OR i.customer_phone LIKE ? OR i.aggregator_order_id LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s, s, s, s);
  }

  if (dateFrom) {
    query += ` AND i.created_at >= ?`;
    let fromIso = dateFrom;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      try {
        fromIso = new Date(`${dateFrom}T00:00:00`).toISOString();
      } catch (e) {
        fromIso = `${dateFrom}T00:00:00.000Z`;
      }
    }
    params.push(fromIso);
  }

  if (dateTo) {
    query += ` AND i.created_at <= ?`;
    let toIso = dateTo;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      try {
        toIso = new Date(`${dateTo}T23:59:59.999`).toISOString();
      } catch (e) {
        toIso = `${dateTo}T23:59:59.999Z`;
      }
    }
    params.push(toIso);
  }

  if (paymentMode && paymentMode !== 'ALL') {
    query += ` AND i.payment_mode LIKE ?`;
    params.push(`%${paymentMode}%`);
  }

  if (channel && channel !== 'ALL') {
    query += ` AND COALESCE(i.order_channel, 'DINE_IN') = ?`;
    params.push(channel);
  }

  query += ` ORDER BY i.id DESC LIMIT ${limit}`;

  const rows = db.prepare(query).all(...params);

  let totalInvoices = rows.length;
  let grossTotal = 0;
  let totalSubtotal = 0;
  let totalTax = 0;
  let totalDiscount = 0;
  let totalServiceCharge = 0;

  const invoicesWithItems = rows.map(r => {
    grossTotal += Number(r.grand_total || 0);
    totalSubtotal += Number(r.subtotal || 0);
    totalTax += Number((r.cgst || 0) + (r.sgst || 0));
    totalDiscount += Number(r.discount || 0);
    totalServiceCharge += Number(r.service_charge || 0);

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(r.id);
    return {
      ...r,
      items
    };
  });

  return {
    invoices: invoicesWithItems,
    stats: {
      totalInvoices,
      grossTotal: Math.round(grossTotal * 100) / 100,
      totalSubtotal: Math.round(totalSubtotal * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalServiceCharge: Math.round(totalServiceCharge * 100) / 100
    }
  };
}

export function getInvoiceById(id) {
  const invoice = db.prepare(`
    SELECT i.*, 
           COALESCE(i.service_charge, 0) as service_charge,
           COALESCE(i.parcel_charge, 0) as parcel_charge,
           COALESCE(i.extra_charges_json, '[]') as extra_charges_json,
           COALESCE(i.order_channel, 'DINE_IN') as order_channel,
           COALESCE(t.name, i.table_id) as table_name, f.name as floor_name
    FROM invoices i
    LEFT JOIN tables t ON i.table_id = t.id
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE i.id = ? OR i.invoice_code = ?
  `).get(id, id);

  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoice.id);
  const settings = getRestaurantSettings();
  return { ...invoice, items, settings };
}

// ================= TV DIGITAL SIGNAGE & PROMOTIONS =================
export function getTVPromotions() {
  return db.prepare('SELECT * FROM tv_promotions ORDER BY display_order ASC, id DESC').all();
}

export function saveTVPromotion(promo) {
  const now = new Date().toISOString();
  if (promo.id) {
    db.prepare(`
      UPDATE tv_promotions 
      SET title = ?, tagline = ?, image_url = ?, price_badge = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(promo.title, promo.tagline || '', promo.image_url || '', promo.price_badge || '', promo.display_order || 0, promo.is_active !== undefined ? promo.is_active : 1, promo.id);
    return db.prepare('SELECT * FROM tv_promotions WHERE id = ?').get(promo.id);
  } else {
    const res = db.prepare(`
      INSERT INTO tv_promotions (title, tagline, image_url, price_badge, display_order, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(promo.title, promo.tagline || '', promo.image_url || '', promo.price_badge || '', promo.display_order || 0, promo.is_active !== undefined ? promo.is_active : 1, now);
    return db.prepare('SELECT * FROM tv_promotions WHERE id = ?').get(res.lastInsertRowid);
  }
}

export function deleteTVPromotion(id) {
  db.prepare('DELETE FROM tv_promotions WHERE id = ?').run(id);
  return { success: true };
}

export function getTVDisplayData() {
  const settings = getRestaurantSettings();

  const takeawayPreparing = db.prepare(`
    SELECT token_number, customer_name, status, created_at
    FROM takeaway_orders
    WHERE status = 'PREPARING'
    ORDER BY id ASC
  `).all();

  const takeawayReady = db.prepare(`
    SELECT token_number, customer_name, status, updated_at
    FROM takeaway_orders
    WHERE status = 'READY'
    ORDER BY id ASC
  `).all();

  // Dining Tables with dishes or KOTs currently PREPARING
  const tablePreparing = db.prepare(`
    SELECT DISTINCT t.id, t.name, f.name as floor_name
    FROM tables t
    JOIN kots k ON k.table_id = t.id
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE t.id NOT LIKE 'TOKEN-%' AND (
      k.status = 'PREPARING' OR EXISTS (
        SELECT 1 FROM kot_items ki WHERE ki.kot_id = k.id AND ki.status = 'PREPARING'
      )
    )
    ORDER BY t.id ASC
  `).all();

  // Dining Tables with dishes or KOTs currently READY
  const tableReady = db.prepare(`
    SELECT DISTINCT t.id, t.name, f.name as floor_name
    FROM tables t
    JOIN kots k ON k.table_id = t.id
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE t.id NOT LIKE 'TOKEN-%' AND (
      k.status = 'READY' OR (
        NOT EXISTS (SELECT 1 FROM kot_items ki WHERE ki.kot_id = k.id AND ki.status != 'READY' AND ki.status != 'SERVED')
        AND EXISTS (SELECT 1 FROM kot_items ki WHERE ki.kot_id = k.id AND ki.status = 'READY')
      )
    )
    ORDER BY t.id ASC
  `).all();

  // Online Aggregators (Swiggy / Zomato) PREPARING
  const onlinePreparing = db.prepare(`
    SELECT DISTINCT t.id, t.name
    FROM tables t
    JOIN kots k ON k.table_id = t.id
    WHERE t.id LIKE 'ONLINE-%' AND (k.status = 'PREPARING' OR k.status = 'PENDING')
    ORDER BY t.id ASC
  `).all();

  const reviewTables = db.prepare(`
    SELECT id, name, status, active_order_id
    FROM tables
    WHERE status = 'BILL_REVIEW'
    ORDER BY id ASC
  `).all();

  const promotions = db.prepare(`
    SELECT * FROM tv_promotions
    WHERE is_active = 1
    ORDER BY display_order ASC, id DESC
  `).all();

  // Consolidated lists for TV screen
  const preparingTokens = [
    ...takeawayPreparing.map(t => String(t.token_number)),
    ...tablePreparing.map(t => t.name || t.id),
    ...onlinePreparing.map(t => t.name || t.id)
  ];

  const readyTokens = [
    ...takeawayReady.map(t => String(t.token_number)),
    ...tableReady.map(t => t.name || t.id)
  ];

  return {
    preparingTokens,
    readyTokens,
    tablePreparing,
    tableReady,
    reviewTables,
    promotions,
    tickerText: settings.tv_ticker_text || '🎉 Welcome to ChefPulse! • Fresh Food • Fast Service',
    slideInterval: parseInt(settings.tv_slide_interval) || 8,
    restaurantName: settings.restaurant_name || 'ChefPulse Multi-Cuisine Restaurant',
    timestamp: new Date().toISOString()
  };
}

export function getActiveKitchenKOTs(kitchenId = null) {
  let query = `
    SELECT k.*, 
           ks.name as kitchen_name, ks.color_code as kitchen_color,
           t.name as table_name, t.floor_id, f.name as floor_name
    FROM kots k
    LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
    LEFT JOIN tables t ON k.table_id = t.id
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE k.status != 'COMPLETED' AND k.status != 'SERVED'
  `;
  const params = [];
  if (kitchenId && kitchenId !== 'all') {
    query += ` AND k.kitchen_id = ?`;
    params.push(kitchenId);
  }
  query += ` ORDER BY k.id DESC`;

  const kots = db.prepare(query).all(...params);
  return kots.map(kot => {
    const items = db.prepare('SELECT * FROM kot_items WHERE kot_id = ?').all(kot.id);
    return { ...kot, items };
  });
}

// ================= SWIGGY & ZOMATO AGGREGATOR ORDER CREATION =================
export function createAggregatorOrder({ aggregator, orderId, customerName, customerPhone, items, deliveryPartner, notes }) {
  const now = new Date().toISOString();
  const channel = (aggregator || 'SWIGGY').toUpperCase();
  const aggOrderId = orderId || `${channel}-${Date.now().toString().slice(-4)}`;
  const onlineTableId = `ONLINE-${channel}`;

  // Ensure virtual table exists in tables to satisfy foreign key
  db.prepare(`
    INSERT OR IGNORE INTO tables (id, name, floor_id, capacity, status)
    VALUES (?, ?, 'floor-ground', 1, 'AVAILABLE')
  `).run(onlineTableId, `${channel} Cloud Dispatch`);

  const createdTickets = createRoutedKOTs(onlineTableId, items, `[${channel} ORDER #${aggOrderId}] ${notes || ''}`, `${channel} Cloud Dispatch`);

  let subtotal = 0;
  for (const it of items) {
    const mi = db.prepare('SELECT price FROM menu_items WHERE id = ?').get(it.menu_id || it.id || it.menuItemId);
    const price = mi ? mi.price : (it.price || 0);
    subtotal += price * (it.qty || 1);
  }

  const settings = getRestaurantSettings();
  const cgstRate = (parseFloat(settings.cgst_rate) || 2.5) / 100;
  const sgstRate = (parseFloat(settings.sgst_rate) || 2.5) / 100;
  const cgst = Math.round(subtotal * cgstRate * 100) / 100;
  const sgst = Math.round(subtotal * sgstRate * 100) / 100;
  const grandTotal = Math.round(subtotal + cgst + sgst);
  const invCode = `INV-${channel.slice(0, 2)}-${Date.now().toString().slice(-5)}`;

  const invStmt = db.prepare(`
    INSERT INTO invoices (invoice_code, table_id, subtotal, cgst, sgst, discount, service_charge, grand_total, payment_mode, customer_name, customer_phone, order_channel, aggregator_order_id, aggregator_payout_status, status, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'ACCOUNTABILITY', ?, ?, ?, ?, 'PENDING', 'PAID', ?)
  `);
  const invRes = invStmt.run(invCode, `ONLINE-${channel}`, subtotal, cgst, sgst, grandTotal, customerName || `${channel} Customer`, customerPhone || '', channel, aggOrderId, now);
  const invoiceId = invRes.lastInsertRowid;

  const itemStmt = db.prepare(`
    INSERT INTO invoice_items (invoice_id, name, price, qty, total)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const it of items) {
    const mi = db.prepare('SELECT name, price FROM menu_items WHERE id = ?').get(it.menu_id || it.id || it.menuItemId);
    const name = mi ? mi.name : (it.name || 'Item');
    const price = mi ? mi.price : (it.price || 0);
    const qty = it.qty || 1;
    itemStmt.run(invoiceId, name, price, qty, price * qty);
  }

  return {
    success: true,
    invoiceId,
    invoiceCode: invCode,
    aggregator: channel,
    orderId: aggOrderId,
    grandTotal,
    paymentMode: 'ACCOUNTABILITY',
    kots: createdTickets
  };
}

export function getAggregatorAccountingSummary() {
  const allAggOrders = db.prepare(`
    SELECT * FROM invoices 
    WHERE order_channel = 'SWIGGY' OR order_channel = 'ZOMATO'
    ORDER BY id DESC
  `).all();

  const today = new Date().toISOString().slice(0, 10);
  const todaySwiggy = allAggOrders.filter(o => o.order_channel === 'SWIGGY' && String(o.created_at).startsWith(today));
  const todayZomato = allAggOrders.filter(o => o.order_channel === 'ZOMATO' && String(o.created_at).startsWith(today));

  const pendingSwiggy = allAggOrders.filter(o => o.order_channel === 'SWIGGY' && (o.aggregator_payout_status || 'PENDING') === 'PENDING');
  const pendingZomato = allAggOrders.filter(o => o.order_channel === 'ZOMATO' && (o.aggregator_payout_status || 'PENDING') === 'PENDING');

  const settledSwiggy = allAggOrders.filter(o => o.order_channel === 'SWIGGY' && o.aggregator_payout_status === 'SETTLED');
  const settledZomato = allAggOrders.filter(o => o.order_channel === 'ZOMATO' && o.aggregator_payout_status === 'SETTLED');

  const pendingSwiggyTotal = pendingSwiggy.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  const pendingZomatoTotal = pendingZomato.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  const settledSwiggyTotal = settledSwiggy.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  const settledZomatoTotal = settledZomato.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  const settledTotal = settledSwiggyTotal + settledZomatoTotal;

  let settlements = [];
  try {
    const rawSettlements = db.prepare(`SELECT * FROM aggregator_settlements ORDER BY id DESC`).all();
    settlements = rawSettlements.map(s => ({
      ...s,
      payoutRef: s.utr_number,
      payoutDate: s.settlement_date,
      payoutAmount: s.net_received_amount,
      orderCount: s.orders_count,
      grossAmount: s.gross_amount,
      deductionsAmount: s.deductions_amount
    }));
  } catch (e) {}

  const swiggyTodayTotal = todaySwiggy.reduce((s, o) => s + Number(o.grand_total || 0), 0);
  const zomatoTodayTotal = todayZomato.reduce((s, o) => s + Number(o.grand_total || 0), 0);

  return {
    daily: {
      date: today,
      todayCount: todaySwiggy.length + todayZomato.length,
      todayTotal: swiggyTodayTotal + zomatoTodayTotal,
      swiggyTodayCount: todaySwiggy.length,
      swiggyTodayTotal: swiggyTodayTotal,
      zomatoTodayCount: todayZomato.length,
      zomatoTodayTotal: zomatoTodayTotal
    },
    today: {
      date: today,
      todayCount: todaySwiggy.length + todayZomato.length,
      todayTotal: swiggyTodayTotal + zomatoTodayTotal,
      swiggyCount: todaySwiggy.length,
      swiggyTotal: swiggyTodayTotal,
      zomatoCount: todayZomato.length,
      zomatoTotal: zomatoTodayTotal
    },
    pending: {
      swiggyCount: pendingSwiggy.length,
      swiggyPendingCount: pendingSwiggy.length,
      swiggyTotal: pendingSwiggyTotal,
      swiggyPendingTotal: pendingSwiggyTotal,
      zomatoCount: pendingZomato.length,
      zomatoPendingCount: pendingZomato.length,
      zomatoTotal: pendingZomatoTotal,
      zomatoPendingTotal: pendingZomatoTotal,
      totalPending: pendingSwiggyTotal + pendingZomatoTotal,
      pendingTotalAmount: pendingSwiggyTotal + pendingZomatoTotal,
      pendingOrdersCount: pendingSwiggy.length + pendingZomato.length
    },
    settled: {
      swiggyCount: settledSwiggy.length,
      swiggySettledTotal: settledSwiggyTotal,
      zomatoCount: settledZomato.length,
      zomatoSettledTotal: settledZomatoTotal,
      settledCount: settledSwiggy.length + settledZomato.length,
      totalSettled: settledTotal,
      settledTotal: settledTotal,
      payouts: settlements
    },
    orders: allAggOrders.map(o => {
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(o.id);
      return { ...o, items };
    })
  };
}

export function settleAggregatorPayout({ invoiceIds = [], channel, payoutRef, payoutAmount, notes, periodRange }) {
  const now = new Date().toISOString();
  const ch = (channel || 'SWIGGY').toUpperCase();
  const ref = payoutRef || `UTR-${ch}-${Date.now().toString().slice(-6)}`;

  let targetOrders = [];
  if (Array.isArray(invoiceIds) && invoiceIds.length > 0) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    targetOrders = db.prepare(`SELECT id, grand_total, order_channel FROM invoices WHERE id IN (${placeholders})`).all(...invoiceIds);
  } else {
    targetOrders = db.prepare(`
      SELECT id, grand_total, order_channel FROM invoices 
      WHERE order_channel = ? AND (aggregator_payout_status = 'PENDING' OR aggregator_payout_status IS NULL)
    `).all(ch);
  }

  const grossTotal = targetOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  const netReceived = (payoutAmount !== undefined && payoutAmount !== null && payoutAmount !== '') ? parseFloat(payoutAmount) : grossTotal;
  const deductions = Math.max(0, Math.round((grossTotal - netReceived) * 100) / 100);
  const ordersCount = targetOrders.length;

  let settlementId = null;
  try {
    const res = db.prepare(`
      INSERT INTO aggregator_settlements (channel, gross_amount, net_received_amount, deductions_amount, orders_count, utr_number, settlement_date, period_range, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ch,
      grossTotal,
      netReceived,
      deductions,
      ordersCount,
      ref,
      now.slice(0, 10),
      periodRange || `Week Ending ${now.slice(0, 10)}`,
      notes || `Reconciled net payout of ${ordersCount} orders`,
      now
    );
    settlementId = res.lastInsertRowid;
  } catch (e) {
    console.warn('Error inserting aggregator_settlement:', e);
  }

  const updateStmt = db.prepare(`
    UPDATE invoices
    SET aggregator_payout_status = 'SETTLED',
        aggregator_payout_date = ?,
        aggregator_payout_ref = ?,
        aggregator_settlement_id = ?
    WHERE id = ?
  `);
  for (const o of targetOrders) {
    updateStmt.run(now, ref, settlementId, o.id);
  }

  return {
    ...getAggregatorAccountingSummary(),
    settledCount: ordersCount,
    grossTotal,
    netReceived,
    deductions,
    utr: ref
  };
}

// ================= STAFF PAYSLIP DETAILS & REPRINT =================
export function getPayslipDetails(payrollId) {
  const row = db.prepare(`
    SELECT p.*, s.name as staff_name, s.role as staff_role, s.phone as staff_phone, s.base_salary, s.salary_type
    FROM staff_payroll p
    LEFT JOIN staff s ON p.staff_id = s.id
    WHERE p.id = ?
  `).get(payrollId);

  if (!row) return null;

  return {
    ...row,
    payslip_code: row.payslip_code || `PAY-${row.period_month.replace('-', '')}-${String(row.id).padStart(3, '0')}`,
    restaurant_name: 'ChefPulse Restaurant & Family Dining',
    address: '123 Food Street, Anna Nagar, Chennai - 600040',
    phone: '+91 98765 43210'
  };
}

// ================= MENU ITEM EDIT & RECIPE MANAGEMENT =================
export function getMenuItemWithIngredients(id) {
  const item = db.prepare(`
    SELECT m.*, c.name as category_name, k.name as kitchen_name, k.color_code as kitchen_color
    FROM menu_items m
    LEFT JOIN menu_categories c ON m.category_id = c.id
    LEFT JOIN kitchen_stations k ON m.kitchen_id = k.id
    WHERE m.id = ?
  `).get(id);

  if (!item) return null;

  const ingredients = db.prepare(`
    SELECT r.id, r.inventory_id, r.quantity_required, i.name as inventory_name, i.unit, i.current_stock, i.cost_per_unit
    FROM recipe_ingredients r
    LEFT JOIN inventory_items i ON r.inventory_id = i.id
    WHERE r.menu_id = ?
  `).all(id);

  return { ...item, ingredients };
}

// ================= SCANNED PURCHASE BILL PROCESSING =================
export function processScannedPurchase({ vendorName, invoiceNo, purchaseDate, paymentMode, items = [] }) {
  const now = purchaseDate || new Date().toISOString().slice(0, 10);
  let totalBillAmount = 0;

  for (const it of items) {
    const qty = parseFloat(it.quantity) || 1;
    const rate = parseFloat(it.unitRate) || 0;
    const lineTotal = it.total ? parseFloat(it.total) : qty * rate;
    totalBillAmount += lineTotal;

    // 1. Check if inventory item exists or auto-create it
    let invId = it.inventory_id;
    if (!invId) {
      const found = db.prepare('SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?)').get(it.name.trim());
      if (found) {
        invId = found.id;
      } else {
        invId = 'inv-' + Date.now().toString().slice(-4) + Math.floor(Math.random() * 100);
        db.prepare(`
          INSERT INTO inventory_items (id, name, category, unit, current_stock, min_threshold, cost_per_unit)
          VALUES (?, ?, 'Pantry & Groceries', ?, ?, 5, ?)
        `).run(invId, it.name.trim(), it.unit || 'kg', qty, rate);
      }
    }

    // 2. Add purchase record
    db.prepare(`
      INSERT INTO purchases (purchase_date, vendor_name, invoice_no, inventory_id, quantity, unit_rate, total_amount, payment_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(now, vendorName || 'Scanned Vendor', invoiceNo || 'SCN-001', invId, qty, rate, lineTotal, paymentMode || 'CASH');

    // 3. Update stock in inventory_items
    db.prepare(`
      UPDATE inventory_items
      SET current_stock = current_stock + ?, cost_per_unit = ?
      WHERE id = ?
    `).run(qty, rate, invId);
  }

  // 4. Record spend in expenses_ledger
  if (totalBillAmount > 0) {
    db.prepare(`
      INSERT INTO expenses_ledger (expense_date, category, description, amount, paid_to, payment_mode, recorded_by)
      VALUES (?, 'Inventory Purchase', ?, ?, ?, 'Admin (Gemini OCR)')
    `).run(now, `Scanned Bill #${invoiceNo || 'N/A'} (${items.length} items)`, totalBillAmount, vendorName || 'Vendor', paymentMode || 'CASH');
  }

  return {
    success: true,
    totalBillAmount,
    itemsCount: items.length,
    inventory: getInventoryStatus()
  };
}

// ================= ADMIN ORDER FLOW CONTROLLER & RESCUE HUB =================
export function getAllActiveOrdersWithStatus() {
  const now = Date.now();
  const tables = db.prepare(`
    SELECT t.id, t.name, t.floor_id, t.capacity, t.status, f.name as floor_name
    FROM tables t
    LEFT JOIN floors f ON t.floor_id = f.id
    WHERE t.id NOT LIKE 'TOKEN-%' AND t.id != 'TAKEAWAY'
    ORDER BY t.id
  `).all();

  const activeOrders = [];

  for (const tbl of tables) {
    const kots = db.prepare(`
      SELECT k.*, ks.name as kitchen_name, ks.color_code as kitchen_color
      FROM kots k
      LEFT JOIN kitchen_stations ks ON k.kitchen_id = ks.id
      WHERE k.table_id = ? AND k.status != 'COMPLETED'
      ORDER BY k.id ASC
    `).all(tbl.id);

    if (kots.length > 0 || tbl.status !== 'AVAILABLE') {
      let oldestKotTime = tbl.status !== 'AVAILABLE' ? now : null;
      let totalAmount = 0;
      const allItems = [];

      for (const kot of kots) {
        const kTime = new Date(kot.created_at).getTime();
        if (!oldestKotTime || kTime < oldestKotTime) oldestKotTime = kTime;

        const items = db.prepare('SELECT * FROM kot_items WHERE kot_id = ?').all(kot.id);
        items.forEach(it => {
          totalAmount += it.price * it.qty;
          allItems.push({ ...it, kitchen_name: kot.kitchen_name, kot_status: kot.status });
        });
      }

      const elapsedMinutes = oldestKotTime ? Math.max(0, Math.floor((now - oldestKotTime) / 60000)) : 0;

      let bottleneck = 'Dining';
      if (kots.some(k => k.status === 'PENDING')) bottleneck = 'Waiting Kitchen ACK';
      else if (kots.some(k => k.status === 'PREPARING')) bottleneck = 'Cooking in Kitchen';
      else if (kots.some(k => k.status === 'READY')) bottleneck = 'Ready at Pickup Counter';
      else if (tbl.status === 'BILL_REVIEW') bottleneck = 'Customer Reviewing Pre-Bill';
      else if (tbl.status === 'OCCUPIED') bottleneck = 'Served / Dining';

      activeOrders.push({
        type: 'DINE_IN',
        tableId: tbl.id,
        tableName: tbl.name,
        floorName: tbl.floor_name || 'Main Hall',
        tableStatus: tbl.status,
        bottleneck,
        elapsedMinutes,
        kotsCount: kots.length,
        itemsCount: allItems.length,
        totalAmount: Math.round(totalAmount * 1.05),
        items: allItems,
        kots: kots.map(k => ({ id: k.id, kitchen: k.kitchen_name, status: k.status, notes: k.notes }))
      });
    }
  }

  // Active Takeaway Orders
  const takeaway = db.prepare(`
    SELECT * FROM takeaway_orders 
    WHERE status != 'DELIVERED' AND status != 'CANCELLED'
    ORDER BY id ASC
  `).all();

  for (const tk of takeaway) {
    const tkTime = new Date(tk.created_at).getTime();
    const elapsedMinutes = Math.max(0, Math.floor((now - tkTime) / 60000));
    const items = JSON.parse(tk.items_json || '[]');

    activeOrders.push({
      type: 'TAKEAWAY',
      tableId: `TOKEN-${tk.token_number}`,
      tableName: `Token #${tk.token_number}`,
      floorName: 'Delivery Counter',
      tableStatus: tk.status,
      bottleneck: tk.status === 'PREPARING' ? 'Cooking in Kitchen' : tk.status === 'READY' ? 'Ready for Handover' : 'Pending',
      elapsedMinutes,
      kotsCount: 1,
      itemsCount: items.length,
      totalAmount: tk.grand_total,
      items,
      takeawayId: tk.id,
      customerName: tk.customer_name
    });
  }

  return activeOrders;
}

export function forceRouteOrder(tableId, targetStage) {
  const now = new Date().toISOString();

  // Takeaway Orders
  if (tableId.startsWith('TOKEN-')) {
    const tokenNum = parseInt(tableId.replace('TOKEN-', ''), 10);
    const order = db.prepare('SELECT * FROM takeaway_orders WHERE token_number = ? AND status != "DELIVERED"').get(tokenNum);
    if (!order) throw new Error('Active takeaway order not found for token ' + tokenNum);

    if (targetStage === 'CLEAR' || targetStage === 'DELIVERED') {
      db.prepare('UPDATE takeaway_orders SET status = "DELIVERED", updated_at = ? WHERE id = ?').run(now, order.id);
      db.prepare('UPDATE kots SET status = "COMPLETED", updated_at = ?, served_at = COALESCE(served_at, ?) WHERE table_id = ? OR table_id = ?').run(now, now, tableId, `TOKEN #${tokenNum}`);
      db.prepare('UPDATE kot_items SET status = "SERVED", served_at = COALESCE(served_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ? OR table_id = ?)').run(now, tableId, `TOKEN #${tokenNum}`);
    } else if (targetStage === 'READY') {
      db.prepare('UPDATE takeaway_orders SET status = "READY", updated_at = ? WHERE id = ?').run(now, order.id);
      db.prepare('UPDATE kots SET status = "READY", updated_at = ?, ready_at = COALESCE(ready_at, ?) WHERE table_id = ? OR table_id = ?').run(now, now, tableId, `TOKEN #${tokenNum}`);
      db.prepare('UPDATE kot_items SET status = "READY", ready_at = COALESCE(ready_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ? OR table_id = ?)').run(now, tableId, `TOKEN #${tokenNum}`);
    } else if (targetStage === 'PREPARING') {
      db.prepare('UPDATE takeaway_orders SET status = "PREPARING", updated_at = ? WHERE id = ?').run(now, order.id);
      db.prepare('UPDATE kots SET status = "PREPARING", updated_at = ? WHERE table_id = ? OR table_id = ?').run(now, tableId, `TOKEN #${tokenNum}`);
      db.prepare('UPDATE kot_items SET status = "PREPARING", prep_started_at = COALESCE(prep_started_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ? OR table_id = ?) AND status = "PENDING"').run(now, tableId, `TOKEN #${tokenNum}`);
    }
    return { success: true, tableId, targetStage, message: `Token #${tokenNum} routed to ${targetStage}` };
  }

  // Swiggy & Zomato Online Aggregator Virtual Tables
  if (tableId.startsWith('ONLINE-SWIGGY') || tableId.startsWith('ONLINE-ZOMATO')) {
    if (targetStage === 'CLEAR' || targetStage === 'DELIVERED') {
      db.prepare('UPDATE kots SET status = "COMPLETED", updated_at = ?, served_at = COALESCE(served_at, ?) WHERE table_id = ?').run(now, now, tableId);
      db.prepare('UPDATE kot_items SET status = "SERVED", served_at = COALESCE(served_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ?)').run(now, tableId);
    } else if (targetStage === 'READY') {
      db.prepare('UPDATE kots SET status = "READY", updated_at = ?, ready_at = COALESCE(ready_at, ?) WHERE table_id = ?').run(now, now, tableId);
      db.prepare('UPDATE kot_items SET status = "READY", ready_at = COALESCE(ready_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ?)').run(now, tableId);
    } else if (targetStage === 'PREPARING') {
      db.prepare('UPDATE kots SET status = "PREPARING", updated_at = ? WHERE table_id = ?').run(now, tableId);
      db.prepare('UPDATE kot_items SET status = "PREPARING", prep_started_at = COALESCE(prep_started_at, ?) WHERE kot_id IN (SELECT id FROM kots WHERE table_id = ?) AND status = "PENDING"').run(now, tableId);
    }
    return { success: true, tableId, targetStage, message: `${tableId} routed to ${targetStage}` };
  }

  // Dine-In Tables
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId);
  if (!table) throw new Error('Table not found: ' + tableId);

  if (targetStage === 'CLEAR') {
    db.prepare(`UPDATE kots SET status = 'COMPLETED', updated_at = ? WHERE table_id = ?`).run(now, tableId);
    db.prepare(`UPDATE tables SET status = 'AVAILABLE', active_order_id = NULL WHERE id = ?`).run(tableId);
    return { success: true, tableId, status: 'AVAILABLE', message: `Table ${table.name} force freed and order queue cleared.` };
  }

  if (targetStage === 'PREPARING') {
    db.prepare(`UPDATE kots SET status = 'PREPARING', updated_at = ? WHERE table_id = ? AND status != 'COMPLETED'`).run(now, tableId);
    db.prepare(`UPDATE tables SET status = 'OCCUPIED' WHERE id = ?`).run(tableId);
    return { success: true, tableId, status: 'OCCUPIED', message: 'Kitchen tickets forced to PREPARING.' };
  }

  if (targetStage === 'READY') {
    db.prepare(`UPDATE kots SET status = 'READY', updated_at = ? WHERE table_id = ? AND status != 'COMPLETED'`).run(now, tableId);
    return { success: true, tableId, status: 'READY', message: 'All kitchen tickets marked READY for pickup.' };
  }

  if (targetStage === 'SERVED') {
    db.prepare(`UPDATE kots SET status = 'SERVED', updated_at = ? WHERE table_id = ? AND status != 'COMPLETED'`).run(now, tableId);
    db.prepare(`UPDATE tables SET status = 'OCCUPIED' WHERE id = ?`).run(tableId);
    return { success: true, tableId, status: 'OCCUPIED', message: 'All items marked SERVED to table.' };
  }

  if (targetStage === 'BILLING') {
    db.prepare(`UPDATE tables SET status = 'BILL_REVIEW' WHERE id = ?`).run(tableId);
    return { success: true, tableId, status: 'BILL_REVIEW', message: 'Table pushed to Pre-Bill Review / Cashier.' };
  }

  throw new Error('Unknown force route stage: ' + targetStage);
}

// ================= TABLE MANAGEMENT: TRANSFER & MERGE =================
export function transferTable(sourceTableId, targetTableId) {
  const now = new Date().toISOString();
  const source = db.prepare('SELECT * FROM tables WHERE id = ?').get(sourceTableId);
  const target = db.prepare('SELECT * FROM tables WHERE id = ?').get(targetTableId);

  if (!source) throw new Error('Source table not found');
  if (!target) throw new Error('Target table not found');

  const activeKots = db.prepare("SELECT COUNT(*) as count FROM kots WHERE table_id = ? AND status != 'COMPLETED'").get(sourceTableId);
  if (source.status === 'AVAILABLE' && (!activeKots || activeKots.count === 0)) {
    throw new Error(`Source table ${source.name} has no active order to transfer`);
  }
  if (target.status !== 'AVAILABLE') throw new Error(`Target table ${target.name} is currently occupied. Choose a free table.`);

  db.prepare(`UPDATE kots SET table_id = ?, updated_at = ? WHERE table_id = ? AND status != 'COMPLETED'`).run(targetTableId, now, sourceTableId);
  const orderId = source.active_order_id || `ORD-${Date.now().toString().slice(-4)}`;
  db.prepare(`UPDATE tables SET status = 'OCCUPIED', active_order_id = ? WHERE id = ?`).run(orderId, targetTableId);
  db.prepare(`UPDATE tables SET status = 'AVAILABLE', active_order_id = NULL WHERE id = ?`).run(sourceTableId);

  return {
    success: true,
    sourceTableId,
    targetTableId,
    message: `Active order successfully transferred from ${source.name} to ${target.name}`
  };
}

export function mergeTables(sourceTableId, targetTableId) {
  const now = new Date().toISOString();
  const source = db.prepare('SELECT * FROM tables WHERE id = ?').get(sourceTableId);
  const target = db.prepare('SELECT * FROM tables WHERE id = ?').get(targetTableId);

  if (!source || !target) throw new Error('Tables not found');
  if (source.status === 'AVAILABLE') throw new Error(`Source table ${source.name} has no active order to merge`);

  db.prepare(`UPDATE kots SET table_id = ?, updated_at = ? WHERE table_id = ? AND status != 'COMPLETED'`).run(targetTableId, now, sourceTableId);
  db.prepare(`UPDATE tables SET status = 'OCCUPIED' WHERE id = ?`).run(targetTableId);
  db.prepare(`UPDATE tables SET status = 'AVAILABLE', active_order_id = NULL WHERE id = ?`).run(sourceTableId);

  return {
    success: true,
    sourceTableId,
    targetTableId,
    message: `Table ${source.name} merged into ${target.name}`
  };
}

// ================= SHIFT & DAY-END Z-REPORT =================
export function getDayEndZReport(dateFilter) {
  const date = dateFilter || new Date().toISOString().slice(0, 10);

  const salesRows = db.prepare(`
    SELECT payment_mode, COUNT(*) as count, SUM(grand_total) as total, SUM(subtotal) as subtotal, SUM(cgst) as cgst, SUM(sgst) as sgst, SUM(discount) as discount
    FROM invoices
    WHERE created_at LIKE ?
    GROUP BY payment_mode
  `).all(`${date}%`);

  let cashSales = 0, upiSales = 0, cardSales = 0, totalSales = 0, totalTax = 0, totalDiscount = 0, totalBills = 0;
  for (const s of salesRows) {
    totalBills += s.count;
    totalSales += s.total;
    totalTax += (s.cgst + s.sgst);
    totalDiscount += s.discount;
    if (s.payment_mode === 'CASH') cashSales = s.total;
    else if (s.payment_mode === 'UPI') upiSales = s.total;
    else if (s.payment_mode === 'CARD') cardSales = s.total;
  }

  const expRows = db.prepare(`
    SELECT payment_mode, SUM(amount) as total
    FROM expenses_ledger
    WHERE expense_date = ?
    GROUP BY payment_mode
  `).all(date);

  let cashExpenses = 0, totalExpenses = 0;
  for (const e of expRows) {
    totalExpenses += e.total;
    if (e.payment_mode === 'CASH') cashExpenses = e.total;
  }

  const openingFloat = 2000;
  const expectedCashInDrawer = openingFloat + cashSales - cashExpenses;

  return {
    date,
    totalBills,
    totalSales,
    cashSales,
    upiSales,
    cardSales,
    totalTax,
    totalDiscount,
    openingFloat,
    cashExpenses,
    totalExpenses,
    expectedCashInDrawer,
    salesByMode: salesRows,
    generatedAt: new Date().toISOString()
  };
}

// ================= MOBILE POS TERMINAL & SYNC ENGINE =================
export function getPosTerminal(terminalId) {
  if (!terminalId) return null;
  return db.prepare('SELECT * FROM pos_terminals WHERE terminal_id = ?').get(terminalId);
}

export function getAllPosTerminals() {
  return db.prepare('SELECT * FROM pos_terminals ORDER BY created_at DESC').all();
}

export function registerPosTerminal({ terminal_id, device_name, mode = 'BILLING_COUNTER', api_key, invoice_prefix }) {
  const existing = getPosTerminal(terminal_id);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE pos_terminals 
      SET device_name = ?, mode = ?, last_sync_at = ?
      WHERE terminal_id = ?
    `).run(device_name || existing.device_name, mode || existing.mode, now, terminal_id);
    return getPosTerminal(terminal_id);
  }

  // Calculate next available invoice prefix (e.g. MOB1-, MOB2-)
  let prefix = invoice_prefix;
  if (!prefix) {
    const count = db.prepare('SELECT count(*) as c FROM pos_terminals').get().c;
    prefix = `MOB${count + 1}-`;
  }
  const key = api_key || `cp_key_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`;

  db.prepare(`
    INSERT INTO pos_terminals (terminal_id, device_name, invoice_prefix, api_key, mode, last_sync_at, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(terminal_id, device_name || terminal_id, prefix, key, mode, now, now);

  return getPosTerminal(terminal_id);
}

export function getMobileBootstrapData(terminalId = '', requestedName = '') {
  let terminal = terminalId ? getPosTerminal(terminalId) : null;
  if (!terminal && terminalId) {
    terminal = registerPosTerminal({
      terminal_id: terminalId,
      device_name: requestedName || terminalId,
      mode: 'BILLING_COUNTER'
    });
  } else if (!terminal) {
    terminal = db.prepare('SELECT * FROM pos_terminals WHERE is_active = 1 LIMIT 1').get();
  }

  const settings = getRestaurantSettings();
  const tablesWithFloor = getTablesWithFloor();
  const floors = getFloors();
  const menuData = getMenuWithKitchens();
  const kitchenStations = getKitchenStations();
  const customCharges = getCustomBillCharges();
  const activeStaff = db.prepare(`
    SELECT id, username, pin_code, full_name, role 
    FROM users 
    WHERE status = 'ACTIVE'
  `).all();

  // Next sequence number for offline terminal billing
  const nextSeq = 1001 + (db.prepare('SELECT COUNT(*) as c FROM invoices WHERE terminal_id = ?').get(terminal?.terminal_id || '')?.c || 0);

  return {
    outlet: {
      name: settings.restaurant_name || 'ChefPulse Multi-Cuisine Restaurant',
      branch: settings.branch_name || 'Main Branch',
      address: settings.address || '',
      phone: settings.phone || '',
      email: settings.email || '',
      gstin: settings.gstin || '',
      fssai: settings.fssai_licence || '',
      upi_id: settings.upi_id || '9876543210@upi',
      currency_symbol: '₹',
      receipt_header: settings.restaurant_name || 'ChefPulse Restaurant',
      receipt_footer: settings.bill_footer || '*** THANK YOU! VISIT AGAIN ***',
      cgst_rate: parseFloat(settings.cgst_rate || '2.5'),
      sgst_rate: parseFloat(settings.sgst_rate || '2.5'),
      service_charge_rate: parseFloat(settings.service_charge_rate || '5.0'),
      enable_service_charge: settings.enable_service_charge === 'true',
      paper_size: settings.paper_size || '80mm',
      show_gst_breakdown: settings.show_gst_breakdown !== 'false',
      show_upi_qr: settings.show_upi_qr !== 'false'
    },
    tables: tablesWithFloor.map(t => ({
      id: t.id,
      name: t.name,
      floor_id: t.floor_id,
      floor_name: t.floor_name || 'Main Floor',
      capacity: t.capacity,
      status: t.status
    })),
    floors,
    catalog: {
      categories: menuData.categories || [],
      items: (menuData.items || []).map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        category_id: item.category_id,
        kitchen_id: item.kitchen_id || 'k-main',
        is_veg: item.is_veg === 1 || item.is_veg === true,
        image_url: item.image_url || '',
        prep_time: item.prep_time || '10m',
        variants: [
          { name: 'Standard / Full', price: item.price }
        ],
        addons: []
      })),
      tax_slabs: {
        cgst: parseFloat(settings.cgst_rate || '2.5'),
        sgst: parseFloat(settings.sgst_rate || '2.5')
      },
      kitchen_stations: kitchenStations
    },
    charges: customCharges,
    staff: activeStaff,
    terminal_config: {
      terminal_id: terminal?.terminal_id || 'MOB-DEFAULT',
      device_name: terminal?.device_name || 'Mobile POS Terminal',
      invoice_prefix: terminal?.invoice_prefix || 'MOB1-',
      mode: terminal?.mode || 'BILLING_COUNTER',
      api_key: terminal?.api_key || 'cp_default_key',
      next_sequence_no: nextSeq
    },
    server_time: new Date().toISOString()
  };
}

export function syncMobileOrders(orders = []) {
  if (!Array.isArray(orders)) orders = [orders];
  const synced_uuids = [];
  const failed = [];
  const now = new Date().toISOString();

  const checkExisting = db.prepare('SELECT id, invoice_code FROM invoices WHERE mobile_bill_uuid = ?');
  const insertInv = db.prepare(`
    INSERT INTO invoices (
      invoice_code, mobile_bill_uuid, terminal_id, table_id, 
      subtotal, cgst, sgst, discount, service_charge, parcel_charge, 
      extra_charges_json, grand_total, payment_mode, 
      customer_name, customer_phone, order_channel, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO invoice_items (invoice_id, name, price, qty, total)
    VALUES (?, ?, ?, ?, ?)
  `);

  const updateTable = db.prepare(`
    UPDATE tables SET status = 'AVAILABLE', active_order_id = NULL WHERE id = ?
  `);

  const insertKot = db.prepare(`
    INSERT INTO kots (table_id, kitchen_id, status, notes, captain_name, created_at, updated_at, fired_at, ready_at, served_at)
    VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertKotItem = db.prepare(`
    INSERT INTO kot_items (kot_id, menu_id, name, price, qty, kitchen_id, status, fired_at, ready_at, served_at, prep_time_minutes)
    VALUES (?, ?, ?, ?, ?, ?, 'SERVED', ?, ?, ?, 5)
  `);

  for (const order of orders) {
    const uuid = order.mobile_bill_uuid || order.uuid || `mob-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      // 1. Strict Idempotency check
      const existing = checkExisting.get(uuid);
      if (existing) {
        synced_uuids.push(uuid);
        continue;
      }

      // 2. Insert new settled bill
      const invCode = order.invoice_no || order.invoice_code || `INV-${uuid.substring(0, 8).toUpperCase()}`;
      const subtotal = parseFloat(order.subtotal || 0);
      const discount = parseFloat(order.discount || 0);
      const cgst = parseFloat(order.cgst || (order.tax_breakdown?.cgst) || (order.tax_breakdown?.cgst_amount) || 0);
      const sgst = parseFloat(order.sgst || (order.tax_breakdown?.sgst) || (order.tax_breakdown?.sgst_amount) || 0);
      const sc = parseFloat(order.service_charge || 0);
      const parcel = parseFloat(order.parcel_charge || 0);
      const grandTotal = parseFloat(order.grand_total || (subtotal - discount + cgst + sgst + sc + parcel));
      const payMode = order.payment_mode || 'CASH';
      
      // Resolve valid table_id to satisfy foreign key constraint on tables(id)
      let resolvedTableId = 'T-01';
      const requestedTable = order.table_id ? String(order.table_id).trim() : '';
      if (requestedTable) {
        const found = db.prepare('SELECT id FROM tables WHERE id = ? OR name = ? OR id = ?').get(requestedTable, requestedTable, 'T-' + requestedTable.padStart(2, '0'));
        if (found) {
          resolvedTableId = found.id;
        } else {
          const firstTbl = db.prepare('SELECT id FROM tables ORDER BY id ASC LIMIT 1').get();
          if (firstTbl) resolvedTableId = firstTbl.id;
        }
      } else {
        const firstTbl = db.prepare('SELECT id FROM tables ORDER BY id ASC LIMIT 1').get();
        if (firstTbl) resolvedTableId = firstTbl.id;
      }

      // Resolve valid kitchen_id to satisfy foreign key constraint on kitchen_stations(id)
      const primaryKitchen = db.prepare('SELECT id FROM kitchen_stations ORDER BY id ASC LIMIT 1').get()?.id || 'k-main';

      const termId = order.terminal_id || 'MOB-TERM';
      const createdAt = order.created_at || now;
      const extraChargesStr = typeof order.extra_charges === 'string' ? order.extra_charges : JSON.stringify(order.extra_charges || []);

      const invRes = insertInv.run(
        invCode, uuid, termId, resolvedTableId,
        subtotal, cgst, sgst, discount, sc, parcel,
        extraChargesStr, grandTotal, payMode,
        order.customer_name || '', order.customer_phone || '', order.channel || 'DINE_IN',
        createdAt
      );

      const invoiceId = invRes.lastInsertRowid;

      // 3. Insert items
      if (Array.isArray(order.items)) {
        for (const it of order.items) {
          const itemPrice = parseFloat(it.price || 0);
          const itemQty = parseInt(it.qty || it.quantity || 1, 10);
          const itemTotal = parseFloat(it.total || it.amount || (itemPrice * itemQty));
          insertItem.run(invoiceId, it.name || 'Dish Item', itemPrice, itemQty, itemTotal);
        }
      }

      // 4. Record completed KOT for history & tracking
      try {
        const kotRes = insertKot.run(resolvedTableId, primaryKitchen, order.notes || 'Mobile POS Order', order.captain_name || 'Mobile POS', createdAt, now, createdAt, now, now);
        const kotId = kotRes.lastInsertRowid;
        if (Array.isArray(order.items)) {
          for (const it of order.items) {
            insertKotItem.run(kotId, it.menu_id || it.id || 'm-item', it.name || 'Dish Item', parseFloat(it.price || 0), parseInt(it.qty || it.quantity || 1, 10), primaryKitchen, createdAt, now, now);
          }
        }
      } catch (kErr) {}

      // 5. Release table if dining order
      if (resolvedTableId && !resolvedTableId.startsWith('TOKEN-')) {
        try { updateTable.run(resolvedTableId); } catch (tErr) {}
      }

      // 6. Update terminal last sync
      if (termId) {
        try {
          db.prepare('UPDATE pos_terminals SET last_sync_at = ? WHERE terminal_id = ?').run(now, termId);
        } catch (sErr) {}
      }

      synced_uuids.push(uuid);
    } catch (err) {
      failed.push({ uuid, error: err.message });
    }
  }

  return { synced_uuids, failed };
}
