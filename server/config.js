// server/config.js
import os from 'node:os';

export const PORT = process.env.PORT || 4000;
export const HOST = process.env.HOST || '0.0.0.0';

// Function to find local network IP address (for Android devices on the same Wi-Fi)
export function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}
