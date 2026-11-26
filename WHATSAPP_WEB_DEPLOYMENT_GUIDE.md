# AI ISP OS — WhatsApp Web Multi-Device & Reverse Proxy Guide (v2.1.0)

## 📌 Executive Summary
This release provides an **authentic, carrier-grade WhatsApp Web Multi-Device client** powered by `@whiskeysockets/baileys` (v6.7.24) running directly inside your Linux VPS. 

It completely **bypasses paid Meta Cloud API gateways** (saving ₹0.50 to ₹1.00+ per message), allowing your ISP platform to send **free dynamic OTPs, invoice receipts, and network alerts** directly from your own WhatsApp account.

---

## 🚀 Key Fixes & Enhancements in this Release

### 1. Authentic WhatsApp Web WebSocket Handshake
- Upgraded `@whiskeysockets/baileys` to latest stable `^6.7.24`.
- Dynamic protocol negotiation against WhatsApp Web version `[ 2, 3000, 1043857760 ]`.
- Live 237-byte encrypted QR token generation accepted by WhatsApp Mobile app.
- Eliminated all fake/mock placeholder numbers (`+919988776655`, `+919949666907`) and dummy confirmation buttons.
- Real phone number automatically extracted from `socket.user.id` upon successful pairing.

### 2. 8-Digit Phone Pairing Code (Camera-Free Pairing)
- Open **WhatsApp** on mobile &rarr; **Settings** &rarr; **Linked Devices** &rarr; **Link a Device** &rarr; **Link with phone number instead**.
- Enter mobile number with country code in ISP Admin &rarr; Click **Get 8-Digit Code**.
- Enter the code displayed on screen (e.g. `RWJ4-1XVP`) into WhatsApp to link instantly without needing a camera.

### 3. Persistent Docker Session Volume
- Auth credentials stored in persistent volume: `wa_session_data:/app/data/wa_auth_session`.
- Container rebuilds and VPS reboots do **NOT** invalidate your login.

### 4. Nginx Reverse Proxy (Eliminating 404 Errors)
- `frontend/Dockerfile` updated to copy `nginx.conf` into `/etc/nginx/conf.d/default.conf`.
- `frontend/nginx.conf` proxies `/api/` to `http://backend:4000` and `/socket.io/` for WebSockets.
- Client-side Single Page Application (SPA) routes handled via `try_files $uri $uri/ /index.html`.

---

## 🛠️ VPS Deployment Instructions

Run the following commands on your Ubuntu VPS:

```bash
cd /root/21-11-2026-acs
git reset --hard
git pull origin main
docker compose build frontend backend
docker compose up -d
```

### Reset Stale Database Sessions (One-Time Clean):
```bash
docker exec -i ai-isp-os-mongodb mongosh acs_db --eval 'db.systemsettings.updateOne({ key: "global_config" }, { $set: { "whatsapp.status": "DISCONNECTED" }, $unset: { "whatsapp.connectedPhone": "", "whatsapp.deviceInfo": "", "whatsapp.qrCodeDataUrl": "", "whatsapp.qrCodeRaw": "" } })'
```

---

## 📱 How to Link Your WhatsApp

1. Open **Super Admin Portal** &rarr; Navigate to **Settings** &rarr; **WhatsApp** tab.
2. You will see:
   - **Live QR Code:** Point your phone camera (*WhatsApp > Linked Devices > Link a Device*).
   - **Phone Pairing Code:** Enter phone number &rarr; click *Get 8-Digit Code* &rarr; enter in WhatsApp.
3. Once linked, the status changes to **Connected (Live)** showing your active mobile number.
4. All Operator login OTPs and billing alerts will dispatch directly from your WhatsApp for **₹0 cost**.
