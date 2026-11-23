# ChefPulse Restaurant Billing & POS System
### Complete Client & Server Architecture (Windows Server, Ubuntu Server, Android Mobile, & Windows Desktop)

---

## 1. Overview & Architecture

ChefPulse is an end-to-end, real-time Restaurant POS & Billing application designed for high-turnover dining operations:
- **Server:** Runs on **Windows OS** or **Ubuntu Server (Linux)** using Node.js + embedded SQLite (zero external DB configuration).
- **Desktop Client:** Runs on **Windows Desktop** (or Mac/Linux) through Chrome/Edge or as an installed desktop app.
- **Mobile Client:** Runs on any **Android Mobile / Tablet / Sunmi POS** device with a responsive touch wizard and 1-tap installation.
- **Real-Time Sync:** WebSockets (`ws://`) instantly update Kitchen KDS screens, Waiter pickup queues, and Billing desks whenever a Captain fires a KOT.

```
                    ┌────────────────────────────────────────────────────────┐
                    │       ChefPulse Central Server (Port 4000)             │
                    │       Runs on Windows or Ubuntu Server                 │
                    │       (Node.js + Embedded SQLite + WebSockets)         │
                    └────────────────────────────────────────────────────────┘
                                               │
                                               │ (Local Restaurant Wi-Fi LAN)
                   ┌───────────────────────────┼───────────────────────────┐
                   ▼                           ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
        │   Floor Captains    │     │     Kitchen KDS     │     │   Cashier Billing   │
        │  (Android Mobiles)  │     │   (Kitchen Tablet)  │     │  (Windows Desktop)  │
        │  • Table map        │     │  • Live KOT board   │     │  • Tax calculation │
        │  • Menu selector    │     │  • Prep timer       │     │  • UPI QR & Cash    │
        │  • Fire KOT         │     │  • Mark Ready       │     │  • Thermal receipt  │
        └─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

---

## 2. Server Setup (Windows)

### Option A: 1-Click Launcher
Double-click `start-windows.bat` in the project root. It will:
1. Verify Node.js is installed.
2. Automatically launch the server on port `4000`.
3. Open the desktop POS view in your browser.

### Option B: Command Prompt / PowerShell
```powershell
cd d:\Project\Project_billing
npm install
npm start
```
The server will output:
```
===========================================================
  🍽️  ChefPulse Restaurant POS & Billing Server Started
===========================================================
  OS Platform:        win32 (x64)
  Local Desktop View: http://localhost:4000
  Mobile Devices:     http://192.168.1.X:4000
  WebSocket Server:   ws://192.168.1.X:4000
===========================================================
```

---

## 3. Server Setup (Ubuntu Linux Server)

### Step 1: Install Node.js (v18+)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
```

### Step 2: Clone or Copy Project Files
```bash
cd /var/www/restaurant_billing
npm install
```

### Step 3: Run as a Background Daemon (Choose PM2 or Systemd)

#### Choice A: Via PM2 (Recommended for quick deployment)
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

#### Choice B: Via Ubuntu Systemd Service (Auto-starts on server reboot)
```bash
sudo cp chefpulse.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable chefpulse
sudo systemctl start chefpulse
sudo systemctl status chefpulse
```

#### Open Firewall Port (if UFW is enabled):
```bash
sudo ufw allow 4000/tcp
```

---

## 4. Client Setup (Android Mobile)

Any Android smartphone (Samsung, Redmi, OnePlus, Vivo) or handheld POS terminal (Sunmi V2, iMin) can connect:

### Method A: 1-Tap PWA Installation (Fastest, zero compile required)
1. Ensure the Android phone is connected to the **same Wi-Fi router** as the server.
2. Open Google Chrome on the Android phone and navigate to:
   ```
   http://<SERVER_IP>:4000
   ```
   *(Example: `http://192.168.1.2:4000` as printed on your server console)*.
3. Chrome will display a banner: **"Add ChefPulse to Home screen"** or tap the 3 dots (⋮) in Chrome and select **"Install App"**.
4. The ChefPulse icon will appear on your Android home screen alongside native apps, operating full-screen with touch ergonomics!

### Method B: Native Android APK Build (via Capacitor)
If you require a standalone `.apk` install file:
```powershell
# 1. Install Capacitor CLI
npm install -D @capacitor/cli @capacitor/core @capacitor/android

# 2. Add Android Project
npx cap add android

# 3. Build & Open in Android Studio
npx cap copy
npx cap open android
```
In Android Studio, click **Build > Build Bundle(s) / APK(s) > Build APK(s)** to generate the `.apk`.

---

## 5. Client Setup (Windows Desktop)

1. On the cashier or admin PC, simply open any browser to:
   ```
   http://localhost:4000
   ```
   *(or `http://<SERVER_IP>:4000` if accessing across LAN)*.
2. In Google Chrome or Microsoft Edge, click the **Install** icon in the address bar to install it as a standalone Windows Desktop application.
3. Connect your USB or Bluetooth 58mm/80mm thermal receipt printer. When settling a bill, clicking **"Print Slip"** opens the print dialogue directly.

---

## 6. Real Restaurant Operational Flow

1. **Captain (Android Mobile):**
   - Captain walks to Table 2, taps **Table 2 (4 Covers)** on mobile screen.
   - Browses menu by categories (*Starters, Mains, Biryani, Breads, Drinks*), taps `+` to add items.
   - Adds cooking instruction (e.g., *"Less spicy, serve Naan hot"*).
   - Taps **"🔥 SEND KOT TO KITCHEN"**.
2. **Kitchen KDS (Kitchen Tablet):**
   - Chef's tablet chimes instantly via WebSocket.
   - KOT #101 appears on screen showing items, quantities, and cooking notes.
   - Chef taps **"🍳 Start Preparing"** (orange state).
   - Once dishes are ready, Chef taps **"✓ Mark Ready for Server Pickup"** (green state).
3. **Waiter Serving (Android Mobile):**
   - Server's mobile notifies: *"Order for Table 2 is READY at pickup!"*.
   - Server collects food from the kitchen window, serves to guests, and taps **"🛎️ Deliver to Table"**.
4. **Cashier Billing (Windows Desktop):**
   - When guests ask for the bill, Cashier selects Table 2.
   - System consolidates all KOTs for Table 2 and computes: Subtotal + CGST (2.5%) + SGST (2.5%).
   - Cashier selects **UPI QR** (customer scans on-screen QR with PhonePe/GPay) or **Cash**.
   - Cashier clicks **"🧾 Settle Payment & Free Table"**.
   - Thermal invoice prints and Table 2 resets back to green (*Available*) instantly across all devices.

---

## 7. File Structure Reference

```
d:\Project\Project_billing\
├── server\
│   ├── config.js             # Port (4000), 0.0.0.0 host, IP detector
│   ├── db.js                 # SQLite engine (node:sqlite), tables & seed data
│   ├── restaurant.db         # Persistent SQLite database file
│   └── server.js             # Express API + WebSocket server
├── public\
│   ├── index.html            # Responsive UI (Android Touch + Desktop POS)
│   ├── app.js                # Frontend REST API client & WebSocket sync
│   ├── manifest.json         # Android PWA configuration
│   ├── sw.js                 # PWA Service worker
│   └── icons\                # App icon assets
├── ecosystem.config.cjs      # PM2 configuration for Ubuntu Linux
├── chefpulse.service         # Systemd service unit for Ubuntu Linux
├── start-windows.bat         # 1-Click launcher for Windows
├── start-ubuntu.sh           # 1-Click launcher for Ubuntu
├── capacitor.config.json     # Configuration for Android APK generation
└── package.json              # Project dependencies & scripts
```
