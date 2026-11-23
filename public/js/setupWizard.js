// public/js/setupWizard.js - 4-Step Mobile Setup & Portal Data Sync Wizard
// Mirror of src/services/setupWizard.js for browser / WebView usage
import { pullMobileBootstrap, registerTerminalWithPortal, startBackgroundSync } from './syncEngine.js';
import { printReceipt } from './thermalPrinter.js';

let currentWizardStep = 1;

export function isMobileSetupCompleted() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('cp_mobile_setup_completed') === 'true';
}

export function openSetupWizard(step = 1) {
  currentWizardStep = step;
  const modal = document.getElementById('mobile-setup-wizard');
  if (!modal) return;

  // Initialize input values from storage or location
  const sUrlInput = document.getElementById('wiz-server-url');
  if (sUrlInput && !sUrlInput.value) {
    sUrlInput.value = localStorage.getItem('cp_pos_server_url') || window.location.origin;
  }
  const tIdInput = document.getElementById('wiz-terminal-id');
  if (tIdInput && !tIdInput.value) {
    tIdInput.value = localStorage.getItem('cp_pos_terminal_id') || 'MOB-COUNTER-01';
  }

  showWizardStep(step);
  modal.classList.remove('hidden');
}

export function closeSetupWizard() {
  const modal = document.getElementById('mobile-setup-wizard');
  if (modal) modal.classList.add('hidden');
}

export function showWizardStep(step) {
  currentWizardStep = step;
  for (let i = 1; i <= 4; i++) {
    const pane = document.getElementById(`wiz-step-${i}`);
    const indicator = document.getElementById(`wiz-indicator-${i}`);
    if (pane) pane.classList.toggle('hidden', i !== step);
    if (indicator) {
      if (i === step) {
        indicator.className = "flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-bold text-xs ring-4 ring-amber-500/20";
      } else if (i < step) {
        indicator.className = "flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs";
        indicator.innerText = "✓";
      } else {
        indicator.className = "flex items-center justify-center w-7 h-7 rounded-full bg-slate-800 text-slate-500 font-bold text-xs";
        indicator.innerText = String(i);
      }
    }
  }
}

// STEP 1: Connect & Register Terminal
export async function handleWizardStep1(e) {
  if (e) e.preventDefault();
  const serverUrl = document.getElementById('wiz-server-url')?.value.trim();
  const terminalId = document.getElementById('wiz-terminal-id')?.value.trim() || 'MOB-COUNTER-01';
  const adminPin = document.getElementById('wiz-admin-pin')?.value.trim() || '1234';
  const statusMsg = document.getElementById('wiz-step1-status');

  if (!serverUrl) {
    alert('Please enter your Web Portal Server URL');
    return;
  }

  if (statusMsg) {
    statusMsg.className = "text-xs text-amber-400 flex items-center justify-center gap-1.5 py-1";
    statusMsg.innerHTML = `<span class="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></span> Connecting to ${serverUrl}...`;
  }

  try {
    const regResult = await registerTerminalWithPortal({
      serverUrl,
      terminal_id: terminalId,
      device_name: terminalId,
      mode: 'BILLING_COUNTER',
      admin_pin: adminPin
    });

    if (statusMsg) {
      statusMsg.className = "text-xs text-emerald-400 font-bold py-1";
      statusMsg.innerText = `✓ Connected! Registered as ${terminalId} (${regResult.terminal?.invoice_prefix || 'MOB1-'})`;
    }

    setTimeout(() => {
      showWizardStep(2);
      startAutomatedBootstrapPull(serverUrl, terminalId);
    }, 700);
  } catch (err) {
    if (statusMsg) {
      statusMsg.className = "text-xs text-red-400 font-bold py-1";
      statusMsg.innerText = `✗ Connection failed: ${err.message}. Ensure phone and PC are on same Wi-Fi.`;
    }
  }
}

// STEP 2: Automated Data Pull Progress Checklist
export async function startAutomatedBootstrapPull(serverUrl, terminalId) {
  const checkOutlet = document.getElementById('wiz-check-outlet');
  const checkTables = document.getElementById('wiz-check-tables');
  const checkCatalog = document.getElementById('wiz-check-catalog');
  const checkStaff = document.getElementById('wiz-check-staff');
  const continueBtn = document.getElementById('wiz-step2-continue-btn');

  const setItemDone = (el, text) => {
    if (!el) return;
    el.innerHTML = `
      <span class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
      <span class="text-slate-200 font-semibold">${text}</span>
    `;
  };

  try {
    if (checkOutlet) checkOutlet.innerHTML = `<span class="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0"></span> <span class="text-amber-400">Pulling outlet profile & GST compliance...</span>`;

    const data = await pullMobileBootstrap(serverUrl, terminalId);

    // Animated milestone reveals
    setTimeout(() => {
      setItemDone(checkOutlet, `Outlet Profile: ${data.outlet?.name || 'ChefPulse'} (${data.outlet?.gstin || 'Tax Enabled'})`);
      if (checkTables) checkTables.innerHTML = `<span class="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0"></span> <span class="text-amber-400">Loading floors & tables...</span>`;
    }, 400);

    setTimeout(() => {
      setItemDone(checkTables, `Floor Sections & Tables: ${data.tables?.length || 0} Tables mapped`);
      if (checkCatalog) checkCatalog.innerHTML = `<span class="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0"></span> <span class="text-amber-400">Loading catalog items & tax slabs...</span>`;
    }, 800);

    setTimeout(() => {
      setItemDone(checkCatalog, `Catalog: ${data.catalog?.items?.length || 0} Dishes & ${data.catalog?.categories?.length || 0} Categories cached`);
      if (checkStaff) checkStaff.innerHTML = `<span class="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0"></span> <span class="text-amber-400">Loading staff security PINs...</span>`;
    }, 1200);

    setTimeout(() => {
      setItemDone(checkStaff, `Staff PINs & Invoice Prefix: Prefix ${data.terminal_config?.invoice_prefix || 'MOB1-'} assigned`);
      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.classList.remove('opacity-50', 'pointer-events-none');
        continueBtn.classList.add('bg-amber-500', 'hover:bg-amber-400', 'text-slate-950', 'shadow-lg');
      }
    }, 1600);

  } catch (err) {
    if (checkOutlet) {
      checkOutlet.innerHTML = `<span class="text-red-400 font-bold">Failed to pull bootstrap: ${err.message}</span>`;
    }
  }
}

// STEP 3: Thermal Printer Configuration & Test
export async function handleTestPrint() {
  const paperWidth = document.querySelector('input[name="wiz-paper"]:checked')?.value || '58mm';
  const connType = document.querySelector('input[name="wiz-conn"]:checked')?.value || 'BLUETOOTH';
  const ip = document.getElementById('wiz-printer-ip')?.value.trim() || '192.168.1.200';
  const btn = document.getElementById('wiz-btn-test-print');
  const statusEl = document.getElementById('wiz-print-test-status');

  localStorage.setItem('cp_pos_paper_size', paperWidth);
  localStorage.setItem('cp_pos_printer_type', connType);
  localStorage.setItem('cp_pos_printer_ip', ip);

  if (statusEl) {
    statusEl.className = "text-xs text-amber-400 flex items-center justify-center gap-1.5 py-1";
    statusEl.innerHTML = `<span class="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></span> Sending ESC/POS test slip...`;
  }

  try {
    const res = await printReceipt('TEST', null, {
      paper_size: paperWidth,
      connection_type: connType,
      printer_ip: ip,
      printer_port: 9100
    });

    if (statusEl) {
      statusEl.className = "text-xs text-emerald-400 font-bold py-1";
      statusEl.innerText = `✓ Test Print Dispatched (${connType})!`;
    }
  } catch (err) {
    if (statusEl) {
      statusEl.className = "text-xs text-amber-300 py-1";
      statusEl.innerText = `Slip opened via browser system fallback (${err.message})`;
    }
  }
}

// STEP 4: Terminal Role & Final Launch
export function handleCompleteWizard() {
  const mode = document.querySelector('input[name="wiz-mode"]:checked')?.value || 'BILLING_COUNTER';
  const autoSync = document.getElementById('wiz-auto-sync')?.checked ?? true;

  localStorage.setItem('cp_pos_terminal_mode', mode);
  localStorage.setItem('cp_pos_auto_sync', autoSync ? 'true' : 'false');
  localStorage.setItem('cp_mobile_setup_completed', 'true');

  if (autoSync) {
    startBackgroundSync();
  }

  closeSetupWizard();

  // Reload or switch to appropriate view
  if (typeof window !== 'undefined') {
    if (typeof window.showNotification === 'function') {
      window.showNotification('🚀 Mobile POS Setup Complete! Ready for Offline-First Billing.');
    }
    if (typeof window.loadAllData === 'function') {
      window.loadAllData();
    }
    if (typeof window.renderApp === 'function') {
      window.renderApp();
    }
  }
}

// Expose on window
if (typeof window !== 'undefined') {
  window.SetupWizard = {
    openSetupWizard,
    closeSetupWizard,
    showWizardStep,
    handleWizardStep1,
    startAutomatedBootstrapPull,
    handleTestPrint,
    handleCompleteWizard,
    isMobileSetupCompleted
  };
}
