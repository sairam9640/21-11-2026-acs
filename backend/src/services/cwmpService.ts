import { Device, IDevice, IRxPowerRecord, IConnectedClient } from '../models/Device.js';
import { Customer } from '../models/Customer.js';
import { Tenant, ITenant } from '../models/Tenant.js';
import { PendingDeviceMapping } from '../models/PendingDeviceMapping.js';
import { WhatsAppService } from './whatsAppService.js';
import { CwmpVendorProfiles, CpeVendor } from './cwmpVendorProfiles.js';
import { CwmpXmlParser, escapeXml } from './cwmpXmlParser.js';
import { RedisService } from './redisService.js';
import { ZtpService } from './ztpService.js';
import { MetricsService } from './metricsService.js';
import { buildPrimaryCwmpUrls, resolveTenantCwmpCredentials } from '../utils/cwmpCredentials.js';

export interface CwmpInformData {
  manufacturer?: string;
  oui?: string;
  productClass?: string;
  serialNumber?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
  macAddress?: string;
  connectionRequestUrl?: string;
  connectionRequestUsername?: string;
  connectionRequestPassword?: string;
  wanIp?: string;
  pppoeUsername?: string;
  opticalRxPower?: number;
  opticalTxPower?: number;
  opticalBiasCurrent?: number;
  opticalVoltage?: number;
  temperatureC?: number;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  wifiSsid24?: string;
  wifiPass24?: string;
  wifiSsid5g?: string;
  wifiPass5g?: string;
  vlanId?: number;
  wanConnectionStatus?: string;
  periodicInformInterval?: number;
  lanHostCount?: number;
  connectedClients?: IConnectedClient[];
  events?: string[];
  rawXml?: string;
}

import { SupportedParameterCache } from '../models/SupportedParameterCache.js';
import { CwmpSessionLog } from '../models/CwmpSessionLog.js';
import { DeviceCommand } from '../models/DeviceCommand.js';
import { Alert } from '../models/Incident.js';
import { User } from '../models/User.js';
import { buildTr069WanParams } from '../routes/operatorRoutes.js';
import { triggerGenieAcsConnectionRequest } from './connectionRequestService.js';
import { validateWanParameters } from './tr098WanDiscoveryService.js';

export interface CwmpHitLog {
  timestamp: Date;
  ip: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  vendor?: string;
  events?: string[];
  tenantSlug?: string;
  status: 'PROVISIONED' | 'DISCOVERED' | 'HEARTBEAT';
}

export interface ActiveSessionContext {
  sessionId: string;
  deviceId?: string;
  customerId?: string;
  serialNumber: string;
  serialAliases: string[];
  vendor: CpeVendor;
  manufacturer: string;
  modelName: string;
  firmwareVersion: string;
  hardwareVersion: string;
  clientIp: string;
  tenantId: string;
  tenantSlug: string;
  stage: 'INFORM_ACKED' | 'MISMATCH_BLOCKED' | 'GPN_SENT' | 'WAN_SLOT_GPN_SENT' | 'BASELINE_SENT' | 'OPTICAL_SENT' | 'ADD_OBJECT_SENT' | 'SPV_SENT' | 'SPA_SENT' | 'CUSTOM_RPC_SENT' | 'VERIFICATION_GPV_SENT' | 'AUTO_MGMT_SPV_SENT' | 'AUTO_MGMT_PERIODIC_ONLY_SENT' | 'COMPLETED';
  activeOpticalCandidate?: string;
  supportedOpticalPath?: string;
  lastQueriedPaths?: string[];
  events?: string[];
  timestamp: number;
}

export class CwmpService {
  private static recentHits: CwmpHitLog[] = [];
  private static totalHits = 0;
  private static tenantTotalHits = new Map<string, number>();
  private static tenantRecentHits = new Map<string, CwmpHitLog[]>();
  private static sessionsById = new Map<string, ActiveSessionContext>();
  private static sessionsByConnection = new Map<string, ActiveSessionContext>();
  private static recentGpnAt = new Map<string, number>();

  /**
   * Extracts TR-069 Session ID from HTTP Cookie header
   */
  static extractSessionCookie(cookieHeader?: string): string | undefined {
    return (
      CwmpXmlParser.extractCookie(cookieHeader, 'cwmpSession') ||
      CwmpXmlParser.extractCookie(cookieHeader, 'sessionID') ||
      CwmpXmlParser.extractCookie(cookieHeader, 'JSESSIONID')
    );
  }

  /**
   * Cleans expired sessions older than 120 seconds
   */
  private static cleanExpiredSessions(): void {
    const cutoff = Date.now() - 120000;
    for (const [id, s] of this.sessionsById.entries()) {
      if (s.timestamp < cutoff) {
        this.sessionsById.delete(id);
      }
    }
    for (const [connKey, s] of this.sessionsByConnection.entries()) {
      if (s.timestamp < cutoff) {
        this.sessionsByConnection.delete(connKey);
      }
    }
  }

  /**
   * Persist active session context to both in-memory cache and Redis cluster
   */
  static async saveSession(sessionId: string, connectionKey: string | undefined, context: ActiveSessionContext): Promise<void> {
    this.sessionsById.set(sessionId, context);
    if (connectionKey) {
      this.sessionsByConnection.set(connectionKey, context);
    }
    if (context.clientIp) {
      this.sessionsByConnection.set(context.clientIp, context);
    }
    try {
      await RedisService.set(`cwmp:session:${sessionId}`, context, 120);
      if (connectionKey) {
        await RedisService.set(`cwmp:conn:${connectionKey}`, context, 120);
      }
      if (context.clientIp) {
        await RedisService.set(`cwmp:conn:${context.clientIp}`, context, 120);
      }
    } catch (err: any) {
      console.warn('[CWMP ACS] Failed to persist session to Redis:', err.message);
    }
  }

  /**
   * Retrieve active session context from memory or distributed Redis cluster
   */
  static async getSession(incomingSessionId?: string, connectionKey?: string, clientIp?: string): Promise<ActiveSessionContext | undefined> {
    // 1. Fast in-memory lookup
    let session = incomingSessionId ? this.sessionsById.get(incomingSessionId) : undefined;
    if (!session && connectionKey) {
      session = this.sessionsByConnection.get(connectionKey);
    }
    if (!session && clientIp) {
      session = this.sessionsByConnection.get(clientIp);
    }
    if (session) return session;

    // 2. Redis cluster lookup (multi-instance / distributed worker)
    try {
      if (incomingSessionId) {
        const redisSession = await RedisService.get<ActiveSessionContext>(`cwmp:session:${incomingSessionId}`);
        if (redisSession) {
          this.sessionsById.set(incomingSessionId, redisSession);
          return redisSession;
        }
      }
      if (connectionKey) {
        const redisConnSession = await RedisService.get<ActiveSessionContext>(`cwmp:conn:${connectionKey}`);
        if (redisConnSession) {
          this.sessionsByConnection.set(connectionKey, redisConnSession);
          return redisConnSession;
        }
      }
      if (clientIp) {
        const redisIpSession = await RedisService.get<ActiveSessionContext>(`cwmp:conn:${clientIp}`);
        if (redisIpSession) {
          this.sessionsByConnection.set(clientIp, redisIpSession);
          return redisIpSession;
        }
      }
    } catch (err: any) {
      console.warn('[CWMP ACS] Error fetching session from Redis:', err.message);
    }

    return undefined;
  }

  /**
   * Update session context across local map and Redis cluster
   */
  static async updateSession(session: ActiveSessionContext, connectionKey?: string): Promise<void> {
    session.timestamp = Date.now();
    this.sessionsById.set(session.sessionId, session);
    if (connectionKey) {
      this.sessionsByConnection.set(connectionKey, session);
    }
    try {
      await RedisService.set(`cwmp:session:${session.sessionId}`, session, 120);
      if (connectionKey) {
        await RedisService.set(`cwmp:conn:${connectionKey}`, session, 120);
      }
    } catch (err: any) {
      console.warn('[CWMP ACS] Failed to sync session update to Redis:', err.message);
    }
  }

  /**
   * Checks if the CPE currently has an active or recently opened CWMP session
   */
  static getActiveSessionForDevice(serialNumber?: string): {
    active: boolean;
    opened: boolean;
    sessionId?: string;
    stage?: string;
    openedAt?: Date;
  } {
    if (!serialNumber) return { active: false, opened: false };
    const aliases = new Set(CwmpXmlParser.getSerialNumberAliases(serialNumber));
    const cutoff = Date.now() - 120_000;
    for (const s of this.sessionsById.values()) {
      if (aliases.has(s.serialNumber) && s.timestamp >= cutoff && s.stage !== 'MISMATCH_BLOCKED') {
        return {
          active: s.stage !== 'COMPLETED',
          opened: true,
          sessionId: s.sessionId,
          stage: s.stage,
          openedAt: new Date(s.timestamp),
        };
      }
    }
    return { active: false, opened: false };
  }

  /**
   * Builds non-disruptive ManagementServer SetParameterValues RPC to auto-configure
   * PeriodicInformEnable=true, PeriodicInformInterval=300s, and server-managed ConnectionRequest credentials.
   */
  private static buildAutoManagementBaselineSpv(
    device: any,
    session: ActiveSessionContext,
    includeConnReq: boolean = true
  ) {
    const creds = resolveTenantCwmpCredentials(session?.tenantSlug);
    const rawKeys = Object.keys(device?.rawParameters || {});
    const isTr181 =
      session?.vendor === 'TR181_STANDARD' ||
      String(device?.modelName || session?.modelName || '').toUpperCase().includes('TR181') ||
      rawKeys.some((k) => k.startsWith('Device.ManagementServer.'));
    const prefix = isTr181 ? 'Device.ManagementServer.' : 'InternetGatewayDevice.ManagementServer.';
    const cwmpId = includeConnReq ? '7' : '8';

    const params: Array<[string, any, string]> = [
      [`${prefix}PeriodicInformEnable`, true, 'xsd:boolean'],
      [`${prefix}PeriodicInformInterval`, creds.periodicInformIntervalSeconds, 'xsd:unsignedInt'],
    ];
    if (includeConnReq) {
      params.push(
        [`${prefix}ConnectionRequestUsername`, creds.connectionRequestUsername, 'xsd:string'],
        [`${prefix}ConnectionRequestPassword`, creds.connectionRequestPassword, 'xsd:string']
      );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">${cwmpId}</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValues>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[${params.length}]">
${params.map(([name, value, type]) => `        <ParameterValueStruct>
          <Name>${escapeXml(name)}</Name>
          <Value xsi:type="${type}">${escapeXml(String(value))}</Value>
        </ParameterValueStruct>`).join('\n')}
      </ParameterList>
      <ParameterKey>AUTO-MGMT-${escapeXml(session.sessionId)}</ParameterKey>
    </cwmp:SetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;

    return { cwmpId, xml, creds, prefix, params };
  }

  /**
   * Release per-socket connection mapping once a CWMP session completes so keepalive/CGNAT port reuse never collides
   */
  static async clearConnectionSession(connectionKey?: string, clientIp?: string): Promise<void> {
    if (connectionKey) {
      this.sessionsByConnection.delete(connectionKey);
      try {
        await RedisService.del(`cwmp:conn:${connectionKey}`);
      } catch {
        // ignore Redis cleanup errors
      }
    }
    if (clientIp) {
      this.sessionsByConnection.delete(clientIp);
      try {
        await RedisService.del(`cwmp:conn:${clientIp}`);
      } catch {
        // ignore Redis cleanup errors
      }
    }
  }

  /**
   * Automatically merges reported parameters from an Inform SOAP packet into device.rawParameters
   * while preserving previously captured write-only Wi-Fi / PPPoE secrets.
   */
  private static mergeInformRawParameters(existingRaw: Record<string, any> | undefined, xml: string): Record<string, string> {
    const merged: Record<string, string> = { ...(existingRaw || {}) };
    if (!xml || typeof xml !== 'string') return merged;
    const { rawMap } = CwmpXmlParser.extractParameterMap(xml);
    for (const [k, v] of Object.entries(rawMap || {})) {
      if (!k || v === undefined || v === null) continue;
      const strVal = String(v);
      const isSecretPath = /password|passphrase|presharedkey/i.test(k);
      if (isSecretPath) {
        const trimmed = strVal.trim();
        if (!trimmed || /^\*+$/.test(trimmed) || trimmed === '••••••••') continue;
      }
      merged[k] = strVal;
    }
    return merged;
  }

  /**
   * Persist device updates safely under concurrent Inform bursts (retries via atomic $set on VersionError/ParallelSaveError)
   */
  private static async saveDeviceResilient(device: any): Promise<void> {
    try {
      await device.save();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (device?._id && (err?.name === 'VersionError' || err?.name === 'ParallelSaveError' || /version|parallel/i.test(msg))) {
        await Device.updateOne(
          { _id: device._id },
          {
            $set: {
              status: device.status || 'online',
              lastInform: device.lastInform || new Date(),
              lastRawInformXml: device.lastRawInformXml,
              lastParameterSyncAt: device.lastParameterSyncAt,
              lastParameterSyncStatus: device.lastParameterSyncStatus,
              periodicInformInterval: device.periodicInformInterval,
              connectionRequestUrl: device.connectionRequestUrl,
              connectionRequestUsername: device.connectionRequestUsername,
              connectionRequestPassword: device.connectionRequestPassword,
              ipAddress: device.ipAddress,
              externalIpAddress: device.externalIpAddress,
              uptimeSeconds: device.uptimeSeconds,
              rawParameters: device.rawParameters,
              ...(device.wifi24 ? { wifi24: device.wifi24 } : {}),
              ...(device.wifi5g ? { wifi5g: device.wifi5g } : {}),
              ...(Array.isArray(device.wanProfiles) ? { wanProfiles: device.wanProfiles } : {}),
              ...(device.pendingConfig !== undefined ? { pendingConfig: device.pendingConfig } : {}),
              ...(device.supportedParametersConfirmed !== undefined ? { supportedParametersConfirmed: device.supportedParametersConfirmed } : {}),
              ...(device.opticalTelemetrySourcePath ? { opticalTelemetrySourcePath: device.opticalTelemetrySourcePath } : {}),
            },
          }
        );
        return;
      }
    throw err;
    }
  }

  private static isOpticalRxPath(path: string): boolean {
    return (
      /rxpower|rx_power|opticalpowerrx|rxopticalpower|receiveopticalpower|opticalsignallevel|receivepower|rxdba|opt_rx|optrx/i.test(path) &&
      !/ping|traceroute|wlan|wifi|beacon|transmit/i.test(path) &&
      !path.endsWith('.')
    );
  }

  private static isOpticalTxPath(path: string): boolean {
    return (
      /txpower|tx_power|opticalpowertx|txopticalpower|transmitopticalpower|transmitpower|txdba|opt_tx|opttx/i.test(path) &&
      !/ping|traceroute|wlan|wifi|beacon|receive/i.test(path) &&
      !path.endsWith('.')
    );
  }

  /**
   * Selects prioritized confirmed TR-069/TR-181 telemetry paths across Device Details,
   * Optical RX/TX, Wi-Fi, WAN Route/Bridge/VLAN, and LAN Hosts with a safe batch ceiling
   * so Syrotech / Realtek TR-069 daemons never choke on 200+ parameter GPV packets.
   */
  private static selectConfirmedTelemetryPaths(
    names: string[],
    unsupportedSet: Set<string> = new Set(),
    maxBatchSize = 90
  ): {
    paths: string[];
    opticalRxCandidates: string[];
    opticalTxCandidates: string[];
    opticalCompanionCandidates: string[];
  } {
    const confirmedParams: string[] = [];
    const pushConfirmed = (p: string, cap = maxBatchSize) => {
      if (p && !p.endsWith('.') && !unsupportedSet.has(p) && confirmedParams.length < cap && !confirmedParams.includes(p)) {
        confirmedParams.push(p);
      }
    };

    // 1. Priority 1: Core Device Identity, Management & Health Telemetry
    const coreMgmtParams = names.filter((n) =>
      /(?:ManagementServer\.(?:PeriodicInformInterval|PeriodicInformEnable|ConnectionRequestURL)|DeviceInfo\.(?:Manufacturer|OUI|ManufacturerOUI|ModelName|ProductClass|HardwareVersion|SoftwareVersion|SerialNumber|Description|UpTime|CPUUsage|MemoryUsage)|DeviceInfo\.MemoryStatus\.(?:Total|Free)|DeviceInfo\.ProcessStatus\.CPUUsage|LANDevice\.1\.LANEthernetInterfaceConfig\.1\.MACAddress)$/i.test(n) &&
      !n.endsWith('.')
    );
    for (const mp of coreMgmtParams) pushConfirmed(mp, maxBatchSize);

    // 2. Priority 2: Confirmed Optical RX / TX / Companion Transceiver Sensors (before verbose Hosts!)
    const opticalRxCandidates = names.filter((n) => this.isOpticalRxPath(n) && !unsupportedSet.has(n));
    const opticalTxCandidates = names.filter((n) => this.isOpticalTxPath(n) && !unsupportedSet.has(n));
    const opticalCompanionCandidates = names.filter((n) =>
      /(?:epon|gpon|pon|optical|x_ct[-_]com_|x_syrotech).*(?:bias|volt|vottage|temp)/i.test(n) &&
      !/ping|traceroute|wlan|wifi/i.test(n) &&
      !n.endsWith('.') &&
      !unsupportedSet.has(n)
    );
    for (const optRx of opticalRxCandidates) pushConfirmed(optRx, maxBatchSize);
    for (const optTx of opticalTxCandidates) pushConfirmed(optTx, maxBatchSize);
    for (const comp of opticalCompanionCandidates) pushConfirmed(comp, maxBatchSize);

    // 3. Priority 3: ALL Wi-Fi Interfaces (SSID, Band evidence, Standard, Channel, Passphrase)
    const allWifiParams = names.filter((n) =>
      /(?:LANDevice\.\d+\.WLANConfiguration\.\d+\.(?:SSID|Enable|Status|Channel|Standard|OperatingChannelBandwidth|PossibleChannels|BeaconType|TotalAssociations|X_TP_Band|X_RFBand|RFBand|Band|X_CT[-_]COM_RFBand|X_HW_RFBand|X_ZTE[-_]COM_RFBand|X_ALU_COM_RFBand|X_SYROTECH_Band|X_REALTEK_Band|X_HW_WorkMode|OperatingFrequencyBand|SupportedFrequencyBands|PreSharedKey\.\d+\.(?:X_[A-Z0-9_-]+_)?(?:KeyPassphrase|PreSharedKey)|(?:X_[A-Z0-9_-]+_)?(?:KeyPassphrase|PreSharedKey)|WPA\.PreSharedKey|WPAKey|WPAPsk|SharedKey)|Device\.WiFi\.(?:SSID|Radio|AccessPoint)\.\d+\.(?:SSID|Channel|Enable|Status|LowerLayers|SSIDReference|OperatingFrequencyBand|OperatingStandards|OperatingChannelBandwidth|AssociatedDeviceNumberOfEntries|Security\.ModeEnabled|Security\.(?:X_[A-Z0-9_-]+_)?(?:KeyPassphrase|PreSharedKey)))$/i.test(n) &&
      !n.endsWith('.')
    );
    for (const wp of allWifiParams) pushConfirmed(wp, maxBatchSize);

    // 4. Priority 4: ALL WAN / Route / Bridge / PPPoE / IP / VLAN Connections across EVERY slot (TR-098 - and _ + TR-181)
    const allWanParams = names.filter((n) =>
      /(?:WANDevice\.\d+\.WANConnectionDevice\.\d+\.(?:WANPPPConnection|WANIPConnection)\.\d+\.(?:Name|Username|Password|ExternalIPAddress|RemoteIPAddress|ConnectionStatus|Enable|ConnectionType|AddressingType|NATEnabled|ServiceList|X_CT[-_]COM_ServiceList|X_HW_SERVICELIST|X_CT[-_]COM_LanInterface|X_CT[-_]COM_VlanID|X_CT[-_]COM_IPMode|X_HW_VLAN|X_ZTE[-_]COM_VLAN|X_TPLINK_VlanID|VLANID|VLANEnabled|DNSServers|DefaultGateway|SubnetMask|MaxMTUSize|CurrentMTUSize|Uptime|LastConnectionError|PPPoEACName)|WANDevice\.\d+\.WANConnectionDevice\.\d+\.(?:X_CT[-_]COM_WAN(?:Epon|Gpon)?LinkConfig)\.(?:VLANIDMark|Mode|802_1pMark)|WANDevice\.\d+\.WANConnectionDevice\.\d+\.VLANID|Device\.(?:PPP|IP)\.Interface\.\d+\.(?:Name|Username|Enable|Status|.*IPAddress|ConnectionStatus)|Device\.Ethernet\.VLANTermination\.\d+\.VLANID)$/i.test(n) &&
      !n.endsWith('.')
    );
    for (const wanp of allWanParams) pushConfirmed(wanp, maxBatchSize);

    // 5. Priority 5: LAN Host count + confirmed host entries within remaining batch budget
    const lanHosts = names.find((n) => /LANDevice\.\d+\.(Hosts\.HostNumberOfEntries|HostNumberOfEntries)$|Device\.Hosts\.HostNumberOfEntries$/i.test(n));
    if (lanHosts) pushConfirmed(lanHosts, maxBatchSize);

    const hostParams = names.filter((n) =>
      /(?:LANDevice\.\d+\.Hosts\.Host\.\d+\.(?:IPAddress|MACAddress|HostName|UserHostName|ClientID|Active|InterfaceType|LeaseTimeRemaining)|LANDevice\.\d+\.WLANConfiguration\.\d+\.AssociatedDevice\.\d+\.(?:AssociatedDeviceMACAddress|AssociatedDeviceIPAddress|AssociatedDeviceHostName|AssociatedDeviceAuthenticationState|AssociatedDeviceRSSI|MACAddress)|Device\.Hosts\.Host\.\d+\.(?:IPAddress|PhysAddress|HostName|Active|InterfaceType)|Device\.WiFi\.AccessPoint\.\d+\.AssociatedDevice\.\d+\.MACAddress)$/i.test(n) &&
      !n.endsWith('.')
    );
    for (const hp of hostParams) pushConfirmed(hp, maxBatchSize);

    return { paths: confirmedParams, opticalRxCandidates, opticalTxCandidates, opticalCompanionCandidates };
  }

  /**
   * Helper to extract the first matching parameter value from an extracted map
   */
  private static getFirstParam(paramMap: Map<string, string>, candidatePaths: string[]): string | undefined {
    for (const p of candidatePaths) {
      if (paramMap.has(p)) {
        const val = paramMap.get(p);
        if (val !== undefined && val !== '') return val;
      }
    }
    return undefined;
  }

  /**
   * Extracts the first non-empty, non-masked Wi-Fi or PPPoE secret across vendor aliases
   */
  private static pickNonMaskedSecret(paramMap: Map<string, string>, candidatePaths: string[]): string | undefined {
    for (const p of candidatePaths) {
      if (paramMap.has(p)) {
        const val = paramMap.get(p);
        if (val !== undefined) {
          const trimmed = String(val).trim();
          if (trimmed && !/^\*+$/.test(trimmed) && trimmed !== '••••••••' && trimmed !== 'null' && trimmed !== 'undefined') {
            return trimmed;
          }
        }
      }
    }
    // Case-insensitive & vendor extension candidate lookup
    for (const p of candidatePaths) {
      const lowerCandidate = p.toLowerCase();
      for (const [k, v] of paramMap.entries()) {
        if (k.toLowerCase() === lowerCandidate) {
          const trimmed = String(v).trim();
          if (trimmed && !/^\*+$/.test(trimmed) && trimmed !== '••••••••' && trimmed !== 'null' && trimmed !== 'undefined') {
            return trimmed;
          }
        }
      }
    }
    return undefined;
  }

  private static mapToRecord(paramMap: Map<string, string>): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [k, v] of paramMap.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  /**
   * Builds ordered Wi-Fi passphrase lookup paths across TR-098, Genexis/GX, Nokia/ALU/ASB, Huawei, ZTE, TP-Link, and TR-181 (with SSIDReference resolution).
   */
  private static getWifiSecretCandidatePaths(instance: number, rawObj: Record<string, any> = {}): string[] {
    const apIdx = CwmpVendorProfiles.resolveTr181AccessPointIndex(rawObj, instance);
    const apIndices = apIdx !== instance ? [apIdx, instance] : [instance];
    const tr181Paths: string[] = [];
    for (const ap of apIndices) {
      tr181Paths.push(
        `Device.WiFi.AccessPoint.${ap}.Security.X_ALU_COM_KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.X_ALU-COM_KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.X_ASB_COM_KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.X_NOKIA_KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.X_GENEXIS_KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.X_BROADCOM_COM_KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.KeyPassphrase`,
        `Device.WiFi.AccessPoint.${ap}.Security.PreSharedKey`
      );
    }
    return [
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.1.KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.1.PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.0.KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.0.PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_GENEXIS_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_GENEXIS_PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_BROADCOM_COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.1.X_ALU_COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.1.X_ALU-COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.1.X_ASB_COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey.1.X_NOKIA_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ALU_COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ALU-COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ASB_COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_NOKIA_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ALU_COM_PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ASB_COM_PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_CT-COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_CT-COM_PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_HW_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ZTE-COM_KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_ZTE-COM_PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.X_TP_PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.WPA.PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.WPAKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.WPAPsk`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${instance}.SharedKey`,
      ...tr181Paths,
    ];
  }

  /**
   * Robust Inform XML Parser
   */
  static parseInformXml(xml: string): CwmpInformData {
    const data: CwmpInformData = { rawXml: xml, events: [] };
    if (!xml || typeof xml !== 'string') return data;

    const { parameters: pMap } = CwmpXmlParser.extractParameterMap(xml);

    data.manufacturer =
      CwmpXmlParser.extractTag(xml, 'Manufacturer') ||
      this.getFirstParam(pMap, ['Device.DeviceInfo.Manufacturer', 'InternetGatewayDevice.DeviceInfo.Manufacturer']);

    data.oui =
      CwmpXmlParser.extractTag(xml, 'OUI') ||
      this.getFirstParam(pMap, ['Device.DeviceInfo.ManufacturerOUI', 'InternetGatewayDevice.DeviceInfo.ManufacturerOUI']);

    data.productClass =
      CwmpXmlParser.extractTag(xml, 'ProductClass') ||
      this.getFirstParam(pMap, ['Device.DeviceInfo.ProductClass', 'InternetGatewayDevice.DeviceInfo.ProductClass', 'Device.DeviceInfo.ModelName', 'InternetGatewayDevice.DeviceInfo.ModelName']);

    data.serialNumber =
      CwmpXmlParser.extractTag(xml, 'SerialNumber') ||
      this.getFirstParam(pMap, ['Device.DeviceInfo.SerialNumber', 'InternetGatewayDevice.DeviceInfo.SerialNumber']);

    const eventMatches = xml.matchAll(/<(?:[a-zA-Z0-9_-]+:)?EventCode[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_-]+:)?EventCode>/gi);
    for (const em of eventMatches) {
      if (em[1]) data.events?.push(em[1].trim());
    }

    data.softwareVersion =
      this.getFirstParam(pMap, ['Device.DeviceInfo.SoftwareVersion', 'InternetGatewayDevice.DeviceInfo.SoftwareVersion', 'InternetGatewayDevice.DeviceInfo.X_HW_SoftwareVersion']) ||
      CwmpXmlParser.extractTag(xml, 'SoftwareVersion');

    data.hardwareVersion =
      this.getFirstParam(pMap, ['Device.DeviceInfo.HardwareVersion', 'InternetGatewayDevice.HardwareVersion', 'InternetGatewayDevice.DeviceInfo.X_HW_HardwareVersion']) ||
      CwmpXmlParser.extractTag(xml, 'HardwareVersion');

    data.macAddress = this.getFirstParam(pMap, [
      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress',
      'Device.Ethernet.Interface.1.MACAddress',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress',
      'Device.DeviceInfo.MACAddress',
      'InternetGatewayDevice.DeviceInfo.MACAddress',
    ]);

    data.connectionRequestUrl =
      this.getFirstParam(pMap, ['Device.ManagementServer.ConnectionRequestURL', 'InternetGatewayDevice.ManagementServer.ConnectionRequestURL']) ||
      CwmpXmlParser.extractTag(xml, 'ConnectionRequestURL');

    data.connectionRequestUsername =
      this.getFirstParam(pMap, ['Device.ManagementServer.ConnectionRequestUsername', 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername']) ||
      CwmpXmlParser.extractTag(xml, 'ConnectionRequestUsername');

    data.connectionRequestPassword =
      this.getFirstParam(pMap, ['Device.ManagementServer.ConnectionRequestPassword', 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword']) ||
      CwmpXmlParser.extractTag(xml, 'ConnectionRequestPassword');

    // Dynamic Multi-Slot PPPoE / WAN extraction (prefer active INTERNET PPPoE slot over slot 1 TR069)
    let bestPppScore = -1;
    let bestPppUser = '';
    let bestPppIp = '';
    let bestPppStatus = '';
    let bestVlanRaw = '';
    for (const [k, v] of pMap.entries()) {
      const m = k.match(/((?:InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANPPPConnection\.\d+)|(?:Device\.PPP\.Interface\.\d+))\.Username$/i);
      if (m && v && String(v).trim()) {
        const prefix = m[1];
        const nameVal = pMap.get(`${prefix}.Name`) || '';
        const svcVal = pMap.get(`${prefix}.X_CT-COM_ServiceList`) || pMap.get(`${prefix}.ServiceList`) || '';
        const statusVal = pMap.get(`${prefix}.ConnectionStatus`) || pMap.get(`${prefix}.Status`) || '';
        const ipVal = pMap.get(`${prefix}.ExternalIPAddress`) || pMap.get(`${prefix}.IPCPLocalIPAddress`) || '';
        const isMgmt = /TR069|VOIP|VOICE/i.test(`${nameVal} ${svcVal}`) && !/INTERNET/i.test(`${nameVal} ${svcVal}`);
        const score = (isMgmt ? 0 : 100) + (/connected/i.test(statusVal) ? 50 : 0) + (ipVal && ipVal !== '0.0.0.0' ? 25 : 0);
        if (score > bestPppScore) {
          bestPppScore = score;
          bestPppUser = String(v).trim();
          if (ipVal && ipVal !== '0.0.0.0') bestPppIp = ipVal;
          if (statusVal) bestPppStatus = statusVal;
          const slotMatch = prefix.match(/WANConnectionDevice\.(\d+)\./i);
          const slotNum = slotMatch ? slotMatch[1] : '1';
          bestVlanRaw =
            pMap.get(`${prefix}.X_HW_VLAN`) ||
            pMap.get(`${prefix}.X_CT-COM_VlanID`) ||
            pMap.get(`${prefix}.VLANID`) ||
            pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.VLANIDMark`) ||
            pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.VLANIDMark`) ||
            bestVlanRaw;
        }
      }
    }

    data.wanIp = bestPppIp || this.getFirstParam(pMap, [
      'Device.IP.Interface.1.IPv4Address.1.IPAddress',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.ExternalIPAddress',
      'Device.PPP.Interface.1.IPCPLocalIPAddress',
    ]);

    data.pppoeUsername = bestPppUser || this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.Username',
      'Device.PPP.Interface.1.Username',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_PPPoEUsername',
    ]);

    const wanStatus = bestPppStatus || this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ConnectionStatus',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionStatus',
      'Device.IP.Interface.1.Status',
    ]);
    if (wanStatus) data.wanConnectionStatus = wanStatus;

    const rawPi = this.getFirstParam(pMap, [
      'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
      'Device.ManagementServer.PeriodicInformInterval',
    ]);
    if (rawPi) {
      const pi = parseInt(String(rawPi), 10);
      if (!isNaN(pi) && pi > 0) data.periodicInformInterval = pi;
    }

    const vlanRaw = bestVlanRaw || this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_VLAN',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_VLAN',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ZTE-COM_VLAN',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TPLINK_VlanID',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ALU_COM_VlanID',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_VLAN',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.X_CT-COM_VlanID',
      'Device.Ethernet.VLANTermination.1.VLANID',
    ]);
    if (vlanRaw) {
      const v = parseInt(vlanRaw, 10);
      if (!isNaN(v)) data.vlanId = v;
    }

    // Optical Power extraction (exact paths + dynamic fallback for Syrotech / Realtek / OEM extensions)
    let rawRx = this.getFirstParam(pMap, [
      'InternetGatewayDevice.X_SyroTech.GPON.OpticalRxPower',
      'InternetGatewayDevice.WANDevice.1.X_SYROTECH_OpticalInfo.RxPower',
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalRxPower',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.RxPower',
      'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_EponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TransceiverRxPower',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower',
      'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.RxPower',
      'InternetGatewayDevice.WANDevice.1.X_NETLINK_OpticalInfo.RxPower',
      'InternetGatewayDevice.WANDevice.1.X_TPLINK_OptInfo.RxPower',
      'InternetGatewayDevice.WANDevice.1.X_NOKIA_OpticalInfo.RxPower',
      'Device.Optical.Interface.1.OpticalSignalLevel',
      'Device.Optical.Interface.1.RxPower',
    ]);
    let rxPathMatched = '';
    if (!rawRx) {
      for (const [k, v] of pMap.entries()) {
        if (this.isOpticalRxPath(k) && v !== undefined && v !== '' && v !== 'N/A') {
          rawRx = v;
          rxPathMatched = k;
          break;
        }
      }
    }
    data.opticalRxPower = CwmpXmlParser.normalizeOpticalRxPower(rawRx, rxPathMatched);

    let rawTx = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalTxPower',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.TxPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_EponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.TxPower',
      'InternetGatewayDevice.WANDevice.1.X_SYROTECH_OpticalInfo.TxPower',
      'InternetGatewayDevice.WANDevice.1.X_TPLINK_OptInfo.TxPower',
      'InternetGatewayDevice.WANDevice.1.X_NOKIA_OpticalInfo.TxPower',
      'Device.Optical.Interface.1.TransmitOpticalPower',
      'Device.Optical.Interface.1.TxPower',
    ]);
    let txPathMatched = '';
    if (!rawTx) {
      for (const [k, v] of pMap.entries()) {
        if (this.isOpticalTxPath(k) && v !== undefined && v !== '' && v !== 'N/A') {
          rawTx = v;
          txPathMatched = k;
          break;
        }
      }
    }
    data.opticalTxPower = CwmpXmlParser.normalizeOpticalTxPower(rawTx, txPathMatched);

    const rawBias = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalBiasCurrent',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXBiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_TPLINK_OptInfo.BiasCurrent',
      'Device.Optical.Interface.1.TxBiasCurrent',
    ]);
    data.opticalBiasCurrent = CwmpXmlParser.normalizeBiasCurrent(rawBias);

    const rawVolt = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalVoltage',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.Voltage',
      'InternetGatewayDevice.WANDevice.1.X_TPLINK_OptInfo.Voltage',
      'Device.Optical.Interface.1.Voltage',
    ]);
    data.opticalVoltage = CwmpXmlParser.normalizeVoltage(rawVolt);

    const rawTemp = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.Temperature',
      'InternetGatewayDevice.DeviceInfo.X_HW_BoardTemp',
      'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_BoardTemperature',
      'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
      'Device.Optical.Interface.1.Temperature',
    ]);
    data.temperatureC = CwmpXmlParser.normalizeTemperature(rawTemp);

    // Wi-Fi SSIDs & Passwords across TR-098 instances 1..8 & TR-181 (using band detection + non-masked secrets)
    const pMapObj = this.mapToRecord(pMap);
    for (let i = 1; i <= 8; i++) {
      const s =
        pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.SSID`) ||
        pMap.get(`Device.WiFi.SSID.${i}.SSID`);
      if (!s) continue;
      const band = CwmpVendorProfiles.determineWifiBand(pMapObj, i, s);
      const pwd = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(i, pMapObj));
      if (band === '5GHz' && !data.wifiSsid5g) {
        data.wifiSsid5g = s;
        if (pwd) data.wifiPass5g = pwd;
      } else if (band === '2.4GHz' && !data.wifiSsid24) {
        data.wifiSsid24 = s;
        if (pwd) data.wifiPass24 = pwd;
      }
    }

    if (!data.wifiSsid24) {
      data.wifiSsid24 = this.getFirstParam(pMap, [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
        'Device.WiFi.SSID.1.SSID',
      ]);
    }
    if (!data.wifiPass24) {
      data.wifiPass24 = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(1, pMapObj));
    }

    if (!data.wifiSsid5g) {
      for (const fallbackIdx of [5, 3, 2, 6]) {
        const candidateSsid = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${fallbackIdx}.SSID`);
        if (candidateSsid && CwmpVendorProfiles.determineWifiBand(pMapObj, fallbackIdx, candidateSsid) !== '2.4GHz') {
          data.wifiSsid5g = candidateSsid;
          data.wifiPass5g = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(fallbackIdx, pMapObj));
          break;
        }
      }
      if (!data.wifiSsid5g) {
        data.wifiSsid5g = this.getFirstParam(pMap, ['Device.WiFi.SSID.2.SSID']);
      }
    }
    if (!data.wifiPass5g) {
      data.wifiPass5g = this.pickNonMaskedSecret(pMap, [
        ...this.getWifiSecretCandidatePaths(5, pMapObj),
        ...this.getWifiSecretCandidatePaths(3, pMapObj),
        ...this.getWifiSecretCandidatePaths(2, pMapObj),
      ]);
    }

    const rawHostCount = this.getFirstParam(pMap, [
      'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries',
      'Device.Hosts.HostNumberOfEntries',
    ]);
    if (rawHostCount !== undefined && rawHostCount !== null && rawHostCount !== '') {
      const parsedHosts = parseInt(String(rawHostCount), 10);
      if (!isNaN(parsedHosts)) {
        data.lanHostCount = parsedHosts;
      }
    }

    // Manufacturer & Brand Normalization
    if (data.productClass && (!data.manufacturer || data.manufacturer === 'Unknown' || data.manufacturer === 'GPON')) {
      if (/RH821|RL8|Richer/i.test(data.productClass)) data.manufacturer = 'RicherLink';
      else if (/HG8|EG8|OptiX|Huawei/i.test(data.productClass)) data.manufacturer = 'Huawei';
      else if (/F670|F660|F680|ZTE/i.test(data.productClass)) data.manufacturer = 'ZTE';
      else if (/V280|VSOL|V-SOL/i.test(data.productClass)) data.manufacturer = 'V-SOL';
      else if (/SY-|Syro/i.test(data.productClass)) data.manufacturer = 'Syrotech';
      else if (/HG323|Netlink/i.test(data.productClass)) data.manufacturer = 'Netlink';
      else if (/G-140|G-240|G-2425|G-1425|G-1426|I-240|Nokia|ALCL/i.test(data.productClass)) data.manufacturer = 'Nokia';
      else if (/XC220|Archer|TP-Link/i.test(data.productClass)) data.manufacturer = 'TP-Link';
    }

    // Recursive extraction of all WAN Profiles from parameter map
    const wanProfiles: any[] = [];
    const pppKeys = new Set<string>();
    const ipKeys = new Set<string>();
    for (const [k] of pMap.entries()) {
      const pppMatch = k.match(/(InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANPPPConnection\.\d+)\./);
      if (pppMatch) pppKeys.add(pppMatch[1]);
      const ipMatch = k.match(/(InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANIPConnection\.\d+)\./);
      if (ipMatch) ipKeys.add(ipMatch[1]);
    }

    for (const prefix of pppKeys) {
      const rawName = pMap.get(`${prefix}.Name`) || '';
      const user = pMap.get(`${prefix}.Username`) || '';
      const extIp = pMap.get(`${prefix}.ExternalIPAddress`) || '';
      const slotMatch = prefix.match(/WANConnectionDevice\.(\d+)\./i);
      const slotNum = slotMatch ? slotMatch[1] : '1';

      const vlanRaw = pMap.get(`${prefix}.X_CT-COM_VlanID`) ||
                      pMap.get(`${prefix}.X_CT_COM_VlanID`) ||
                      pMap.get(`${prefix}.X_HW_VLAN`) ||
                      pMap.get(`${prefix}.X_ZTE-COM_VLAN`) ||
                      pMap.get(`${prefix}.VLANID`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.VLANIDMark`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.VLANIDMark`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANLinkConfig.VLANIDMark`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.VLANID`);
      const vlan = vlanRaw ? parseInt(String(vlanRaw), 10) : undefined;
      const rawEponMode = pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.Mode`) ||
                          pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.Mode`);
      const isVlanTagMode = rawEponMode !== undefined ? String(rawEponMode) === '1' : Boolean(vlan && vlan > 0);

      const status = pMap.get(`${prefix}.ConnectionStatus`) || (extIp && extIp !== '0.0.0.0' ? 'Connected' : 'Connecting');
      const serviceRaw = pMap.get(`${prefix}.X_CT-COM_ServiceList`) || pMap.get(`${prefix}.X_CT_COM_ServiceList`) || pMap.get(`${prefix}.X_HW_SERVICELIST`) || pMap.get(`${prefix}.ServiceList`) || '';

      const isTr069 = /TR069/i.test(rawName) || (serviceRaw && /TR069/i.test(serviceRaw) && !/INTERNET|VOIP/i.test(serviceRaw));
      const isVoip = /VOIP|VOICE/i.test(rawName) || /VOIP|VOICE/i.test(serviceRaw);
      const isInternet = /INTERNET/i.test(rawName) || /INTERNET/i.test(serviceRaw) || (!isTr069 && !isVoip);
      const resolvedService = isTr069 ? 'TR069' : (isVoip ? 'VOIP' : 'INTERNET');

      const fallbackName = `${slotNum}_${resolvedService}_R${vlan ? `_VID_${vlan}` : ''}`;
      const pppPass = this.pickNonMaskedSecret(pMap, [`${prefix}.Password`, `${prefix}.X_CT-COM_Password`]);
      const gateway = pMap.get(`${prefix}.DefaultGateway`) || '';
      const mask = pMap.get(`${prefix}.SubnetMask`) || '';

      wanProfiles.push({
        name: rawName || fallbackName,
        connectionType: 'PPPoE',
        type: 'PPPoE',
        mode: 'Route',
        linkMode: 'PPP',
        cpeObjectPath: `${prefix}.`,
        pppoeUsername: user,
        ...(pppPass ? { pppoePasswordEncrypted: pppPass } : {}),
        ipAddress: extIp || null,
        vlanId: vlan,
        vlanMode: isVlanTagMode ? 'TAG' : 'UNTAG',
        vlanEnabled: isVlanTagMode && Boolean(vlan),
        status,
        serviceType: resolvedService,
        serviceUsage: {
          internet: Boolean(isInternet),
          voip: Boolean(isVoip),
          tr069: Boolean(isTr069),
          iptvDhcp: false,
          iptvBridge: false,
          other: false,
        },
        gateway: gateway || null,
        subnetMask: mask || null,
        enabled: pMap.get(`${prefix}.Enable`) !== '0',
        isProtected: Boolean(isTr069),
      });
    }

    for (const prefix of ipKeys) {
      const rawName = pMap.get(`${prefix}.Name`) || '';
      const addrType = pMap.get(`${prefix}.AddressingType`) || 'DHCP';
      const extIp = pMap.get(`${prefix}.ExternalIPAddress`) || '';
      const slotMatch = prefix.match(/WANConnectionDevice\.(\d+)\./i);
      const slotNum = slotMatch ? slotMatch[1] : '1';

      const vlanRaw = pMap.get(`${prefix}.X_CT-COM_VlanID`) ||
                      pMap.get(`${prefix}.X_CT_COM_VlanID`) ||
                      pMap.get(`${prefix}.X_HW_VLAN`) ||
                      pMap.get(`${prefix}.X_ZTE-COM_VLAN`) ||
                      pMap.get(`${prefix}.VLANID`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.VLANIDMark`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.VLANIDMark`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANLinkConfig.VLANIDMark`) ||
                      pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.VLANID`);
      const vlan = vlanRaw ? parseInt(String(vlanRaw), 10) : undefined;
      const rawEponMode = pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.Mode`) ||
                          pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.Mode`);
      const isVlanTagMode = rawEponMode !== undefined ? String(rawEponMode) === '1' : Boolean(vlan && vlan > 0);

      const connType = pMap.get(`${prefix}.ConnectionType`) || '';
      const isBridged = connType === 'IP_Bridged' || /bridge/i.test(rawName);
      const mode = isBridged ? 'Bridge' : 'Route';

      const status = pMap.get(`${prefix}.ConnectionStatus`) || (extIp && extIp !== '0.0.0.0' ? 'Connected' : 'Connecting');
      const serviceRaw = pMap.get(`${prefix}.X_CT-COM_ServiceList`) || pMap.get(`${prefix}.X_CT_COM_ServiceList`) || pMap.get(`${prefix}.X_HW_SERVICELIST`) || pMap.get(`${prefix}.ServiceList`) || '';

      const isTr069 = /TR069/i.test(rawName) || (serviceRaw && /TR069/i.test(serviceRaw) && !/INTERNET|VOIP/i.test(serviceRaw));
      const isVoip = /VOIP|VOICE/i.test(rawName) || /VOIP|VOICE/i.test(serviceRaw);
      const isInternet = /INTERNET/i.test(rawName) || /INTERNET/i.test(serviceRaw);
      const resolvedService = isTr069 ? 'TR069' : (isVoip ? 'VOIP' : (isInternet ? 'INTERNET' : 'OTHER'));

      const fallbackName = `${slotNum}_${resolvedService}_${isBridged ? 'B' : 'IP'}${vlan ? `_VID_${vlan}` : ''}`;

      wanProfiles.push({
        name: rawName || fallbackName,
        connectionType: isBridged ? 'Bridge' : (addrType === 'Static' ? 'Static' : 'DHCP'),
        type: addrType,
        mode,
        linkMode: 'IP',
        cpeObjectPath: `${prefix}.`,
        ipAddress: extIp || null,
        vlanId: vlan,
        vlanMode: isVlanTagMode ? 'TAG' : 'UNTAG',
        vlanEnabled: isVlanTagMode && Boolean(vlan),
        status,
        serviceType: resolvedService,
        serviceUsage: {
          internet: Boolean(isInternet),
          voip: Boolean(isVoip),
          tr069: Boolean(isTr069),
          iptvDhcp: false,
          iptvBridge: isBridged,
          other: false,
        },
        enabled: pMap.get(`${prefix}.Enable`) !== '0',
        isProtected: Boolean(isTr069),
      });
    }

    if (wanProfiles.length > 0) {
      (data as any).wanProfiles = wanProfiles;
    }

    // Recursive extraction of all LAN Host & Wi-Fi Associated Devices
    const connectedClients: any[] = [];
    const hostPrefixes = new Set<string>();
    for (const [k] of pMap.entries()) {
      const hostMatch = k.match(/(InternetGatewayDevice\.LANDevice\.\d+\.Hosts\.Host\.\d+)\./);
      if (hostMatch) hostPrefixes.add(hostMatch[1]);
      const wlanAssocMatch = k.match(/(InternetGatewayDevice\.LANDevice\.\d+\.WLANConfiguration\.\d+\.AssociatedDevice\.\d+)\./);
      if (wlanAssocMatch) hostPrefixes.add(wlanAssocMatch[1]);
    }

    for (const prefix of hostPrefixes) {
      const mac = pMap.get(`${prefix}.MACAddress`) || pMap.get(`${prefix}.AssociatedDeviceMACAddress`);
      const ip = pMap.get(`${prefix}.IPAddress`) || pMap.get(`${prefix}.AssociatedDeviceIPAddress`);
      const rawHostName = pMap.get(`${prefix}.HostName`) || pMap.get(`${prefix}.X_CT_COM_HostName`);
      const rawIface = pMap.get(`${prefix}.InterfaceType`);
      const is5G = prefix.includes('WLANConfiguration.3') || prefix.includes('WLANConfiguration.4') || prefix.includes('WLANConfiguration.6') || (rawIface && rawIface.includes('5'));
      const friendlyName = CwmpVendorProfiles.resolveFriendlyDeviceName(rawHostName, mac, is5G ? '5GHz' : '2.4GHz');
      const isWireless = CwmpVendorProfiles.isWirelessClient(mac, friendlyName, rawIface);
      const finalIface = is5G ? '5GHz' : (isWireless ? '2.4GHz' : 'Ethernet');
      const active = pMap.get(`${prefix}.Active`) !== '0' && pMap.get(`${prefix}.AssociatedDeviceAuthenticationState`) !== '0';

      if (mac || ip) {
        connectedClients.push({
          mac: mac || '',
          macAddress: mac || '',
          hostname: friendlyName,
          hostName: friendlyName,
          ip: ip || '',
          ipAddress: ip || '',
          connected: active,
          active: active,
          interfaceType: finalIface,
          connectedInterface: finalIface === 'Ethernet' ? 'LAN Ethernet' : `${finalIface} Wi-Fi`,
          band: finalIface === '5GHz' ? '5GHz' : '2.4GHz',
          lastSeen: new Date()
        });
      }
    }

    if (connectedClients.length > 0) {
      data.connectedClients = connectedClients;
      data.lanHostCount = connectedClients.length;
    }

    return data;
  }

  /**
   * Resolves target tenant dynamically based on path slug, subdomain, host header, existing device assignment, or subscriber PPPoE
   */
  static async resolveTenant(
    hostHeader?: string,
    pathOrQuerySlug?: string,
    cpeContext?: {
      serialAliases?: string[];
      pppoeUsername?: string;
      macAddress?: string;
      ssid?: string;
      wanIp?: string;
    }
  ): Promise<ITenant | null> {
    // 1. Super Admin Manual Pre-Mapping (Explicit assignment from Quarantine Workbench)
    if (cpeContext?.serialAliases && cpeContext.serialAliases.length > 0) {
      const mappedRecord = await PendingDeviceMapping.findOne({
        serialNumber: { $in: cpeContext.serialAliases },
        mappedTenantId: { $exists: true, $ne: null },
      });

      if (mappedRecord?.mappedTenantId) {
        if (typeof mappedRecord.mappedTenantId === 'object' && (mappedRecord.mappedTenantId as any).slug) {
          return mappedRecord.mappedTenantId as any;
        }
        const t = await Tenant.findById(mappedRecord.mappedTenantId);
        if (t) return t;
      }
    }

    // 2. Strict Dedicated Endpoint Resolution: Dedicated URL path slug (/tr069/:slug) or Subdomain (:slug.ciniplay.in)
    let incomingSlug: string | undefined;
    if (pathOrQuerySlug) {
      incomingSlug = pathOrQuerySlug.toLowerCase().trim();
    } else if (hostHeader) {
      const hostClean = hostHeader.split(':')[0].toLowerCase().trim();
      const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostClean);

      if (!isIpAddress) {
        const hostParts = hostClean.split('.');
        const baseDomainPrefix = (process.env.BASE_DOMAIN || '').split('.')[0];
        if (hostParts.length > 2 && hostParts[0] !== 'www' && (!baseDomainPrefix || hostParts[0] !== baseDomainPrefix)) {
          incomingSlug = hostParts[0];
        }
      }
    }

    // If an explicit dedicated slug was provided, resolve the tenant
    if (incomingSlug) {
      let tenant = await Tenant.findOne({ slug: incomingSlug });
      if (tenant) return tenant;

      tenant = await Tenant.findOne({
        $or: [
          { slug: new RegExp(`^${incomingSlug}`, 'i') },
          { subdomain: new RegExp(`^${incomingSlug}`, 'i') },
          { name: new RegExp(`^${incomingSlug}`, 'i') },
        ],
      });
      if (tenant) return tenant;
    }

    // If dedicated subdomain or custom domain (e.g. operator1.ciniplay.in:7547), check active tenant domain
    if (hostHeader) {
      const hostClean = hostHeader.split(':')[0].toLowerCase().trim();
      const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostClean);
      if (!isIpAddress) {
        const tenant = await Tenant.findOne({
          $or: [
            { subdomain: hostClean },
            { customDomain: hostClean },
          ],
          status: 'active',
        });
        if (tenant) return tenant;
      }
    }

    // 3. Registered Hardware Owner (Validated across tenants if ONT is pre-registered or assigned to a customer)
    if (cpeContext?.serialAliases && cpeContext.serialAliases.length > 0) {
      const existingDevice = await Device.findOne({
        serialNumber: { $in: cpeContext.serialAliases },
        tenantId: { $exists: true, $ne: null },
      });

      if (existingDevice?.tenantId) {
        const t = await Tenant.findById(existingDevice.tenantId);
        if (t) return t;
      }

      // Check if assigned to a customer in any tenant
      const customer = await Customer.findOne({
        assignedOntSerial: { $in: cpeContext.serialAliases },
        tenantId: { $exists: true, $ne: null },
      });
      if (customer?.tenantId) {
        const t = await Tenant.findById(customer.tenantId);
        if (t) return t;
      }
    }

    // 4. Default / Single Active Tenant Fallback for direct IP /cwmp connections
    const activeTenants = await Tenant.find({ status: 'active' }).limit(2);
    if (activeTenants.length === 1) {
      return activeTenants[0];
    }

    return null;
  }

  /**
   * Continuous Optical Telemetry Ingestion, Deduplication, History (last 20 only), and Alert Engine
   */
  static async processOpticalTelemetryChange(
    device: IDevice,
    rxPower?: number,
    txPower?: number,
    bias?: number,
    volt?: number,
    temp?: number,
    sourcePath?: string
  ): Promise<void> {
    if (rxPower === undefined && txPower === undefined) return;

    if (!device.rxPowerHistory) device.rxPowerHistory = [];
    const lastHist = device.rxPowerHistory.length > 0
      ? device.rxPowerHistory[device.rxPowerHistory.length - 1]
      : null;

    const currentRx = rxPower !== undefined ? rxPower : device.currentRxPowerDbm;
    const currentTx = txPower !== undefined ? txPower : device.currentTxPowerDbm;

    if (currentRx === undefined) return;

    const deltaRx = lastHist ? parseFloat((currentRx - lastHist.valueDbm).toFixed(2)) : 0;
    const deltaTx = (lastHist?.txPowerDbm !== undefined && currentTx !== undefined)
      ? parseFloat((currentTx - lastHist.txPowerDbm).toFixed(2))
      : 0;

    const isRxChanged = !lastHist || Math.abs(currentRx - lastHist.valueDbm) >= 0.01;
    const isTxChanged = currentTx !== undefined && (!lastHist || lastHist.txPowerDbm === undefined || Math.abs(currentTx - lastHist.txPowerDbm) >= 0.01);

    // 1. DEDUPLICATION: Only record a new history entry when values have changed
    if (isRxChanged || isTxChanged) {
      device.rxPowerHistory.push({
        valueDbm: currentRx,
        txPowerDbm: currentTx,
        biasCurrentMa: bias ?? device.biasCurrentMa,
        voltageV: volt ?? device.opticalVoltageV,
        temperatureC: temp ?? device.temperatureC,
        timestamp: new Date(),
      });

      // 2. LIMIT HISTORY: Retain ONLY the last 20 changes
      if (device.rxPowerHistory.length > 20) {
        device.rxPowerHistory = device.rxPowerHistory.slice(-20);
      }

      device.currentRxPowerDbm = currentRx;
      if (currentTx !== undefined) device.currentTxPowerDbm = currentTx;
      device.opticalDelta = deltaRx;
      device.opticalHealthTrend = deltaRx > 0.3 ? 'improving' : deltaRx < -0.3 ? 'degrading' : 'stable';
      if (sourcePath) device.opticalTelemetrySourcePath = sourcePath;

      const previousStatus = device.opticalStatus;
      const newStatus = currentRx < -27.0 ? 'critical' : currentRx < -24.5 ? 'warning' : 'normal';
      device.opticalStatus = newStatus;

      // 3. 0.5 or 1.0 dB Change Detection & Critical/Warning Alert Generation
      if (lastHist && (Math.abs(deltaRx) >= 0.5 || currentRx < -27.0)) {
        const severity = (Math.abs(deltaRx) >= 1.0 || currentRx < -27.0) ? 'critical' : 'warning';
        
        // Find associated customer
        let customer = null;
        if (device.customerId) {
          customer = await Customer.findById(device.customerId);
        } else if (device.tenantId) {
          customer = await Customer.findOne({ assignedDeviceId: device._id, tenantId: device.tenantId });
        }

        const customerName = customer?.fullName || 'Unassigned Subscriber';

        // Save Alert in Database with strict tenant isolation
        const alert = await Alert.create({
          tenantId: device.tenantId,
          severity,
          sourceType: 'ONT_OPTICAL',
          sourceId: device.serialNumber,
          sourceName: customerName,
          message: `Optical power shift of ${deltaRx > 0 ? '+' : ''}${deltaRx} dB detected on ${device.serialNumber} (${customerName}). Old Rx: ${lastHist.valueDbm.toFixed(2)} dBm, New Rx: ${currentRx.toFixed(2)} dBm${currentTx !== undefined ? ` (Tx: ${currentTx.toFixed(2)} dBm)` : ''}.`,
          valueRecorded: currentRx,
          thresholdDbm: -27.0,
          acknowledged: false,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          occurrencesCount: 1,
        });

        console.log(
          `[OPTICAL_ALERT_SAVED] Alert ${alert._id} created for ${device.serialNumber} | Delta: ${deltaRx} dB | Severity: ${severity}`
        );

        // Resolve Assigned Operators & Technicians for WhatsApp Dispatch
        if (device.tenantId) {
          const operatorUsers = await User.find({
            tenantId: device.tenantId,
            role: { $in: ['operator_admin', 'noc_operator'] },
            status: 'active',
          });

          const technicianUsers = await User.find({
            tenantId: device.tenantId,
            role: 'technician',
            status: 'active',
          });

          const tenant = await Tenant.findById(device.tenantId);

          const recipients: Array<{ phone: string; role: 'operator' | 'technician' | 'admin' }> = [];
          if (tenant?.owner?.phone) {
            recipients.push({ phone: tenant.owner.phone, role: 'operator' });
          }
          for (const op of operatorUsers) {
            if (op.phone && !recipients.some(r => r.phone === op.phone)) {
              recipients.push({ phone: op.phone, role: 'operator' });
            }
          }
          for (const tech of technicianUsers) {
            if (tech.phone && !recipients.some(r => r.phone === tech.phone)) {
              recipients.push({ phone: tech.phone, role: 'technician' });
            }
          }

          for (const r of recipients) {
            WhatsAppService.sendOpticalPowerAlert({
              tenantId: device.tenantId.toString(),
              recipientPhone: r.phone,
              recipientRole: r.role,
              customerName,
              serialNumber: device.serialNumber,
              oldRxPowerDbm: lastHist.valueDbm,
              newRxPowerDbm: currentRx,
              deltaRxDb: deltaRx,
              oldTxPowerDbm: lastHist.txPowerDbm,
              newTxPowerDbm: currentTx,
              deltaTxDb: deltaTx,
              timestamp: new Date(),
              severity,
            }).catch(err => console.error('[CwmpService] WhatsApp optical alert failed:', err));
          }
        }
      }

      // 4. AUTOMATIC RECOVERY ALERT: When optical power returns to normal range (-10 dBm to -24.5 dBm)
      const wasDegraded = previousStatus === 'critical' || previousStatus === 'warning' || (lastHist && lastHist.valueDbm < -27.0);
      const isNowNormal = currentRx >= -24.5 && currentRx <= -10.0;

      if (wasDegraded && isNowNormal) {
        // Auto-acknowledge previous open optical alerts for this device
        await Alert.updateMany(
          {
            tenantId: device.tenantId,
            sourceId: device.serialNumber,
            sourceType: 'ONT_OPTICAL',
            acknowledged: false,
          },
          {
            $set: {
              acknowledged: true,
              acknowledgedAt: new Date(),
            },
          }
        );

        let customer = null;
        if (device.customerId) {
          customer = await Customer.findById(device.customerId);
        } else if (device.tenantId) {
          customer = await Customer.findOne({ assignedDeviceId: device._id, tenantId: device.tenantId });
        }
        const customerName = customer?.fullName || 'Unassigned Subscriber';

        if (device.tenantId) {
          const operatorUsers = await User.find({
            tenantId: device.tenantId,
            role: { $in: ['operator_admin', 'noc_operator'] },
            status: 'active',
          });
          const technicianUsers = await User.find({
            tenantId: device.tenantId,
            role: 'technician',
            status: 'active',
          });
          const tenant = await Tenant.findById(device.tenantId);

          const recipients: Array<{ phone: string; role: 'operator' | 'technician' | 'admin' }> = [];
          if (tenant?.owner?.phone) recipients.push({ phone: tenant.owner.phone, role: 'operator' });
          for (const op of operatorUsers) {
            if (op.phone && !recipients.some(r => r.phone === op.phone)) recipients.push({ phone: op.phone, role: 'operator' });
          }
          for (const tech of technicianUsers) {
            if (tech.phone && !recipients.some(r => r.phone === tech.phone)) recipients.push({ phone: tech.phone, role: 'technician' });
          }

          for (const r of recipients) {
            WhatsAppService.sendOpticalRecoveryAlert({
              tenantId: device.tenantId.toString(),
              recipientPhone: r.phone,
              recipientRole: r.role,
              customerName,
              serialNumber: device.serialNumber,
              previousRxPowerDbm: lastHist ? lastHist.valueDbm : -28.0,
              currentRxPowerDbm: currentRx,
              currentTxPowerDbm: currentTx,
              timestamp: new Date(),
            }).catch(err => console.error('[CwmpService] WhatsApp optical recovery alert failed:', err));
          }
        }
      }
    }
  }

  /**
   * Phase 1: Handles incoming Inform SOAP message from CPE
   */
  static async handleInform(
    xml: string,
    clientIp: string,
    hostHeader?: string,
    pathOrQuerySlug?: string,
    connectionKey?: string
  ): Promise<{ responseXml: string; sessionId: string }> {
    this.totalHits++;
    this.cleanExpiredSessions();

    const informData = this.parseInformXml(xml);
    const rawSerial = CwmpVendorProfiles.formatPonSerialNumber(informData.serialNumber) || `CPE-${clientIp.replace(/[^0-9]/g, '').slice(-8)}`;
    const serialAliases = CwmpXmlParser.getSerialNumberAliases(rawSerial);

    // Multi-factor tenant resolution (Explicit Path Slug -> Subdomain -> Existing DB Device -> Customer Match -> Heuristics -> Fallback)
    const tenant = await this.resolveTenant(hostHeader, pathOrQuerySlug, {
      serialAliases,
      pppoeUsername: informData.pppoeUsername,
      macAddress: informData.macAddress,
      ssid: informData.wifiSsid24 || informData.wifiSsid5g,
      wanIp: informData.wanIp,
    });
    const tenantSlug = tenant?.slug || 'quarantine_pending';
    const model = informData.productClass || informData.hardwareVersion || 'GPON-ONT';
    const vendorName = informData.manufacturer || 'Generic GPON';
    const detectedVendor = CwmpVendorProfiles.detectVendor(vendorName, model, informData.oui, informData.productClass, xml);

    // FILTER OUT DUMMY CRAWLERS & DISCOVERY SCANNERS:
    // Drop known scanner probes (e.g. DISCOVERYSERVICE, Shodan, Censys, honeypot probes) to prevent corrupting inventory.
    const isDummyScanner =
      /discoveryservice|shodan|censys|shadowserver|zgrab|nmap|masscan|scanner|dummy_cpe/i.test(vendorName) ||
      /discoveryservice|testcpe|dummy/i.test(model) ||
      /discoveryservice/i.test(rawSerial) ||
      /discoveryservice/i.test(informData.oui || '');

    if (isDummyScanner) {
      console.warn(`[CWMP ACS] ⛔ Blocked dummy scanner probe from [${clientIp}] (Vendor: ${vendorName}, Serial: ${rawSerial})`);
      const faultXml = this.buildSoapFault('1', 9001, 'Request Denied: Unrecognized Device Hardware');
      return { responseXml: faultXml, sessionId: `scanner_drop_${Date.now()}` };
    }

    // STRICT SECURITY GATE: Verify Tenant Ownership vs Incoming Routing Path
    // Devices must strictly communicate within their assigned Tenant boundary.
    let isTenantMismatch = false;
    let registeredDevice: any = null;

    if (tenant) {
      registeredDevice = await Device.findOne({
        serialNumber: { $in: serialAliases },
        tenantId: tenant._id,
      });

      // Check if this ONT serial is already claimed by a different/foreign tenant
      const foreignDevice = await Device.findOne({
        serialNumber: { $in: serialAliases },
        tenantId: { $ne: tenant._id },
      });

      if (foreignDevice && foreignDevice.tenantId) {
        isTenantMismatch = true;
        MetricsService.recordTenantMismatch();
        console.error(
          `[TENANT_MISMATCH_SECURITY_EVENT] 🚨 CRITICAL: ONT ${rawSerial} (Owner Tenant: ${foreignDevice.tenantId}) hit mismatched slug "${pathOrQuerySlug || 'none'}" (Target Tenant: ${tenant._id}). BLOCKING ALL ACS COMMANDS & TELEMETRY ACCESS TO PREVENT CROSS-OPERATOR CONTAMINATION.`
        );

        // Quarantine immediately into PendingDeviceMapping
        try {
          await PendingDeviceMapping.findOneAndUpdate(
            { serialNumber: rawSerial },
            {
              $set: {
                manufacturer: vendorName,
                oui: informData.oui,
                productClass: model,
                softwareVersion: informData.softwareVersion,
                hardwareVersion: informData.hardwareVersion,
                macAddress: informData.macAddress,
                incomingHost: hostHeader,
                incomingUrl: `/tr069${pathOrQuerySlug ? `/${pathOrQuerySlug}` : ''}`,
                pathOrQuerySlug,
                clientIp,
                reason: 'CONFLICTING_HEADER',
                rawInformXml: CwmpXmlParser.maskSensitiveData(xml.substring(0, 10000)),
                lastSeenAt: new Date(),
              },
              $setOnInsert: {
                status: 'PENDING',
                firstSeenAt: new Date(),
                alertCount: 0,
              },
            },
            { upsert: true, new: true }
          );
        } catch (err) {
          console.error('[CWMP] Error upserting mismatched PendingDeviceMapping:', err);
        }

        WhatsAppService.sendPendingDeviceAlert({
          serialNumber: rawSerial,
          manufacturer: vendorName,
          oui: informData.oui,
          productClass: model,
          incomingHost: hostHeader,
          incomingUrl: `/tr069${pathOrQuerySlug ? `/${pathOrQuerySlug}` : ''}`,
          pathOrQuerySlug,
          clientIp,
          reason: 'CONFLICTING_HEADER',
        }).catch(() => {});
      }
    } else {
      // Unmapped tenant: ONT reached ACS root URL without valid slug or matching subdomain
      MetricsService.recordQuarantinedDevice();
      console.warn(
        `[UNMAPPED_TENANT_QUARANTINE] ⚠️ ONT ${rawSerial} connected without valid tenant slug or subdomain (Host: ${hostHeader || 'unknown'}). Isolated to Pending Quarantine Pool.`
      );
      try {
        await PendingDeviceMapping.findOneAndUpdate(
          { serialNumber: rawSerial },
          {
            $set: {
              manufacturer: vendorName,
              oui: informData.oui,
              productClass: model,
              softwareVersion: informData.softwareVersion,
              hardwareVersion: informData.hardwareVersion,
              macAddress: informData.macAddress,
              incomingHost: hostHeader,
              incomingUrl: `/tr069${pathOrQuerySlug ? `/${pathOrQuerySlug}` : ''}`,
              pathOrQuerySlug,
              clientIp,
              reason: 'UNMAPPED_TENANT',
              rawInformXml: CwmpXmlParser.maskSensitiveData(xml.substring(0, 10000)),
              lastSeenAt: new Date(),
            },
            $setOnInsert: {
              status: 'PENDING',
              firstSeenAt: new Date(),
              alertCount: 0,
            },
          },
          { upsert: true, new: true }
        );
      } catch (err) {
        console.error('[CWMP] Error upserting unmapped PendingDeviceMapping:', err);
      }
    }

    // Record Prometheus metric
    MetricsService.recordCwmpInform();

    // Create session tracking
    const sessionId = `cwmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const sessionContext: ActiveSessionContext = {
      sessionId,
      serialNumber: rawSerial,
      serialAliases,
      vendor: detectedVendor,
      manufacturer: vendorName,
      modelName: model,
      firmwareVersion: informData.softwareVersion || 'V1.0.0',
      hardwareVersion: informData.hardwareVersion || 'V1.0',
      clientIp,
      tenantId: isTenantMismatch ? '' : (tenant ? tenant._id.toString() : ''),
      tenantSlug: isTenantMismatch ? 'quarantine_mismatch' : tenantSlug,
      stage: isTenantMismatch ? 'MISMATCH_BLOCKED' : 'INFORM_ACKED',
      events: informData.events || [],
      timestamp: Date.now(),
    };

    await this.saveSession(sessionId, connectionKey, sessionContext);

    const rxPower = informData.opticalRxPower;
    const txPower = informData.opticalTxPower;
    const opticalStatus = rxPower !== undefined
      ? (rxPower < -27.0 ? 'critical' : rxPower < -24.5 ? 'warning' : 'normal')
      : 'normal';

    let hitStatus: 'PROVISIONED' | 'DISCOVERED' | 'HEARTBEAT' = 'DISCOVERED';

    let resolvedDeviceId: string | undefined;
    let resolvedCustomerId: string | undefined;

    if (tenant && !isTenantMismatch) {
      // Lookup device in database strictly scoped to this tenant
      let device = registeredDevice;
      if (!device) {
        device = await Device.findOne({
          serialNumber: { $in: serialAliases },
          tenantId: tenant._id,
        });
      }

      const historyRecord: IRxPowerRecord | null = rxPower !== undefined ? {
        valueDbm: rxPower,
        txPowerDbm: txPower,
        timestamp: new Date(),
      } : null;

      if (device) {
        hitStatus = 'HEARTBEAT';
        device.status = 'online';
        device.lastInform = new Date();
        device.cwmpSessionId = sessionId;

        // 3-WAY HARDWARE IDENTITY LOCK: Registered Owner Tenant is IMMUTABLE
        if (device.tenantId) {
          sessionContext.tenantId = device.tenantId.toString();
        }

        if (informData.wanIp) device.ipAddress = informData.wanIp;
        device.externalIpAddress = clientIp;
        if (informData.pppoeUsername) (device as any).pppoeUsername = informData.pppoeUsername;
        if (informData.vlanId !== undefined) (device as any).wanVlan = informData.vlanId;
        if (informData.periodicInformInterval) {
          device.periodicInformInterval = informData.periodicInformInterval;
          // Drift detection: reset periodicInformConfigured if router's interval differs from target
          const targetInterval = parseInt(process.env.CWMP_RECOMMENDED_INFORM_INTERVAL || '300', 10);
          if (informData.periodicInformInterval !== targetInterval && (device as any).periodicInformConfigured) {
            (device as any).periodicInformConfigured = false;
            console.log(`[CWMP ACS] ⚠️ PeriodicInform drift detected on ${rawSerial}: reported ${informData.periodicInformInterval}s vs target ${targetInterval}s. Resetting periodicInformConfigured for re-push.`);
          }
        }
        if (informData.softwareVersion) device.softwareVersion = informData.softwareVersion;
        if (informData.hardwareVersion) device.hardwareVersion = informData.hardwareVersion;
        if (informData.macAddress) device.macAddress = informData.macAddress;
        if (informData.productClass) device.modelName = informData.productClass;
        if (informData.connectionRequestUrl) device.connectionRequestUrl = informData.connectionRequestUrl;
        const incomingCrUser = String((informData as any).connectionRequestUsername || '').trim();
        const incomingCrPass = String((informData as any).connectionRequestPassword || '').trim();
        if (incomingCrUser && !/^\*+$/.test(incomingCrUser)) device.connectionRequestUsername = incomingCrUser;
        if (incomingCrPass && !/^\*+$/.test(incomingCrPass)) device.connectionRequestPassword = incomingCrPass;

        device.lastRawInformXml = xml;
        device.rawParameters = this.mergeInformRawParameters(device.rawParameters, xml);
        if (typeof (device as any).markModified === 'function') {
          (device as any).markModified('rawParameters');
        }
        // Note: Do not update lastParameterSyncAt on Inform; it is updated on successful GPV in handleGetParameterValuesResponse
        if (
          !device.lastParameterSyncStatus ||
          device.lastParameterSyncStatus === 'NEVER_SYNCED' ||
          String(device.lastParameterSyncStatus).startsWith('FAULT_')
        ) {
          device.lastParameterSyncStatus = 'INFORM_SYNCED';
        }

        if (!device.wifi24) {
          device.wifi24 = {
            ssid: informData.wifiSsid24 || '',
            password: informData.wifiPass24 || '',
            enabled: true,
            channel: 6,
            channelAuto: true,
            bandwidthMhz: 20,
            securityMode: 'WPA2-PSK',
            txPowerPercent: 100,
          };
        } else {
          if (informData.wifiSsid24) device.wifi24.ssid = informData.wifiSsid24;
          if (informData.wifiPass24) device.wifi24.password = informData.wifiPass24;
        }

        if (!device.wifi5g) {
          device.wifi5g = {
            ssid: informData.wifiSsid5g || '',
            password: informData.wifiPass5g || '',
            enabled: true,
            channel: 44,
            channelAuto: true,
            bandwidthMhz: 80,
            securityMode: 'WPA2-PSK',
            txPowerPercent: 100,
          };
        } else {
          if (informData.wifiSsid5g) device.wifi5g.ssid = informData.wifiSsid5g;
          if (informData.wifiPass5g) device.wifi5g.password = informData.wifiPass5g;
        }
        if (informData.lanHostCount !== undefined) device.lanHostCount = informData.lanHostCount;

        if ((informData as any).wanProfiles && (informData as any).wanProfiles.length > 0) {
          const incoming = (informData as any).wanProfiles;
          if (!device.wanProfiles || device.wanProfiles.length === 0) {
            device.wanProfiles = incoming;
          } else {
            for (const inc of incoming) {
              const existing = device.wanProfiles.find((p: any) =>
                (inc.cpeObjectPath && p.cpeObjectPath && p.cpeObjectPath === inc.cpeObjectPath) ||
                (inc.name && p.name && p.name === inc.name) ||
                (inc.pppoeUsername && p.pppoeUsername && p.pppoeUsername === inc.pppoeUsername) ||
                (!p.cpeObjectPath && !p.pppoeUsername && p.connectionType === inc.connectionType)
              );
              if (existing) {
                if (inc.status) existing.status = inc.status;
                if (inc.ipAddress) existing.ipAddress = inc.ipAddress;
                if (inc.vlanId) existing.vlanId = inc.vlanId;
                if (inc.pppoeUsername) existing.pppoeUsername = inc.pppoeUsername;
                if (inc.serviceType) existing.serviceType = inc.serviceType;
                if (inc.cpeObjectPath) existing.cpeObjectPath = inc.cpeObjectPath;
                if (inc.name) existing.name = inc.name;
              } else {
                device.wanProfiles.push(inc);
              }
            }
          }
        } else if (device.wanProfiles && device.wanProfiles.length > 0) {
          if (informData.vlanId !== undefined) device.wanProfiles[0].vlanId = informData.vlanId;
          if (informData.pppoeUsername) device.wanProfiles[0].pppoeUsername = informData.pppoeUsername;
        }

        if (informData.connectedClients && informData.connectedClients.length > 0) {
          device.connectedClients = informData.connectedClients;
          device.lanHostCount = informData.connectedClients.length;
        }

        // Process Continuous Optical Telemetry, Deduplication, History (20 Limit), and Critical/Recovery Alerts
        await CwmpService.processOpticalTelemetryChange(
          device,
          rxPower,
          txPower,
          informData.opticalBiasCurrent,
          informData.opticalVoltage,
          informData.temperatureC
        );

        // Device ownership is immutable during CWMP telemetry ingestion (only modified via explicit UI action)

        await this.saveDeviceResilient(device);
        resolvedDeviceId = device._id.toString();
        resolvedCustomerId = device.customerId?.toString();

        // Check for CPE boot/reboot event confirmation and finalize any pending reboot commands
        const hasRebootEvent = (informData.events || []).some((e: string) => /reboot/i.test(e) || /boot/i.test(e));
        if (hasRebootEvent) {
          console.log(`[CWMP ACS] CPE boot/reboot event detected (${informData.events?.join(', ')}). Clearing in-flight reboot commands for ${device.serialNumber}`);
          await DeviceCommand.updateMany(
            { deviceId: device._id, action: { $in: ['REBOOT_DEVICE', 'Reboot'] }, status: { $in: ['sending', 'sent', 'queued', 'pending'] } },
            { $set: { status: 'success', completedAt: new Date(), result: 'Router rebooted successfully (confirmed via CPE Inform boot event)' } }
          );
        }

        // Zero-Touch Auto-Provisioning is strictly disabled to protect existing live connections.
        // New or migrating ONTs are ingested as read-only inventory for operator manual review.
      } else {
        hitStatus = 'PROVISIONED';
        const initialWanProfiles: any[] = ((informData as any).wanProfiles && (informData as any).wanProfiles.length > 0)
          ? (informData as any).wanProfiles
          : [{
              name: 'WAN_PPPoE',
              connectionType: 'PPPoE',
              serviceType: 'INTERNET',
              status: 'Connected',
              vlanId: informData.vlanId || 100,
              pppoeUsername: informData.pppoeUsername || '',
            }];

        const deviceData: any = {
          tenantId: tenant._id,
          deviceIdStr: `dev_${Date.now()}_${rawSerial.slice(-4)}`,
          serialNumber: rawSerial,
          macAddress: informData.macAddress || `00:E0:${clientIp.split('.').map((p: string) => parseInt(p).toString(16).padStart(2, '0')).slice(-4).join(':')}`,
          manufacturer: vendorName,
          modelName: model,
          hardwareVersion: informData.hardwareVersion || 'V1.0',
          softwareVersion: informData.softwareVersion || 'V1.0.0',
          protocol: 'TR-069',
          status: 'online',
          lastInform: new Date(),
          ipAddress: informData.wanIp || clientIp,
          externalIpAddress: clientIp,
          opticalStatus,
          customerId: undefined,
          assigned: false,
          cwmpSessionId: sessionId,
          connectionRequestUrl: informData.connectionRequestUrl,
          connectionRequestUsername: (informData as any).connectionRequestUsername,
          connectionRequestPassword: (informData as any).connectionRequestPassword,
          ...(informData.periodicInformInterval ? { periodicInformInterval: informData.periodicInformInterval } : {}),
          lastRawInformXml: xml,
          rawParameters: this.mergeInformRawParameters({}, xml),
          lastParameterSyncAt: new Date(),
          lastParameterSyncStatus: 'INFORM_SYNCED',
          wanProfiles: initialWanProfiles,
          wifi24: {
            ssid: informData.wifiSsid24 || '',
            password: informData.wifiPass24 || '',
            enabled: true,
            channel: 6,
            channelAuto: true,
            bandwidthMhz: 20,
            securityMode: 'WPA2-PSK',
            txPowerPercent: 100,
          },
          wifi5g: {
            ssid: informData.wifiSsid5g || '',
            password: informData.wifiPass5g || '',
            enabled: true,
            channel: 44,
            channelAuto: true,
            bandwidthMhz: 80,
            securityMode: 'WPA2-PSK',
            txPowerPercent: 100,
          },
          rxPowerHistory: historyRecord ? [historyRecord] : [],
        };

        if (rxPower !== undefined) deviceData.currentRxPowerDbm = rxPower;
        if (txPower !== undefined) deviceData.currentTxPowerDbm = txPower;
        if (informData.opticalBiasCurrent !== undefined) deviceData.biasCurrentMa = informData.opticalBiasCurrent;
        if (informData.opticalVoltage !== undefined) deviceData.opticalVoltageV = informData.opticalVoltage;
        if (informData.temperatureC !== undefined) deviceData.temperatureC = informData.temperatureC;
        if (informData.lanHostCount !== undefined) deviceData.lanHostCount = informData.lanHostCount;

        let newDevice: any;
        try {
          newDevice = await Device.create(deviceData);
        } catch (err: any) {
          newDevice = await Device.findOneAndUpdate(
            { serialNumber: rawSerial },
            { $set: deviceData },
            { new: true, upsert: true }
          );
        }
        resolvedDeviceId = newDevice?._id?.toString();
        // Safe Read-Only Ingestion: No auto-configuration is triggered. 
        // Existing or new ONTs are saved to inventory without altering WAN/PPPoE settings.
      }
    } else {
      // UNRESOLVED / UNMAPPED DEVICE: Record in PendingDeviceMapping and trigger Super Admin WhatsApp alert
      hitStatus = 'DISCOVERED';
      let detectedReason: 'MISSING_SLUG_AND_SUBDOMAIN' | 'UNKNOWN_TENANT_SLUG' | 'INVALID_SUBDOMAIN' = 'MISSING_SLUG_AND_SUBDOMAIN';

      if (pathOrQuerySlug) {
        detectedReason = 'UNKNOWN_TENANT_SLUG';
      } else if (hostHeader) {
        const hostParts = hostHeader.split(':')[0].toLowerCase().split('.');
        const baseDomainPrefix = (process.env.BASE_DOMAIN || '').split('.')[0];
        if (hostParts.length > 2 && hostParts[0] !== 'www' && (!baseDomainPrefix || hostParts[0] !== baseDomainPrefix)) {
          detectedReason = 'INVALID_SUBDOMAIN';
        }
      }

      await PendingDeviceMapping.findOneAndUpdate(
        { serialNumber: rawSerial },
        {
          $set: {
            manufacturer: vendorName,
            oui: informData.oui,
            productClass: model,
            softwareVersion: informData.softwareVersion,
            hardwareVersion: informData.hardwareVersion,
            macAddress: informData.macAddress,
            incomingHost: hostHeader,
            incomingUrl: `/tr069${pathOrQuerySlug ? `/${pathOrQuerySlug}` : ''}`,
            pathOrQuerySlug,
            clientIp,
            reason: detectedReason,
            rawInformXml: xml.substring(0, 10000),
            wifi24: {
              ssid: informData.wifiSsid24 || '',
              password: informData.wifiPass24 || '',
              enabled: true,
              channel: 6,
              bandwidthMhz: 20,
              securityMode: 'WPA2-PSK',
              txPowerPercent: 100,
            },
            wifi5g: {
              ssid: informData.wifiSsid5g || '',
              password: informData.wifiPass5g || '',
              enabled: true,
              channel: 44,
              bandwidthMhz: 80,
              securityMode: 'WPA2-PSK',
              txPowerPercent: 100,
            },
            wan: {
              pppoeUsername: informData.pppoeUsername,
              vlanId: informData.vlanId,
              connectionType: 'PPPoE',
              ipAddress: informData.wanIp || clientIp,
              macAddress: informData.macAddress,
              status: informData.wanConnectionStatus || 'Connected',
            },
            telemetry: {
              rxPowerDbm: informData.opticalRxPower,
              txPowerDbm: informData.opticalTxPower,
              voltageV: informData.opticalVoltage,
              biasCurrentMa: informData.opticalBiasCurrent,
              temperatureC: informData.temperatureC,
              lanHostCount: informData.lanHostCount || 0,
            },
            lastSeenAt: new Date(),
          },
          $setOnInsert: {
            status: 'PENDING',
            firstSeenAt: new Date(),
            alertCount: 0,
          },
        },
        { upsert: true, new: true }
      ).catch((err) => console.error('[CWMP] Error upserting PendingDeviceMapping:', err));

      // Asynchronously dispatch WhatsApp alert to Super Admin (non-blocking)
      WhatsAppService.sendPendingDeviceAlert({
        serialNumber: rawSerial,
        manufacturer: vendorName,
        oui: informData.oui,
        productClass: model,
        incomingHost: hostHeader,
        incomingUrl: `/tr069${pathOrQuerySlug ? `/${pathOrQuerySlug}` : ''}`,
        pathOrQuerySlug,
        clientIp,
        reason: detectedReason,
      }).catch((waErr) => console.error('[CWMP] WhatsApp alert dispatch error:', waErr));

      console.warn(
        `[CWMP ACS] [UNMAPPED_CPE] Device ${rawSerial} (${model}) quarantined in PendingDeviceMapping. Reason: ${detectedReason}. WhatsApp alert triggered.`
      );
    }

    sessionContext.deviceId = resolvedDeviceId;
    sessionContext.customerId = resolvedCustomerId;

    const hitTenantSlug = sessionContext.tenantSlug || tenantSlug || 'quarantine_pending';
    const hitRecord: CwmpHitLog = {
      timestamp: new Date(),
      ip: clientIp,
      serialNumber: rawSerial,
      manufacturer: vendorName,
      model,
      vendor: detectedVendor,
      events: informData.events,
      tenantSlug: hitTenantSlug,
      status: hitStatus,
    };

    this.recentHits.unshift(hitRecord);
    if (this.recentHits.length > 50) this.recentHits.pop();

    this.tenantTotalHits.set(hitTenantSlug, (this.tenantTotalHits.get(hitTenantSlug) || 0) + 1);
    const tenantHits = this.tenantRecentHits.get(hitTenantSlug) || [];
    tenantHits.unshift(hitRecord);
    if (tenantHits.length > 50) tenantHits.pop();
    this.tenantRecentHits.set(hitTenantSlug, tenantHits);

    CwmpSessionLog.create({
      tenantId: tenant?._id,
      serialNumber: rawSerial,
      sessionId,
      cwmpId: '1',
      direction: 'CPE_TO_ACS',
      rpcMethod: 'Inform',
      httpStatus: 200,
      rawXml: CwmpXmlParser.maskSensitiveData(xml),
      timestamp: new Date(),
    }).catch(() => {});

    const informRespXml = this.buildInformResponse();
    CwmpSessionLog.create({
      tenantId: tenant?._id,
      serialNumber: rawSerial,
      sessionId,
      cwmpId: '1',
      direction: 'ACS_TO_CPE',
      rpcMethod: 'InformResponse',
      httpStatus: 200,
      rawXml: informRespXml,
      timestamp: new Date(),
    }).catch(() => {});

    await this.updateSession(sessionContext, connectionKey);

    console.log(
      `[CWMP ACS] Ingested Inform from ${clientIp} | Tenant: ${tenantSlug} | Serial: ${rawSerial} | Vendor: ${detectedVendor} | Session: ${sessionId}`
    );
    return { responseXml: informRespXml, sessionId };
  }

  /**
   * Phase 2 & 3: Dispatches isolated, multi-stage GetParameterValues on empty POST.
   * Stage 1: Safe Baseline TR-098/TR-181 (Wi-Fi, WAN, LAN) with ZERO unverified optical paths.
   * Stage 2: Isolated Optical Candidate Discovery & Cached Path Querying.
   */
  static async checkPendingRpcOrPoll(
    clientIp: string,
    incomingSessionId?: string,
    hostHeader?: string,
    pathOrQuerySlug?: string,
    connectionKey?: string
  ): Promise<string | null> {
    try {
      const session = await this.getSession(incomingSessionId, connectionKey, clientIp);

      if (!session) {
        console.warn(`[CWMP ACS] [EMPTY_POST] No active session found for Conn: ${connectionKey || clientIp}, SessionId: ${incomingSessionId || 'none'}. Returning 204.`);
        return null;
      }

      // STRICT TENANT ISOLATION: If session was blocked due to cross-tenant slug mismatch or quarantine, return ZERO commands & ZERO GPV
      if (session.stage === 'MISMATCH_BLOCKED' || !session.tenantId) {
        console.warn(`[CWMP ACS] [CROSS_TENANT_BLOCK] Suppressing all RPCs (Zero GPV, Zero SPV, Zero Reboot) for mismatched/quarantined session ${session.sessionId} (${session.serialNumber}). Returning 204.`);
        return null;
      }

      // 0. Check for Pending Operational Commands (SetParameterValues, Reboot, etc.) scoped strictly to tenant
      const serialAliases = session.serialAliases || CwmpXmlParser.getSerialNumberAliases(session.serialNumber);
      const dev = await Device.findOne({
        serialNumber: { $in: serialAliases },
        tenantId: session.tenantId,
      });
      if (dev) {
        // Priority 0: Post-reconnection verification GPV for applied commands awaiting verification
        const verifyingCmd = await DeviceCommand.findOne({
          deviceId: dev._id,
          status: { $in: ['applied_pending_verification', 'verifying', 'applied'] },
          affectedParameterPaths: { $exists: true, $not: { $size: 0 } },
        }).sort({ queuedAt: -1, createdAt: -1 });

        if (verifyingCmd && verifyingCmd.affectedParameterPaths && verifyingCmd.affectedParameterPaths.length > 0) {
          const verifyPaths = verifyingCmd.affectedParameterPaths.filter((p: string) => !p.toLowerCase().includes('password'));
          if (verifyPaths.length > 0) {
            verifyingCmd.status = 'verifying';
            await verifyingCmd.save();
            session.stage = 'VERIFICATION_GPV_SENT';

            console.log(`[CWMP_STRUCTURED_LOG] ${JSON.stringify({
              event: 'CWMP_DISPATCH_RECONNECT_VERIFICATION_GPV',
              taskId: verifyingCmd._id.toString(),
              deviceId: dev._id.toString(),
              serialNumber: session.serialNumber,
              dataModel: verifyingCmd.dataModel,
              parameterPaths: verifyPaths,
              rpcMethod: 'GetParameterValues',
              cwmpRequestId: '4',
              retryNumber: verifyingCmd.retryCount || 0,
              taskStatus: 'verifying',
            })}`);

            const stringElements = verifyPaths.map((p: string) => `        <string>${p}</string>`).join('\n');
            const verifyGpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">4</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${verifyPaths.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
            console.log(`[Native CWMP OUT] Dispatched Reconnect Verification GPV for ${session.serialNumber} (Cmd: ${verifyingCmd._id}, Params: [${verifyPaths.length}])`);
            return verifyGpvXml;
          }
        }

        // Priority 1: High-priority configuration & diagnostic commands (SET_WIFI_CONFIG, SET_WAN_CONFIG, REBOOT_DEVICE, etc.)
        let pendingCmd = await DeviceCommand.findOne({
          deviceId: dev._id,
          action: { $nin: ['SUMMON_LIVE_POLL', 'GET_PARAMETERS', 'REFRESH_TELEMETRY'] },
          status: { $in: ['pending', 'queued', 'authorized', 'created'] }
        }).sort({ queuedAt: 1, createdAt: 1 });

        // STRICT SINGLE-COMMAND LOCK: If a high-priority command is already in-flight (sending/verifying/sent),
        // do NOT dispatch any other command. Fall through to baseline GPV telemetry only.
        const inFlightHighPriority = await DeviceCommand.findOne({
          deviceId: dev._id,
          action: { $nin: ['SUMMON_LIVE_POLL', 'GET_PARAMETERS', 'REFRESH_TELEMETRY'] },
          status: { $in: ['sending', 'sent', 'verifying', 'applied_pending_verification'] },
        });
        if (inFlightHighPriority) {
          const ageMs = Date.now() - new Date(inFlightHighPriority.sentAt || inFlightHighPriority.queuedAt).getTime();
          // Only hard-block if the command is genuinely in-flight (< 90 seconds old).
          // Beyond 90 seconds without a response it's stale and should be cleared by workspace reconciliation.
          if (ageMs < 90_000) {
            console.log(
              `[CWMP ACS] ⏸ Single-command lock active for ${session.serialNumber}: ` +
              `Cmd ${inFlightHighPriority._id} (${inFlightHighPriority.action}) is ${inFlightHighPriority.status}. ` +
              `Falling through to baseline GPV only.`
            );
            // Skip all command dispatching — fall through to end of function (baseline GPV)
            pendingCmd = null;
          }
        }

        // Priority 2: General telemetry poll / summon commands (only if no high-priority cmd is pending)
        if (!pendingCmd && !inFlightHighPriority) {
          pendingCmd = await DeviceCommand.findOne({
            deviceId: dev._id,
            status: { $in: ['pending', 'queued', 'authorized', 'created'] }
          }).sort({ queuedAt: -1, createdAt: -1 });
        }

        if (pendingCmd) {
          const cmdAction = (pendingCmd as any).action || (pendingCmd as any).rpcMethod || (pendingCmd as any).commandType || '';
          
          // STRICT SECURITY GUARD 1: Prohibit stale commands (> 15 mins) from executing unexpectedly
          const cmdAgeSeconds = (Date.now() - new Date(pendingCmd.queuedAt || (pendingCmd as any).createdAt).getTime()) / 1000;
          if (cmdAgeSeconds > 900) {
            console.error(`[EMERGENCY GLOBAL GUARD] 🛑 Dropped stale command ${pendingCmd._id} (${cmdAction}) for ${session.serialNumber} (Age: ${Math.round(cmdAgeSeconds)}s)`);
            pendingCmd.status = 'expired';
            pendingCmd.errorMessage = `EXPIRED: Command dropped because it remained uncollected for ${Math.round(cmdAgeSeconds)}s (> 15 mins).`;
            await pendingCmd.save();
            return null;
          }

          // STRICT SECURITY GUARD 2: Only explicit, authenticated operator UI actions can trigger Reboot
          if (cmdAction === 'REBOOT_DEVICE' || cmdAction === 'Reboot') {
            const requester = (pendingCmd as any).requestedBy;
            if (!requester || (!requester.userId && !requester.email)) {
              console.error(`[EMERGENCY GLOBAL GUARD] 🚨 BLOCKED AUTOMATED REBOOT for ${session.serialNumber} (Cmd: ${pendingCmd._id}) - No authenticated operator found.`);
              pendingCmd.status = 'failed';
              pendingCmd.errorMessage = 'BLOCKED_BY_EMERGENCY_GLOBAL_GUARD: Automated reboot prohibited without verified operator.';
              await pendingCmd.save();
              return null;
            }

            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();
            const rebootXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">4</cwmp:ID></soapenv:Header>
  <soapenv:Body><cwmp:Reboot><CommandKey>${pendingCmd._id}</CommandKey></cwmp:Reboot></soapenv:Body>
</soapenv:Envelope>`;
            console.log(`[Native CWMP OUT] Dispatched Authenticated Operator Reboot RPC for ${session.serialNumber} (Cmd: ${pendingCmd._id}, Operator: ${requester.email || requester.userId})`);
            return rebootXml;
          }

          // STRICT SECURITY GUARD 3: Only explicit, authenticated operator UI actions can trigger Factory Reset
          if (cmdAction === 'FACTORY_RESET' || cmdAction === 'FactoryReset') {
            const requester = (pendingCmd as any).requestedBy;
            if (!requester || (!requester.userId && !requester.email)) {
              console.error(`[EMERGENCY GLOBAL GUARD] 🚨 BLOCKED AUTOMATED FACTORY RESET for ${session.serialNumber} (Cmd: ${pendingCmd._id}) - No authenticated operator found.`);
              pendingCmd.status = 'failed';
              pendingCmd.errorMessage = 'BLOCKED_BY_EMERGENCY_GLOBAL_GUARD: Automated factory reset prohibited without verified operator.';
              await pendingCmd.save();
              return null;
            }

            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();
            const resetXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">5</cwmp:ID></soapenv:Header>
  <soapenv:Body><cwmp:FactoryReset/></soapenv:Body>
</soapenv:Envelope>`;
            console.log(`[Native CWMP OUT] Dispatched Authenticated Operator FactoryReset RPC for ${session.serialNumber} (Cmd: ${pendingCmd._id})`);
            return resetXml;
          }

          // Handle Explicit GetParameterNames RPC Discovery
          if (cmdAction === 'GET_PARAMETER_NAMES' || cmdAction === 'GetParameterNames') {
            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();

            const pPath = (pendingCmd as any).parameters?.parameterPath || 'InternetGatewayDevice.WANDevice.1.';
            const nextLvl = (pendingCmd as any).parameters?.nextLevel !== undefined ? (pendingCmd as any).parameters.nextLevel : 0;
            const gpnXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">2</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterNames>
      <ParameterPath>${pPath}</ParameterPath>
      <NextLevel>${nextLvl}</NextLevel>
    </cwmp:GetParameterNames>
  </soapenv:Body>
</soapenv:Envelope>`;
            console.log(`[Native CWMP OUT] Dispatched GetParameterNames for ${session.serialNumber} (Path: ${pPath}, Cmd: ${pendingCmd._id})`);
            return gpnXml;
          }

          // Handle TR-069 Firmware Upgrade <cwmp:Download> RPC
          if (cmdAction === 'FIRMWARE_UPGRADE' || cmdAction === 'Download') {
            const payload = (pendingCmd as any).parameters || (pendingCmd as any).payload || {};
            const commandKey = payload.commandKey || (pendingCmd as any).commandKey || `FW-UPG-${pendingCmd._id}`;
            const fileType = payload.fileType || '1 Firmware Upgrade Image';
            const firmwareUrl = payload.firmwareUrl || '';
            const fileSize = payload.fileSize || 0;
            const fileName = payload.fileName || '';

            if (!firmwareUrl) {
              pendingCmd.status = 'failed';
              pendingCmd.errorMessage = 'Firmware download URL is missing from command payload';
              await pendingCmd.save();
              return null;
            }

            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();

            const downloadXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">6</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:Download>
      <CommandKey>${escapeXml(commandKey)}</CommandKey>
      <FileType>${escapeXml(fileType)}</FileType>
      <URL>${escapeXml(firmwareUrl)}</URL>
      <Username></Username>
      <Password></Password>
      <FileSize>${fileSize}</FileSize>
      <TargetFileName>${escapeXml(fileName)}</TargetFileName>
      <DelaySeconds>0</DelaySeconds>
      <SuccessURL></SuccessURL>
      <FailureURL></FailureURL>
    </cwmp:Download>
  </soapenv:Body>
</soapenv:Envelope>`;

            console.log(`[Native CWMP OUT] Dispatched TR-069 <cwmp:Download> RPC for ${session.serialNumber} (Cmd: ${pendingCmd._id}, Version: ${payload.targetVersion}, Size: ${fileSize})`);
            return downloadXml;
          }

          // Handle Custom Raw CWMP RPC (for diagnostics & advanced testing)
          if (cmdAction === 'CUSTOM_RPC' && (pendingCmd as any).parameters?.customXml) {
            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();
            session.stage = 'CUSTOM_RPC_SENT';
            console.log(`[Native CWMP OUT] Dispatched CUSTOM_RPC for ${session.serialNumber} (Cmd: ${pendingCmd._id})`);
            return (pendingCmd as any).parameters.customXml;
          }

          // Handle TR-069 On-Demand Diagnostics (Ping / TraceRoute)
          if (cmdAction === 'RUN_DIAGNOSTICS') {
            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();

            const diagType = (pendingCmd as any).parameters?.diagnosticType || 'PING';
            const host = (pendingCmd as any).parameters?.host || '8.8.8.8';
            const count = (pendingCmd as any).parameters?.count || 4;
            const timeout = (pendingCmd as any).parameters?.timeout || 2000;

            const isTr181 = session.modelName?.toUpperCase().includes('TR181') ||
              (dev.rawParameters && Object.keys(dev.rawParameters).some(k => k.startsWith('Device.')));

            let paramList: Array<[string, any, string]> = [];
            if (diagType === 'TRACEROUTE') {
              const root = isTr181 ? 'Device.IP.Diagnostics.TraceRoute.' : 'InternetGatewayDevice.TraceRouteDiagnostics.';
              paramList = [
                [`${root}DiagnosticsState`, 'Requested', 'xsd:string'],
                [`${root}Host`, host, 'xsd:string'],
                [`${root}Timeout`, timeout, 'xsd:unsignedInt'],
              ];
            } else {
              // PING
              const root = isTr181 ? 'Device.IP.Diagnostics.IPPing.' : 'InternetGatewayDevice.IPPingDiagnostics.';
              paramList = [
                [`${root}DiagnosticsState`, 'Requested', 'xsd:string'],
                [`${root}Host`, host, 'xsd:string'],
                [`${root}NumberOfRepetitions`, count, 'xsd:unsignedInt'],
                [`${root}Timeout`, timeout, 'xsd:unsignedInt'],
              ];
            }

            const paramElements = paramList
              .map(([p, v, t]) => `        <ParameterValueStruct>
          <Name>${escapeXml(p)}</Name>
          <Value xsi:type="${escapeXml(t)}">${escapeXml(String(v))}</Value>
        </ParameterValueStruct>`)
              .join('\n');

            const spvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValues>
      <ParameterList soapenc:arrayType="cwmp:ParameterValueStruct[${paramList.length}]">
${paramElements}
      </ParameterList>
      <ParameterKey>DIAG-${pendingCmd._id}</ParameterKey>
    </cwmp:SetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;

            console.log(`[Native CWMP OUT] Dispatched TR-069 <cwmp:SetParameterValues> for ${diagType} Diagnostics on ${session.serialNumber} (Host: ${host})`);
            return spvXml;
          }

          if (
            cmdAction === 'GetParameterValues' ||
            cmdAction === 'SUMMON_LIVE_POLL' ||
            cmdAction === 'CUSTOM_RPC' ||
            cmdAction === 'GET_PARAMETERS' ||
            cmdAction === 'REFRESH_TELEMETRY' ||
            (pendingCmd as any).commandType === 'SUMMON_LIVE_POLL' ||
            (pendingCmd as any).commandType === 'CUSTOM_RPC'
          ) {
            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();

            const requestedParams = (pendingCmd as any).parameters?.parameterNames ||
              (pendingCmd as any).payload?.parameterNames ||
              (pendingCmd as any).parameters?.paths ||
              (pendingCmd as any).payload?.paths;

            // For blanket SUMMON_LIVE_POLL / REFRESH_TELEMETRY without targeted paths, route cleanly through GPN -> Confirmed GPV instead of whole-tree InternetGatewayDevice. GPV
            const isBlanketSync =
              (cmdAction === 'SUMMON_LIVE_POLL' || cmdAction === 'REFRESH_TELEMETRY' || (pendingCmd as any).commandType === 'SUMMON_LIVE_POLL') &&
              (!Array.isArray(requestedParams) || requestedParams.length === 0 || (requestedParams.length === 1 && /^(InternetGatewayDevice\.|Device\.)$/i.test(String(requestedParams[0]))));

            if (!isBlanketSync) {
              session.stage = 'BASELINE_SENT';
              const targetParams = requestedParams && requestedParams.length > 0
                ? requestedParams
                : CwmpVendorProfiles.getSafeBaselineParameters(session.vendor, session.modelName);
              session.lastQueriedPaths = [...targetParams];
              console.log(
                `[Native CWMP OUT] Dispatched GPV for ${session.serialNumber} (${session.modelName}) | Cmd: ${pendingCmd._id} | Params: [${targetParams.length}]`
              );

              const stringElements = targetParams.map((p: string) => `        <string>${p}</string>`).join('\n');
              const gpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">2</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${targetParams.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
              return gpvXml;
            }
          }
          if (!(cmdAction === 'SUMMON_LIVE_POLL' || cmdAction === 'REFRESH_TELEMETRY' || (pendingCmd as any).commandType === 'SUMMON_LIVE_POLL')) {

          // STRICT SECURITY GUARD 4: Parameter changes require verified operator request
          let rawParams =
            (pendingCmd as any).parameters?.tr069ParamValues ||
            (pendingCmd as any).parameters?.parameterList ||
            (pendingCmd as any).payload?.parameterValues;
          if (!Array.isArray(rawParams) || rawParams.length === 0) {
            const prof = (pendingCmd as any).parameters?.profile;
            if (prof && prof.cpeObjectPath) {
              rawParams = await buildTr069WanParams(prof, dev);
            } else {
              rawParams = [];
            }
          }

          const isWanConfigCommand = pendingCmd.action === 'SET_WAN_CONFIG' || (Array.isArray(rawParams) && rawParams.some((p: any) => {
            const name = Array.isArray(p) ? p[0] : (p?.name || p?.path || '');
            return name.includes('WANConnectionDevice.');
          }));
          const requiresAddObject = !!(pendingCmd as any).parameters?.requiresAddObject;
          const addObjectAttempted = !!(pendingCmd as any).parameters?.addObjectAttempted;

          // Dispatch DeleteObject if action is SET_WAN_CONFIG with operation DELETE_OBJECT or DELETE_WAN_CONFIG
          const requiresDeleteObject = (pendingCmd.parameters as any)?.operation === 'DELETE_OBJECT' || (pendingCmd as any).action === 'DELETE_WAN_CONFIG';
          if (requiresDeleteObject && (session as any).stage !== 'CUSTOM_RPC_SENT') {
            let deleteTarget = (pendingCmd.parameters as any)?.cpeObjectPath || (pendingCmd.parameters as any)?.targetObjectName;
            if (deleteTarget) {
              if (!deleteTarget.endsWith('.')) deleteTarget = `${deleteTarget}.`;
              pendingCmd.status = 'sending';
              pendingCmd.sentAt = new Date();
              (session as any).stage = 'CUSTOM_RPC_SENT';
              await pendingCmd.save();

              const deleteObjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:DeleteObject>
      <ObjectName>${deleteTarget}</ObjectName>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:DeleteObject>
  </soapenv:Body>
</soapenv:Envelope>`;

              CwmpSessionLog.create({
                tenantId: session.tenantId,
                deviceId: dev._id,
                serialNumber: session.serialNumber,
                sessionId: session.sessionId,
                cwmpId: '3',
                direction: 'ACS_TO_CPE',
                rpcMethod: 'DeleteObject',
                httpStatus: 200,
                rawXml: deleteObjectXml,
                timestamp: new Date(),
              }).catch(() => {});

              console.log(`[Native CWMP OUT] Dispatched DeleteObject RPC for ${deleteTarget} on ${session.serialNumber} (Cmd: ${pendingCmd._id})`);
              triggerGenieAcsConnectionRequest(session.serialNumber).catch(() => {});
              return deleteObjectXml;
            }
          }

          // Dispatch AddObject FIRST if dynamic new slot creation is required (even if rawParams is initially empty)
          if (isWanConfigCommand && requiresAddObject && !addObjectAttempted && session.stage !== 'ADD_OBJECT_SENT') {
            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            session.stage = 'ADD_OBJECT_SENT';
            const targetObjectName = (pendingCmd.parameters as any)?.targetObjectName || 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.';
            if (pendingCmd.parameters) {
              (pendingCmd.parameters as any).addObjectAttempted = true;
              (pendingCmd.parameters as any).targetObjectName = targetObjectName;
              pendingCmd.markModified('parameters');
            }
            await pendingCmd.save();

            const addObjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:AddObject>
      <ObjectName>${targetObjectName}</ObjectName>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:AddObject>
  </soapenv:Body>
</soapenv:Envelope>`;
            CwmpSessionLog.create({
              tenantId: session.tenantId,
              deviceId: dev._id,
              serialNumber: session.serialNumber,
              sessionId: session.sessionId,
              cwmpId: '3',
              direction: 'ACS_TO_CPE',
              rpcMethod: 'AddObject',
              httpStatus: 200,
              rawXml: addObjectXml,
              timestamp: new Date(),
            }).catch(() => {});
            console.log(`[Native CWMP OUT] Dispatched AddObject RPC for ${targetObjectName} on ${session.serialNumber} (Cmd: ${pendingCmd._id})`);
            triggerGenieAcsConnectionRequest(session.serialNumber).catch(() => {});
            return addObjectXml;
          }

          if (Array.isArray(rawParams) && rawParams.length > 0) {
            pendingCmd.status = 'sending';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();

            const normalizedParams = rawParams.map((p: any) => {
              if (Array.isArray(p)) return { name: p[0], value: p[1], type: p[2] || 'xsd:string' };
              return { name: p.name || p.path, value: p.value, type: p.type || 'xsd:string' };
            });

            // Validate requested parameters against dev.rawParameters and SupportedParameterCache
            const rawParamTuples: Array<[string, any, string]> = normalizedParams.map((p: any) => [p.name, p.value, p.type]);
            const validation = validateWanParameters(rawParamTuples, dev.rawParameters || {});
            if (validation.errors.length > 0) {
              console.error(`[CWMP ACS] ❌ Pre-dispatch validation failed for ${session.serialNumber}:`, validation.errors);
              pendingCmd.status = 'failed';
              pendingCmd.errorMessage = `PRE_DISPATCH_VALIDATION_FAILED: ${validation.errors.join('; ')}`;
              pendingCmd.completedAt = new Date();
              await pendingCmd.save();
              return null;
            }

            // Validate against SupportedParameterCache (reject known unsupported vendor parameters, never core params)
            let validParams: Array<{ name: string; value: any; type: string }> = [];
            const rawKeys = Object.keys(dev.rawParameters || {});

            for (const [vName, vVal, vType] of validation.validParams) {
              let targetName = vName;

              // Suppress unsupported vendor VLAN parameters if not present in CPE rawParameters
              if (targetName.includes('X_CT-COM_WANEponLinkConfig.Mode') && !rawKeys.some(k => k.includes('X_CT-COM_WANEponLinkConfig.Mode'))) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${targetName}' before SetParameterValues dispatch.`);
                continue;
              }
              if (targetName.includes('X_CT-COM_WANEponLinkConfig') && !rawKeys.some(k => k.includes('X_CT-COM_WANEponLinkConfig'))) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${targetName}' before SetParameterValues dispatch.`);
                continue;
              }
              if (targetName.includes('X_CT-COM_WANGponLinkConfig.Mode') && !rawKeys.some(k => k.includes('X_CT-COM_WANGponLinkConfig.Mode'))) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${targetName}' before SetParameterValues dispatch.`);
                continue;
              }
              if (targetName.includes('X_CT-COM_WANGponLinkConfig') && !rawKeys.some(k => k.includes('X_CT-COM_WANGponLinkConfig'))) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${targetName}' before SetParameterValues dispatch.`);
                continue;
              }
              if (rawKeys.length > 0 && targetName.endsWith('.VLANID') && !rawKeys.some(k => k.includes(targetName))) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${targetName}' (not in device parameter tree) before SetParameterValues dispatch.`);
                continue;
              }

              // Suppress ConnectionType if targeted on WANPPPConnection (as it causes Fault 9003 on Genexis/Broadcom/CTC ONTs)
              if (/WANPPPConnection\.\d+\.ConnectionType$/i.test(targetName)) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed read-only parameter '${targetName}' before SetParameterValues dispatch.`);
                continue;
              }

              // Suppress X_CT-COM_ServiceList if targeted on WANPPPConnection (as it causes Fault 9005 on Genexis/Broadcom/CTC ONTs)
              if (/WANPPPConnection\.\d+\..*ServiceList$/i.test(targetName)) {
                console.warn(`[CWMP ACS] 🛡️ Suppressed invalid parameter '${targetName}' on WANPPPConnection before SetParameterValues dispatch.`);
                continue;
              }

              // Suppress direct WLAN KeyPassphrase if PreSharedKey is used/supported (as it causes Fault 9003 on Genexis ONTs)
              if (/WLANConfiguration\.\d+\.KeyPassphrase$/i.test(targetName)) {
                const instMatch = targetName.match(/WLANConfiguration\.(\d+)\./);
                const instNum = instMatch ? instMatch[1] : '1';
                if (validation.validParams.some(([p]) => p.includes(`WLANConfiguration.${instNum}.PreSharedKey`)) ||
                    rawKeys.some(k => k.includes(`WLANConfiguration.${instNum}.PreSharedKey`))) {
                  console.warn(`[CWMP ACS] 🛡️ Suppressed redundant/unsupported parameter '${targetName}' in favor of PreSharedKey.`);
                  continue;
                }
              }

              const isCoreParam = /Username|Password|NATEnabled$/i.test(targetName);
              if (!isCoreParam) {
                const cached = await SupportedParameterCache.findOne({
                  parameterPath: targetName,
                  status: 'UNSUPPORTED'
                });
                if (cached) {
                  console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${targetName}' before SetParameterValues dispatch.`);
                  continue;
                }
              }
              validParams.push({ name: targetName, value: vVal, type: vType });
            }

            // Dynamic Live Slot Auto-Alignment:
            // If the queued command targets Slot 2, but the physical ONT only has customer PPP on Slot 1 (e.g. RL-Tech / RicherLink),
            // auto-align parameter paths to Slot 1 so SetParameterValues matches the router's physical hardware tree.
            if (rawKeys.length > 0) {
              const hasSlot2 = rawKeys.some(k => k.includes('WANConnectionDevice.2.'));
              const hasSlot1Ppp = rawKeys.some(k => k.includes('WANConnectionDevice.1.WANPPPConnection.'));
              const isTargetingSlot2 = validParams.some(p => p.name.includes('WANConnectionDevice.2.'));

              if (isTargetingSlot2 && !hasSlot2 && hasSlot1Ppp) {
                console.log(`[CWMP ACS] 🔄 Auto-aligning target slot from Slot 2 to live Slot 1 on ${session.serialNumber} based on physical ONT parameter tree.`);
                validParams = validParams.map(p => ({
                  name: p.name.replace('WANConnectionDevice.2.', 'WANConnectionDevice.1.'),
                  value: p.value,
                  type: p.type
                }));
              }
            }

            const isWanConfigCommand = pendingCmd.action === 'SET_WAN_CONFIG' || validParams.some(p => p.name.includes('WANConnectionDevice.'));
            const isDeleteOp = (pendingCmd.parameters as any)?.operation === 'DELETE_OR_DISABLE';
            const targetParamName = validParams.find(p => p.name.includes('WANConnectionDevice.'))?.name || '';
            const slotMatch = targetParamName.match(/WANConnectionDevice\.(\d+)\./);
            const targetSlot = slotMatch ? parseInt(slotMatch[1], 10) : 1;

            const isPppoeConn = targetParamName.includes('WANPPPConnection');
            const targetConnObj = isPppoeConn ? 'WANPPPConnection.' : 'WANIPConnection.';
            
            const slotDeviceExists = targetSlot === 1 || Object.keys(dev.rawParameters || {}).some(k =>
              k.includes(`WANConnectionDevice.${targetSlot}.`)
            );
            const targetObjectName = !slotDeviceExists
              ? 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.'
              : `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${targetSlot}.${targetConnObj}`;

            const slotExistsInRaw = Object.keys(dev.rawParameters || {}).some(k =>
              k.includes(`WANConnectionDevice.${targetSlot}.${targetConnObj}`)
            );

            // Fast-path for DELETE_OR_DISABLE: If slot is already gone from physical ONT, mark success immediately
            if (isDeleteOp && !slotDeviceExists) {
              console.log(`[CWMP ACS] 🗑️ [WAN DELETE] Target slot ${targetSlot} is already absent on ${session.serialNumber}. Marking Cmd ${pendingCmd._id} as success.`);
              pendingCmd.status = 'success';
              pendingCmd.errorMessage = `Target WAN slot ${targetSlot} is already absent on physical ONT.`;
              pendingCmd.completedAt = new Date();
              await pendingCmd.save();
              return null;
            }

            const requiresAddObject = !!(pendingCmd as any).parameters?.requiresAddObject || !slotDeviceExists || (targetSlot > 1 && !slotExistsInRaw);
            const addObjectAttempted = !!(pendingCmd as any).parameters?.addObjectAttempted;
            
            // Dispatch AddObject first if target connection instance is not yet present on physical CPE
            if (isWanConfigCommand && requiresAddObject && !addObjectAttempted && session.stage !== 'ADD_OBJECT_SENT') {
              session.stage = 'ADD_OBJECT_SENT';
              if (pendingCmd.parameters) {
                (pendingCmd.parameters as any).addObjectAttempted = true;
                (pendingCmd.parameters as any).targetObjectName = targetObjectName;
                pendingCmd.markModified('parameters');
                await pendingCmd.save();
              }
              const addObjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:AddObject>
      <ObjectName>${targetObjectName}</ObjectName>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:AddObject>
  </soapenv:Body>
</soapenv:Envelope>`;
              CwmpSessionLog.create({
                tenantId: session.tenantId,
                deviceId: dev._id,
                serialNumber: session.serialNumber,
                sessionId: session.sessionId,
                cwmpId: '3',
                direction: 'ACS_TO_CPE',
                rpcMethod: 'AddObject',
                httpStatus: 200,
                rawXml: addObjectXml,
                timestamp: new Date(),
              }).catch(() => {});
              console.log(`[Native CWMP OUT] Dispatched AddObject RPC for ${targetObjectName} on ${session.serialNumber} (Cmd: ${pendingCmd._id})`);
              triggerGenieAcsConnectionRequest(session.serialNumber).catch(() => {});
              return addObjectXml;
            }

            if (validParams.length === 0) {
              console.warn(`[CWMP ACS] ⚠️ No valid parameters remaining to dispatch for Cmd ${pendingCmd._id}. Marking as failed.`);
              pendingCmd.status = 'failed';
              pendingCmd.errorMessage = 'VALIDATION_FAILED: All queued parameters are marked unsupported or invalid for this CPE firmware.';
              pendingCmd.completedAt = new Date();
              await pendingCmd.save();
              return null;
            }

            console.log(`
[SET_WAN_CONFIG]
Command ID: ${pendingCmd._id}
Device ID: ${dev._id}
CPE Serial: ${session.serialNumber}
Model: ${session.modelName || dev.modelName}
Firmware: ${dev.softwareVersion || 'Unknown'}

[QUEUE]
Created: ${pendingCmd.queuedAt || (pendingCmd as any).createdAt}
Status: DISPATCHING_SPV
Parameters: [${validParams.map((p) => p.name).join(', ')}]

[CWMP]
Session ID: ${session.sessionId}
RPC sent: SetParameterValues
            `);

            const spvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValues>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[${validParams.length}]">
${validParams.map((p: any) => `        <ParameterValueStruct>
          <Name>${escapeXml(p.name)}</Name>
          <Value xsi:type="${p.type}">${escapeXml(p.value)}</Value>
        </ParameterValueStruct>`).join('\n')}
      </ParameterList>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:SetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
            session.stage = 'SPV_SENT';
            const selectedDataModel = validParams.some((p: any) => p.name.startsWith('Device.')) ? 'TR-181' : 'TR-098';
            pendingCmd.cwmpRequestId = '3';
            pendingCmd.dataModel = selectedDataModel;
            pendingCmd.affectedParameterPaths = validParams.map((p: any) => p.name);
            pendingCmd.verificationTargetValues = validParams.reduce((acc: any, p: any) => {
              acc[p.name] = p.value;
              return acc;
            }, {});
            await pendingCmd.save();

            console.log(`[CWMP_STRUCTURED_LOG] ${JSON.stringify({
              event: 'CWMP_DISPATCH_SPV',
              taskId: pendingCmd._id.toString(),
              deviceId: dev._id.toString(),
              serialNumber: session.serialNumber,
              dataModel: selectedDataModel,
              parameterPaths: pendingCmd.affectedParameterPaths,
              rpcMethod: 'SetParameterValues',
              cwmpRequestId: '3',
              retryNumber: pendingCmd.retryCount || 0,
              taskStatus: pendingCmd.status,
            })}`);

            console.log(`[Native CWMP OUT] Dispatched SetParameterValues RPC for ${session.serialNumber} (Cmd: ${pendingCmd._id}) | Model: ${selectedDataModel} | Params: [${validParams.length}]`);
            return spvXml;
          }
          }
        }
      }

      // Check whether full GPN/GPV tree discovery has genuinely completed (never skip GPN due to a sparse Inform containing 1 SSID + 1 WAN key)
      const rawKeys = Object.keys(dev?.rawParameters || {});
      const hasCompletedDiscovery = Boolean(
        (dev as any)?.supportedParametersConfirmed ||
        (Boolean(dev?.opticalTelemetrySourcePath) && rawKeys.length >= 25)
      );
      const lastGpnTs = this.recentGpnAt.get(session.serialNumber) || 0;
      if (!hasCompletedDiscovery && session.stage !== 'GPN_SENT' && (Date.now() - lastGpnTs) >= 120_000) {
        session.stage = 'GPN_SENT';
        this.recentGpnAt.set(session.serialNumber, Date.now());
        const rootPath = session.vendor === 'TR181_STANDARD' ? 'Device.' : 'InternetGatewayDevice.';
        const gpnXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">2</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterNames>
      <ParameterPath>${rootPath}</ParameterPath>
      <NextLevel>0</NextLevel>
    </cwmp:GetParameterNames>
  </soapenv:Body>
</soapenv:Envelope>`;
        console.log(`[CWMP ACS -> CPE] Dispatched GPN root discovery for ${session.serialNumber} (${rootPath})`);
        return gpnXml;
      }

      // Guard against rapid duplicate inform loops (< 15-30s): skip full periodic GPV when telemetry already synced cleanly within cooldown.
      // Reboots, value changes, and periodic informs after interval (e.g. 60s, 300s) will always execute GPV to refresh optical & status metrics.
      const isRebootOrEvent = session.events?.some((e) => /BOOT|BOOTSTRAP|VALUE CHANGE|REBOOT/i.test(e));
      const telemetryCooldownSec = Math.max(15, parseInt(process.env.CWMP_TELEMETRY_COOLDOWN_SECONDS || '30', 10));
      const lastSyncTs = (dev as any)?.lastParameterSyncAt ? new Date((dev as any).lastParameterSyncAt).getTime() : 0;
      const hasSyncedTree = rawKeys.length > 5 && (dev as any)?.lastParameterSyncStatus === 'SUCCESS';
      if (!isRebootOrEvent && hasSyncedTree && lastSyncTs > 0 && (Date.now() - lastSyncTs) < telemetryCooldownSec * 1000) {
        // Auto-push management baseline on ANY inform if not yet configured (removed onboarding-event gate)
        if (dev && !(dev as any).periodicInformConfigured) {
          const baseline = this.buildAutoManagementBaselineSpv(dev, session, true);
          session.stage = 'AUTO_MGMT_SPV_SENT';
          await this.updateSession(session, connectionKey);
          console.log(
            `[CWMP ACS -> CPE] Auto-pushing ManagementServer baseline for ${session.serialNumber} (interval drift or first config, creds user '${baseline.creds.connectionRequestUsername}')`
          );
          return baseline.xml;
        }
        session.stage = 'COMPLETED';
        await this.clearConnectionSession(connectionKey);
        console.log(
          `[CWMP ACS] Inform heartbeat synced for ${session.serialNumber}; skipping heavy GPV within ${telemetryCooldownSec}s cooldown (${Math.round((Date.now() - lastSyncTs) / 1000)}s ago). Returning 204.`
        );
        return null;
      }

      // Periodic Inform Telemetry Sync: Strictly query confirmed paths + core Management/DeviceInfo + verified optical path (never speculative unverified optical or Hosts.Host.1..16 batches)
      session.stage = 'BASELINE_SENT';
      const queryParams: string[] = [];
      const addUnique = (p: string) => {
        if (p && !p.endsWith('.') && !queryParams.includes(p)) queryParams.push(p);
      };

      const isTr181Dev = session.vendor === 'TR181_STANDARD' || rawKeys.some((k) => k.startsWith('Device.'));
      if (isTr181Dev) {
        addUnique('Device.DeviceInfo.UpTime');
        addUnique('Device.DeviceInfo.SoftwareVersion');
        addUnique('Device.ManagementServer.ConnectionRequestURL');
        addUnique('Device.ManagementServer.PeriodicInformInterval');
      } else {
        addUnique('InternetGatewayDevice.DeviceInfo.UpTime');
        addUnique('InternetGatewayDevice.DeviceInfo.SoftwareVersion');
        addUnique('InternetGatewayDevice.ManagementServer.ConnectionRequestURL');
        addUnique('InternetGatewayDevice.ManagementServer.PeriodicInformInterval');
        addUnique('InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries');
      }

      const verifiedOpticalPath = dev?.opticalTelemetrySourcePath;
      if (verifiedOpticalPath) {
        addUnique(verifiedOpticalPath);
        for (const comp of CwmpVendorProfiles.getOpticalCompanionPaths(verifiedOpticalPath)) {
          if (rawKeys.length === 0 || rawKeys.includes(comp)) {
            addUnique(comp);
          }
        }
      } else {
        // Fall back to vendor optical candidates so new or unverified ONTs (e.g. Genexis Earth-2022) always get optical telemetry probed
        const vendorCandidates = CwmpVendorProfiles.getOpticalCandidates(session.vendor);
        const matchingCandidates = vendorCandidates.filter((cand) => rawKeys.includes(cand));
        if (matchingCandidates.length > 0) {
          for (const cand of matchingCandidates) {
            addUnique(cand);
            for (const comp of CwmpVendorProfiles.getOpticalCompanionPaths(cand)) {
              if (rawKeys.includes(comp)) addUnique(comp);
            }
          }
        } else {
          // If rawKeys doesn't contain matching paths yet, query the top vendor candidates
          for (const cand of vendorCandidates.slice(0, 4)) {
            if (!cand.endsWith('.')) addUnique(cand);
          }
        }
      }

      // Include all confirmed DeviceInfo, Optical, Wi-Fi, WAN Route/VLAN, and Host paths from dev.rawParameters
      if (dev?.rawParameters && rawKeys.length > 0) {
        const selectedPeriodic = this.selectConfirmedTelemetryPaths(rawKeys, new Set(), 90);
        for (const rk of selectedPeriodic.paths) {
          addUnique(rk);
        }
      } else {
        for (const bp of CwmpVendorProfiles.getSafeBaselineParameters(session.vendor, session.modelName)) {
          if (!bp.endsWith('.')) addUnique(bp);
        }
      }

      session.lastQueriedPaths = [...queryParams];
      const stringElements = queryParams.map((p) => `        <string>${p}</string>`).join('\n');
      const gpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">2</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${queryParams.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;

      console.log(
        `[CWMP ACS -> CPE] Dispatched Baseline GPV for ${session.serialNumber} (${session.modelName}) | Verified Optical: ${verifiedOpticalPath || 'Pending GPN'} | Params: [${queryParams.length}]`
      );
      return gpvXml;
    } catch (err: any) {
      console.error(`[CWMP ACS] [UNHANDLED_EXCEPTION in checkPendingRpcOrPoll]:`, err);
      return null;
    }
  }

  /**
   * Handles CPE <cwmp:DownloadResponse> confirming firmware download has commenced
   */
  static async handleDownloadResponse(
    xml: string,
    clientIp: string,
    incomingSessionId?: string,
    connectionKey?: string
  ): Promise<string | null> {
    const session = await this.getSession(incomingSessionId, connectionKey, clientIp);
    const parsed = CwmpXmlParser.extractDownloadResponse(xml);

    console.log(
      `[CWMP ACS] Ingested DownloadResponse from ${connectionKey || clientIp} | Serial: ${session?.serialNumber} | Status: ${parsed.status}`
    );

    if (session?.deviceId) {
      const activeCmd = await DeviceCommand.findOne({
        deviceId: session.deviceId,
        action: 'FIRMWARE_UPGRADE',
        status: { $in: ['sending', 'sent', 'queued'] },
      }).sort({ queuedAt: -1, createdAt: -1 });

      if (activeCmd) {
        activeCmd.status = 'applied_pending_verification';
        activeCmd.acknowledgedAt = new Date();
        activeCmd.executionLog = [
          ...(activeCmd.executionLog || []),
          `[${new Date().toISOString()}] CPE confirmed firmware download started (Status: ${parsed.status}, StartTime: ${parsed.startTime || 'immediate'})`,
        ];
        await activeCmd.save();
      }
    }

    return null; // Return 204 No Content so CPE proceeds with download
  }

  /**
   * Handles CPE <cwmp:TransferComplete> reporting final status of firmware transfer and flash
   */
  static async handleTransferComplete(
    xml: string,
    clientIp: string,
    incomingSessionId?: string,
    connectionKey?: string
  ): Promise<string> {
    const session = await this.getSession(incomingSessionId, connectionKey, clientIp);
    const details = CwmpXmlParser.extractTransferComplete(xml);

    console.log(
      `[CWMP ACS] Ingested TransferComplete from ${connectionKey || clientIp} | Serial: ${session?.serialNumber} | CommandKey: ${details.commandKey} | FaultCode: ${details.faultCode}`
    );

    const isSuccess = details.faultCode === 0;

    // Find the associated DeviceCommand by commandKey or active FIRMWARE_UPGRADE command
    let cmd: any = null;
    if (details.commandKey) {
      cmd = await DeviceCommand.findOne({
        $or: [
          { commandKey: details.commandKey },
          { 'parameters.commandKey': details.commandKey },
          { 'payload.commandKey': details.commandKey },
        ],
      });
    }

    if (!cmd && session?.deviceId) {
      cmd = await DeviceCommand.findOne({
        deviceId: session.deviceId,
        action: 'FIRMWARE_UPGRADE',
        status: { $in: ['applied_pending_verification', 'sending', 'sent', 'verifying'] },
      }).sort({ queuedAt: -1, createdAt: -1 });
    }

    if (cmd) {
      if (isSuccess) {
        cmd.status = 'applied';
        cmd.completedAt = new Date();
        cmd.executionLog = [
          ...(cmd.executionLog || []),
          `[${new Date().toISOString()}] TransferComplete reported SUCCESS (FaultCode: 0, CompleteTime: ${details.completeTime || 'now'})`,
        ];
        await cmd.save();

        // Update Device record with new firmware target version
        if (session?.deviceId) {
          const targetVer = (cmd as any).parameters?.targetVersion || (cmd as any).payload?.targetVersion;
          await Device.findByIdAndUpdate(session.deviceId, {
            lastParameterSyncStatus: 'FIRMWARE_UPGRADED',
            ...(targetVer ? { softwareVersion: targetVer } : {}),
          });
        }
      } else {
        cmd.status = 'failed';
        cmd.errorMessage = `Transfer failed: ${details.faultString || 'Error'} (FaultCode: ${details.faultCode})`;
        cmd.executionLog = [
          ...(cmd.executionLog || []),
          `[${new Date().toISOString()}] TransferComplete reported FAILURE: ${details.faultString} (${details.faultCode})`,
        ];
        await cmd.save();
      }
    }

    // Extract cwmp ID from request or default to '7'
    const cwmpId = CwmpXmlParser.extractTag(xml, 'ID') || '7';

    // Build standard <cwmp:TransferCompleteResponse/>
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">${escapeXml(cwmpId)}</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:TransferCompleteResponse/>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  /**
   * Phase 2.5: Handles GetParameterNamesResponse from CPE, extracts confirmed parameters, and queries them
   */
  static async handleParameterNamesResponse(
    xml: string,
    clientIp: string,
    incomingSessionId?: string,
    hostHeader?: string,
    pathOrQuerySlug?: string,
    connectionKey?: string
  ): Promise<string | null> {
    const session = await this.getSession(incomingSessionId, connectionKey, clientIp);

    CwmpSessionLog.create({
      serialNumber: session?.serialNumber || 'UNKNOWN',
      sessionId: session?.sessionId || incomingSessionId || 'unknown',
      cwmpId: '2',
      direction: 'CPE_TO_ACS',
      rpcMethod: 'GetParameterNamesResponse',
      httpStatus: 200,
      rawXml: xml.substring(0, 15000),
      timestamp: new Date(),
    }).catch(() => {});

    const detailedNames = CwmpXmlParser.extractParameterInfoListDetailed(xml);
    const names = detailedNames.map((d) => d.name);
    console.log(
      `[CWMP ACS] Ingested GetParameterNamesResponse from ${connectionKey || clientIp} | Serial: ${session?.serialNumber} | Discovered Total Names: [${names.length}]`
    );

    if (names.length === 0) {
      console.warn(`[CWMP ACS] Zero names returned by GPN from ${connectionKey || clientIp}. Falling back to safe baseline.`);
      return null;
    }

    // Determine data model
    const hasTr181 = names.some((n) => n.startsWith('Device.'));
    const hasTr098 = names.some((n) => n.startsWith('InternetGatewayDevice.'));
    const detectedDataModel = hasTr181 && hasTr098 ? 'HYBRID' : hasTr181 ? 'TR-181' : 'TR-098';

    // Asynchronously batch cache supported parameter paths with classification
    if (session) {
      const cacheUpdates = detailedNames.map((item) => ({
        updateOne: {
          filter: {
            vendor: session.vendor,
            modelName: session.modelName,
            parameterPath: item.name,
          },
          update: {
            $set: {
              status: 'SUPPORTED' as const,
              manufacturer: session.manufacturer,
              firmwareVersion: session.firmwareVersion,
              dataModel: detectedDataModel,
              category: CwmpVendorProfiles.classifyParameter(item.name),
              writable: item.writable,
              lastCheckedAt: new Date(),
              lastVerified: new Date(),
              lastSeen: new Date(),
            },
            $setOnInsert: { firstSeen: new Date() },
          },
          upsert: true,
        },
      }));
      SupportedParameterCache.bulkWrite(cacheUpdates).catch(() => {});
    }

    // Resolve any in-flight GET_PARAMETER_NAMES or GetParameterNames command for this device
    if (session?.serialNumber) {
      Device.findOne({ serialNumber: session.serialNumber }).then(async (dev) => {
        if (dev) {
          await DeviceCommand.updateMany(
            {
              deviceId: dev._id,
              action: { $in: ['CUSTOM_RPC', 'GET_PARAMETER_NAMES', 'GetParameterNames'] },
              status: { $in: ['sent', 'sending', 'queued', 'pending', 'verifying'] },
            },
            {
              $set: {
                status: 'success',
                completedAt: new Date(),
                result: `Discovered ${names.length} parameter paths from CPE.`,
              },
            }
          );
          console.log(`[CWMP ACS] Marked in-flight GET_PARAMETER_NAMES as success for device ${session.serialNumber}`);
        }
      }).catch((err) => console.warn('[CWMP ACS] Error resolving GPN command:', err.message));
    }

    // Build the prioritized GPV query list strictly from parameters that EXIST on the CPE (capped cleanly for Syrotech/Realtek stability)
    let unsupportedSet = new Set<string>();
    if (session) {
      const cachedUnsupported = await SupportedParameterCache.find({
        vendor: session.vendor,
        modelName: session.modelName,
        status: 'UNSUPPORTED',
      }).lean().catch(() => []);
      unsupportedSet = new Set(cachedUnsupported.map((c: any) => c.parameterPath));
    }

    const {
      paths: confirmedParams,
      opticalRxCandidates,
      opticalTxCandidates,
      opticalCompanionCandidates,
    } = this.selectConfirmedTelemetryPaths(names, unsupportedSet, 90);

    console.log(
      `[CWMP ACS] Discovered Optical Telemetry on ${session?.serialNumber}: [RX: ${opticalRxCandidates.length}] [TX: ${opticalTxCandidates.length}] [Companions: ${opticalCompanionCandidates.length}]`,
      { rx: opticalRxCandidates, tx: opticalTxCandidates }
    );

    if (session && confirmedParams.length > 0) {
      session.stage = 'OPTICAL_SENT';
      session.lastQueriedPaths = [...confirmedParams];

      if (opticalRxCandidates.length > 0) {
        session.activeOpticalCandidate = opticalRxCandidates[0];
      }

      console.log(
        `[CWMP ACS -> CPE] Dispatched Confirmed GPV for ${session.serialNumber} | Params: [${confirmedParams.length}] -> ${confirmedParams.join(', ')}`
      );

      const stringElements = confirmedParams.map((p) => `        <string>${p}</string>`).join('\n');
      const gpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${confirmedParams.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;

      CwmpSessionLog.create({
        serialNumber: session.serialNumber,
        sessionId: session.sessionId,
        cwmpId: '3',
        direction: 'ACS_TO_CPE',
        rpcMethod: 'GetParameterValues',
        httpStatus: 200,
        rawXml: CwmpXmlParser.maskSensitiveData(gpvXml),
        timestamp: new Date(),
      }).catch(() => {});

      return gpvXml;
    }

    return null;
  }

  /**
   * Phase 3: Handles GetParameterValuesResponse, isolates Fault 9005, and saves to MongoDB
   */
  static async handleParameterValuesResponse(
    xml: string,
    clientIp: string,
    incomingSessionId?: string,
    hostHeader?: string,
    pathOrQuerySlug?: string,
    connectionKey?: string
  ): Promise<string | null> {
    const { parameters: pMap, rawMap, fault } = CwmpXmlParser.extractParameterMap(xml);

    const session = await this.getSession(incomingSessionId, connectionKey, clientIp);

    if (!session) {
      console.warn(`[CWMP ACS] [GPV_REJECTED] No matching active session for Conn: ${connectionKey || clientIp}, SessionId: ${incomingSessionId || 'none'}. Rejecting write to prevent cross-device contamination.`);
      return null;
    }

    const tenant = session?.tenantId
      ? { _id: session.tenantId }
      : await this.resolveTenant(hostHeader, pathOrQuerySlug);
    if (!tenant) return null;

    const serialAliases = session?.serialAliases || CwmpXmlParser.getSerialNumberAliases(session?.serialNumber);

    let device: any = null;
    if (session?.deviceId) {
      device = await Device.findOne({
        _id: session.deviceId,
        ...(tenant?._id ? { tenantId: tenant._id } : {}),
      });
    }

    if (!device && serialAliases.length > 0) {
      device = await Device.findOne({
        serialNumber: { $in: serialAliases },
        ...(tenant?._id ? { tenantId: tenant._id } : {}),
      });
    }

    if (!device) {
      console.warn(`[CWMP ACS] Device not found in DB for IP ${clientIp} / Serial ${session?.serialNumber}`);
      return null;
    }

    console.log(`[CWMP ACS] Inbound Response XML for ${device.serialNumber} (Stage: ${session?.stage}):\n${xml.substring(0, 1000)}`);
    if (!device.rawParameters) device.rawParameters = {};

    // Only overwrite raw XML, run scoped pruning, and assign rawMap when the response is NOT a Fault (Fault responses carry empty rawMap!)
    if (!(fault && fault.isFault)) {
      device.lastRawGetParameterValuesResponseXml = xml;
      if (session?.lastQueriedPaths && session.lastQueriedPaths.length > 0) {
        for (const queriedPath of session.lastQueriedPaths) {
          if (queriedPath.endsWith('.')) {
            for (const existingKey of Object.keys(device.rawParameters)) {
              if (existingKey.startsWith(queriedPath) && !(existingKey in rawMap)) {
                delete device.rawParameters[existingKey];
              }
            }
          } else {
            if ((queriedPath in device.rawParameters) && !(queriedPath in rawMap)) {
              delete device.rawParameters[queriedPath];
            }
          }
        }
        session.lastQueriedPaths = undefined;
      }

      Object.assign(device.rawParameters, rawMap);
      if (typeof (device as any).markModified === 'function') {
        (device as any).markModified('rawParameters');
      }
    }

    // --- POLL-THEN-PROVISION: WAN Slot Activation Check ---
    // After every GPV response, check if any waiting_for_wan_slot commands can now be fulfilled.
    // This fires when the operator manually adds a WAN connection in the router GUI and the slot
    // appears in the next GetParameterValues response (CWMP ID 6 = WAN slot discovery GPV).
    if ((device as any).addObjectNotSupported) {
      const waitingCmds = await DeviceCommand.find({
        deviceId: device._id,
        action: 'SET_WAN_CONFIG',
        status: 'waiting_for_wan_slot',
      });
      for (const waitCmd of waitingCmds) {
        const rawParams = (waitCmd as any).parameters?.tr069ParamValues || [];
        const samplePath = Array.isArray(rawParams[0]) ? rawParams[0][0] : (rawParams[0]?.name || '');
        const slotM = String(samplePath).match(/WANConnectionDevice\.(\d+)\./i);
        if (!slotM) {
          console.error(`[CWMP ACS] ❌ [POLL-THEN-PROVISION] Unable to resolve target WAN slot from command ${waitCmd._id} for ${device.serialNumber}. Failing loudly.`);
          (waitCmd as any).status = 'failed';
          (waitCmd as any).errorMessage = 'UNRESOLVABLE_WAN_SLOT: Could not extract target WANConnectionDevice slot index from command parameters.';
          (waitCmd as any).completedAt = new Date();
          await waitCmd.save();
          continue;
        }
        const neededSlot = slotM[1];
        const slotNowExists = Object.keys(device.rawParameters || {}).some(k =>
          k.includes(`WANConnectionDevice.${neededSlot}.`)
        );
        if (slotNowExists) {
          console.log(`[CWMP ACS] ✅ [POLL-THEN-PROVISION] WAN Slot ${neededSlot} detected on ${device.serialNumber}! Activating waiting command ${waitCmd._id}.`);
          (waitCmd as any).status = 'queued';
          (waitCmd as any).errorMessage = `Slot ${neededSlot} detected in device parameter tree. ACS will now provision parameters.`;
          (device as any).wanSlotPollPending = false;
          await waitCmd.save();
          triggerGenieAcsConnectionRequest(device.serialNumber).catch(() => {});
        }
      }
    }

    // 0. Handle DeleteObjectResponse from CPE
    if (xml.includes('DeleteObjectResponse')) {
      CwmpSessionLog.create({
        tenantId: tenant?._id,
        deviceId: device?._id,
        serialNumber: device.serialNumber,
        sessionId: session?.sessionId || incomingSessionId || 'unknown',
        cwmpId: '3',
        direction: 'CPE_TO_ACS',
        rpcMethod: 'DeleteObjectResponse',
        httpStatus: 200,
        rawXml: xml,
        timestamp: new Date(),
      }).catch(() => {});

      const statusMatch = xml.match(/<Status>(\d+)<\/Status>/i);
      const delStatus = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      console.log(`[Native CWMP IN] CPE successfully acknowledged DeleteObject for ${device.serialNumber} (Status: ${delStatus})`);

      await DeviceCommand.updateMany(
        { deviceId: device._id, status: 'sending', action: { $in: ['SET_WAN_CONFIG', 'DELETE_WAN_CONFIG'] } },
        { $set: { status: 'success', completedAt: new Date() } }
      );

      // Trigger immediate GPV discovery to refresh device rawParameters and purge deleted slot
      const gpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">6</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[1]">
        <string>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.</string>
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
      if (session) (session as any).stage = 'BASELINE_SENT';
      return gpvXml;
    }

    // 1. Handle AddObjectResponse from CPE
    if (xml.includes('AddObjectResponse')) {
      CwmpSessionLog.create({
        tenantId: tenant?._id,
        deviceId: device?._id,
        serialNumber: device.serialNumber,
        sessionId: session?.sessionId || incomingSessionId || 'unknown',
        cwmpId: '3',
        direction: 'CPE_TO_ACS',
        rpcMethod: 'AddObjectResponse',
        httpStatus: 200,
        rawXml: xml,
        timestamp: new Date(),
      }).catch(() => {});

      // Locate the in-flight command that triggered AddObject
      const pendingCmd = await DeviceCommand.findOne({ 
        deviceId: device._id, 
        status: 'sending',
        action: 'SET_WAN_CONFIG' 
      }).sort({ sentAt: -1 }) || await DeviceCommand.findOne({ 
        deviceId: device._id, 
        status: { $in: ['queued', 'sending', 'sent'] },
        action: 'SET_WAN_CONFIG'
      }).sort({ queuedAt: -1 });

      const instMatch = xml.match(/<InstanceNumber>(\d+)<\/InstanceNumber>/i);
      if (!instMatch || !instMatch[1]) {
        console.error(`[Native CWMP IN] CPE AddObjectResponse missing valid InstanceNumber element for ${device.serialNumber}`);
        if (pendingCmd) {
          pendingCmd.status = 'failed';
          pendingCmd.errorMessage = 'CPE AddObjectResponse did not return a valid <InstanceNumber> element.';
          pendingCmd.completedAt = new Date();
          await pendingCmd.save();
        }
        return null;
      }

      const instanceNum = instMatch[1];
      console.log(`[Native CWMP IN] CPE created new WAN connection instance ${instanceNum} for ${device.serialNumber}`);

      if (pendingCmd && session) {
        const rawParams = (pendingCmd as any).parameters?.tr069ParamValues || (pendingCmd as any).payload?.parameterValues || [];
        const profile = (pendingCmd.parameters as any)?.profile;
        const connType = String(profile?.connectionType || '').toUpperCase();
        const isPpp = connType === 'PPPOE' || connType === 'PPP' || profile?.linkMode === 'PPP' || rawParams.some((p: any) => {
          const name = Array.isArray(p) ? p[0] : (p?.name || p?.path || '');
          return name.includes('WANPPPConnection');
        });
        const connObj = isPpp ? 'WANPPPConnection' : 'WANIPConnection';

        const targetObjectName = String((pendingCmd.parameters as any)?.targetObjectName || '');

        // Step 1 check: If AddObject was dispatched for the parent WANConnectionDevice.,
        // the CPE allocated a new WAN slot (e.g. WANConnectionDevice.8.).
        // Now dispatch Step 2 AddObject to create the child WANPPPConnection or WANIPConnection instance inside it!
        if (targetObjectName.endsWith('WANConnectionDevice.')) {
          const nextTargetObjectName = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${instanceNum}.${connObj}.`;
          console.log(`[Native CWMP IN] Step 1 AddObject allocated slot ${instanceNum}. Now dispatching Step 2 AddObject for ${nextTargetObjectName} on ${device.serialNumber}`);
          (pendingCmd.parameters as any).targetObjectName = nextTargetObjectName;
          (pendingCmd.parameters as any).allocatedSlot = instanceNum;
          pendingCmd.markModified('parameters');
          await pendingCmd.save();

          const addConnObjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:AddObject>
      <ObjectName>${nextTargetObjectName}</ObjectName>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:AddObject>
  </soapenv:Body>
</soapenv:Envelope>`;

          CwmpSessionLog.create({
            tenantId: tenant?._id,
            deviceId: device?._id,
            serialNumber: device.serialNumber,
            sessionId: session?.sessionId || incomingSessionId || 'unknown',
            cwmpId: '3',
            direction: 'ACS_TO_CPE',
            rpcMethod: 'AddObject',
            httpStatus: 200,
            rawXml: addConnObjectXml,
            timestamp: new Date(),
          }).catch(() => {});

          session.stage = 'ADD_OBJECT_SENT';
          return addConnObjectXml;
        }

        // Step 2 completed: AddObject was on WANConnectionDevice.{slot}.{connObj}.
        let resolvedCpePath: string;
        if (targetObjectName.includes('WANConnectionDevice.')) {
          const slotMatch = targetObjectName.match(/WANConnectionDevice\.(\d+)\./);
          const slot = slotMatch ? slotMatch[1] : ((pendingCmd.parameters as any)?.allocatedSlot || instanceNum);
          resolvedCpePath = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slot}.${connObj}.${instanceNum}.`;
        } else {
          resolvedCpePath = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${instanceNum}.${connObj}.1.`;
        }

        const profileId = String((pendingCmd.parameters as any)?.profile?._id || '');
        const profileName = String((pendingCmd.parameters as any)?.profile?.name || '');
        const profileVlan = (pendingCmd.parameters as any)?.profile?.vlanId;

        let targetProfile = (device.wanProfiles || []).find((p: any) => p._id && String(p._id) === profileId);
        if (!targetProfile && profileName && profileName !== 'New WAN Connection') {
          targetProfile = (device.wanProfiles || []).find((p: any) => p.name === profileName);
        }
        if (!targetProfile && profileVlan) {
          targetProfile = (device.wanProfiles || []).find((p: any) => !p.isProtected && p.vlanId === Number(profileVlan));
        }

        if (!targetProfile) {
          targetProfile = profile || {
            name: profileName || 'WAN Connection',
            connectionType: isPpp ? 'PPPoE' : 'IP_Routed',
            vlanId: profileVlan || 100,
            enableWan: true,
          };
          device.wanProfiles = device.wanProfiles || [];
          device.wanProfiles.push(targetProfile);
        }

        targetProfile.cpeObjectPath = resolvedCpePath;
        device.markModified('wanProfiles');
        await this.saveDeviceResilient(device);
        console.log(`[Native CWMP DB] Persisted resolved cpeObjectPath '${resolvedCpePath}' for profile '${targetProfile.name || targetProfile._id}' on ${device.serialNumber}`);

        // Pass dynamic targetProfile into the same parameter-writing function that the edit path uses: buildTr069WanParams
        const generatedParams = await buildTr069WanParams(targetProfile, device);

        const normalizedParams: Array<{ name: string; value: any; type: string }> = generatedParams.map((p: any) => ({
          name: Array.isArray(p) ? p[0] : (p.name || p.path),
          value: Array.isArray(p) ? p[1] : p.value,
          type: Array.isArray(p) ? (p[2] || 'xsd:string') : (p.type || 'xsd:string'),
        }));

        // STRICT TR-069 ORDERING FOR ONT PROVISIONING:
        // 1. ConnectionType immediately (IP_Routed vs IP_Bridged)
        // 2. Enable (true)
        // 3. NATEnabled (true for Route, false for Bridge)
        // 4. Credentials (Username, Password)
        // 5. VLAN (X_CT-COM_WANEponLinkConfig.Mode = 1 (Tag) or 2 (Untag), VLANIDMark = <VID>)
        // 6. Remaining attributes (DNSServers, etc.)
        const orderedParams: Array<{ name: string; value: any; type: string }> = [];

        const isBridged = targetProfile.mode === 'Bridge' || targetProfile.connectionType === 'Bridge' || Boolean(targetProfile.bridgeMode);

        // 1. ConnectionType (only valid on WANIPConnection, omitted on WANPPPConnection to prevent Fault 9005)
        if (!isPpp) {
          const connTypeVal = isBridged ? 'IP_Bridged' : 'IP_Routed';
          const connTypeExisting = normalizedParams.find((p: any) => p.name.endsWith('.ConnectionType'));
          if (connTypeExisting) {
            connTypeExisting.value = connTypeVal;
            orderedParams.push(connTypeExisting);
          } else {
            orderedParams.push({
              name: `${resolvedCpePath}ConnectionType`,
              value: connTypeVal,
              type: 'xsd:string',
            });
          }
        }

        // 2. Enable
        const enableExisting = normalizedParams.find((p: any) => p.name.endsWith('.Enable'));
        if (enableExisting) {
          orderedParams.push(enableExisting);
        } else {
          orderedParams.push({
            name: `${resolvedCpePath}Enable`,
            value: true,
            type: 'xsd:boolean',
          });
        }

        // 3. NATEnabled (Crucial for Realtek/Syrotech Luna Route mode)
        if (!isPpp) {
          const natVal = isBridged ? false : (targetProfile.natEnabled !== false);
          const natExisting = normalizedParams.find((p: any) => p.name.endsWith('.NATEnabled'));
          if (natExisting) {
            natExisting.value = natVal;
            orderedParams.push(natExisting);
          } else {
            orderedParams.push({
              name: `${resolvedCpePath}NATEnabled`,
              value: natVal,
              type: 'xsd:boolean',
            });
          }
        }

        // 4. Credentials (Username & Password)
        const userExisting = normalizedParams.find((p: any) => p.name.endsWith('.Username'));
        const passExisting = normalizedParams.find((p: any) => p.name.endsWith('.Password'));
        if (userExisting) orderedParams.push(userExisting);
        if (passExisting) orderedParams.push(passExisting);

        // 5. VLAN parameters
        const rawKeys = Object.keys(device.rawParameters || {});
        const hasEponLinkConfig = rawKeys.some(k => k.includes('X_CT-COM_WANEponLinkConfig'));
        const hasGponLinkConfig = rawKeys.some(k => k.includes('X_CT-COM_WANGponLinkConfig'));

        const vlanParams = normalizedParams.filter((p: any) =>
          p.name.includes('WANEponLinkConfig') ||
          p.name.includes('X_CT-COM_WANEponLinkConfig') ||
          p.name.includes('WANGponLinkConfig') ||
          p.name.includes('X_CT-COM_WANGponLinkConfig') ||
          p.name.endsWith('.VLANID') ||
          p.name.endsWith('.VLANIDMark') ||
          p.name.endsWith('.802_1pMark') ||
          p.name.endsWith('.X_HW_VLAN')
        );

        for (const vp of vlanParams) {
          // Suppress candidate .VLANID if not in rawKeys to avoid Fault 9005
          if (rawKeys.length > 0 && vp.name.endsWith('.VLANID') && !rawKeys.some(k => k.includes(vp.name))) {
            console.warn(`[CWMP ACS] 🛡️ Suppressed unsupported parameter '${vp.name}' (not in device tree) after AddObject.`);
            continue;
          }
          if (vp.name.includes('X_CT-COM_WANEponLinkConfig') && hasGponLinkConfig && !hasEponLinkConfig) {
            const gponName = vp.name.replace('X_CT-COM_WANEponLinkConfig', 'X_CT-COM_WANGponLinkConfig');
            if (!orderedParams.some((o: any) => o.name === gponName)) {
              orderedParams.push({ ...vp, name: gponName });
            }
            continue;
          }
          if (vp.name.includes('X_CT-COM_WANGponLinkConfig') && hasEponLinkConfig && !hasGponLinkConfig) {
            const eponName = vp.name.replace('X_CT-COM_WANGponLinkConfig', 'X_CT-COM_WANEponLinkConfig');
            if (!orderedParams.some((o: any) => o.name === eponName)) {
              orderedParams.push({ ...vp, name: eponName });
            }
            continue;
          }
          if (!orderedParams.some((o: any) => o.name === vp.name)) {
            orderedParams.push(vp);
          }
        }

        // 5. Remaining parameters (NATEnabled, DNSServers, etc.)
        for (const np of normalizedParams) {
          if (!orderedParams.some((o: any) => o.name === np.name)) {
            orderedParams.push(np);
          }
        }

        const spvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValues>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[${orderedParams.length}]">
${orderedParams.map((p: any) => `        <ParameterValueStruct>
          <Name>${escapeXml(p.name)}</Name>
          <Value xsi:type="${p.type}">${escapeXml(p.value)}</Value>
        </ParameterValueStruct>`).join('\n')}
      </ParameterList>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:SetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;

        session.stage = 'SPV_SENT';
        pendingCmd.status = 'sending';
        pendingCmd.cwmpRequestId = '3';
        pendingCmd.affectedParameterPaths = orderedParams.map((p: any) => p.name);
        pendingCmd.verificationTargetValues = orderedParams.reduce((acc: any, p: any) => {
          acc[p.name] = p.value;
          return acc;
        }, {});
        if (pendingCmd.parameters) {
          (pendingCmd.parameters as any).resolvedCpePath = resolvedCpePath;
          pendingCmd.markModified('parameters');
        }
        await pendingCmd.save();

        CwmpSessionLog.create({
          tenantId: tenant?._id,
          deviceId: device?._id,
          serialNumber: device.serialNumber,
          sessionId: session.sessionId,
          cwmpId: '3',
          direction: 'ACS_TO_CPE',
          rpcMethod: 'SetParameterValues',
          httpStatus: 200,
          rawXml: CwmpXmlParser.maskSensitiveData(spvXml),
          timestamp: new Date(),
        }).catch(() => {});

        console.log(`[Native CWMP OUT] Dispatched Strict Ordered SetParameterValues after AddObject for ${device.serialNumber} (Cmd: ${pendingCmd._id}, Params: [${orderedParams.length}])`);
        return spvXml;
      }
      return null;
    }

    // 2. Handle SetParameterValuesResponse from CPE
    if (xml.includes('SetParameterValuesResponse')) {
      const statusMatch = xml.match(/<Status>(\d+)<\/Status>/i);
      const spvStatus = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const idMatch = xml.match(/<(?:cwmp:)?ID[^>]*>([^<]+)<\/(?:cwmp:)?ID>/i);
      const cwmpId = idMatch ? idMatch[1].trim() : '3';

      const isAutoMgmtResponse =
        cwmpId === '7' ||
        cwmpId === '8' ||
        ((session?.stage === 'AUTO_MGMT_SPV_SENT' || session?.stage === 'AUTO_MGMT_PERIODIC_ONLY_SENT') && cwmpId !== '3');

      if (isAutoMgmtResponse) {
        const creds = resolveTenantCwmpCredentials(session?.tenantSlug || (tenant as any)?.slug, (tenant as any)?.cwmpPassword);
        const includeConnReq = cwmpId === '7' || (session?.stage === 'AUTO_MGMT_SPV_SENT' && cwmpId !== '8');
        const isTr181 = Object.keys(device.rawParameters || {}).some((k) => k.startsWith('Device.ManagementServer.'));
        const prefix = isTr181 ? 'Device.ManagementServer.' : 'InternetGatewayDevice.ManagementServer.';

        device.periodicInformConfigured = true;
        device.periodicInformInterval = creds.periodicInformIntervalSeconds;
        device.rawParameters = {
          ...(device.rawParameters || {}),
          [`${prefix}PeriodicInformEnable`]: 'true',
          [`${prefix}PeriodicInformInterval`]: String(creds.periodicInformIntervalSeconds),
        };
        if (includeConnReq) {
          device.connectionRequestUsername = creds.connectionRequestUsername;
          device.connectionRequestPassword = creds.connectionRequestPassword;
          device.rawParameters[`${prefix}ConnectionRequestUsername`] = creds.connectionRequestUsername;
        }
        if (typeof (device as any).markModified === 'function') {
          (device as any).markModified('rawParameters');
        }
        await this.saveDeviceResilient(device);
        if (session) {
          session.stage = 'COMPLETED';
          await this.updateSession(session, connectionKey).catch(() => {});
          await this.clearConnectionSession(connectionKey).catch(() => {});
        }
        console.log(
          `[Native CWMP IN] Auto-ManagementServer baseline applied on ${device.serialNumber} | Inform: ${creds.periodicInformIntervalSeconds}s | ConnReq Synced: ${includeConnReq}`
        );
        return null;
      }

      console.log(`[Native CWMP IN] CPE successfully acknowledged SetParameterValues for ${device.serialNumber} (Status: ${spvStatus}, CWMP ID: ${cwmpId})`);

      await DeviceCommand.updateMany(
        { deviceId: device._id, status: { $in: ['sent', 'sending', 'queued', 'pending'] } },
        { $set: { status: spvStatus === 1 ? 'applied_pending_verification' : 'success', completedAt: new Date() } }
      );

      // Reconcile WAN profiles: mark any in-flight provisioning profiles as Connected
      if (Array.isArray(device.wanProfiles)) {
        let updatedWan = false;
        for (const wp of device.wanProfiles) {
          if (wp.status === 'Provisioning' || (wp as any).status === 'Connecting') {
            wp.status = 'Connected';
            delete (wp as any).lastError;
            updatedWan = true;
          }
        }
        if (updatedWan) {
          device.markModified('wanProfiles');
          await this.saveDeviceResilient(device);
        }
      }

      const recentCutoff = new Date(Date.now() - 120_000);
      const inFlightCommands = await DeviceCommand.find({
        deviceId: device._id,
        $or: [
          { cwmpRequestId: cwmpId },
          { queuedAt: { $gte: recentCutoff }, status: { $in: ['sent', 'sending', 'applied_pending_verification', 'applied', 'success'] } },
        ],
        action: { $nin: ['SUMMON_LIVE_POLL', 'GET_PARAMETERS', 'REFRESH_TELEMETRY', 'GetParameterNames', 'GetParameterValues', 'CUSTOM_RPC'] },
      });

      for (const cmd of inFlightCommands) {
        cmd.cwmpRequestId = cwmpId;
        cmd.cwmpResponseStatus = spvStatus;
        cmd.cwmpResponseTimestamp = new Date();
        cmd.completedAt = new Date();
        await cmd.save();

        console.log(`[CWMP_STRUCTURED_LOG] ${JSON.stringify({
          event: 'CWMP_SPV_RESPONSE_SUCCESS',
          taskId: cmd._id.toString(),
          deviceId: device._id.toString(),
          serialNumber: device.serialNumber,
          dataModel: cmd.dataModel,
          parameterPaths: cmd.affectedParameterPaths,
          rpcMethod: 'SetParameterValuesResponse',
          cwmpRequestId: cwmpId,
          spvResponseStatus: spvStatus,
          retryNumber: cmd.retryCount || 0,
          taskStatus: cmd.status,
        })}`);
      }

      if (device.pendingConfig) {
        device.pendingConfig.status = 'APPLIED';
        device.pendingConfig.appliedAt = new Date();
      }
      await device.save();

      // Check if this was a WAN connection command -> Dispatch SetParameterAttributes (SPA) for Notification
      const wanCmd = inFlightCommands.find((c: any) =>
        c.action === 'SET_WAN_CONFIG' ||
        (Array.isArray(c.affectedParameterPaths) && c.affectedParameterPaths.some((p: string) => p.includes('WANConnectionDevice.')))
      );

      if (wanCmd && session) {
        const storedPath = (wanCmd.parameters as any)?.resolvedCpePath ||
          (wanCmd.affectedParameterPaths && wanCmd.affectedParameterPaths[0] ?
            wanCmd.affectedParameterPaths[0].substring(0, wanCmd.affectedParameterPaths[0].lastIndexOf('.') + 1) : '');

        const targetBasePath = storedPath || 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.';
        const notifyParams = [
          `${targetBasePath}ConnectionStatus`,
          `${targetBasePath}ExternalIPAddress`,
        ];

        const spaXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">5</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterAttributes>
      <ParameterList soapenv:arrayType="cwmp:SetParameterAttributesStruct[${notifyParams.length}]">
${notifyParams.map((p) => `        <SetParameterAttributesStruct>
          <Name>${p}</Name>
          <NotificationChange>true</NotificationChange>
          <Notification>1</Notification>
          <AccessListChange>false</AccessListChange>
        </SetParameterAttributesStruct>`).join('\n')}
      </ParameterList>
    </cwmp:SetParameterAttributes>
  </soapenv:Body>
</soapenv:Envelope>`;

        session.stage = 'SPA_SENT';
        CwmpSessionLog.create({
          tenantId: tenant?._id,
          deviceId: device?._id,
          serialNumber: device.serialNumber,
          sessionId: session.sessionId,
          cwmpId: '5',
          direction: 'ACS_TO_CPE',
          rpcMethod: 'SetParameterAttributes',
          httpStatus: 200,
          rawXml: spaXml,
          timestamp: new Date(),
        }).catch(() => {});

        console.log(`[Native CWMP OUT] Dispatched SetParameterAttributes for Notify on ${device.serialNumber} (CWMP ID: 5)`);
        return spaXml;
      }

      // Check if we can immediately dispatch verification GPV within current session
      const pathsToVerify: string[] = [];
      for (const cmd of inFlightCommands) {
        if (Array.isArray(cmd.affectedParameterPaths)) {
          for (const p of cmd.affectedParameterPaths) {
            if (!p.toLowerCase().includes('password') && !pathsToVerify.includes(p)) {
              pathsToVerify.push(p);
            }
          }
        }
      }

      if (pathsToVerify.length > 0 && session) {
        session.stage = 'VERIFICATION_GPV_SENT';
        session.lastQueriedPaths = [...pathsToVerify];
        for (const cmd of inFlightCommands) {
          cmd.status = 'verifying';
          await cmd.save();
        }

        const stringElements = pathsToVerify.map((p) => `        <string>${p}</string>`).join('\n');
        const verifyGpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">4</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${pathsToVerify.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
        console.log(`[Native CWMP OUT] Dispatched Immediate Verification GPV for ${device.serialNumber} (${pathsToVerify.length} params)`);
        return verifyGpvXml;
      }

      return null;
    }

    // 3. Handle SetParameterAttributesResponse from CPE
    if (xml.includes('SetParameterAttributesResponse')) {
      console.log(`[Native CWMP IN] CPE successfully acknowledged SetParameterAttributes for ${device.serialNumber}`);
      CwmpSessionLog.create({
        tenantId: tenant?._id,
        deviceId: device?._id,
        serialNumber: device.serialNumber,
        sessionId: session?.sessionId || incomingSessionId || 'unknown',
        cwmpId: '5',
        direction: 'CPE_TO_ACS',
        rpcMethod: 'SetParameterAttributesResponse',
        httpStatus: 200,
        rawXml: xml,
        timestamp: new Date(),
      }).catch(() => {});

      await DeviceCommand.updateMany(
        { deviceId: device._id, status: { $in: ['sent', 'sending', 'queued', 'pending', 'applied_pending_verification'] } },
        { $set: { status: 'success', completedAt: new Date() } }
      );

      const recentCutoffSpa = new Date(Date.now() - 120_000);
      const inFlightCommands = await DeviceCommand.find({
        deviceId: device._id,
        queuedAt: { $gte: recentCutoffSpa },
        status: { $in: ['sent', 'sending', 'applied_pending_verification', 'applied', 'success'] },
        action: { $nin: ['SUMMON_LIVE_POLL', 'GET_PARAMETERS', 'REFRESH_TELEMETRY', 'GetParameterNames', 'GetParameterValues', 'CUSTOM_RPC'] },
      });

      const pathsToVerify: string[] = [];
      for (const cmd of inFlightCommands) {
        if (Array.isArray(cmd.affectedParameterPaths)) {
          for (const p of cmd.affectedParameterPaths) {
            if (!p.toLowerCase().includes('password') && !pathsToVerify.includes(p)) {
              pathsToVerify.push(p);
            }
          }
        }
      }

      if (pathsToVerify.length > 0 && session) {
        session.stage = 'VERIFICATION_GPV_SENT';
        session.lastQueriedPaths = [...pathsToVerify];
        for (const cmd of inFlightCommands) {
          cmd.status = 'verifying';
          await cmd.save();
        }

        const stringElements = pathsToVerify.map((p) => `        <string>${p}</string>`).join('\n');
        const verifyGpvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">4</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${pathsToVerify.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
        console.log(`[Native CWMP OUT] Dispatched Post-SPA Verification GPV for ${device.serialNumber} (${pathsToVerify.length} params)`);
        return verifyGpvXml;
      }

      if (session) {
        session.stage = 'COMPLETED';
      }
      return null;
    }

    // 4. Handle RebootResponse / FactoryResetResponse from CPE
    if (xml.includes('RebootResponse')) {
      console.log(`[Native CWMP IN] CPE acknowledged Reboot command for ${device.serialNumber}`);
      await DeviceCommand.updateMany(
        { deviceId: device._id, action: { $in: ['REBOOT_DEVICE', 'Reboot'] }, status: { $in: ['sent', 'sending', 'queued', 'pending'] } },
        { $set: { status: 'success', completedAt: new Date(), result: 'Reboot acknowledged by CPE' } }
      );
      return null;
    }

    if (xml.includes('FactoryResetResponse')) {
      console.log(`[Native CWMP IN] CPE acknowledged FactoryReset command for ${device.serialNumber}`);
      await DeviceCommand.updateMany(
        { deviceId: device._id, action: { $in: ['FACTORY_RESET', 'FactoryReset'] }, status: { $in: ['sent', 'sending', 'queued', 'pending'] } },
        { $set: { status: 'success', completedAt: new Date(), result: 'Factory reset acknowledged by CPE' } }
      );
      return null;
    }

    // 5. Handle GetParameterNamesResponse from CPE
    if (xml.includes('GetParameterNamesResponse')) {
      console.log(`[Native CWMP IN] CPE returned GetParameterNamesResponse for ${device.serialNumber}`);
      CwmpSessionLog.create({
        tenantId: tenant?._id,
        deviceId: device?._id,
        serialNumber: device.serialNumber,
        sessionId: session?.sessionId || incomingSessionId || 'unknown',
        cwmpId: '2',
        direction: 'CPE_TO_ACS',
        rpcMethod: 'GetParameterNamesResponse',
        httpStatus: 200,
        rawXml: xml,
        timestamp: new Date(),
      }).catch(() => {});

      const matches = xml.matchAll(/<ParameterInfoStruct>\s*<Name>([^<]+)<\/Name>\s*<Writable>([^<]+)<\/Writable>\s*<\/ParameterInfoStruct>/gi);
      for (const m of matches) {
        const pName = m[1].trim();
        const isWritable = m[2].trim() === '1' || m[2].trim() === 'true';
        SupportedParameterCache.findOneAndUpdate(
          { vendor: session?.vendor || 'GENEXIS', modelName: session?.modelName || 'Platinum-4410', parameterPath: pName },
          { $set: { status: 'SUPPORTED', writable: isWritable, lastSeenAt: new Date() } },
          { upsert: true }
        ).catch(() => {});
      }

      await DeviceCommand.updateMany(
        { deviceId: device._id, action: { $in: ['CUSTOM_RPC', 'GET_PARAMETER_NAMES'] }, status: { $in: ['sent', 'sending', 'queued', 'pending'] } },
        { $set: { status: 'success', completedAt: new Date() } }
      );
      return null;
    }

    CwmpSessionLog.create({
      tenantId: tenant?._id,
      deviceId: device?._id,
      serialNumber: device.serialNumber,
      sessionId: session?.sessionId || incomingSessionId || 'unknown',
      cwmpId: '3',
      direction: 'CPE_TO_ACS',
      rpcMethod: fault?.isFault ? 'Fault' : 'GetParameterValuesResponse',
      httpStatus: 200,
      rawXml: CwmpXmlParser.maskSensitiveData(xml),
      faultCode: fault?.faultCode,
      faultString: fault?.faultString,
      timestamp: new Date(),
    }).catch(() => {});

    // Handle SOAP Fault (e.g. Fault 9002 / 9003 / 9005 during SPV or GPV)
    if (fault?.isFault) {
      console.warn(
        `[CWMP ACS] CPE returned SOAP Fault ${fault.faultCode}: ${fault.faultString} during stage ${session?.stage}`
      );

      // Extract specific SetParameterValuesFault parameter name and code if present
      const spvFaultMatch = xml.match(/<SetParameterValuesFault>[\s\S]*?<ParameterName>([^<]+)<\/ParameterName>[\s\S]*?<FaultCode>([^<]+)<\/FaultCode>[\s\S]*?<FaultString>([^<]+)<\/FaultString>[\s\S]*?<\/SetParameterValuesFault>/i);
      let detailedErrorMsg = fault.faultString || `CWMP Fault ${fault.faultCode}`;
      if (spvFaultMatch) {
        const paramName = spvFaultMatch[1].trim();
        const fCode = spvFaultMatch[2].trim();
        const fString = spvFaultMatch[3].trim();
        detailedErrorMsg = `Fault ${fCode}: ${fString} (Parameter: ${paramName})`;
        console.warn(`[CWMP ACS] 🛑 Extracted SetParameterValuesFault on '${paramName}': ${detailedErrorMsg}`);
        const isCoreParam = /Username|Password|NATEnabled$/i.test(paramName);
        if (!isCoreParam) {
          SupportedParameterCache.findOneAndUpdate(
            { vendor: session?.vendor || 'GENEXIS', modelName: session?.modelName || 'Platinum-4410', parameterPath: paramName },
            { $set: { status: 'UNSUPPORTED', writable: false, lastSeenAt: new Date() } },
            { upsert: true }
          ).catch(() => {});
        }
      }
      let extractedFaultParam = '';
      const failedParamMatch = xml.match(/<ParameterName>([^<]+)<\/ParameterName>/i);
      if (failedParamMatch && failedParamMatch[1]) {
        extractedFaultParam = failedParamMatch[1].trim();
        detailedErrorMsg = `Fault ${fault.faultCode}: ${fault.faultString} (Parameter: ${extractedFaultParam})`;
        const isCore = /Username|Password|NATEnabled|Enable|ConnectionType|WANPPPConnection|WANIPConnection/i.test(extractedFaultParam);
        if (!isCore) {
          SupportedParameterCache.findOneAndUpdate(
            { vendor: session?.vendor || 'GENEXIS', modelName: session?.modelName || 'Platinum-4410', parameterPath: extractedFaultParam },
            { $set: { status: 'UNSUPPORTED', writable: false, lastSeenAt: new Date() } },
            { upsert: true }
          ).catch(() => {});
        }
      }

      console.log(`
[RESULT]
Stage: ${session?.stage}
Fault Code: ${fault.faultCode}
Fault String: ${fault.faultString}
Detailed: ${detailedErrorMsg}
Timestamp: ${new Date().toISOString()}
      `);

      // If AddObject was rejected with Fault 9003 (firmware doesn't support dynamic WAN object creation)
      // → Flag device as addObjectNotSupported and transition to Poll-Then-Provision mode
      if (session?.stage === 'ADD_OBJECT_SENT') {
        const is9003 = String(fault?.faultCode ?? '') === '9003';
        const pendingCmd = await DeviceCommand.findOne({
          deviceId: device._id,
          action: 'SET_WAN_CONFIG',
          status: { $in: ['queued', 'sending', 'sent', 'pending'] },
        }).sort({ createdAt: -1 });

        if (is9003) {
          // Permanently flag this device firmware as AddObject-unsupported
          console.log(`[CWMP ACS] 🚫 AddObject Fault 9003 confirmed for ${device.serialNumber}. Flagging device.addObjectNotSupported=true and switching to POLL-THEN-PROVISION mode.`);
          (device as any).addObjectNotSupported = true;
          (device as any).wanSlotPollPending = true;
          await this.saveDeviceResilient(device);

          if (pendingCmd) {
            // Extract target slot from stored params
            const rawParams = (pendingCmd as any).parameters?.tr069ParamValues || [];
            const samplePath = Array.isArray(rawParams[0]) ? rawParams[0][0] : (rawParams[0]?.name || '');
            const slotM = String(samplePath).match(/WANConnectionDevice\.(\d+)\./i);
            if (!slotM) {
              console.error(`[CWMP ACS] ❌ [FAULT_9003] Unable to resolve target WAN slot from command ${pendingCmd._id} for ${device.serialNumber}. Failing loudly.`);
              (pendingCmd as any).status = 'failed';
              (pendingCmd as any).errorMessage = 'FAILED_UNKNOWN_WAN_SLOT: Could not extract target WANConnectionDevice slot index from command parameters.';
              (pendingCmd as any).completedAt = new Date();
              await pendingCmd.save();
              return null;
            }
            const slotNum = slotM[1];

            (pendingCmd as any).status = 'waiting_for_wan_slot';
            (pendingCmd as any).errorMessage = [
              `[WAITING_FOR_WAN_SLOT] AddObject not supported by firmware (Fault 9003).`,
              `Please add WAN Connection Slot ${slotNum} manually in the router GUI (192.168.1.1),`,
              `then ACS will automatically detect the slot and complete provisioning.`,
            ].join(' ');
            await pendingCmd.save();
          }
          return null;
        }

        // Non-9003 AddObject fault → fallback to SPV on intended slot
        session.stage = 'SPV_SENT';
        if (pendingCmd) {
          let rawParams = (pendingCmd as any).parameters?.tr069ParamValues || (pendingCmd as any).payload?.parameterValues;
          if (Array.isArray(rawParams) && rawParams.length > 0) {
            const validParams = rawParams.map(([name, value, type]) => {
              // Never fallback PPPoE parameters to Slot 1 (Management TR069)
              const adjustedName = (name.includes('WANPPPConnection') && name.includes('WANConnectionDevice.1.'))
                ? name.replace('WANConnectionDevice.1.', 'WANConnectionDevice.2.')
                : name;
              return {
                name: adjustedName,
                value,
                type: type || 'xsd:string',
              };
            });

            const spvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValues>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[${validParams.length}]">
${validParams.map((p: any) => `        <ParameterValueStruct>
          <Name>${escapeXml(p.name)}</Name>
          <Value xsi:type="${p.type}">${escapeXml(p.value)}</Value>
        </ParameterValueStruct>`).join('\n')}
      </ParameterList>
      <ParameterKey>${pendingCmd._id}</ParameterKey>
    </cwmp:SetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
            pendingCmd.cwmpRequestId = '3';
            pendingCmd.status = 'sending';
            pendingCmd.affectedParameterPaths = validParams.map((p: any) => p.name);
            pendingCmd.verificationTargetValues = validParams.reduce((acc: any, p: any) => {
              acc[p.name] = p.value;
              return acc;
            }, {});
            await pendingCmd.save();
            return spvXml;
          }
        }
        return null;
      }

      const idMatch = xml.match(/<(?:cwmp:)?ID[^>]*>([^<]+)<\/(?:cwmp:)?ID>/i);
      const incomingCwmpId = idMatch ? idMatch[1].trim() : '';

      // Graceful fallback when auto-pushed ConnectionRequestUsername/Password is read-only on a locked CPE
      if (incomingCwmpId === '7' || (session?.stage === 'AUTO_MGMT_SPV_SENT' && !incomingCwmpId)) {
        if (session) {
          const fallback = this.buildAutoManagementBaselineSpv(device, session, false);
          session.stage = 'AUTO_MGMT_PERIODIC_ONLY_SENT';
          await this.updateSession(session, connectionKey).catch(() => {});
          console.warn(
            `[CWMP ACS] Auto-Mgmt SPV fault (${fault.faultCode}) on ${device.serialNumber}; retrying PeriodicInform-only (${fallback.creds.periodicInformIntervalSeconds}s).`
          );
          return fallback.xml;
        }
      }
      if (incomingCwmpId === '8' || (session?.stage === 'AUTO_MGMT_PERIODIC_ONLY_SENT' && !incomingCwmpId)) {
        // Both full SPV (ID 7) and periodic-only fallback (ID 8) faulted — do NOT mark as configured, allow retry on next inform
        console.warn(`[CWMP ACS] Auto-Mgmt periodic-only SPV also faulted (${fault.faultCode}) on ${device.serialNumber}. Will retry on next inform cycle.`);
        // device.periodicInformConfigured = true;  // REMOVED — prevents permanent stuck-offline
        await this.saveDeviceResilient(device);
        if (session) {
          session.stage = 'COMPLETED';
          await this.updateSession(session, connectionKey).catch(() => {});
          await this.clearConnectionSession(connectionKey).catch(() => {});
        }
        return null;
      }

      // If Baseline GPV failed (ID 2), do not fail operator commands: fallback to GetParameterNames discovery
      if (session?.stage === 'BASELINE_SENT' || incomingCwmpId === '2') {
        console.warn(
          `[CWMP ACS] Baseline GPV batch (ID: ${incomingCwmpId}) rejected with Fault ${fault.faultCode} on ${session?.serialNumber || device.serialNumber} (${session?.modelName || device.modelName}). Dispatching GPN discovery fallback.`
        );
        if (session) session.stage = 'GPN_SENT';
        device.lastParameterSyncStatus = `FAULT_${fault.faultCode}_DISCOVERY_FALLBACK`;
        await this.saveDeviceResilient(device);

        const isTr181 = session?.vendor === 'TR181_STANDARD';
        const gpnRoot = isTr181 ? 'Device.' : 'InternetGatewayDevice.';
        const gpnXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">2</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterNames>
      <ParameterPath>${gpnRoot}</ParameterPath>
      <NextLevel>0</NextLevel>
    </cwmp:GetParameterNames>
  </soapenv:Body>
</soapenv:Envelope>`;
        return gpnXml;
      }

      // Only mark configuration commands as failed if the fault occurred during SetParameterValues (SPV) or Custom RPC
      if ((session?.stage === 'SPV_SENT' || session?.stage === 'CUSTOM_RPC_SENT') && incomingCwmpId !== '2') {
        // Fallback for DeleteObject (CUSTOM_RPC_SENT): Many CPE firmwares (e.g. Genexis GX4410, TP-Link) restrict DeleteObject
        // and return Fault 9003/9005. Gracefully fallback to disabling WAN and clearing credentials on the ONT via SetParameterValues.
        if (session?.stage === 'CUSTOM_RPC_SENT') {
          const deleteCmd = await DeviceCommand.findOne({
            deviceId: device._id,
            action: { $in: ['DELETE_WAN_CONFIG', 'DeleteObject', 'SET_WAN_CONFIG'] },
            status: { $in: ['sending', 'sent', 'queued', 'pending'] },
          }).sort({ sentAt: -1, createdAt: -1 });

          if (deleteCmd && ((deleteCmd.parameters as any)?.operation === 'DELETE_OBJECT' || deleteCmd.action === 'DELETE_WAN_CONFIG')) {
            console.log(`[CWMP ACS] ⚠️ CPE returned Fault ${fault.faultCode} for DeleteObject on ${session?.serialNumber || device.serialNumber}. Executing graceful WAN disable fallback via SetParameterValues.`);
            
            const targetSlot = (deleteCmd.parameters as any)?.targetSlot || '2';
            const targetConn = (deleteCmd.parameters as any)?.cpeObjectPath || (deleteCmd.parameters as any)?.targetObjectName || '';
            const slotNum = targetConn.match(/WANConnectionDevice\.(\d+)\./i)?.[1] || targetSlot;
            const basePath = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.`;
            const isIpTarget = targetConn.includes('WANIPConnection');
            const connSubPath = isIpTarget ? `${basePath}WANIPConnection.1.` : `${basePath}WANPPPConnection.1.`;

            // Detect whether this CPE hardware genuinely supports China Telecom proprietary X_CT-COM_ parameters
            const isCtComDevice = Boolean(
              /huawei|zte|china|ct-com|fiberhome/i.test(`${device?.manufacturer || ''} ${device?.modelName || ''} ${session?.vendor || ''}`) ||
              Object.keys(device?.rawParameters || {}).some((k) => k.includes('X_CT-COM_'))
            );

            const fallbackParams: { name: string; value: any; type: string }[] = [
              { name: `${connSubPath}Enable`, value: false, type: 'xsd:boolean' },
            ];

            // Only send X_CT-COM vendor extensions if confirmed supported on this hardware (avoids Fault 9005 on TP-Link, Netlink, Genexis)
            if (isCtComDevice) {
              fallbackParams.push(
                { name: `${connSubPath}X_CT-COM_LanInterface`, value: '', type: 'xsd:string' },
                { name: `${connSubPath}X_CT-COM_ServiceList`, value: '', type: 'xsd:string' },
                { name: `${basePath}X_CT-COM_WANEponLinkConfig.VLANIDMark`, value: 0, type: 'xsd:int' }
              );
            }

            if (!isIpTarget) {
              fallbackParams.push({ name: `${connSubPath}Username`, value: '', type: 'xsd:string' });
              fallbackParams.push({ name: `${connSubPath}Password`, value: '', type: 'xsd:string' });
            }

            session.stage = 'SPV_SENT';
            const spvXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">3</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValues>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[${fallbackParams.length}]">
${fallbackParams.map((p) => `        <ParameterValueStruct>
          <Name>${escapeXml(p.name)}</Name>
          <Value xsi:type="${p.type}">${escapeXml(p.value)}</Value>
        </ParameterValueStruct>`).join('\n')}
      </ParameterList>
      <ParameterKey>${deleteCmd._id}</ParameterKey>
    </cwmp:SetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;

            deleteCmd.cwmpRequestId = '3';
            deleteCmd.status = 'sending';
            deleteCmd.affectedParameterPaths = fallbackParams.map((p) => p.name);
            deleteCmd.verificationTargetValues = fallbackParams.reduce((acc: any, p) => {
              acc[p.name] = p.value;
              return acc;
            }, {});
            await deleteCmd.save();

            CwmpSessionLog.create({
              tenantId: session?.tenantId,
              deviceId: device._id,
              serialNumber: session?.serialNumber || device.serialNumber,
              sessionId: session?.sessionId || incomingSessionId || 'unknown',
              cwmpId: '3',
              direction: 'ACS_TO_CPE',
              rpcMethod: 'SetParameterValues',
              httpStatus: 200,
              rawXml: spvXml,
              timestamp: new Date(),
            }).catch(() => {});

            console.log(`[Native CWMP OUT] Dispatched Graceful Disable SPV for Slot ${slotNum} on ${session.serialNumber}`);
            return spvXml;
          }
        }

        console.log(`[CWMP_STRUCTURED_LOG] ${JSON.stringify({
          event: 'CWMP_FAULT',
          deviceId: device._id.toString(),
          serialNumber: device.serialNumber,
          rpcMethod: fault.isFault ? 'Fault' : 'Unknown',
          faultCode: fault.faultCode,
          faultString: fault.faultString,
          faultParameter: extractedFaultParam,
          detailedErrorMsg,
          stage: session?.stage,
          taskStatus: 'failed',
        })}`);

        const isFault9005 = String(fault.faultCode) === '9005' || /9005/i.test(xml);
        const resolvedFaultCode = isFault9005 ? 9005 : Number(fault.faultCode || 9002);
        const cmdUpdatePayload: any = {
          status: 'failed',
          errorMessage: detailedErrorMsg,
          completedAt: new Date(),
          faultCode: resolvedFaultCode,
          faultString: fault.faultString,
        };
        if (extractedFaultParam) {
          cmdUpdatePayload.faultParameter = extractedFaultParam;
        }
        if (isFault9005) {
          cmdUpdatePayload.retryable = false;
        }

        await DeviceCommand.updateMany(
          { deviceId: device._id, status: { $in: ['sent', 'sending'] } },
          { $set: cmdUpdatePayload }
        );
        if (device.pendingConfig && device.pendingConfig.status === 'APPLYING') {
          device.pendingConfig.status = 'FAILED';
          device.pendingConfig.failedAt = new Date();
          device.pendingConfig.errorMessage = detailedErrorMsg;
        }

        // On SPV Fault, flag any in-flight provisioning WAN profiles as Disconnected / Failed
        if (Array.isArray(device.wanProfiles)) {
          let updatedWan = false;
          for (const wp of device.wanProfiles) {
            if (wp.status === 'Provisioning' || (wp as any).status === 'Connecting') {
              wp.status = 'Disconnected';
              (wp as any).lastError = detailedErrorMsg;
              updatedWan = true;
            }
          }
          if (updatedWan) {
            device.markModified('wanProfiles');
          }
        }
        await this.saveDeviceResilient(device);
        return null;
      }

      if (session?.stage === 'OPTICAL_SENT' && (session.activeOpticalCandidate || (session.lastQueriedPaths && session.lastQueriedPaths.length > 0))) {
        const paramFaultMatch = (fault.faultString || xml).match(/(?:Invalid parameter name[: ]*|parameter[: ]+)((?:InternetGatewayDevice|Device)\.[A-Za-z0-9._-]+)/i);
        const exactFaultPath = paramFaultMatch ? paramFaultMatch[1].trim() : undefined;
        const pathToBlacklist = exactFaultPath || session.activeOpticalCandidate;

        if (pathToBlacklist) {
          await SupportedParameterCache.findOneAndUpdate(
            {
              vendor: session.vendor,
              modelName: session.modelName,
              parameterPath: pathToBlacklist,
            },
            {
              $set: {
                status: 'UNSUPPORTED',
                manufacturer: session.manufacturer,
                firmwareVersion: session.firmwareVersion,
                lastCheckedAt: new Date(),
                lastErrorCode: fault.faultCode,
                lastRawFault: fault.faultString || 'CWMP Fault 9005',
              },
            },
            { upsert: true }
          );
          console.log(
            `[CWMP ACS] Cached parameter as UNSUPPORTED: ${pathToBlacklist}. Baseline Wi-Fi/WAN data remains preserved.`
          );
        }

        device.lastParameterSyncStatus = `FAULT_${fault.faultCode}_OPTICAL`;
        await this.saveDeviceResilient(device);

        // If the fault specifically implicated a non-optical path, retry remaining paths keeping optical intact; otherwise fall back cleanly without optical
        const remainingPaths = (session.lastQueriedPaths || []).filter((p) => {
          if (exactFaultPath && !this.isOpticalRxPath(exactFaultPath) && !this.isOpticalTxPath(exactFaultPath)) {
            return p !== exactFaultPath;
          }
          return !this.isOpticalRxPath(p) && !this.isOpticalTxPath(p) && !/optical|bias|vottage|rxpower|txpower/i.test(p);
        });
        const remainingNonOptical = remainingPaths.length > 48 ? remainingPaths.slice(0, 48) : remainingPaths;
        if (remainingNonOptical.length > 0) {
          session.stage = 'BASELINE_SENT';
          if (!exactFaultPath || this.isOpticalRxPath(exactFaultPath)) {
            session.activeOpticalCandidate = undefined;
          }
          session.lastQueriedPaths = [...remainingNonOptical];
          const stringElements = remainingNonOptical.map((p) => `        <string>${p}</string>`).join('\n');
          console.log(`[CWMP ACS -> CPE] Dispatching non-optical fallback GPV (${remainingNonOptical.length} params) for ${session.serialNumber}`);
          return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">2</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${remainingNonOptical.length}]">
${stringElements}
      </ParameterNames>
    </cwmp:GetParameterValues>
  </soapenv:Body>
</soapenv:Envelope>`;
        }
      }
      return null;
    }

    // SUCCESSFUL RESPONSE: Extract all returned Wi-Fi, WAN, LAN, and Optical parameters
    // Dynamic Multi-Band WLAN Discovery across all instances (TR-098 & TR-181)
    let ssid24 = '';
    let pass24 = '';
    let chan24 = '';
    let beacon24 = '';
    let ssid5g = '';
    let pass5g = '';
    let chan5g = '';
    let beacon5g = '';

    const mergedRawForBand: Record<string, any> = {
      ...(device.rawParameters || {}),
      ...rawMap,
    };

    for (let i = 1; i <= 16; i++) {
      const sVal = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.SSID`) ||
                   pMap.get(`Device.WiFi.SSID.${i}.SSID`);
      if (!sVal) continue;
      const enVal = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.Enable`) ||
                    pMap.get(`Device.WiFi.SSID.${i}.Enable`);
      const isEnabled = enVal !== '0' && enVal !== 'false';
      const radioRef = pMap.get(`Device.WiFi.SSID.${i}.LowerLayers`) || mergedRawForBand[`Device.WiFi.SSID.${i}.LowerLayers`] || '';
      const radioMatch = String(radioRef).match(/Radio\.(\d+)/i);
      const tr181RadioIdx = radioMatch ? Number(radioMatch[1]) : i;
      const tr181ApIdx = CwmpVendorProfiles.resolveTr181AccessPointIndex(mergedRawForBand, i);
      const cVal = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.Channel`) ||
                   pMap.get(`Device.WiFi.Radio.${tr181RadioIdx}.Channel`) ||
                   mergedRawForBand[`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.Channel`] ||
                   mergedRawForBand[`Device.WiFi.Radio.${tr181RadioIdx}.Channel`];
      const detectedBand = CwmpVendorProfiles.determineWifiBand(mergedRawForBand, i, sVal);
      const is5G = detectedBand === '5GHz';
      const is24G = detectedBand === '2.4GHz';

      const validSecret = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(i, mergedRawForBand));
      const secVal = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.BeaconType`) ||
                     pMap.get(`Device.WiFi.AccessPoint.${tr181ApIdx}.Security.ModeEnabled`);

      if (is5G) {
        if (!ssid5g || (isEnabled && !/guest|iot/i.test(sVal) && (i === 5 || i === 3 || i === 2 || /guest|iot/i.test(ssid5g)))) {
          ssid5g = sVal;
          if (validSecret) pass5g = validSecret;
          if (cVal !== undefined) chan5g = String(cVal);
          if (secVal) beacon5g = secVal;
        }
      } else if (is24G) {
        if (!ssid24 || (isEnabled && !/guest|iot/i.test(sVal) && (i === 1 || /guest|iot/i.test(ssid24)))) {
          ssid24 = sVal;
          if (validSecret) pass24 = validSecret;
          if (cVal !== undefined) chan24 = String(cVal);
          if (secVal) beacon24 = secVal;
        }
      }
    }

    if (!ssid24) {
      ssid24 = this.getFirstParam(pMap, ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', 'Device.WiFi.SSID.1.SSID']) || '';
      const rawP24 = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(1, mergedRawForBand));
      if (rawP24) pass24 = rawP24;
      chan24 = this.getFirstParam(pMap, ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel', 'Device.WiFi.Radio.1.Channel']) || '';
      beacon24 = this.getFirstParam(pMap, ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType', 'Device.WiFi.AccessPoint.1.Security.ModeEnabled']) || '';
    }
    if (!ssid5g) {
      // Only fall back to secondary radio instances if not explicitly classified as 2.4GHz and preferring enabled instances
      for (const fallbackIdx of [5, 3, 2, 6]) {
        const candSsid = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${fallbackIdx}.SSID`);
        if (!candSsid) continue;
        const candBand = CwmpVendorProfiles.determineWifiBand(mergedRawForBand, fallbackIdx, candSsid);
        const candEnabled = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${fallbackIdx}.Enable`) !== '0';
        if (candBand !== '2.4GHz' && (candEnabled || !ssid5g) && !/guest/i.test(candSsid)) {
          ssid5g = candSsid;
          const rawP5g = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(fallbackIdx, mergedRawForBand));
          if (rawP5g) pass5g = rawP5g;
          chan5g = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${fallbackIdx}.Channel`) || '';
          beacon5g = pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${fallbackIdx}.BeaconType`) || '';
          if (candEnabled) break;
        }
      }
      if (!ssid5g && pMap.get('Device.WiFi.SSID.2.SSID')) {
        ssid5g = pMap.get('Device.WiFi.SSID.2.SSID') || '';
        const rawTr181P5 = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(2, mergedRawForBand));
        if (rawTr181P5) pass5g = rawTr181P5;
        chan5g = pMap.get('Device.WiFi.Radio.2.Channel') || '';
        const ap2 = CwmpVendorProfiles.resolveTr181AccessPointIndex(mergedRawForBand, 2);
        beacon5g = pMap.get(`Device.WiFi.AccessPoint.${ap2}.Security.ModeEnabled`) || '';
      }
    }

    // Multi-slot dynamic search for customer PPPoE credentials across all WAN slots (preferring active non-TR069 INTERNET slot)
    let pppoeUser = '';
    let pppoePass = '';
    let pppStatus = '';
    let pppIp = '';
    let rawVlan = '';
    let bestPppScore = -1;

    for (const [k, v] of pMap.entries()) {
      const m = k.match(/((?:WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANPPPConnection\.\d+)|(?:Device\.PPP\.Interface\.\d+))\.Username$/i);
      if (m && v && String(v).trim()) {
        const prefix = m[1];
        const connName = pMap.get(`${prefix}.Name`) || mergedRawForBand[`${prefix}.Name`] || '';
        const svc = pMap.get(`${prefix}.X_CT-COM_ServiceList`) || pMap.get(`${prefix}.ServiceList`) || mergedRawForBand[`${prefix}.X_CT-COM_ServiceList`] || '';
        const statusVal = pMap.get(`${prefix}.ConnectionStatus`) || pMap.get(`${prefix}.Status`) || '';
        const ipVal = pMap.get(`${prefix}.ExternalIPAddress`) || pMap.get(`${prefix}.IPCPLocalIPAddress`) || '';
        const enVal = pMap.get(`${prefix}.Enable`);
        const isMgmt = /TR069|VOIP|VOICE/i.test(`${connName} ${svc}`) && !/INTERNET/i.test(`${connName} ${svc}`);
        const score =
          (isMgmt ? 0 : 100) +
          (/connected/i.test(statusVal) ? 50 : 0) +
          (ipVal && ipVal !== '0.0.0.0' ? 25 : 0) +
          (enVal !== '0' && enVal !== 'false' ? 10 : 0);

        if (score > bestPppScore) {
          bestPppScore = score;
          pppoeUser = String(v).trim();
          pppoePass = this.pickNonMaskedSecret(pMap, [`${prefix}.Password`, `${prefix}.X_CT-COM_Password`]) || '';
          pppStatus = statusVal || pppStatus;
          if (ipVal && ipVal !== '0.0.0.0') pppIp = ipVal;
          const slotMatch = prefix.match(/WANConnectionDevice\.(\d+)\./i);
          const slotNum = slotMatch ? slotMatch[1] : '1';
          rawVlan =
            pMap.get(`${prefix}.X_HW_VLAN`) ||
            pMap.get(`${prefix}.X_CT-COM_VlanID`) ||
            pMap.get(`${prefix}.VLANID`) ||
            pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.VLANIDMark`) ||
            pMap.get(`InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.VLANIDMark`) ||
            rawVlan;
        }
      }
    }

    if (!pppIp) {
      for (const [k, v] of pMap.entries()) {
        if (/WANConnectionDevice\.\d+\.(WANPPPConnection|WANIPConnection)\.\d+\.ExternalIPAddress$/i.test(k) && v && v !== '0.0.0.0') {
          const prefix = k.substring(0, k.lastIndexOf('.'));
          const connName = pMap.get(`${prefix}.Name`) || '';
          if (!/TR069/i.test(connName) || !pppIp) {
            pppIp = v;
            pppStatus = pMap.get(`${prefix}.ConnectionStatus`) || pppStatus;
          }
        }
      }
    }

    if (!pppoeUser) {
      pppoeUser = this.getFirstParam(pMap, [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.Username',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.3.Username',
        'Device.PPP.Interface.1.Username',
        'Device.PPP.Interface.2.Username',
      ]) || '';
    }
    if (!pppStatus) {
      pppStatus = this.getFirstParam(pMap, [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ConnectionStatus',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.3.ConnectionStatus',
        'Device.PPP.Interface.1.ConnectionStatus',
      ]) || '';
    }
    if (!pppIp) {
      pppIp = this.getFirstParam(pMap, [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.3.ExternalIPAddress',
        'Device.IP.Interface.1.IPv4Address.1.IPAddress',
      ]) || '';
    }
    if (!rawVlan) {
      rawVlan = this.getFirstParam(pMap, [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_VLAN',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_CT-COM_VlanID',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_ZTE-COM_VLAN',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.X_CT-COM_VlanID',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.VLANID',
        'Device.Ethernet.VLANTermination.1.VLANID',
      ]) || '';
    }

    if (pppoeUser) (device as any).pppoeUsername = pppoeUser;
    if (pppIp && pppIp !== '0.0.0.0') device.externalIpAddress = pppIp;
    if (rawVlan) {
      const v = parseInt(rawVlan, 10);
      if (!isNaN(v) && v > 0) (device as any).wanVlan = v;
    }
    const rawInterval = this.getFirstParam(pMap, [
      'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
      'Device.ManagementServer.PeriodicInformInterval',
    ]);
    if (rawInterval) {
      const pi = parseInt(String(rawInterval), 10);
      if (!isNaN(pi) && pi > 0) {
        device.periodicInformInterval = pi;
        // GPV drift detection: if router's actual interval differs from target, flag for re-push
        const targetInterval = parseInt(process.env.CWMP_RECOMMENDED_INFORM_INTERVAL || '300', 10);
        if (pi !== targetInterval && (device as any).periodicInformConfigured) {
          (device as any).periodicInformConfigured = false;
          console.log(`[CWMP ACS] ⚠️ GPV detected PeriodicInform drift: ${pi}s vs target ${targetInterval}s on ${device.serialNumber}. Flagged for re-push.`);
        }
      }
    }
    const gpvCrUrl = this.getFirstParam(pMap, [
      'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
      'Device.ManagementServer.ConnectionRequestURL',
    ]);
    if (gpvCrUrl && String(gpvCrUrl).startsWith('http')) {
      device.connectionRequestUrl = String(gpvCrUrl).trim();
    }
    const gpvCrUser = this.getFirstParam(pMap, [
      'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
      'Device.ManagementServer.ConnectionRequestUsername',
    ]);
    if (gpvCrUser && String(gpvCrUser).trim() && !/^\*+$/.test(String(gpvCrUser).trim())) {
      device.connectionRequestUsername = String(gpvCrUser).trim();
    }
    const gpvCrPass = this.getFirstParam(pMap, [
      'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',
      'Device.ManagementServer.ConnectionRequestPassword',
    ]);
    if (gpvCrPass && String(gpvCrPass).trim() && !/^\*+$/.test(String(gpvCrPass).trim())) {
      device.connectionRequestPassword = String(gpvCrPass).trim();
    }
    const gpvManufacturer = this.getFirstParam(pMap, ['InternetGatewayDevice.DeviceInfo.Manufacturer', 'Device.DeviceInfo.Manufacturer']);
    if (gpvManufacturer && !/^unknown|generic$/i.test(gpvManufacturer.trim())) {
      device.manufacturer = CwmpVendorProfiles.detectVendor(gpvManufacturer, device.modelName) === 'SYROTECH' ? 'SYROTECH' : gpvManufacturer.trim();
    }
    const gpvModel = this.getFirstParam(pMap, ['InternetGatewayDevice.DeviceInfo.ModelName', 'Device.DeviceInfo.ModelName', 'InternetGatewayDevice.DeviceInfo.ProductClass', 'Device.DeviceInfo.ProductClass']);
    if (gpvModel && !/^unknown|generic|gpon[-_ ]?ont|igd$/i.test(gpvModel.trim())) {
      device.modelName = gpvModel.trim();
    }
    const gpvHwVer = this.getFirstParam(pMap, ['InternetGatewayDevice.DeviceInfo.HardwareVersion', 'Device.DeviceInfo.HardwareVersion']);
    if (gpvHwVer && gpvHwVer.trim()) device.hardwareVersion = gpvHwVer.trim();
    const gpvSwVer = this.getFirstParam(pMap, ['InternetGatewayDevice.DeviceInfo.SoftwareVersion', 'Device.DeviceInfo.SoftwareVersion', 'InternetGatewayDevice.DeviceInfo.X_HW_SoftwareVersion']);
    if (gpvSwVer && gpvSwVer.trim()) device.softwareVersion = gpvSwVer.trim();
    const gpvMac = this.getFirstParam(pMap, [
      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress',
      'Device.Ethernet.Interface.1.MACAddress',
      'InternetGatewayDevice.DeviceInfo.MACAddress',
      'Device.DeviceInfo.MACAddress',
    ]);
    if (gpvMac && gpvMac.trim() && gpvMac !== '00:00:00:00:00:00') device.macAddress = gpvMac.trim();
    const rawUptime = this.getFirstParam(pMap, [
      'InternetGatewayDevice.DeviceInfo.UpTime',
      'Device.DeviceInfo.UpTime',
    ]);
    if (rawUptime) {
      const up = parseInt(String(rawUptime), 10);
      if (!isNaN(up) && up >= 0) device.uptimeSeconds = up;
    }

    const rawHosts = this.getFirstParam(pMap, [
      'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries',
      'InternetGatewayDevice.LANDevice.1.HostNumberOfEntries',
      'Device.Hosts.HostNumberOfEntries',
    ]);

    if (!device.wifi24) {
      device.wifi24 = {
        ssid: ssid24 || '',
        password: pass24 || '',
        enabled: true,
        channel: chan24 ? parseInt(chan24, 10) || 6 : 6,
        channelAuto: true,
        bandwidthMhz: 20,
        securityMode: (beacon24 as any) || 'WPA2-PSK',
        txPowerPercent: 100,
      };
    } else {
      if (ssid24) device.wifi24.ssid = ssid24;
      if (pass24 && pass24.trim() && !/^\*+$/.test(pass24.trim())) device.wifi24.password = pass24.trim();
      if (chan24) {
        const c = parseInt(chan24, 10);
        if (!isNaN(c)) device.wifi24.channel = c;
      }
      if (beacon24) device.wifi24.securityMode = beacon24 as any;
    }

    if (!device.wifi5g) {
      device.wifi5g = {
        ssid: ssid5g || '',
        password: (pass5g && pass5g.trim() && !/^\*+$/.test(pass5g.trim())) ? pass5g.trim() : '',
        enabled: true,
        channel: chan5g ? parseInt(chan5g, 10) || 44 : 44,
        channelAuto: true,
        bandwidthMhz: 80,
        securityMode: (beacon5g as any) || 'WPA2-PSK',
        txPowerPercent: 100,
      };
    } else {
      if (ssid5g) device.wifi5g.ssid = ssid5g;
      if (pass5g && pass5g.trim() && !/^\*+$/.test(pass5g.trim())) device.wifi5g.password = pass5g.trim();
      if (chan5g) {
        const c = parseInt(chan5g, 10);
        if (!isNaN(c)) device.wifi5g.channel = c;
      }
      if (beacon5g) device.wifi5g.securityMode = beacon5g as any;
    }

    // Dynamically discover and populate ALL WAN connections from pMap
    const discoveredWanProfiles: any[] = [];
    const pMapKeys = Array.from(pMap.keys());
    
    // Find all WAN connection prefixes
    const connPrefixes = Array.from(new Set(
      pMapKeys.map(k => {
        const m = k.match(/(InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.(?:WANPPPConnection|WANIPConnection)\.\d+)\./i);
        return m ? m[1] : null;
      }).filter((v): v is string => v !== null)
    ));

    for (const prefix of connPrefixes) {
      const isPpp = prefix.includes('WANPPPConnection');
      const connName = pMap.get(`${prefix}.Name`) || '';
      const connUser = pMap.get(`${prefix}.Username`) || '';
      const connIp = pMap.get(`${prefix}.ExternalIPAddress`) || pMap.get(`${prefix}.RemoteIPAddress`) || '';
      const connGateway = pMap.get(`${prefix}.DefaultGateway`) || '';
      const connDns = pMap.get(`${prefix}.DNSServers`) || '';
      const connSubnet = pMap.get(`${prefix}.SubnetMask`) || '';
      const connAddressing = pMap.get(`${prefix}.AddressingType`) || '';
      const connNat = pMap.get(`${prefix}.NATEnabled`);
      const connMtuRaw = pMap.get(`${prefix}.MaxMTUSize`) || pMap.get(`${prefix}.CurrentMTUSize`);
      const connStatus = pMap.get(`${prefix}.ConnectionStatus`) || (connIp && connIp !== '0.0.0.0' ? 'Connected' : 'Connecting');
      const connEnable = pMap.get(`${prefix}.Enable`) !== '0' && pMap.get(`${prefix}.Enable`) !== 'false';
      const slotMatch = prefix.match(/WANConnectionDevice\.(\d+)\./i);
      const slotNum = slotMatch ? slotMatch[1] : '1';

      // Resolve VLAN ID from live pMap, rawParameters, or slot link config (supports X_CT-COM_ and X_CT_COM_)
      let connVlan: number | null = null;
      const rawMap = ((device as any)?.rawParameters || {}) as Record<string, any>;
      const getSlotOrConn = (keys: string[]) => {
        for (const k of keys) {
          const val = pMap.get(k) ?? rawMap[k];
          if (val !== undefined && val !== '') return val;
        }
        return undefined;
      };
      const vlanRaw = getSlotOrConn([
        `${prefix}.X_CT-COM_VlanID`,
        `${prefix}.X_CT_COM_VlanID`,
        `${prefix}.X_HW_VLAN`,
        `${prefix}.X_ZTE-COM_VLAN`,
        `${prefix}.VLANID`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.VLANIDMark`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT_COM_WANEponLinkConfig.VLANIDMark`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.VLANIDMark`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT_COM_WANGponLinkConfig.VLANIDMark`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANLinkConfig.VLANIDMark`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT_COM_WANLinkConfig.VLANIDMark`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.VLANID`,
      ]);
      if (vlanRaw) {
        const v = parseInt(String(vlanRaw), 10);
        if (!isNaN(v) && v > 0) connVlan = v;
      }
      if (!connVlan && connName) {
        const m = connName.match(/VID_(\d+)/i);
        if (m) connVlan = parseInt(m[1], 10);
      }
      const existingProfile = (device.wanProfiles || []).find((p: any) => p.cpeObjectPath === `${prefix}.` || p.name === connName);
      if (!connVlan && existingProfile?.vlanId) {
        connVlan = Number(existingProfile.vlanId);
      }
      if (!connVlan && isPpp && (device as any).wanVlan) {
        connVlan = (device as any).wanVlan;
      }

      // Resolve mode (Bridge vs Route) and VLAN mode (TAG vs UNTAG)
      const rawConnType = pMap.get(`${prefix}.ConnectionType`) || rawMap[`${prefix}.ConnectionType`] || '';
      const isBridged = /_Bridged$/i.test(rawConnType) || /bridge/i.test(connName) || existingProfile?.mode === 'Bridge';
      const resolvedMode = isBridged ? 'Bridge' : 'Route';
      const resolvedConnectionType = isPpp ? 'PPPoE' : isBridged ? 'Bridge' : (/static/i.test(connAddressing) ? 'Static' : 'IPoE_DHCP');

      const rawEponMode = getSlotOrConn([
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANEponLinkConfig.Mode`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT_COM_WANEponLinkConfig.Mode`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT-COM_WANGponLinkConfig.Mode`,
        `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${slotNum}.X_CT_COM_WANGponLinkConfig.Mode`,
      ]);
      const isVlanTagMode = rawEponMode !== undefined ? String(rawEponMode) === '1' : (existingProfile?.vlanMode === 'TAG' || Boolean(connVlan));

      // Resolve service type
      const serviceList = getSlotOrConn([
        `${prefix}.X_CT-COM_ServiceList`,
        `${prefix}.X_CT_COM_ServiceList`,
        `${prefix}.X_HW_SERVICELIST`,
        `${prefix}.ServiceList`,
      ]) || '';
      const isTr069 = (/TR069/i.test(connName) || /TR069/i.test(serviceList)) && !/INTERNET|VOIP|VOICE/i.test(connName + serviceList);
      const isVoip = /VOIP|VOICE/i.test(connName) || /VOIP|VOICE/i.test(serviceList);
      const isInternet = /INTERNET/i.test(connName) || /INTERNET/i.test(serviceList) || isPpp || (!isTr069 && !isVoip);
      const resolvedService = isTr069 ? 'TR069' : (isVoip ? 'VOIP' : 'INTERNET');

      const fallbackName = `${slotNum}_${resolvedService}_${isPpp ? 'R' : (isBridged ? 'B' : 'IP')}${connVlan ? `_VID_${connVlan}` : ''}`;
      const connPass = isPpp
        ? this.pickNonMaskedSecret(pMap, [`${prefix}.Password`, `${prefix}.X_CT-COM_Password`, `${prefix}.X_HW_Password`])
        : undefined;

      const dnsParts = connDns ? connDns.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      discoveredWanProfiles.push({
        name: connName || fallbackName,
        enableWan: connEnable,
        connectionType: resolvedConnectionType,
        serviceType: resolvedService,
        serviceUsage: {
          internet: isInternet,
          voip: isVoip,
          tr069: /TR069/i.test(connName + serviceList),
          iptvDhcp: /IPTV/i.test(connName + serviceList),
          iptvBridge: isBridged || /BRIDGE/i.test(connName + serviceList),
          other: false,
        },
        bearerService: resolvedService,
        transMode: 'PON',
        mode: resolvedMode,
        linkMode: isPpp ? 'PPP' : 'IP',
        vlanId: connVlan || undefined,
        vlanMode: isVlanTagMode ? 'TAG' : 'UNTAG',
        vlanEnabled: isVlanTagMode && Boolean(connVlan),
        ipAssignment: /static/i.test(connAddressing) ? 'Static' : 'DHCP',
        natEnabled: connNat !== undefined ? (connNat !== '0' && connNat !== 'false') : !isBridged,
        ...(connMtuRaw && !isNaN(Number(connMtuRaw)) ? { mtu: Number(connMtuRaw) } : {}),
        isProtected: isTr069,
        cpeObjectPath: `${prefix}.`,
        pppoeUsername: connUser,
        ...(connPass ? { pppoePasswordEncrypted: connPass } : {}),
        ipAddress: (connIp && connIp !== '0.0.0.0') ? connIp : null,
        gateway: (connGateway && connGateway !== '0.0.0.0') ? connGateway : undefined,
        dnsServers: connDns || undefined,
        ...(dnsParts[0] ? { primaryDns: dnsParts[0] } : {}),
        ...(dnsParts[1] ? { secondaryDns: dnsParts[1] } : {}),
        subnetMask: (connSubnet && connSubnet !== '0.0.0.0') ? connSubnet : undefined,
        status: connStatus === 'Connected' ? 'Connected' : 'Connecting',
        isDefault: isInternet,
      });
    }

    if (discoveredWanProfiles.length > 0) {
      if (!device.wanProfiles || device.wanProfiles.length === 0) {
        // First discovery: populate from CPE
        device.wanProfiles = discoveredWanProfiles;
      } else {
        // Full synchronization: accurately match and update all live fields from CPE
        let modified = false;
        const validDiscoveredPaths = new Set(discoveredWanProfiles.map(p => p.cpeObjectPath).filter(Boolean));

        // Purge obsolete profiles that were deleted from the physical router
        if (validDiscoveredPaths.size > 0) {
          const filtered = (device.wanProfiles as any[]).filter((p: any) => {
            if (p.cpeObjectPath && !validDiscoveredPaths.has(p.cpeObjectPath)) {
              console.log(`[CWMP ACS] 🗑️ Removing deleted WAN profile '${p.name}' (${p.cpeObjectPath}) no longer present on CPE.`);
              modified = true;
              return false;
            }
            return true;
          });
          device.wanProfiles = filtered;
        }

        for (const incoming of discoveredWanProfiles) {
          const existing = (device.wanProfiles as any[]).find((p: any) =>
            // 1. Exact CPE path match (most reliable)
            (incoming.cpeObjectPath && p.cpeObjectPath && p.cpeObjectPath === incoming.cpeObjectPath) ||
            // 2. Profile name match
            (incoming.name && incoming.name !== 'Internet_TR069' && incoming.name !== 'WAN_PPPoE' && p.name === incoming.name) ||
            // 3. PPPoE username match
            (incoming.pppoeUsername && p.pppoeUsername && p.pppoeUsername === incoming.pppoeUsername) ||
            // 4. Enrich empty placeholder: same connection type
            (incoming.connectionType === p.connectionType && !p.cpeObjectPath && !p.pppoeUsername && incoming.connectionType === 'PPPoE')
          );

          if (existing) {
            // Update live telemetry and configuration fields directly from CPE
            if (incoming.status) existing.status = incoming.status;
            if (incoming.enableWan !== undefined) existing.enableWan = incoming.enableWan;
            if (incoming.ipAddress && incoming.ipAddress !== '0.0.0.0') existing.ipAddress = incoming.ipAddress;
            if (incoming.gateway) existing.gateway = incoming.gateway;
            if (incoming.dnsServers) existing.dnsServers = incoming.dnsServers;
            if (incoming.primaryDns) existing.primaryDns = incoming.primaryDns;
            if (incoming.secondaryDns) existing.secondaryDns = incoming.secondaryDns;
            if (incoming.subnetMask) existing.subnetMask = incoming.subnetMask;
            if (incoming.pppoeUsername) existing.pppoeUsername = incoming.pppoeUsername;
            if (incoming.pppoePasswordEncrypted) existing.pppoePasswordEncrypted = incoming.pppoePasswordEncrypted;
            if (incoming.vlanId) existing.vlanId = incoming.vlanId;
            if (incoming.vlanMode) existing.vlanMode = incoming.vlanMode;
            if (incoming.vlanEnabled !== undefined) existing.vlanEnabled = incoming.vlanEnabled;
            if (incoming.mode) existing.mode = incoming.mode;
            if (incoming.ipAssignment) existing.ipAssignment = incoming.ipAssignment;
            if (incoming.natEnabled !== undefined) existing.natEnabled = incoming.natEnabled;
            if (incoming.mtu) existing.mtu = incoming.mtu;
            if (incoming.cpeObjectPath) existing.cpeObjectPath = incoming.cpeObjectPath;
            if (incoming.serviceType) existing.serviceType = incoming.serviceType;
            if (incoming.bearerService) existing.bearerService = incoming.bearerService;
            if (incoming.serviceUsage) existing.serviceUsage = incoming.serviceUsage;
            if (incoming.linkMode) existing.linkMode = incoming.linkMode;
            if (incoming.connectionType) existing.connectionType = incoming.connectionType;
            if (incoming.isProtected !== undefined) existing.isProtected = incoming.isProtected;
            if (incoming.name && incoming.name !== 'Internet_TR069' && incoming.name !== 'WAN_PPPoE') existing.name = incoming.name;
            modified = true;
          } else {
            // New profile discovered on CPE that we don't have yet — append it
            (device.wanProfiles as any[]).push(incoming);
            modified = true;
          }
        }
        if (modified) device.markModified('wanProfiles');
      }
    } else if (!device.wanProfiles || device.wanProfiles.length === 0) {
      const parsedFallbackVlan = rawVlan ? parseInt(rawVlan, 10) : undefined;
      device.wanProfiles = [{
        name: 'WAN_PPPoE',
        connectionType: 'PPPoE',
        serviceType: 'INTERNET',
        status: pppStatus === 'Connected' ? 'Connected' : 'Connecting',
        pppoeUsername: pppoeUser || '',
        ...(pppoePass ? { pppoePasswordEncrypted: pppoePass } : {}),
        ipAddress: pppIp || '',
        ...(parsedFallbackVlan && !isNaN(parsedFallbackVlan) && parsedFallbackVlan > 0 ? { vlanId: parsedFallbackVlan } : {}),
      } as any];
    }

    // Discover and populate ALL SSIDs (TR-098 & TR-181) with accurate band classification and non-masked secrets
    const discoveredSsids: any[] = [];
    const wlanIndices = Array.from(new Set(
      pMapKeys.map(k => {
        const m = k.match(/LANDevice\.\d+\.WLANConfiguration\.(\d+)\./i) || k.match(/Device\.WiFi\.SSID\.(\d+)\./i);
        return m ? parseInt(m[1], 10) : null;
      }).filter((v): v is number => v !== null)
    )).sort((a, b) => a - b);

    for (const wIdx of wlanIndices) {
      const sName =
        pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wIdx}.SSID`) ||
        pMap.get(`Device.WiFi.SSID.${wIdx}.SSID`);
      if (sName) {
        const sKey = this.pickNonMaskedSecret(pMap, this.getWifiSecretCandidatePaths(wIdx, mergedRawForBand)) || '';
        const radioRef = pMap.get(`Device.WiFi.SSID.${wIdx}.LowerLayers`) || '';
        const rMatch = String(radioRef).match(/Radio\.(\d+)/i);
        const rIdx = rMatch ? Number(rMatch[1]) : wIdx;
        const apIdx = CwmpVendorProfiles.resolveTr181AccessPointIndex(mergedRawForBand, wIdx);
        const sChan =
          pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wIdx}.Channel`) ||
          pMap.get(`Device.WiFi.Radio.${rIdx}.Channel`);
        const sBeacon =
          pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wIdx}.BeaconType`) ||
          pMap.get(`Device.WiFi.AccessPoint.${apIdx}.Security.ModeEnabled`) ||
          'WPA2-PSK';
        const sEnable =
          (pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wIdx}.Enable`) ?? pMap.get(`Device.WiFi.SSID.${wIdx}.Enable`)) !== '0';
        const detectedSsidBand = CwmpVendorProfiles.determineWifiBand(mergedRawForBand, wIdx, sName);
        const schemaBand: '2.4GHz' | '5GHz' =
          detectedSsidBand === '5GHz'
            ? '5GHz'
            : (detectedSsidBand === 'UNKNOWN' && ssid5g && sName === ssid5g ? '5GHz' : '2.4GHz');
        discoveredSsids.push({
          instance: wIdx,
          ssid: sName,
          password: sKey,
          channel: sChan ? parseInt(sChan, 10) : (schemaBand === '5GHz' ? 44 : 6),
          bandwidthMhz: schemaBand === '5GHz' ? 80 : 20,
          securityMode: sBeacon,
          enabled: sEnable,
          band: schemaBand,
        });
      }
    }
    if (discoveredSsids.length > 0) {
      device.additionalSsids = discoveredSsids;
    }

    if (wlanIndices.length > 0 || connPrefixes.length > 0 || Boolean(ssid24) || Boolean(pppoeUser)) {
      (device as any).supportedParametersConfirmed = true;
    }

    if (rawHosts) {
      const h = parseInt(rawHosts, 10);
      if (!isNaN(h)) device.lanHostCount = h;
    }

    // Parse Connected LAN / Wi-Fi Clients from pMap
    const clientMap: Map<string, any> = new Map();
    
    for (const [key, val] of pMap.entries()) {
      if (!val || val === '' || val === '0.0.0.0' || val === '00:00:00:00:00:00') continue;
      
      // 1. LAN Hosts parsing
      const hostMatch = key.match(/(?:LANDevice\.\d+\.Hosts\.Host|Device\.Hosts\.Host)\.(\d+)\.(MACAddress|PhysAddress|IPAddress|HostName|UserHostName|ClientID|Active|InterfaceType|LeaseTimeRemaining)/i);
      if (hostMatch) {
        const idx = `host_${hostMatch[1]}`;
        const field = hostMatch[2].toLowerCase();
        if (!clientMap.has(idx)) {
          clientMap.set(idx, {
            mac: '',
            ip: '',
            hostname: '',
            interfaceType: '2.4GHz',
            connected: true,
            isBlocked: false,
            lastSeen: new Date(),
          });
        }
        const c = clientMap.get(idx);
        if (field === 'macaddress' || field === 'physaddress') c.mac = String(val).toUpperCase().trim();
        if (field === 'ipaddress') c.ip = String(val).trim();
        if (field === 'hostname' || field === 'userhostname' || field === 'clientid') {
          const cleanName = String(val).replace(/["']/g, '').trim();
          if (cleanName && cleanName !== 'unknown' && cleanName !== 'undefined') c.hostname = cleanName;
        }
        if (field === 'interfacetype') {
          c.interfaceType = /5g/i.test(val) ? '5GHz' : /ethernet|eth|lan/i.test(val) ? 'Ethernet' : '2.4GHz';
        }
        if (field === 'active') {
          c.connected = val === '1' || val.toLowerCase() === 'true' || val.toLowerCase() === 'active';
        }
      }

      // 2. Wi-Fi Associated Devices parsing (TR-098 WLANConfiguration + TR-181 WiFi AccessPoint + Vendor Paths)
      const wlanMatch = key.match(/(?:LANDevice\.\d+\.WLANConfiguration\.(\d+)\.AssociatedDevice|Device\.WiFi\.AccessPoint\.(\d+)\.AssociatedDevice)\.(\d+)\.(AssociatedDeviceMACAddress|AssociatedDeviceIPAddress|AssociatedDeviceHostName|AssociatedDeviceAuthenticationState|AssociatedDeviceRSSI|MACAddress|IPAddress)/i);
      if (wlanMatch) {
        const wlanBand = wlanMatch[1] || wlanMatch[2];
        const devNum = wlanMatch[3];
        const idx = `wlan_${wlanBand}_${devNum}`;
        const field = wlanMatch[4].toLowerCase();
        
        // Check if this WLAN instance is 5 GHz via full band detection (handles Auto channel 0 & all vendor slots)
        const wlanSsidVal =
          pMap.get(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanBand}.SSID`) ||
          pMap.get(`Device.WiFi.SSID.${wlanBand}.SSID`) ||
          '';
        const is5GHz = CwmpVendorProfiles.determineWifiBand(mergedRawForBand, Number(wlanBand), wlanSsidVal) === '5GHz';

        if (!clientMap.has(idx)) {
          clientMap.set(idx, {
            mac: '',
            ip: '',
            hostname: '',
            interfaceType: is5GHz ? '5GHz' : '2.4GHz',
            connected: true,
            isBlocked: false,
            lastSeen: new Date(),
          });
        }
        const c = clientMap.get(idx);
        if (field === 'associateddevicemacaddress' || field === 'macaddress') c.mac = String(val).toUpperCase().trim();
        if (field === 'associateddeviceipaddress' || field === 'ipaddress') c.ip = String(val).trim();
        if (field === 'associateddevicehostname') {
          const cleanName = String(val).replace(/["']/g, '').trim();
          if (cleanName && cleanName !== 'unknown') c.hostname = cleanName;
        }
        if (field === 'associateddeviceauthenticationstate') {
          c.connected = val === '1' || /true|authenticated/i.test(val);
        }
      }
    }

    // Deduplicate clients by MAC / IP address
    const uniqueClientsMap = new Map<string, any>();
    for (const c of clientMap.values()) {
      if (!c.mac && !c.ip) continue;
      const key = (c.mac || c.ip).toUpperCase();
      if (uniqueClientsMap.has(key)) {
        const existing = uniqueClientsMap.get(key);
        if (!existing.hostname && c.hostname) existing.hostname = c.hostname;
        if (!existing.ip && c.ip) existing.ip = c.ip;
        if (!existing.mac && c.mac) existing.mac = c.mac;
        if (c.interfaceType !== '2.4GHz') existing.interfaceType = c.interfaceType;
      } else {
        uniqueClientsMap.set(key, c);
      }
    }

    const parsedClients = Array.from(uniqueClientsMap.values());
    const realHostEntries = rawHosts ? parseInt(rawHosts, 10) : 0;
    if (parsedClients.length > 0) {
      device.connectedClients = parsedClients.map((c: any) => {
        const friendlyName = CwmpVendorProfiles.resolveFriendlyDeviceName(c.hostname, c.mac, c.interfaceType);
        const isWireless = CwmpVendorProfiles.isWirelessClient(c.mac, friendlyName, c.interfaceType);
        let finalIface = c.interfaceType;
        if (c.interfaceType === '5GHz' || /5g/i.test(String(c.interfaceType))) {
          finalIface = '5GHz';
        } else if (isWireless) {
          finalIface = '2.4GHz';
        } else {
          finalIface = 'Ethernet';
        }
        return {
          ...c,
          hostname: c.hostname || friendlyName,
          name: friendlyName,
          interfaceType: finalIface,
        };
      });
      device.wifiClients24 = device.connectedClients.filter((c: any) => c.interfaceType === '2.4GHz').length;
      device.wifiClients5 = device.connectedClients.filter((c: any) => c.interfaceType === '5GHz').length;
      device.lanClients = device.connectedClients.filter((c: any) => c.interfaceType === 'Ethernet').length;
      device.totalClientsConnected = device.connectedClients.length;
      device.lanHostCount = Math.max(realHostEntries || 0, device.connectedClients.length);
    } else if (realHostEntries > 0) {
      device.lanHostCount = realHostEntries;
      device.totalClientsConnected = realHostEntries;
    }

    device.lastParameterSyncStatus = 'PARTIAL_SUCCESS';

    // 2. Optical Telemetry Extraction (Dynamic Multi-Vendor Scanning for Syrotech / Realtek / CTC / Huawei / ZTE / Genexis)
    let activeCandidate = session?.activeOpticalCandidate;
    let rxValRaw: string | undefined = activeCandidate ? pMap.get(activeCandidate) : undefined;

    if (!rxValRaw) {
      for (const [k, v] of pMap.entries()) {
        if (this.isOpticalRxPath(k) && v !== undefined && v !== '' && v !== '-40.0' && v !== 'N/A') {
          activeCandidate = k;
          rxValRaw = v;
          break;
        }
      }
    }

    const vendor = session?.vendor || 'CHINA_TELECOM';
    const normalizedRx = rxValRaw ? CwmpVendorProfiles.normalizeOpticalRx(vendor, activeCandidate || '', rxValRaw) : null;

    // Extract TX, Bias, Voltage, Temperature independently so companion metrics still update even if RX is missing/LOS
    let txPathCandidate = '';
    let rawTx = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalTxPower',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.TxPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_EponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXPower',
      'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.TxPower',
      'InternetGatewayDevice.WANDevice.1.X_SYROTECH_OpticalInfo.TxPower',
      'Device.Optical.Interface.1.TransmitOpticalPower',
      'Device.Optical.Interface.1.TxPower',
    ]);
    if (!rawTx) {
      for (const [k, v] of pMap.entries()) {
        if (this.isOpticalTxPath(k) && v !== undefined && v !== '' && v !== '0' && v !== 'N/A') {
          rawTx = v;
          txPathCandidate = k;
          break;
        }
      }
    }
    const normalizedTx = rawTx ? CwmpVendorProfiles.normalizeOpticalTx(vendor, txPathCandidate, rawTx) : undefined;
    if (normalizedTx) device.currentTxPowerDbm = normalizedTx.normalizedValue;

    const rawBias = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalBiasCurrent',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXBiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_EponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.BiasCurrent',
      'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.BiasCurrent',
      'Device.Optical.Interface.1.TxBiasCurrent',
    ]);
    const bias = CwmpXmlParser.normalizeBiasCurrent(rawBias);
    if (bias !== undefined) device.biasCurrentMa = bias;

    const rawVolt = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalVoltage',
      'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.Voltage',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.Voltage',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.Voltage',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.SupplyVoltage',
      'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.Voltage',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.SupplyVoltage',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_EponInterfaceConfig.SupplyVoltage',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.SupplyVottage',
      'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.SupplyVoltage',
      'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.SupplyVottage',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.SupplyVoltage',
      'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.SupplyVoltage',
      'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.SupplyVoltage',
      'Device.Optical.Interface.1.Voltage',
    ]);
    const volt = CwmpXmlParser.normalizeVoltage(rawVolt);
    if (volt !== undefined) device.opticalVoltageV = volt;

    const rawTemp = this.getFirstParam(pMap, [
      'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.Temperature',
      'InternetGatewayDevice.DeviceInfo.X_HW_BoardTemp',
      'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_BoardTemperature',
      'InternetGatewayDevice.DeviceInfo.Temperature',
      'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.Temperature',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.Temperature',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.Temperature',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TransceiverTemperature',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_GponInterfaceConfig.TransceiverTemperature',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TransceiverTemperature',
      'InternetGatewayDevice.WANDevice.1.X_CT_COM_EponInterfaceConfig.TransceiverTemperature',
      'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.TransceiverTemperature',
      'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.TransceiverTemperature',
      'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.TransceiverTemperature',
      'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
      'Device.Optical.Interface.1.Temperature',
    ]);
    let resolvedRawTemp = rawTemp;
    if (!resolvedRawTemp) {
      for (const [k, v] of pMap.entries()) {
        if (/(?:epon|gpon|pon|optical|x_ct[-_]com_|x_syrotech|transceiver|board).*temp/i.test(k) && v !== undefined && v !== '' && v !== '0') {
          resolvedRawTemp = v;
          break;
        }
      }
    }
    const temp = CwmpXmlParser.normalizeTemperature(resolvedRawTemp);
    if (temp !== undefined) {
      device.temperatureC = temp;
      (device as any).opticalTemperature = temp;
    }

    if (normalizedRx && normalizedRx.isReliable) {
      device.currentRxPowerDbm = normalizedRx.normalizedValue;
      device.opticalTelemetrySourcePath = activeCandidate;
      device.opticalStatus =
        normalizedRx.normalizedValue < -27.0 ? 'critical' :
        normalizedRx.normalizedValue < -24.5 ? 'warning' : 'normal';

      // Process Continuous Optical Telemetry, Deduplication, History (20 Limit), and Critical/Recovery Alerts
      await CwmpService.processOpticalTelemetryChange(
        device,
        normalizedRx.normalizedValue,
        normalizedTx?.normalizedValue,
        bias,
        volt,
        temp,
        activeCandidate
      );

      // Record in cache as SUPPORTED
      if (activeCandidate && session) {
        await SupportedParameterCache.findOneAndUpdate(
          {
            vendor: session.vendor,
            modelName: session.modelName,
            parameterPath: activeCandidate,
          },
          {
            $set: {
              status: 'SUPPORTED',
              manufacturer: session.manufacturer,
              firmwareVersion: session.firmwareVersion,
              lastCheckedAt: new Date(),
            },
          },
          { upsert: true }
        );
      }

      device.lastParameterSyncStatus = 'SUCCESS';
    } else if (ssid24 || discoveredWanProfiles.length > 0 || (device as any).supportedParametersConfirmed) {
      // Non-optical GPV succeeded (or CPE returned Wi-Fi/WAN/DeviceInfo cleanly) -> mark SUCCESS so periodic sync cooldown activates cleanly
      device.lastParameterSyncStatus = 'SUCCESS';
    }

    // IMMUTABLE HARDWARE LOCK: If device already has a registered owner tenantId, never re-bind automatically
    if (!device.tenantId) {
      const resolvedTenant = await this.resolveTenant(hostHeader, pathOrQuerySlug, {
        serialAliases,
        wanIp: pppIp || device.ipAddress,
      });

      if (resolvedTenant) {
        device.tenantId = resolvedTenant._id;
        if (session) {
          session.tenantId = resolvedTenant._id.toString();
          session.tenantSlug = resolvedTenant.slug;
        }
      }
    }

    const prevStageBeforeCompletion = session?.stage;
    device.lastInform = new Date();
    device.lastParameterSyncAt = new Date();
    device.status = 'online';
    if (session && (session.stage === 'BASELINE_SENT' || session.stage === 'OPTICAL_SENT' || session.stage === 'VERIFICATION_GPV_SENT')) {
      session.stage = 'COMPLETED';
      await this.updateSession(session, connectionKey).catch(() => {});
      await this.clearConnectionSession(connectionKey).catch(() => {});
    }
    await device.save();

    // Post-Change Verification Evaluation
    const pendingVerificationCommands = await DeviceCommand.find({
      deviceId: device._id,
      status: { $in: ['verifying', 'applied', 'applied_pending_verification'] },
      verificationTargetValues: { $exists: true },
    });

    for (const vCmd of pendingVerificationCommands) {
      const targets = vCmd.verificationTargetValues || {};
      const mismatches: string[] = [];
      const readBackValues: Record<string, any> = {};
      let verifiableParamCount = 0;

      for (const [targetPath, expectedVal] of Object.entries(targets)) {
        // Passwords on CPEs are write-only — CPE never returns them in GPV
        if (targetPath.toLowerCase().includes('password') || targetPath.toLowerCase().includes('passphrase')) continue;

        verifiableParamCount++;

        // Primary lookup: exact path match in the GPV response
        let actualVal: string | undefined = pMap.get(targetPath) ?? rawMap[targetPath] ?? device.rawParameters?.[targetPath];

        // Bug 5 fix: If exact match not found, try a suffix-based lookup in pMap.
        // Handles the case where CPE reports WLANConfiguration.2 but we targeted WLANConfiguration.5,
        // or any minor path variation from vendor quirks.
        if (actualVal === undefined || actualVal === '') {
          const targetSuffix = targetPath.split('.').slice(-2).join('.'); // e.g. "WLANConfiguration.1.SSID" → "1.SSID"
          for (const [k, v] of pMap.entries()) {
            if (k !== targetPath && k.endsWith(`.${targetSuffix}`) && v !== undefined && v !== '') {
              actualVal = v;
              console.log(`[CWMP_VERIFICATION] Suffix fallback matched '${targetPath}' via '${k}' = '${v}'`);
              break;
            }
          }
        }

        readBackValues[targetPath] = actualVal;

        if (actualVal === undefined || actualVal === null || actualVal === '') {
          // Parameter was not returned in this GPV response — treat as inconclusive, not failed.
          // This happens when the verification GPV did not include this path (e.g. password-only change).
          // Do not add to mismatches — the change may have been applied but not verifiable by read-back.
          console.log(`[CWMP_VERIFICATION] Parameter '${targetPath}' not in GPV response — inconclusive (expected: '${expectedVal}')`);
        } else {
          const expNorm = String(expectedVal).toLowerCase().trim();
          const actNorm = String(actualVal).toLowerCase().trim();
          const isBoolMatch = (expNorm === 'true' && (actNorm === '1' || actNorm === 'true')) ||
                              (expNorm === 'false' && (actNorm === '0' || actNorm === 'false'));
          if (expNorm !== actNorm && !isBoolMatch) {
            mismatches.push(`${targetPath} (expected: '${expectedVal}', received: '${actualVal}')`);
          }
        }
      }

      if (verifiableParamCount > 0) {
        if (mismatches.length === 0 && Object.keys(readBackValues).length > 0) {
          vCmd.status = 'verified';
          vCmd.verifiedAt = new Date();
          vCmd.completedAt = new Date();
          vCmd.verificationResult = {
            verified: true,
            readBackValues,
            mismatches: [],
          };
          await vCmd.save();

          console.log(`[CWMP_STRUCTURED_LOG] ${JSON.stringify({
            event: 'CWMP_VERIFICATION_SUCCESS',
            taskId: vCmd._id.toString(),
            deviceId: device._id.toString(),
            serialNumber: device.serialNumber,
            dataModel: vCmd.dataModel,
            verificationResult: 'VERIFIED',
            readBackValues,
            retryNumber: vCmd.retryCount || 0,
            taskStatus: 'verified',
          })}`);
        } else if (mismatches.length > 0) {
          vCmd.status = 'verification_failed';
          vCmd.verifiedAt = new Date();
          vCmd.completedAt = new Date();
          vCmd.verificationResult = {
            verified: false,
            readBackValues,
            mismatches,
          };
          vCmd.errorMessage = `VERIFICATION_MISMATCH: ${mismatches.join('; ')}`;
          await vCmd.save();

          console.warn(`[CWMP_STRUCTURED_LOG] ${JSON.stringify({
            event: 'CWMP_VERIFICATION_FAILED',
            taskId: vCmd._id.toString(),
            deviceId: device._id.toString(),
            serialNumber: device.serialNumber,
            mismatches,
            taskStatus: 'verification_failed',
          })}`);
        }
      }
    }

    // Mark SUMMON_LIVE_POLL and any telemetry polling commands as success
    await DeviceCommand.updateMany(
      { deviceId: device._id, action: 'SUMMON_LIVE_POLL', status: { $in: ['sent', 'sending', 'queued', 'pending', 'verifying'] } },
      { $set: { status: 'success', completedAt: new Date() } }
    ).catch(() => {});

    console.log(
      `[CWMP ACS] Ingested Live GPV Response for ${device.serialNumber} | SSID: ${device.wifi24?.ssid ?? 'N/A'} | Rx: ${device.currentRxPowerDbm ?? 'N/A'} dBm | Status: ${device.lastParameterSyncStatus}`
    );

    // Server-side automatic onboarding: push PeriodicInform=300s & ConnectionRequest credentials on first synced session
    if (
      session &&
      (prevStageBeforeCompletion === 'BASELINE_SENT' || prevStageBeforeCompletion === 'OPTICAL_SENT') &&
      pendingVerificationCommands.length === 0 &&
      !device.periodicInformConfigured &&
      device.lastParameterSyncStatus === 'SUCCESS'
    ) {
      const baseline = this.buildAutoManagementBaselineSpv(device, session, true);
      session.stage = 'AUTO_MGMT_SPV_SENT';
      await this.updateSession(session, connectionKey).catch(() => {});
      console.log(
        `[CWMP ACS -> CPE] Chaining Auto-ManagementServer SPV for ${device.serialNumber} (${baseline.creds.periodicInformIntervalSeconds}s Inform + ConnReq user '${baseline.creds.connectionRequestUsername}')`
      );
      return baseline.xml;
    }

    return null;
  }

  static buildSoapFault(cwmpId = '1', faultCode = 9001, faultString = 'Request Denied: Unrecognized Device Hardware'): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">${cwmpId}</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>Client</faultcode>
      <faultstring>CWMP fault</faultstring>
      <detail>
        <cwmp:Fault>
          <FaultCode>${faultCode}</FaultCode>
          <FaultString>${faultString}</FaultString>
        </cwmp:Fault>
      </detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  static buildInformResponse(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">1</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:InformResponse>
      <MaxEnvelopes>1</MaxEnvelopes>
    </cwmp:InformResponse>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  static getStats(tenantSlug?: string, reqHost?: string, allowGlobal: boolean = false, tenantCwmpPassword?: string) {
    const cleanSlug = (tenantSlug || '').trim().toLowerCase();
    const hasScopedTenant = Boolean(cleanSlug && cleanSlug !== 'default' && cleanSlug !== 'global');
    const hits = hasScopedTenant
      ? (this.tenantRecentHits.get(cleanSlug) || [])
      : (allowGlobal ? this.recentHits : []);
    const scopedTotalHits = hasScopedTenant
      ? (this.tenantTotalHits.get(cleanSlug) || 0)
      : (allowGlobal ? this.totalHits : 0);
    const urls = buildPrimaryCwmpUrls(reqHost, hasScopedTenant ? cleanSlug : '');
    const creds = resolveTenantCwmpCredentials(hasScopedTenant ? cleanSlug : '', tenantCwmpPassword);

    return {
      success: true,
      cwmpUrl: urls.primaryUrl,
      cwmpPathUrl: urls.cwmpPathUrl,
      port80CwmpUrl: urls.port80Url,
      cwmpSubdomainUrl: urls.subdomainUrl,
      tenantSlug: creds.tenantSlug,
      totalHits: scopedTotalHits,
      activeListeningPort: 7547,
      authCredentials: {
        acsUsername: creds.acsUsername,
        acsPassword: creds.acsPassword,
        username: creds.connectionRequestUsername,
        password: creds.connectionRequestPassword,
        connectionRequestUsername: creds.connectionRequestUsername,
        connectionRequestPassword: creds.connectionRequestPassword,
        informIntervalSeconds: creds.periodicInformIntervalSeconds,
      },
      recentHits: hits,
      serverStatus: 'LISTENING',
    };
  }

  /**
   * Automatically reconciles all pending/unassigned CPEs into the active Fleet Inventory
   */
  static async syncAllPendingDevicesToFleet(): Promise<number> {
    try {
      const pendingItems = await PendingDeviceMapping.find({
        $or: [{ status: 'PENDING' }, { mappedTenantId: null }],
      });

      let syncedCount = 0;
      for (const p of pendingItems) {
        const serial = p.serialNumber;
        const serialAliases = CwmpXmlParser.getSerialNumberAliases(serial);
        const tenant = await this.resolveTenant(p.incomingHost, p.pathOrQuerySlug, {
          serialAliases,
          macAddress: p.macAddress,
        });

        if (tenant) {
          let existingDevice = await Device.findOne({ serialNumber: { $in: serialAliases } });
          if (!existingDevice) {
            existingDevice = await Device.create({
              tenantId: tenant._id,
              deviceIdStr: `dev_${Date.now()}_${serial.slice(-4)}`,
              serialNumber: serial,
              macAddress: p.macAddress || `00:E0:${p.clientIp?.split('.').map((x) => parseInt(x).toString(16).padStart(2, '0')).slice(-4).join(':') || '00:00:00:00'}`,
              manufacturer: p.manufacturer || 'Generic GPON',
              modelName: p.productClass || 'GPON-ONT',
              hardwareVersion: p.hardwareVersion || 'V1.0',
              softwareVersion: p.softwareVersion || 'V1.0.0',
              protocol: 'TR-069',
              status: 'online',
              lastInform: p.lastSeenAt || new Date(),
              ipAddress: p.clientIp,
              externalIpAddress: p.clientIp,
              opticalStatus: 'normal',
              assigned: false,
              rawParameters: {},
              wanProfiles: [{
                name: 'Internet_TR069',
                connectionType: 'PPPoE',
                serviceType: 'INTERNET',
                status: 'Connected',
              }],
              wifi24: {
                ssid: '',
                password: '',
                enabled: true,
                channel: 6,
                channelAuto: true,
                bandwidthMhz: 20,
                securityMode: 'WPA2-PSK',
                txPowerPercent: 100,
              },
              wifi5g: {
                ssid: '',
                password: '',
                enabled: true,
                channel: 44,
                channelAuto: true,
                bandwidthMhz: 80,
                securityMode: 'WPA2-PSK',
                txPowerPercent: 100,
              },
            });
          } else {
            existingDevice.tenantId = tenant._id;
            await existingDevice.save();
          }

          p.status = 'MAPPED';
          p.mappedTenantId = tenant._id as any;
          p.mappedTenantSlug = tenant.slug;
          p.mappedAt = new Date();
          await p.save();
          syncedCount++;
        }
      }
      return syncedCount;
    } catch (err: any) {
      console.error('[CWMP] Error syncing pending devices to fleet:', err);
      return 0;
    }
  }
}