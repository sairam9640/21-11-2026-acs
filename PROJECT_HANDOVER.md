# ACS (Auto Configuration Server) Platform – Complete Developer Handover Guide

> **Repository URL:** [https://github.com/sairam9640/21-11-2026-acs.git](https://github.com/sairam9640/21-11-2026-acs.git)  
> **Default Branch:** `main`  
> **Target Environment:** Node.js 22 LTS, TypeScript, Express.js, MongoDB 7.0, Redis, Docker, Nginx  

---

## 1. Project Overview & Business Vision

This project is a high-performance, carrier-grade **Auto Configuration Server (ACS)** designed specifically for Internet Service Providers (ISPs). It automates the remote management, provisioning, diagnostics, optical monitoring, and firmware management of Customer Premises Equipment (CPE) such as GPON/EPON ONTs and FTTH routers using standard telecom broadband protocols.

### Core Telecom Protocols Supported:
- **TR-069 (CWMP):** Complete native SOAP/XML communication over HTTP/HTTPS on Port 7547.
- **TR-369 (USP):** User Services Platform with WebSocket protocol support.
- **Data Models:** TR-098 (`InternetGatewayDevice.`) and TR-181 (`Device.`) with automatic cross-vendor path translation.
- **Authentication:** RFC 2617 HTTP Digest Authentication on inbound CPE Inform requests.
- **Diagnostics:** Remote `IPPingDiagnostics` and `TraceRouteDiagnostics` RPC triggers.

---

## 2. Multi-Tenant Operator Hierarchy

The system enforces strict multi-tenant isolation with zero cross-tenant data leakage:

```
                            ┌────────────────────────────────┐
                            │          SUPER ADMIN           │
                            │   (Global Oversight & Health)  │
                            └───────────────┬────────────────┘
                                            │
                   ┌────────────────────────┴────────────────────────┐
                   │                                                 │
          ┌────────▼───────────────┐                        ┌────────▼───────────────┐
          │      OPERATOR 1        │                        │      OPERATOR 2        │
          │  (Dedicated Tenant)    │                        │  (Dedicated Tenant)    │
          ├────────────────────────┤                        ├────────────────────────┤
          │ ├── Customers          │                        │ ├── Customers          │
          │ ├── ONT Devices        │                        │ ├── ONT Devices        │
          │ ├── Optical Telemetry  │                        │ ├── Optical Telemetry  │
          │ ├── Provisioning (ZTP) │                        │ ├── Provisioning (ZTP) │
          │ └── Firmware Profiles  │                        │ └── Firmware Profiles  │
          └────────────────────────┘                        └────────────────────────┘
```

### Isolation Guarantees:
1. **Compound Unique Indexes:** MongoDB enforces `{ tenantId: 1, serialNumber: 1 }` on `Device`, guaranteeing tenant boundary integrity.
2. **Dedicated CWMP Routing:** ONTs connect via dedicated slugs `/tr069/:operatorSlug` or subdomains. Unspecified CPEs hitting root IP are safely quarantined into `PendingDeviceMapping` with reason `'UNMAPPED_TENANT'`.
3. **Cross-Tenant Guard:** If an ONT registered under Operator 1 communicates with Operator 2's slug, it is flagged with `isTenantMismatch = true`, quarantined, and Operator 1's device is NEVER mutated or leaked.
4. **No Fallbacks:** API endpoints strictly reject unauthenticated requests without `tenantId` with `HTTP 403 Forbidden` (no hardcoded default IDs).

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend Runtime** | Node.js 20+ (ESM), TypeScript | High-concurrency event-driven server |
| **HTTP Framework** | Express.js 4.x | REST APIs & Inbound CWMP Port 7547 router |
| **CWMP Parser** | `fast-xml-parser` | High-throughput, streaming SOAP/XML parser |
| **Database** | MongoDB 7.x (via Mongoose 8.x) | Primary persistent store with tenant scoping |
| **Distributed Cache** | Redis 7.x (ioredis) | Multi-instance CWMP session state & rate limits |
| **Frontend** | React 18, Vite, Tailwind CSS | Operator & Super Admin management portals |
| **Observability** | Prometheus Exporter (`/api/v1/metrics`) | Real-time telemetry, inform rates, error counters |
| **Containerization** | Docker, Docker Compose, Nginx | Multi-service orchestration and reverse proxy |

---

## 4. Completed Implementation Phases (Phases 1 to 5)

All 5 core roadmap phases and multi-tenant operator isolation have been developed, verified with automated tests, and pushed to GitHub:

- **Phase 1: Security Hardening & Zero-Trust Foundation**
  - Eliminated auth bypasses, enforced Bcrypt hashing for credentials.
  - Implemented pagination and XML entity escaping (`escapeXml`) to prevent XML injection / XXE.
  - Enforced compound unique indexes on MongoDB collections.
- **Phase 2: Distributed CWMP Sessions & Port 7547 Isolation**
  - Redis session caching (`cwmp:session:<id>` and `cwmp:conn:<ip:port>`).
  - RFC 2617 HTTP Digest Authentication on inbound CPE POST requests.
  - Connection Request client challenge handshake for on-demand device wake-ups.
- **Phase 3: Enterprise Firmware Upgrade Engine**
  - `<cwmp:Download>` RPC generator with `TransferComplete` handler.
  - Safety pre-flight checks: power loss guards, model verification, downgrade prevention.
  - Secure streaming binary download endpoint (`/firmware/download/:firmwareId`).
- **Phase 4: Zero-Touch Provisioning (ZTP) & Multi-Vendor Normalization**
  - Automated customer-to-ONT binding via PPPoE username / VLAN ID.
  - Multi-vendor profile adapters for Huawei, ZTE, Syrotech, Netlink, Genexis, V-Sol, DBC.
  - Enforced baseline 300s periodic inform interval on newly ingested CPEs.
- **Phase 5: Observability, Diagnostics & Production Infrastructure**
  - TR-069 `IPPingDiagnostics` and `TraceRouteDiagnostics` RPC integration.
  - Comprehensive Prometheus metrics endpoint in `metricsService.ts`.
  - Production `docker-compose.yml` with port 7547 mapping and volume persistence.
  - Production Nginx reverse proxy configuration (`deploy/nginx/acs.conf`).
- **Critical Isolation Hardening:**
  - Removed `{ status: 'active' }` wildcard fallback in `resolveTenant`.
  - Added Super Admin Executive Dashboard with global operator breakdown and operator-scoped drill-down.
  - Granular reporting failure monitor (`GET /superadmin/reporting-failures`).

---

## 5. Repository Structure & Key Files

```
ACS/
├── backend/
│   ├── src/
│   │   ├── middleware/
│   │   │   ├── auth.ts              # JWT authentication & token generation
│   │   │   ├── cwmpAuth.ts          # RFC 2617 HTTP Digest Auth for Port 7547
│   │   │   ├── rbac.ts              # Role-Based Access Control
│   │   │   └── tenantIsolation.ts   # Multi-tenant scoping middleware
│   │   ├── models/
│   │   │   ├── Customer.ts          # Subscriber profiles, PPPoE credentials
│   │   │   ├── Device.ts            # ONT inventory, optical status, WiFi/WAN
│   │   │   ├── DeviceCommand.ts     # Queued CWMP RPC commands
│   │   │   ├── PendingDeviceMapping.ts # Quarantine pool for unmapped CPEs
│   │   │   ├── Tenant.ts            # Operator profiles and plan settings
│   │   │   └── User.ts              # User accounts & RBAC roles
│   │   ├── routes/
│   │   │   ├── authRoutes.ts        # Login & authentication
│   │   │   ├── cwmpRoutes.ts        # Native Port 7547 TR-069 endpoints
│   │   │   ├── operatorRoutes.ts    # Operator NOC device & subscriber APIs
│   │   │   └── superAdminRoutes.ts  # Super Admin dashboard & tenant APIs
│   │   └── services/
│   │       ├── cwmpService.ts       # Core CWMP engine (Informs, GPV, SPV)
│   │       ├── cwmpXmlParser.ts     # XML parsing & escaping
│   │       ├── cwmpVendorProfiles.ts# Vendor detection & path normalization
│   │       ├── firmwareService.ts   # Firmware download & verification
│   │       ├── metricsService.ts    # Prometheus metrics exporter
│   │       └── ztpService.ts        # Zero-Touch Provisioning evaluator
│   └── tests/                       # 48 Automated Vitest test suites
├── deploy/
│   └── nginx/
│       └── acs.conf                 # Nginx reverse proxy config
├── docker-compose.yml               # Production multi-container spec
└── README.md
```

---

## 6. Local Setup & Testing Quickstart

### Prerequisites:
- Node.js 20.x or higher
- Git
- MongoDB & Redis (or run via Docker)

### Step 1: Clone Repository
```bash
git clone https://github.com/sairam9640/21-11-2026-acs.git
cd 21-11-2026-acs/backend
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Run Automated Test Suites
All unit tests are configured with Vitest and can be executed offline:
```bash
npx vitest run tests/operatorIsolationAndReporting.test.ts tests/phase2Hardening.test.ts tests/firmwareUpgrade.test.ts tests/ztpAndVendorNormalization.test.ts tests/phase5ObservabilityAndDiagnostics.test.ts
```
Expected result: **31 passed (31)** with 0 failures.

### Step 4: Run Type Checker
```bash
npx tsc --noEmit
```
Expected result: 0 errors.

### Step 5: Start Development Server
```bash
npm run dev
```
The server will start listening on Port 5000 (API & Web) and Port 7547 (CWMP TR-069).

---

## 7. Cloud Deployment & Real ONT Testing Guide

### VPS & Network Requirements:
- **Server:** 4 vCPU, 4–6 GB RAM, Ubuntu 22.04 LTS (Contabo / Hostinger India DC).
- **Public IP:** 1 Static Dedicated IPv4 (Mandatory for TR-069 ONTs).
- **Ports to open:**
  - `22/tcp`: Admin SSH
  - `80/tcp`: Let's Encrypt SSL
  - `443/tcp`: Web UI & REST APIs (Proxied through Cloudflare Orange Cloud)
  - `7547/tcp`: TR-069 Inbound Inform Traffic (Cloudflare Grey Cloud / Direct DNS)

### ONT Onboarding Parameters:
Configure the following in the ONT Web GUI under Management -> TR-069:
- **ACS URL:** `http://tr069.yourdomain.com:7547/tr069/<operator-slug>`
- **ACS Username:** `acs_user`
- **ACS Password:** `<configured-in-env-or-operator-settings>`
- **Periodic Inform Enable:** `True`
- **Periodic Inform Interval:** `300` (or `180` during lab testing)

---

## 8. Immediate Next Steps for Incoming Developer

1. **Frontend Integration:**
   - Connect Frontend React dashboard to `/api/v1/superadmin/dashboard` and `/api/v1/operator/devices`.
   - Implement the Super Admin operator drill-down selector.
2. **Deploy to Pilot VPS:**
   - Use `docker-compose.yml` and `deploy/nginx/acs.conf` on a live VPS with a dedicated static IP.
3. **Connect Pilot Test Equipment:**
   - Point 1 physical ONT from Operator 1 and 1 physical ONT from Operator 2.
   - Verify real-time optical power (Rx/Tx dBm) and WiFi status ingestion.
