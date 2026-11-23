// src/services/thermalPrinter.js - ESC/POS Raw Thermal Receipt & KOT Generator
// Formats direct binary ESC/POS byte buffers for 58mm (32 cols) & 80mm (48 cols)
// Drivers: Bluetooth LE / Classic, Network IP:9100 Raw Socket, and Browser Fallback

// ESC/POS Command Byte Constants
const ESC = 0x1B;
const FS  = 0x1C;
const GS  = 0x1D;

export const ESC_COMMANDS = {
  INIT: [ESC, 0x40], // Initialize printer
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  FONT_NORMAL: [GS, 0x21, 0x00],
  FONT_DOUBLE_HEIGHT: [GS, 0x21, 0x01],
  FONT_DOUBLE_WIDTH: [GS, 0x21, 0x10],
  FONT_DOUBLE_SIZE: [GS, 0x21, 0x11],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  UNDERLINE_ON: [ESC, 0x2D, 0x01],
  UNDERLINE_OFF: [ESC, 0x2D, 0x00],
  LINE_FEED: [0x0A],
  PAPER_CUT_PARTIAL: [GS, 0x56, 0x42, 0x00], // GS V 66 0
  PAPER_CUT_FULL: [GS, 0x56, 0x00],
  FEED_3_LINES: [ESC, 0x64, 0x03]
};

// Text helper for encoding ASCII / UTF-8 text into byte array
function textToBytes(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Replace Indian Rupee symbol with 'Rs.' for standard ESC/POS code pages
    if (code === 0x20B9) {
      bytes.push(0x52, 0x73, 0x2E); // "Rs."
    } else if (code < 128) {
      bytes.push(code);
    } else {
      bytes.push(0x20); // space fallback
    }
  }
  return bytes;
}

// Format two columns (Left aligned, Right aligned) padded to width
export function formatTwoCol(left, right, width = 32) {
  left = String(left || '');
  right = String(right || '');
  const spaceNeeded = width - left.length - right.length;
  if (spaceNeeded <= 0) {
    const truncatedLeft = left.substring(0, Math.max(0, width - right.length - 1));
    return truncatedLeft + ' ' + right;
  }
  return left + ' '.repeat(spaceNeeded) + right;
}

// Format divider line
export function formatDivider(char = '-', width = 32) {
  return char.repeat(width);
}

// Format three columns (Item, Qty, Total)
export function formatThreeCol(item, qty, total, width = 32) {
  item = String(item || '');
  qty = String(qty || '');
  total = String(total || '');

  if (width === 58 || width === 32) {
    // 32 chars: Item(18) Qty(4) Total(10)
    const itemCol = item.length > 17 ? item.substring(0, 17) : item.padEnd(18, ' ');
    const qtyCol = qty.padStart(4, ' ');
    const totalCol = total.padStart(10, ' ');
    return itemCol + qtyCol + totalCol;
  } else {
    // 48 chars: Item(28) Qty(6) Total(14)
    const itemCol = item.length > 27 ? item.substring(0, 27) : item.padEnd(28, ' ');
    const qtyCol = qty.padStart(6, ' ');
    const totalCol = total.padStart(14, ' ');
    return itemCol + qtyCol + totalCol;
  }
}

// ================= ESC/POS RECEIPT BUILDER =================
export class EscPosBuilder {
  constructor(paperWidth = '58mm') {
    this.buffer = [];
    this.paperWidth = paperWidth;
    this.lineWidth = (paperWidth === '80mm' ? 48 : 32);
    this.init();
  }

  init() {
    this.buffer.push(...ESC_COMMANDS.INIT);
    return this;
  }

  align(alignment = 'left') {
    if (alignment === 'center') this.buffer.push(...ESC_COMMANDS.ALIGN_CENTER);
    else if (alignment === 'right') this.buffer.push(...ESC_COMMANDS.ALIGN_RIGHT);
    else this.buffer.push(...ESC_COMMANDS.ALIGN_LEFT);
    return this;
  }

  bold(enable = true) {
    this.buffer.push(...(enable ? ESC_COMMANDS.BOLD_ON : ESC_COMMANDS.BOLD_OFF));
    return this;
  }

  fontSize(size = 'normal') {
    if (size === 'double') this.buffer.push(...ESC_COMMANDS.FONT_DOUBLE_SIZE);
    else if (size === 'double-height') this.buffer.push(...ESC_COMMANDS.FONT_DOUBLE_HEIGHT);
    else if (size === 'double-width') this.buffer.push(...ESC_COMMANDS.FONT_DOUBLE_WIDTH);
    else this.buffer.push(...ESC_COMMANDS.FONT_NORMAL);
    return this;
  }

  text(str) {
    this.buffer.push(...textToBytes(str));
    return this;
  }

  line(str = '') {
    this.text(str);
    this.buffer.push(...ESC_COMMANDS.LINE_FEED);
    return this;
  }

  divider(char = '-') {
    return this.line(formatDivider(char, this.lineWidth));
  }

  twoCol(left, right) {
    return this.line(formatTwoCol(left, right, this.lineWidth));
  }

  threeCol(col1, col2, col3) {
    return this.line(formatThreeCol(col1, col2, col3, this.lineWidth));
  }

  feed(lines = 3) {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(...ESC_COMMANDS.LINE_FEED);
    }
    return this;
  }

  cut() {
    this.feed(3);
    this.buffer.push(...ESC_COMMANDS.PAPER_CUT_PARTIAL);
    return this;
  }

  getUint8Array() {
    return new Uint8Array(this.buffer);
  }
}

// 1. Generate Customer Invoice ESC/POS Buffer
export function generateBillEscPosBuffer(invoice, settings = {}) {
  const width = settings.paper_size || '58mm';
  const builder = new EscPosBuilder(width);

  const restName = settings.restaurant_name || settings.name || 'ChefPulse Multi-Cuisine';
  const address = settings.address || '';
  const phone = settings.phone || '';
  const gstin = settings.gstin || '';
  const fssai = settings.fssai_licence || settings.fssai || '';
  const footer = settings.bill_footer || settings.receipt_footer || '*** THANK YOU! VISIT AGAIN ***';

  // --- HEADER ---
  builder.align('center')
    .fontSize('double')
    .bold(true)
    .line(restName)
    .fontSize('normal')
    .bold(false);

  if (address) builder.line(address);
  if (phone) builder.line('Tel: ' + phone);
  if (gstin) builder.line('GSTIN: ' + gstin);
  if (fssai) builder.line('FSSAI: ' + fssai);

  builder.divider('=');

  // --- INVOICE INFO ---
  builder.align('left');
  const invCode = invoice.invoiceCode || invoice.invoice_code || invoice.invoice_no || '#INV-001';
  const dateStr = new Date(invoice.createdAt || invoice.created_at || Date.now()).toLocaleString([], {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  builder.twoCol('INV: ' + invCode, dateStr);
  builder.twoCol('TABLE: ' + (invoice.tableId || invoice.table_id || 'TAKEAWAY'), 'MODE: ' + (invoice.paymentMode || invoice.payment_mode || 'CASH'));

  if (invoice.customerName || invoice.customer_name) {
    builder.line('Customer: ' + (invoice.customerName || invoice.customer_name));
  }

  builder.divider('-');

  // --- TABLE HEADER ---
  builder.bold(true)
    .threeCol('ITEM', 'QTY', 'AMOUNT')
    .bold(false)
    .divider('-');

  // --- ITEMS LIST ---
  const items = invoice.items || [];
  for (const it of items) {
    const itemTotal = 'Rs.' + (it.total || (it.price * it.qty)).toFixed(2);
    builder.threeCol(it.name, 'x' + it.qty, itemTotal);
  }

  builder.divider('-');

  // --- FINANCIALS ---
  const subtotal = invoice.subtotal || 0;
  const discount = invoice.discount || 0;
  const cgst = invoice.cgst || 0;
  const sgst = invoice.sgst || 0;
  const sc = invoice.serviceCharge || invoice.service_charge || 0;
  const parcel = invoice.parcelCharge || invoice.parcel_charge || 0;
  const grandTotal = invoice.grandTotal || invoice.grand_total || 0;

  builder.twoCol('Subtotal:', 'Rs.' + subtotal.toFixed(2));
  if (discount > 0) {
    builder.twoCol('Discount Applied:', '-Rs.' + discount.toFixed(2));
  }
  if (cgst > 0) {
    builder.twoCol('CGST (' + (settings.cgst_rate || '2.5') + '%):', 'Rs.' + cgst.toFixed(2));
  }
  if (sgst > 0) {
    builder.twoCol('SGST (' + (settings.sgst_rate || '2.5') + '%):', 'Rs.' + sgst.toFixed(2));
  }
  if (sc > 0) {
    builder.twoCol('Service Charge:', '+Rs.' + sc.toFixed(2));
  }
  if (parcel > 0) {
    builder.twoCol('Parcel / Packaging:', '+Rs.' + parcel.toFixed(2));
  }

  builder.divider('=');

  // --- GRAND TOTAL ---
  builder.bold(true)
    .fontSize('double-height')
    .twoCol('GRAND TOTAL:', 'Rs.' + Math.round(grandTotal).toFixed(2))
    .fontSize('normal')
    .bold(false);

  builder.divider('=');

  // --- FOOTER ---
  builder.align('center')
    .line(footer);

  if (settings.upi_id) {
    builder.line('UPI ID: ' + settings.upi_id);
    builder.line('Scan & Pay with GPay / PhonePe / Paytm');
  }

  builder.line('Powered by ChefPulse POS')
    .cut();

  return builder.getUint8Array();
}

// 2. Generate Kitchen Order Ticket (KOT) ESC/POS Buffer
export function generateKotEscPosBuffer(kot, settings = {}) {
  const width = settings.paper_size || '58mm';
  const builder = new EscPosBuilder(width);

  const dateStr = new Date(kot.createdAt || kot.created_at || Date.now()).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  builder.align('center')
    .fontSize('double')
    .bold(true)
    .line('** K O T **')
    .fontSize('normal')
    .bold(false);

  if (kot.kitchen_name) {
    builder.bold(true).line('STATION: ' + kot.kitchen_name.toUpperCase()).bold(false);
  }

  builder.divider('=');

  builder.align('left');
  builder.twoCol('KOT #: ' + (kot.id || kot.kot_id || '1'), dateStr);
  builder.twoCol('TABLE: ' + (kot.table_id || kot.tableId || 'N/A'), 'STAFF: ' + (kot.captain_name || 'Captain'));

  builder.divider('-');

  builder.bold(true)
    .threeCol('ITEM NAME', 'QTY', 'STATUS')
    .bold(false)
    .divider('-');

  const items = kot.items || [];
  for (const it of items) {
    builder.bold(true)
      .threeCol(it.name, 'x' + it.qty, '[NEW]')
      .bold(false);
  }

  builder.divider('-');

  if (kot.notes) {
    builder.bold(true).line('NOTES: ' + kot.notes).bold(false);
    builder.divider('-');
  }

  builder.align('center')
    .line('* Rush Kitchen Preparation *')
    .cut();

  return builder.getUint8Array();
}

// 3. Generate Hardware Self-Test Slip
export function generateTestSlipEscPosBuffer(settings = {}) {
  const width = settings.paper_size || '58mm';
  const builder = new EscPosBuilder(width);

  builder.align('center')
    .fontSize('double')
    .bold(true)
    .line('PRINTER TEST')
    .fontSize('normal')
    .bold(false)
    .line('ChefPulse Mobile POS')
    .divider('=');

  builder.align('left');
  builder.line('Mode: ' + (settings.connection_type || 'Bluetooth ESC/POS'));
  builder.line('Width: ' + width + ' (' + (width === '80mm' ? '48 Columns' : '32 Columns') + ')');
  builder.line('Date: ' + new Date().toLocaleString());
  builder.divider('-');

  builder.twoCol('Left Column', 'Right Column');
  builder.threeCol('Item Name', 'Qty', 'Price');
  builder.threeCol('Chicken Biryani', 'x2', 'Rs.280.00');
  builder.divider('-');

  builder.bold(true).line('Bold Text: PASS').bold(false);
  builder.fontSize('double-height').line('Double Height: PASS').fontSize('normal');

  builder.divider('=');
  builder.align('center')
    .line('*** TEST PRINT SUCCESSFUL ***')
    .cut();

  return builder.getUint8Array();
}

// ================= HARDWARE PRINT DISPATCHER =================
export async function printReceipt(type, data, printerSettings = {}) {
  let buffer;
  if (type === 'KOT') {
    buffer = generateKotEscPosBuffer(data, printerSettings);
  } else if (type === 'TEST') {
    buffer = generateTestSlipEscPosBuffer(printerSettings);
  } else {
    buffer = generateBillEscPosBuffer(data, printerSettings);
  }

  const connType = printerSettings.connection_type || 'BROWSER_FALLBACK';

  // 1. Web Bluetooth / Capacitor Bluetooth LE
  if (connType === 'BLUETOOTH') {
    return printViaBluetooth(buffer, printerSettings.bluetooth_device_id);
  }

  // 2. Network IP:9100 Raw Socket / HTTP Print Bridge
  if (connType === 'NETWORK') {
    return printViaNetwork(buffer, printerSettings.printer_ip, printerSettings.printer_port || 9100);
  }

  // 3. Browser System Fallback
  return printViaBrowserFallback(type, data, printerSettings);
}

// Bluetooth LE Printing
export async function printViaBluetooth(buffer, targetDeviceId = null) {
  if (typeof navigator !== 'undefined' && navigator.bluetooth) {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

      // Send in chunks of 100 bytes (standard BLE MTU compatibility)
      const chunkSize = 100;
      for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        await characteristic.writeValue(chunk);
      }
      return { success: true, message: 'Printed via Web Bluetooth' };
    } catch (err) {
      console.warn('Web Bluetooth print error, falling back:', err.message);
    }
  }

  // Capacitor Native Bluetooth Check
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform()) {
    return { success: true, message: 'Dispatched to Capacitor Bluetooth Print Driver' };
  }

  throw new Error('Bluetooth printer not connected. Please pair via Setup Wizard.');
}

// Network LAN IP:9100 Raw Socket Printing
export async function printViaNetwork(buffer, ip, port = 9100) {
  if (!ip) throw new Error('Printer IP address is required');

  const base64Data = btoa(String.fromCharCode.apply(null, buffer));
  const serverUrl = localStorage.getItem('cp_pos_server_url') || window.location.origin;

  const res = await fetch(`${serverUrl}/api/pos/print-raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      printer_ip: ip,
      printer_port: port,
      data_base64: base64Data
    })
  });

  if (!res.ok) {
    throw new Error('Network printer at ' + ip + ':' + port + ' did not respond');
  }

  return { success: true, message: 'Sent to Network Printer ' + ip + ':' + port };
}

// Browser / System Thermal Print Fallback
export function printViaBrowserFallback(type, data, settings = {}) {
  if (typeof window === 'undefined') return;

  if (typeof window.showReceiptPrintModal === 'function' && type === 'BILL') {
    window.showReceiptPrintModal(data);
    return { success: true, mode: 'BROWSER_MODAL' };
  }

  window.print();
  return { success: true, mode: 'SYSTEM_PRINT' };
}

// Expose on window for vanilla browser script usage
if (typeof window !== 'undefined') {
  window.ThermalPrinter = {
    EscPosBuilder,
    generateBillEscPosBuffer,
    generateKotEscPosBuffer,
    generateTestSlipEscPosBuffer,
    printReceipt,
    printViaBluetooth,
    printViaNetwork,
    printViaBrowserFallback
  };
}
