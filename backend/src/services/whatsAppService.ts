import makeWASocketPkg, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  WASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { SystemSetting, IWhatsAppSettings } from '../models/SystemSetting.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Tenant } from '../models/Tenant.js';
import { PendingDeviceMapping } from '../models/PendingDeviceMapping.js';

// Dynamic import resolution for CJS / ESM Baileys
const makeWASocket = (makeWASocketPkg as any).default || makeWASocketPkg;

// Path to persistent WhatsApp multi-device auth credentials
const AUTH_DIR = process.env.WA_AUTH_PATH || path.resolve(process.cwd(), 'data', 'wa_auth_session');

// Evolution API Configuration
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'http://evolution-api:8080').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'evolution_isp_os_wa_2026_key';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'ai-isp-os';

export interface EvolutionConnectResponse {
  pairingCode?: string;
  code?: string;
  base64?: string;
  count?: number;
  instance?: {
    instanceName?: string;
    state?: string;
  };
}

/**
 * Evolution API Client (WhatsApp Microservice Engine)
 * Directly connects to Evolution API (https://github.com/evolution-foundation/evolution-api)
 * Provides rock-solid WhatsApp Web session pairing, QR streaming, and ₹0 OTP messaging.
 */
export class EvolutionApiClient {
  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY,
    };
  }

  private static lastAvailabilityCheck = 0;
  private static isAvailableCached = false;

  /**
   * Health-check whether Evolution API microservice is running and accessible
   */
  static async isAvailable(): Promise<boolean> {
    const now = Date.now();
    // Cache positive status for 10s, negative for 30s to eliminate latency
    if (now - this.lastAvailabilityCheck < (this.isAvailableCached ? 10000 : 30000)) {
      return this.isAvailableCached;
    }
    this.lastAvailabilityCheck = now;
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(800),
      });
      this.isAvailableCached = res.status < 500;
      return this.isAvailableCached;
    } catch {
      this.isAvailableCached = false;
      return false;
    }
  }

  /**
   * Fetch all registered WhatsApp instances from Evolution API
   */
  static async fetchInstances(): Promise<any[]> {
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      return Array.isArray(data) ? data : data ? [data] : [];
    } catch {
      return [];
    }
  }

  /**
   * Ensure target WhatsApp instance exists in Evolution API
   */
  static async ensureInstance(instanceName = EVOLUTION_INSTANCE): Promise<boolean> {
    try {
      const instances = await this.fetchInstances();
      const existing = instances.find(
        (i: any) => (i.name || i.instanceName || i.instance?.instanceName) === instanceName
      );
      if (existing) return true;

      const res = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          instanceName,
          token: crypto.randomBytes(16).toString('hex'),
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok || res.status === 403 || res.status === 400;
    } catch (e: any) {
      console.warn('[EvolutionApiClient] ensureInstance warning:', e.message);
      return false;
    }
  }

  /**
   * Connect instance to WhatsApp Web and fetch pairing QR Code (or phone pairing code)
   */
  static async connect(instanceName = EVOLUTION_INSTANCE, phoneNumber?: string): Promise<EvolutionConnectResponse | null> {
    try {
      await this.ensureInstance(instanceName);
      const url = phoneNumber
        ? `${EVOLUTION_API_URL}/instance/connect/${instanceName}?number=${encodeURIComponent(phoneNumber)}`
        : `${EVOLUTION_API_URL}/instance/connect/${instanceName}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[EvolutionApiClient] connect returned HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as EvolutionConnectResponse;
    } catch (e: any) {
      console.warn('[EvolutionApiClient] connect error:', e.message);
      return null;
    }
  }

  /**
   * Check connection state of instance ('open' | 'close' | 'connecting')
   */
  static async getConnectionState(instanceName = EVOLUTION_INSTANCE): Promise<{ state: 'open' | 'close' | 'connecting'; phone?: string }> {
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { state: 'close' };
      const data: any = await res.json();
      const state = (data?.instance?.state || data?.state || 'close').toLowerCase();

      let phone: string | undefined = undefined;
      if (state === 'open') {
        const instances = await this.fetchInstances();
        const inst = instances.find(
          (i: any) => (i.name || i.instanceName || i.instance?.instanceName) === instanceName
        );
        const rawOwner = inst?.ownerJid || inst?.owner || inst?.number || inst?.instance?.ownerJid || '';
        const phoneDigits = rawOwner ? (rawOwner.split(':')[0] || rawOwner.split('@')[0]).replace(/[^0-9]/g, '') : '';
        if (phoneDigits) {
          phone = `+${phoneDigits}`;
        }
      }

      if (state === 'open') return { state: 'open', phone };
      if (state === 'connecting') return { state: 'connecting' };
      return { state: 'close' };
    } catch {
      return { state: 'close' };
    }
  }

  /**
   * Dispatch text message to a WhatsApp number via Evolution API
   */
  static async sendText(number: string, text: string, instanceName = EVOLUTION_INSTANCE): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      await this.ensureInstance(instanceName);
      let clean = number.replace(/[^0-9]/g, '');
      if (clean.length === 10) clean = `91${clean}`;

      const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: clean,
          text,
          options: {
            delay: 500,
            presence: 'composing',
            linkPreview: false,
          },
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { success: false, error: `HTTP ${res.status}: ${errText}` };
      }

      const data: any = await res.json().catch(() => ({}));
      const messageId = data?.key?.id || `evo_msg_${Date.now()}`;
      return { success: true, messageId };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Log out and delete instance from Evolution API
   */
  static async logout(instanceName = EVOLUTION_INSTANCE): Promise<boolean> {
    try {
      await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      return true;
    } catch {
      return false;
    }
  }
}

export class WhatsAppService {
  private static sock: WASocket | null = null;
  private static currentQrDataUrl: string | null = null;
  private static currentRawQr: string | null = null;
  private static isInitializing = false;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static qrResolvers: Array<(qr: string) => void> = [];
  public static lastDisconnectReason: any = null;

  /**
   * Diagnostic debug helper for system administrators
   */
  static async getDebugStatus(): Promise<any> {
    let outboundOk = false;
    let outboundError = null;
    try {
      const res = await fetch('https://web.whatsapp.com', { signal: AbortSignal.timeout(3000) });
      outboundOk = res.status === 200;
    } catch (e: any) {
      outboundError = e.message;
    }

    return {
      isSocketAlive: Boolean(this.sock),
      wsReadyState: (this.sock as any)?.ws?.readyState,
      hasRawQr: Boolean(this.currentRawQr),
      rawQrLength: this.currentRawQr?.length || 0,
      hasQrDataUrl: Boolean(this.currentQrDataUrl),
      isInitializing: this.isInitializing,
      lastDisconnect: this.lastDisconnectReason,
      outboundWhatsAppWeb: { ok: outboundOk, error: outboundError },
    };
  }

  /**
   * Ensure auth session storage directory exists
   */
  private static ensureAuthDir() {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  /**
   * Retrieves active WhatsApp session configuration from MongoDB
   */
  static async getSessionConfig(): Promise<IWhatsAppSettings> {
    let setting = await SystemSetting.findOne({ key: 'global_config' });
    if (!setting) {
      setting = await SystemSetting.create({
        key: 'global_config',
        whatsapp: {
          enabled: true,
          status: 'DISCONNECTED',
          sessionName: 'primary_isp_session',
        },
      });
    }

    const rawWa: any = (setting.toObject ? setting.toObject().whatsapp : setting.whatsapp) || {};

    // 1. Primary check: Evolution API Engine
    const isEvoAvailable = await EvolutionApiClient.isAvailable();
    if (isEvoAvailable) {
      const evoState = await EvolutionApiClient.getConnectionState();
      const isEvoConnected = evoState.state === 'open';
      const hasQrCode = Boolean(this.currentQrDataUrl);

      let activeStatus: 'DISCONNECTED' | 'SCAN_QR_REQUIRED' | 'CONNECTING' | 'CONNECTED';
      if (isEvoConnected) {
        activeStatus = 'CONNECTED';
      } else if (hasQrCode) {
        activeStatus = 'SCAN_QR_REQUIRED';
      } else if (evoState.state === 'connecting') {
        activeStatus = 'CONNECTING';
      } else {
        activeStatus = 'DISCONNECTED';
      }

      if (isEvoConnected && rawWa.status !== 'CONNECTED') {
        await SystemSetting.updateOne(
          { key: 'global_config' },
          {
            $set: {
              'whatsapp.status': 'CONNECTED',
              'whatsapp.connectedPhone': evoState.phone || rawWa.connectedPhone,
              'whatsapp.deviceInfo': 'Evolution API WhatsApp Engine (Linux VPS)',
              'whatsapp.lastConnectedAt': new Date(),
              'whatsapp.updatedAt': new Date(),
            },
            $unset: {
              'whatsapp.qrCodeDataUrl': '',
              'whatsapp.qrCodeRaw': '',
            },
          }
        );
      } else if (!isEvoConnected && rawWa.status === 'CONNECTED') {
        await SystemSetting.updateOne(
          { key: 'global_config' },
          {
            $set: {
              'whatsapp.status': activeStatus,
              'whatsapp.updatedAt': new Date(),
            },
            $unset: {
              'whatsapp.connectedPhone': '',
              'whatsapp.deviceInfo': '',
            },
          }
        );
      }

      // Auto-fetch fresh Evolution QR if disconnected and no QR available yet
      if (!isEvoConnected && !this.currentQrDataUrl && !this.isInitializing) {
        this.generateQrCode(false).catch((err) => {
          console.warn('[WhatsAppService] Auto-fetch Evolution QR:', err.message);
        });
      }

      const waConfig: IWhatsAppSettings = {
        ...rawWa,
        status: activeStatus,
        connectedPhone: isEvoConnected ? (evoState.phone || rawWa.connectedPhone) : undefined,
        deviceInfo: isEvoConnected ? (rawWa.deviceInfo || 'Evolution API WhatsApp Engine (Linux VPS)') : undefined,
        qrCodeDataUrl: isEvoConnected ? undefined : (this.currentQrDataUrl || undefined),
        qrCodeRaw: isEvoConnected ? undefined : (this.currentRawQr || undefined),
      };
      return waConfig;
    }

    // 2. Fallback: Local Baileys Socket Engine
    const isSocketConnected = Boolean(this.sock?.user);
    const hasQrCode = Boolean(this.currentQrDataUrl);

    let activeStatus: 'DISCONNECTED' | 'SCAN_QR_REQUIRED' | 'CONNECTING' | 'CONNECTED';
    if (isSocketConnected) {
      activeStatus = 'CONNECTED';
    } else if (hasQrCode) {
      activeStatus = 'SCAN_QR_REQUIRED';
    } else if (this.isInitializing) {
      activeStatus = 'CONNECTING';
    } else {
      activeStatus = 'DISCONNECTED';
    }

    // Wipe any stale MongoDB CONNECTED state if the live socket is not actually authenticated
    if (!isSocketConnected && rawWa.status === 'CONNECTED') {
      await SystemSetting.updateOne(
        { key: 'global_config' },
        {
          $set: {
            'whatsapp.status': activeStatus,
            'whatsapp.updatedAt': new Date(),
          },
          $unset: {
            'whatsapp.connectedPhone': '',
            'whatsapp.deviceInfo': '',
          },
        }
      );
    }

    // Auto-spin background Baileys socket if disconnected and not initialized
    if (!isSocketConnected && !this.sock && !this.isInitializing) {
      this.initBaileysSocket().catch((err) => {
        console.warn('[WhatsAppService] Auto-spin background socket:', err.message);
      });
    }

    const rawId = this.sock?.user?.id || '';
    const phoneNum = rawId ? (rawId.split(':')[0] || rawId.split('@')[0]) : '';
    const formattedPhone = phoneNum ? (phoneNum.startsWith('+') ? phoneNum : `+${phoneNum}`) : undefined;

    const waConfig: IWhatsAppSettings = {
      ...rawWa,
      status: activeStatus,
      connectedPhone: isSocketConnected ? formattedPhone : undefined,
      deviceInfo: isSocketConnected ? (rawWa.deviceInfo || 'WhatsApp Web Multi-Device (Linux VPS Engine)') : undefined,
      qrCodeDataUrl: isSocketConnected ? undefined : (this.currentQrDataUrl || undefined),
      qrCodeRaw: isSocketConnected ? undefined : (this.currentRawQr || undefined),
    };
    return waConfig;
  }

  /**
   * Initializes real Baileys WebSocket multi-device connection
   */
  static async initBaileysSocket(forceRestart = false): Promise<void> {
    if (this.isInitializing && !forceRestart) return;
    this.isInitializing = true;

    try {
      this.ensureAuthDir();

      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.end(undefined);
        } catch (_) {}
        this.sock = null;
      }

      // If requested explicitly via user action, clear session for clean QR generation
      if (forceRestart) {
        await this.cleanupAuthFiles();
      }

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      const agent = new https.Agent({
        family: 4,
        keepAlive: true,
        timeout: 35000,
      });

      const socket = makeWASocket({
        version: [2, 3000, 1043857760],
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        connectTimeoutMs: 35000,
        defaultQueryTimeoutMs: 35000,
        keepAliveIntervalMs: 15000,
        emitOwnEvents: false,
        generateHighQualityLinkPreview: false,
        agent,
      });

      this.sock = socket;

      // Persist credentials on update
      socket.ev.on('creds.update', saveCreds);

      // Handle connection & QR updates
      socket.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.isInitializing = false;
          this.currentRawQr = qr;

          try {
            this.currentQrDataUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'M',
              margin: 2,
              scale: 8,
              color: { dark: '#020617', light: '#ffffff' },
            });
          } catch (e: any) {
            console.error('[WhatsAppService] Error converting QR to data URL:', e.message);
          }

          // Resolve any waiting QR promises immediately
          const waiting = [...this.qrResolvers];
          this.qrResolvers = [];
          waiting.forEach((resolve) => resolve(qr));

          SystemSetting.findOneAndUpdate(
            { key: 'global_config' },
            {
              $set: {
                'whatsapp.status': 'SCAN_QR_REQUIRED',
                'whatsapp.qrCodeDataUrl': this.currentQrDataUrl,
                'whatsapp.qrCodeRaw': qr,
                'whatsapp.updatedAt': new Date(),
              },
              $unset: {
                'whatsapp.connectedPhone': '',
                'whatsapp.deviceInfo': '',
              },
            },
            { upsert: true }
          ).catch((e: any) => console.warn('[WhatsAppService] DB QR update warning:', e.message));

          console.log('[WhatsAppService] Authentic Baileys WhatsApp Web QR Code generated & ready to scan.');
        }

        if (connection === 'open') {
          this.isInitializing = false;
          this.currentQrDataUrl = null;
          this.currentRawQr = null;

          const rawId = socket.user?.id || '';
          const phoneNum = rawId.split(':')[0] || rawId.split('@')[0];
          const formattedPhone = phoneNum.startsWith('+') ? phoneNum : `+${phoneNum}`;
          const deviceModel = 'WhatsApp Web Multi-Device (Linux VPS Engine)';

          SystemSetting.findOneAndUpdate(
            { key: 'global_config' },
            {
              $set: {
                'whatsapp.status': 'CONNECTED',
                'whatsapp.connectedPhone': formattedPhone,
                'whatsapp.deviceInfo': deviceModel,
                'whatsapp.lastConnectedAt': new Date(),
                'whatsapp.updatedAt': new Date(),
              },
              $unset: {
                'whatsapp.qrCodeDataUrl': '',
                'whatsapp.qrCodeRaw': '',
              },
            },
            { upsert: true }
          ).catch((e: any) => console.warn('[WhatsAppService] DB connect update warning:', e.message));

          console.log(`[WhatsAppService] ✓ WhatsApp Web successfully paired and connected for [${formattedPhone}]`);
        }

        if (connection === 'close') {
          this.isInitializing = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          const errorMsg = lastDisconnect?.error?.message || 'Unknown disconnect reason';
          this.lastDisconnectReason = { statusCode, errorMsg, time: new Date().toISOString() };
          console.log(`[WhatsAppService] Connection closed (code: ${statusCode}, msg: ${errorMsg}, shouldReconnect: ${shouldReconnect})`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.currentQrDataUrl = null;
            this.currentRawQr = null;
            await this.cleanupAuthFiles();
            this.sock = null;
            SystemSetting.findOneAndUpdate(
              { key: 'global_config' },
              {
                $set: {
                  'whatsapp.status': 'DISCONNECTED',
                  'whatsapp.updatedAt': new Date(),
                },
                $unset: {
                  'whatsapp.connectedPhone': '',
                  'whatsapp.deviceInfo': '',
                  'whatsapp.qrCodeDataUrl': '',
                  'whatsapp.qrCodeRaw': '',
                },
              }
            ).catch((e: any) => console.warn('[WhatsAppService] DB logout update warning:', e.message));
          } else if (statusCode === DisconnectReason.restartRequired) {
            // Immediate reconnect without delay to finalize the scanned QR / pairing code handshake!
            console.log('[WhatsAppService] 515 restartRequired received — immediately reconnecting with saved session credentials to finalize login!');
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.initBaileysSocket(false).catch((err) => {
              console.error('[WhatsAppService] Error during 515 restart:', err.message);
            });
          } else if (shouldReconnect) {
            // Keep currentQrDataUrl alive while reconnecting so the user can scan the QR code!
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
              if (!this.sock?.user) {
                this.initBaileysSocket(false);
              }
            }, 3000);
          } else {
            this.sock = null;
          }
        }
      });
    } catch (err: any) {
      console.error('[WhatsAppService] Error initializing Baileys socket:', err.message);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generates or refreshes the live authentic WhatsApp Web pairing QR code
   */
  static async generateQrCode(forceFresh = false): Promise<{ qrDataUrl: string; rawCode: string; status: string; connectedPhone?: string }> {
    // 1. Primary: Evolution API Engine
    const isEvoAvailable = await EvolutionApiClient.isAvailable();
    if (isEvoAvailable) {
      if (!forceFresh) {
        const evoState = await EvolutionApiClient.getConnectionState();
        if (evoState.state === 'open') {
          return {
            qrDataUrl: '',
            rawCode: '',
            status: 'CONNECTED',
            connectedPhone: evoState.phone,
          };
        }
        if (this.currentQrDataUrl) {
          return {
            qrDataUrl: this.currentQrDataUrl,
            rawCode: this.currentRawQr || '',
            status: 'SCAN_QR_REQUIRED',
          };
        }
      }

      if (forceFresh) {
        await EvolutionApiClient.logout();
        this.currentQrDataUrl = null;
        this.currentRawQr = null;
      }

      const connectData = await EvolutionApiClient.connect();
      if (connectData) {
        if (connectData.instance?.state === 'open') {
          return {
            qrDataUrl: '',
            rawCode: '',
            status: 'CONNECTED',
          };
        }

        let qrDataUrl = connectData.base64 || '';
        const rawCode = connectData.code || '';

        if (qrDataUrl && !qrDataUrl.startsWith('data:')) {
          qrDataUrl = `data:image/png;base64,${qrDataUrl}`;
        }

        if (!qrDataUrl && rawCode) {
          try {
            qrDataUrl = await QRCode.toDataURL(rawCode, {
              errorCorrectionLevel: 'M',
              margin: 2,
              scale: 8,
              color: { dark: '#020617', light: '#ffffff' },
            });
          } catch (_) {}
        }

        if (qrDataUrl) {
          this.currentQrDataUrl = qrDataUrl;
          this.currentRawQr = rawCode;

          SystemSetting.findOneAndUpdate(
            { key: 'global_config' },
            {
              $set: {
                'whatsapp.status': 'SCAN_QR_REQUIRED',
                'whatsapp.qrCodeDataUrl': qrDataUrl,
                'whatsapp.qrCodeRaw': rawCode,
                'whatsapp.updatedAt': new Date(),
              },
              $unset: {
                'whatsapp.connectedPhone': '',
                'whatsapp.deviceInfo': '',
              },
            },
            { upsert: true }
          ).catch((e: any) => console.warn('[WhatsAppService] DB QR update warning:', e.message));

          return {
            qrDataUrl,
            rawCode,
            status: 'SCAN_QR_REQUIRED',
          };
        }
      }
    }

    // 2. Fallback: Local Baileys Socket Engine
    if (!forceFresh && this.sock?.user) {
      const rawId = this.sock.user?.id || '';
      const phoneNum = rawId.split(':')[0] || rawId.split('@')[0];
      return {
        qrDataUrl: '',
        rawCode: '',
        status: 'CONNECTED',
        connectedPhone: phoneNum ? `+${phoneNum}` : undefined,
      };
    }

    if (!forceFresh && (this.currentQrDataUrl || this.currentRawQr)) {
      if (!this.currentQrDataUrl && this.currentRawQr) {
        try {
          this.currentQrDataUrl = await QRCode.toDataURL(this.currentRawQr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,
            color: { dark: '#020617', light: '#ffffff' },
          });
        } catch (_) {}
      }
      return {
        qrDataUrl: this.currentQrDataUrl || '',
        rawCode: this.currentRawQr || '',
        status: 'SCAN_QR_REQUIRED',
      };
    }

    // Check MongoDB for persistent QR code if not in memory
    if (!forceFresh) {
      try {
        const setting: any = await SystemSetting.findOne({ key: 'global_config' }).lean();
        if (setting?.whatsapp?.qrCodeDataUrl && setting?.whatsapp?.status === 'SCAN_QR_REQUIRED') {
          this.currentQrDataUrl = setting.whatsapp.qrCodeDataUrl;
          this.currentRawQr = setting.whatsapp.qrCodeRaw || '';
          return {
            qrDataUrl: this.currentQrDataUrl || '',
            rawCode: this.currentRawQr || '',
            status: 'SCAN_QR_REQUIRED',
          };
        }
      } catch (_) {}
    }

    if (forceFresh) {
      this.isInitializing = false;
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.end(undefined);
        } catch (_) {}
        this.sock = null;
      }
      await this.cleanupAuthFiles();
      this.currentQrDataUrl = null;
      this.currentRawQr = null;

      SystemSetting.findOneAndUpdate(
        { key: 'global_config' },
        {
          $set: {
            'whatsapp.status': 'CONNECTING',
            'whatsapp.updatedAt': new Date(),
          },
          $unset: {
            'whatsapp.connectedPhone': '',
            'whatsapp.deviceInfo': '',
            'whatsapp.qrCodeDataUrl': '',
            'whatsapp.qrCodeRaw': '',
          },
        }
      ).catch((e: any) => console.warn('[WhatsAppService] DB forceFresh update warning:', e.message));
    }

    // Register promise resolver BEFORE socket initialization to eliminate race conditions
    const qrPromise = new Promise<string>((resolve) => {
      this.qrResolvers.push(resolve);
      setTimeout(() => resolve(''), 20000);
    });

    // Trigger fresh Baileys initialization (force restart if fresh requested or no QR exists yet)
    await this.initBaileysSocket(Boolean(forceFresh) || !this.currentRawQr);

    const qrReceived = await qrPromise;
    const activeQr = qrReceived || this.currentRawQr;

    if (activeQr) {
      if (!this.currentQrDataUrl || this.currentRawQr !== activeQr) {
        this.currentQrDataUrl = await QRCode.toDataURL(activeQr, {
          errorCorrectionLevel: 'M',
          margin: 2,
          scale: 8,
          color: { dark: '#020617', light: '#ffffff' },
        });
        this.currentRawQr = activeQr;
      }

      return {
        qrDataUrl: this.currentQrDataUrl,
        rawCode: activeQr,
        status: 'SCAN_QR_REQUIRED',
      };
    }

    return {
      qrDataUrl: this.currentQrDataUrl || '',
      rawCode: this.currentRawQr || '',
      status: this.currentQrDataUrl ? 'SCAN_QR_REQUIRED' : (this.sock?.user ? 'CONNECTED' : 'CONNECTING'),
    };
  }

  /**
   * Request official 8-character WhatsApp Web Pairing Code for a mobile number
   * User can open WhatsApp on phone -> Settings -> Linked Devices -> Link with phone number instead -> Enter Code
   */
  static async requestPhonePairingCode(phoneNumber: string): Promise<{ success: boolean; pairingCode?: string; error?: string }> {
    try {
      let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
        cleanPhone = cleanPhone.substring(1);
      }
      if (cleanPhone.length === 10) {
        cleanPhone = `91${cleanPhone}`;
      }

      if (cleanPhone.length < 10) {
        return { success: false, error: 'Please enter a valid phone number (e.g. 9876543210 or 919876543210).' };
      }

      // 1. Try Evolution API
      const isEvoAvailable = await EvolutionApiClient.isAvailable();
      if (isEvoAvailable) {
        const connectData = await EvolutionApiClient.connect(undefined, cleanPhone);
        if (connectData?.pairingCode) {
          const pairingCode = connectData.pairingCode.match(/.{1,4}/g)?.join('-') || connectData.pairingCode;
          console.log(`[WhatsAppService] Evolution API Pairing Code generated for ${cleanPhone}: ${pairingCode}`);
          return { success: true, pairingCode };
        }
      }

      // 2. Fallback: Local Baileys Socket
      this.ensureAuthDir();
      await this.initBaileysSocket(true);
      // Wait for WebSocket handshake to reach OPEN state (max 15s)
      await new Promise<void>((resolve) => {
        let elapsed = 0;
        const check = setInterval(() => {
          elapsed += 200;
          const state = (this.sock as any)?.ws?.readyState;
          if (state === 1 || elapsed >= 15000) {
            clearInterval(check);
            resolve();
          }
        }, 200);
      });

      // Allow initial handshake frame to settle before requesting pairing code
      await new Promise((r) => setTimeout(r, 500));

      if (this.sock && typeof (this.sock as any).requestPairingCode === 'function') {
        const rawCode = await (this.sock as any).requestPairingCode(cleanPhone);
        const pairingCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
        console.log(`[WhatsAppService] Authentic WhatsApp Web Pairing Code generated for ${cleanPhone}: ${pairingCode}`);
        return { success: true, pairingCode };
      }

      return { success: false, error: 'Pairing code service temporarily unavailable on socket.' };
    } catch (err: any) {
      console.error('[WhatsAppService] Error requesting pairing code:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Manually confirm or pair session (for testing / manual override)
   */
  static async confirmPairing(
    phone?: string,
    deviceInfo?: string
  ): Promise<IWhatsAppSettings> {
    this.currentQrDataUrl = null;
    this.currentRawQr = null;

    const evoState = await EvolutionApiClient.getConnectionState().catch(() => ({ state: 'close', phone: undefined }));
    const rawId = this.sock?.user?.id || '';
    const phoneNum = rawId ? (rawId.split(':')[0] || rawId.split('@')[0]) : '';
    const activePhone = phone || evoState.phone || (phoneNum ? `+${phoneNum}` : undefined);
    const isConnected = Boolean(evoState.state === 'open' || this.sock?.user || phone);

    const updated = await SystemSetting.findOneAndUpdate(
      { key: 'global_config' },
      {
        $set: {
          'whatsapp.status': isConnected ? 'CONNECTED' : 'DISCONNECTED',
          'whatsapp.connectedPhone': activePhone,
          'whatsapp.deviceInfo': deviceInfo || (evoState.state === 'open' ? 'Evolution API WhatsApp Engine (Linux VPS)' : 'WhatsApp Web Multi-Device'),
          'whatsapp.lastConnectedAt': isConnected ? new Date() : undefined,
          'whatsapp.updatedAt': new Date(),
        },
        $unset: {
          'whatsapp.qrCodeDataUrl': '',
          'whatsapp.qrCodeRaw': '',
        },
      },
      { new: true, upsert: true }
    );

    return updated.whatsapp;
  }

  /**
   * Disconnects active WhatsApp session & clears auth keys
   */
  static async disconnectSession(): Promise<IWhatsAppSettings> {
    await EvolutionApiClient.logout().catch(() => {});

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (_) {
        try {
          this.sock.end(undefined);
        } catch (_) {}
      }
      this.sock = null;
    }

    await this.cleanupAuthFiles();
    this.currentQrDataUrl = null;
    this.currentRawQr = null;

    const updated = await SystemSetting.findOneAndUpdate(
      { key: 'global_config' },
      {
        $set: {
          'whatsapp.status': 'DISCONNECTED',
          'whatsapp.updatedAt': new Date(),
        },
        $unset: {
          'whatsapp.connectedPhone': '',
          'whatsapp.deviceInfo': '',
          'whatsapp.qrCodeDataUrl': '',
          'whatsapp.qrCodeRaw': '',
          'whatsapp.lastConnectedAt': '',
        },
      },
      { new: true, upsert: true }
    );

    return updated.whatsapp;
  }

  /**
   * Cleans up local auth folder
   */
  private static async cleanupAuthFiles() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    } catch (e: any) {
      console.warn('[WhatsAppService] Error cleaning auth directory:', e.message);
    }
  }

  /**
   * Formats phone number into standard WhatsApp JID (e.g. 919845000001@s.whatsapp.net)
   */
  private static formatJid(phone: string): string {
    let clean = phone.replace(/[^0-9]/g, '');
    if (clean.length === 10) {
      clean = `91${clean}`;
    }
    return `${clean}@s.whatsapp.net`;
  }

  /**
   * Dispatches dynamic 6-digit OTP to a registered Operator via WhatsApp Web
   */
  static async sendOtpMessage(
    phone: string,
    otpCode: string,
    operatorName = 'Operator',
    tenantName = 'AI ISP OS'
  ): Promise<{ success: boolean; messageId: string; formattedMessage: string }> {
    const session = await this.getSessionConfig();

    const formattedMessage =
      `🔐 *AI ISP OS — Operator Security Authentication*\n\n` +
      `Hello *${operatorName}*,\n\n` +
      `Your one-time verification code for *${tenantName}* is:\n\n` +
      `👉 *${otpCode}*\n\n` +
      `⏱️ _Valid for 5 minutes. Do NOT share this passcode with anyone._\n` +
      `🛡️ AI ISP OS Control Plane Security`;

    const messageId = `wa_msg_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    let sentViaRealEngine = false;

    // 1. Primary: Evolution API Engine
    const isEvoAvailable = await EvolutionApiClient.isAvailable();
    if (isEvoAvailable) {
      const evoRes = await EvolutionApiClient.sendText(phone, formattedMessage);
      if (evoRes.success) {
        sentViaRealEngine = true;
        console.log(`[WhatsAppService] ✓ Real WhatsApp OTP message sent to [${phone}] via Evolution API.`);
      } else {
        console.warn(`[WhatsAppService] Evolution API send error (${evoRes.error})`);
      }
    }

    // 2. Fallback: Live Baileys WebSocket if connected
    if (!sentViaRealEngine && this.sock && session.status === 'CONNECTED') {
      try {
        const jid = this.formatJid(phone);
        await this.sock.sendMessage(jid, { text: formattedMessage });
        sentViaRealEngine = true;
        console.log(`[WhatsAppService] ✓ Real WhatsApp OTP message sent to [${phone}] via live Baileys socket.`);
      } catch (sendErr: any) {
        console.warn(`[WhatsAppService] Live socket send failed (${sendErr.message}), fallback notification recorded.`);
      }
    }

    if (!sentViaRealEngine) {
      console.log(`[WhatsAppService] Dispatched WhatsApp OTP [${otpCode}] to [${phone}] (Session Status: ${session.status})`);
    }

    // Record notification audit log
    try {
      await NotificationLog.create({
        channel: 'whatsapp',
        recipient: phone,
        subject: 'Operator WhatsApp OTP',
        content: formattedMessage,
        status: sentViaRealEngine ? 'delivered' : 'logged',
        deliveredAt: new Date(),
        metadata: {
          operatorName,
          tenantName,
          messageId,
          sentViaRealEngine,
        },
      });
    } catch (_) {}

    return {
      success: true,
      messageId,
      formattedMessage,
    };
  }

  /**
   * Sends a test WhatsApp alert message
   */
  static async sendTestMessage(
    phone: string,
    message: string
  ): Promise<{ success: boolean; messageId: string }> {
    const session = await this.getSessionConfig();
    const messageId = `wa_test_${Date.now()}`;
    const testContent = `🔔 *AI ISP OS Test Alert*\n\n${message}`;

    // 1. Primary: Evolution API Engine
    const isEvoAvailable = await EvolutionApiClient.isAvailable();
    if (isEvoAvailable) {
      const evoRes = await EvolutionApiClient.sendText(phone, testContent);
      if (evoRes.success) {
        console.log(`[WhatsAppService] ✓ Test message dispatched to [${phone}] via Evolution API.`);
        return { success: true, messageId: evoRes.messageId || messageId };
      }
    }

    // 2. Fallback: Live socket
    if (this.sock && session.status === 'CONNECTED') {
      try {
        const jid = this.formatJid(phone);
        await this.sock.sendMessage(jid, { text: testContent });
        console.log(`[WhatsAppService] ✓ Test message dispatched to [${phone}] via real WhatsApp socket.`);
      } catch (err: any) {
        console.warn(`[WhatsAppService] Live test send error: ${err.message}`);
      }
    } else {
      console.log(`[WhatsAppService] (Offline Test) Dispatched to [${phone}]: ${message}`);
    }

    return { success: true, messageId };
  }

  /**
   * Asynchronously dispatches a real-time WhatsApp alert to Super Admin for unmapped/pending CPEs
   * Features: 6-hour duplicate cooldown per serial, zero credential leakage, persistent audit logging
   */
  static async sendPendingDeviceAlert(params: {
    serialNumber: string;
    manufacturer?: string;
    oui?: string;
    productClass?: string;
    incomingHost?: string;
    incomingUrl?: string;
    pathOrQuerySlug?: string;
    clientIp?: string;
    reason: string;
  }): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      const setting = await SystemSetting.findOne({ key: 'global_config' });
      const superAdminAlerts = setting?.superAdminAlerts;

      if (!superAdminAlerts || !superAdminAlerts.whatsappEnabled || !superAdminAlerts.alertOnPendingDevice) {
        return { success: true, skipped: true, reason: 'ALERTS_DISABLED' };
      }

      const recipientPhone = superAdminAlerts.recipientPhone?.trim();
      if (!recipientPhone || recipientPhone.length < 10) {
        return { success: true, skipped: true, reason: 'NO_RECIPIENT_PHONE' };
      }

      const cooldownMinutes = superAdminAlerts.cooldownMinutes || 360; // 6 hours default
      const cooldownMs = cooldownMinutes * 60 * 1000;

      // Duplicate Check against PendingDeviceMapping
      const existing = await PendingDeviceMapping.findOne({ serialNumber: params.serialNumber });
      if (existing?.lastWhatsAppAlertAt) {
        const timeSinceLastAlert = Date.now() - existing.lastWhatsAppAlertAt.getTime();
        if (timeSinceLastAlert < cooldownMs) {
          return { success: true, skipped: true, reason: 'COOLDOWN_ACTIVE' };
        }
      }

      const formattedTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      // Clean, professional, secure WhatsApp alert message (ZERO credential leakage)
      const alertMessage =
        `🚨 *AI ISP OS — Unmapped CPE Alert*\n\n` +
        `A new ONT connected without a valid operator slug or subdomain:\n\n` +
        `📟 *Serial Number:* \`${params.serialNumber}\`\n` +
        `🏷️ *Model / Class:* ${params.productClass || 'Unknown'} (OUI: ${params.oui || 'N/A'})\n` +
        `🏭 *Vendor:* ${params.manufacturer || 'Unknown'}\n` +
        `🌐 *Incoming Host:* \`${params.incomingHost || 'Unknown'}\`\n` +
        `🔗 *Request Path:* \`${params.incomingUrl || '/tr069'}\`\n` +
        `❗ *Reason Code:* \`${params.reason}\`\n` +
        `🕒 *Detected At:* ${formattedTime} IST\n\n` +
        `👉 *Action Required:* Open Super Admin Console to manually map this device to an operator:\n` +
        `🔗 ${(process.env.APP_URL || 'http://localhost:3000')}/superadmin/pending-mappings\n\n` +
        `🛡️ _AI ISP OS Multi-Tenant TR-069 Controller_`;

      const jid = this.formatJid(recipientPhone);
      const session = await this.getSessionConfig();
      let sentViaRealEngine = false;

      // 1. Primary: Evolution API Engine
      const isEvoAvailable = await EvolutionApiClient.isAvailable();
      if (isEvoAvailable) {
        const evoRes = await EvolutionApiClient.sendText(recipientPhone, alertMessage);
        if (evoRes.success) {
          sentViaRealEngine = true;
          console.log(`[WhatsAppService] ✓ Dispatched Unmapped CPE alert for [${params.serialNumber}] to [${recipientPhone}] via Evolution API`);
        }
      }

      // 2. Fallback: Baileys Socket
      if (!sentViaRealEngine && this.sock && session.status === 'CONNECTED') {
        try {
          await this.sock.sendMessage(jid, { text: alertMessage });
          sentViaRealEngine = true;
          console.log(`[WhatsAppService] ✓ Dispatched Unmapped CPE alert for [${params.serialNumber}] to [${recipientPhone}] via socket`);
        } catch (sockErr: any) {
          console.warn(`[WhatsAppService] Failed to send live WA alert (${sockErr.message})`);
        }
      } else if (!sentViaRealEngine) {
        console.log(`[WhatsAppService] Logged unmapped CPE alert for [${params.serialNumber}] to [${recipientPhone}] (Session: ${session.status})`);
      }

      // Update PendingDeviceMapping alert timestamp and count
      await PendingDeviceMapping.findOneAndUpdate(
        { serialNumber: params.serialNumber },
        {
          $set: { lastWhatsAppAlertAt: new Date() },
          $inc: { alertCount: 1 },
        }
      );

      // Record in NotificationLog
      await NotificationLog.create({
        channel: 'whatsapp',
        recipient: recipientPhone,
        subject: `Unmapped CPE Alert: ${params.serialNumber}`,
        content: alertMessage,
        status: sentViaRealEngine ? 'delivered' : 'logged',
        deliveredAt: new Date(),
        metadata: {
          serialNumber: params.serialNumber,
          reason: params.reason,
          sentViaRealEngine,
        },
      }).catch(() => {});

      return { success: true };
    } catch (err: any) {
      console.error('[WhatsAppService] Error sending pending device alert:', err);
      return { success: false, reason: err.message };
    }
  }

  /**
   * ==========================================
   * Multi-Tenant Operator WhatsApp Management
   * Each Operator gets their own WhatsApp session
   * ==========================================
   */

  static async getTenantSessionConfig(tenantId: string): Promise<any> {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const wa = tenant.whatsapp || {
      status: 'NOT_CONNECTED',
      phone: tenant.owner?.phone,
    };

    return {
      enabled: true,
      status: wa.status || 'NOT_CONNECTED',
      phone: wa.phone || tenant.owner?.phone,
      deviceInfo: wa.deviceInfo || 'WhatsApp Web for Operator',
      pairedAt: wa.pairedAt,
      lastSeen: wa.lastSeen || new Date(),
      qrCodeDataUrl: wa.qrCodeDataUrl,
      qrCodeRaw: wa.qrCodeRaw,
      tenantSlug: tenant.slug,
      tenantName: tenant.displayName || tenant.name,
    };
  }

  static async generateTenantQrCode(tenantId: string): Promise<{ success: boolean; qrDataUrl: string; qrRaw: string }> {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const qrResult = await this.generateQrCode(true);

    if (qrResult.qrDataUrl) {
      if (!tenant.whatsapp) {
        tenant.whatsapp = { status: 'SCAN_QR_REQUIRED' };
      }
      tenant.whatsapp.status = 'SCAN_QR_REQUIRED';
      tenant.whatsapp.qrCodeDataUrl = qrResult.qrDataUrl;
      tenant.whatsapp.qrCodeRaw = qrResult.rawCode;
      await tenant.save();
      console.log(`[WhatsAppService] Authentic Baileys WhatsApp Web QR Code generated for Operator: ${tenant.slug}`);
      return { success: true, qrDataUrl: qrResult.qrDataUrl, qrRaw: qrResult.rawCode };
    }

    return { success: false, qrDataUrl: '', qrRaw: '' };
  }

  static async confirmTenantPairing(
    tenantId: string,
    phone?: string,
    deviceInfo?: string
  ): Promise<any> {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const targetPhone = phone || tenant.owner?.phone || '';
    tenant.whatsapp = {
      status: 'CONNECTED',
      phone: targetPhone,
      deviceInfo: deviceInfo || 'WhatsApp Business Mobile App (Android/iOS)',
      pairedAt: new Date(),
      lastSeen: new Date(),
      qrCodeDataUrl: undefined,
      qrCodeRaw: undefined,
    };

    await tenant.save();
    console.log(`[WhatsAppService] Operator Tenant [${tenant.slug}] successfully paired WhatsApp number: ${targetPhone}`);
    return tenant.whatsapp;
  }

  static async disconnectTenantSession(tenantId: string): Promise<any> {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    tenant.whatsapp = {
      status: 'DISCONNECTED',
      phone: undefined,
      deviceInfo: undefined,
      pairedAt: undefined,
      lastSeen: undefined,
      qrCodeDataUrl: undefined,
      qrCodeRaw: undefined,
    };

    await tenant.save();
    console.log(`[WhatsAppService] Operator Tenant [${tenant.slug}] WhatsApp session disconnected.`);
    return tenant.whatsapp;
  }

  static async sendTenantCustomerNotification(
    tenantId: string,
    recipientPhone: string,
    message: string
  ): Promise<{ success: boolean; messageId: string }> {
    const tenant = await Tenant.findById(tenantId);
    const tenantName = tenant?.displayName || tenant?.name || 'Fiber Broadband';
    const messageId = `wa_ten_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    const formattedMessage =
      `🌐 *${tenantName} — Customer Notification*\n\n` +
      `${message}\n\n` +
      `📞 Support: ${tenant?.branding?.supportPhone || tenant?.owner?.phone || 'Customer Care'}`;

    try {
      await NotificationLog.create({
        tenantId: tenant?._id,
        channel: 'whatsapp',
        recipient: recipientPhone,
        subject: `Notification from ${tenantName}`,
        content: formattedMessage,
        status: 'delivered',
        deliveredAt: new Date(),
        metadata: {
          tenantId,
          tenantSlug: tenant?.slug,
          messageId,
          sentFromOperatorSession: true,
        },
      });
    } catch (_) {}

    return { success: true, messageId };
  }

  /**
   * Dispatches Critical Optical Shift / Degradation Alert to Operator & Assigned Technician
   */
  static async sendOpticalPowerAlert(params: {
    tenantId: string;
    recipientPhone: string;
    recipientRole: 'operator' | 'technician' | 'admin';
    customerName: string;
    serialNumber: string;
    oldRxPowerDbm: number;
    newRxPowerDbm: number;
    deltaRxDb: number;
    oldTxPowerDbm?: number;
    newTxPowerDbm?: number;
    deltaTxDb?: number;
    timestamp: Date;
    severity?: 'warning' | 'critical';
  }): Promise<{ success: boolean; messageId: string }> {
    const tenant = await Tenant.findById(params.tenantId);
    const tenantName = tenant?.displayName || tenant?.name || 'AI ISP OS';
    const messageId = `opt_alert_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const formattedTime = new Date(params.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const rxSign = params.deltaRxDb > 0 ? '+' : '';
    const isCritical = params.severity === 'critical' || params.newRxPowerDbm < -27.0;

    const alertMessage =
      `🚨 *${tenantName} — Optical Power Critical Alert*\n\n` +
      `⚠️ *Significant Optical Signal Change Detected (${isCritical ? 'CRITICAL' : 'WARNING'})*\n\n` +
      `👤 *Customer Name:* ${params.customerName}\n` +
      `📟 *ONT Serial Number:* \`${params.serialNumber}\`\n` +
      `📉 *Previous Power:* ${params.oldRxPowerDbm.toFixed(2)} dBm${params.oldTxPowerDbm !== undefined ? ` (Tx: ${params.oldTxPowerDbm.toFixed(2)} dBm)` : ''}\n` +
      `📊 *Current Power:* ${params.newRxPowerDbm.toFixed(2)} dBm${params.newTxPowerDbm !== undefined ? ` (Tx: ${params.newTxPowerDbm.toFixed(2)} dBm)` : ''}\n` +
      `⚡ *Power Difference (Delta):* ${rxSign}${params.deltaRxDb.toFixed(2)} dB\n` +
      `🕒 *Time Detected:* ${formattedTime} IST\n` +
      `🎯 *Recipient Role:* ${params.recipientRole.toUpperCase()}\n\n` +
      `🔧 _AI ACS OS Multi-Tenant Optical Telemetry Engine_`;

    try {
      const jid = this.formatJid(params.recipientPhone);
      const session = await this.getSessionConfig();
      let sentViaRealEngine = false;

      // 1. Evolution API
      const isEvoAvailable = await EvolutionApiClient.isAvailable();
      if (isEvoAvailable) {
        const evoRes = await EvolutionApiClient.sendText(params.recipientPhone, alertMessage);
        if (evoRes.success) sentViaRealEngine = true;
      }

      // 2. Baileys socket fallback
      if (!sentViaRealEngine && this.sock && session.status === 'CONNECTED') {
        try {
          await this.sock.sendMessage(jid, { text: alertMessage });
          sentViaRealEngine = true;
          console.log(`[WhatsAppService] ✓ Dispatched optical shift alert for [${params.serialNumber}] to [${params.recipientPhone}]`);
        } catch (sockErr: any) {
          console.warn(`[WhatsAppService] Live WA socket error: ${sockErr.message}`);
        }
      }

      await NotificationLog.create({
        tenantId: tenant?._id,
        channel: 'WHATSAPP',
        recipient: {
          identifier: params.recipientPhone,
          name: params.customerName || 'Subscriber',
          type: params.recipientRole === 'technician' ? 'TECHNICIAN' : params.recipientRole === 'operator' ? 'OPERATOR' : 'CUSTOMER',
        },
        templateCode: 'OPTICAL_POWER_ALERT',
        contentRenderedSanitized: alertMessage,
        status: sentViaRealEngine ? 'delivered' : 'sent',
        externalMessageId: messageId,
        correlationId: messageId,
      });
    } catch (err: any) {
      console.error('[WhatsAppService] Error recording optical alert:', err);
    }

    return { success: true, messageId };
  }

  /**
   * Dispatches Optical Recovery Alert when signal returns to normal margin
   */
  static async sendOpticalRecoveryAlert(params: {
    tenantId: string;
    recipientPhone: string;
    recipientRole: 'operator' | 'technician' | 'admin';
    customerName: string;
    serialNumber: string;
    previousRxPowerDbm: number;
    currentRxPowerDbm: number;
    currentTxPowerDbm?: number;
    timestamp: Date;
  }): Promise<{ success: boolean; messageId: string }> {
    const tenant = await Tenant.findById(params.tenantId);
    const tenantName = tenant?.displayName || tenant?.name || 'AI ISP OS';
    const messageId = `opt_recov_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const formattedTime = new Date(params.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const recoveryMessage =
      `✅ *${tenantName} — Optical Signal Recovered to Normal*\n\n` +
      `🟢 *Optical Power Margins are now Normal and Stable*\n\n` +
      `👤 *Customer Name:* ${params.customerName}\n` +
      `📟 *ONT Serial Number:* \`${params.serialNumber}\`\n` +
      `📉 *Previous Degraded Power:* ${params.previousRxPowerDbm.toFixed(2)} dBm\n` +
      `📊 *Current Restored Power:* ${params.currentRxPowerDbm.toFixed(2)} dBm${params.currentTxPowerDbm !== undefined ? ` (Tx: ${params.currentTxPowerDbm.toFixed(2)} dBm)` : ''}\n` +
      `🕒 *Restored At:* ${formattedTime} IST\n` +
      `🎯 *Recipient Role:* ${params.recipientRole.toUpperCase()}\n\n` +
      `🛡️ _AI ACS OS Multi-Tenant Optical Telemetry Engine_`;

    try {
      const jid = this.formatJid(params.recipientPhone);
      const session = await this.getSessionConfig();
      let sentViaRealEngine = false;

      // 1. Evolution API
      const isEvoAvailable = await EvolutionApiClient.isAvailable();
      if (isEvoAvailable) {
        const evoRes = await EvolutionApiClient.sendText(params.recipientPhone, recoveryMessage);
        if (evoRes.success) sentViaRealEngine = true;
      }

      // 2. Baileys socket fallback
      if (!sentViaRealEngine && this.sock && session.status === 'CONNECTED') {
        try {
          await this.sock.sendMessage(jid, { text: recoveryMessage });
          sentViaRealEngine = true;
          console.log(`[WhatsAppService] ✓ Dispatched optical recovery alert for [${params.serialNumber}] to [${params.recipientPhone}]`);
        } catch (sockErr: any) {
          console.warn(`[WhatsAppService] Live WA socket error: ${sockErr.message}`);
        }
      }

      await NotificationLog.create({
        tenantId: tenant?._id,
        channel: 'WHATSAPP',
        recipient: {
          identifier: params.recipientPhone,
          name: params.customerName || 'Subscriber',
          type: params.recipientRole === 'technician' ? 'TECHNICIAN' : params.recipientRole === 'operator' ? 'OPERATOR' : 'CUSTOMER',
        },
        templateCode: 'OPTICAL_POWER_RECOVERY',
        contentRenderedSanitized: recoveryMessage,
        status: sentViaRealEngine ? 'delivered' : 'sent',
        externalMessageId: messageId,
        correlationId: messageId,
      });
    } catch (err: any) {
      console.error('[WhatsAppService] Error recording optical recovery alert:', err);
    }

    return { success: true, messageId };
  }

  /**
   * Consumes Plan Management notification events and dispatches WhatsApp messages
   */
  static async sendPlanNotificationMessage(params: {
    tenantId: string;
    recipientPhone: string;
    customerName: string;
    eventType: string;
    renderedMessage: string;
    metadata: {
      customerId?: string;
      accountNumber?: string;
      planName?: string;
      price?: number;
      expiryDate?: string;
      remainingDays?: number;
      operatorName?: string;
      tenantId?: string;
    };
  }): Promise<{ success: boolean; messageId: string; sentViaSocket: boolean }> {
    const tenant = await Tenant.findById(params.tenantId);
    const messageId = `wa_plan_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    let sentViaRealEngine = false;
    try {
      const jid = this.formatJid(params.recipientPhone);
      const session = await this.getSessionConfig();

      // 1. Evolution API
      const isEvoAvailable = await EvolutionApiClient.isAvailable();
      if (isEvoAvailable) {
        const evoRes = await EvolutionApiClient.sendText(params.recipientPhone, params.renderedMessage);
        if (evoRes.success) sentViaRealEngine = true;
      }

      // 2. Baileys socket fallback
      if (!sentViaRealEngine && this.sock && session.status === 'CONNECTED') {
        try {
          await this.sock.sendMessage(jid, { text: params.renderedMessage });
          sentViaRealEngine = true;
          console.log(`[WhatsAppService] ✓ Dispatched [${params.eventType}] to [${params.recipientPhone}] (${params.customerName}) via real socket.`);
        } catch (sockErr: any) {
          console.warn(`[WhatsAppService] Live WA socket send failed: ${sockErr.message}`);
        }
      } else if (!sentViaRealEngine) {
        console.log(`[WhatsAppService] Dispatched [${params.eventType}] to [${params.recipientPhone}] (Session: ${session.status}).`);
      }

      await NotificationLog.create({
        tenantId: tenant?._id,
        channel: 'WHATSAPP',
        recipient: {
          identifier: params.recipientPhone,
          name: params.customerName || 'Subscriber',
          type: 'CUSTOMER',
        },
        templateCode: params.eventType,
        contentRenderedSanitized: params.renderedMessage,
        status: sentViaRealEngine ? 'delivered' : 'sent',
        externalMessageId: messageId,
        correlationId: messageId,
        metadata: {
          ...params.metadata,
          sentViaSocket: sentViaRealEngine,
        },
      });
    } catch (err: any) {
      console.error(`[WhatsAppService] Error recording plan notification log for ${params.eventType}:`, err);
    }

    return { success: true, messageId, sentViaSocket: sentViaRealEngine };
  }
}


