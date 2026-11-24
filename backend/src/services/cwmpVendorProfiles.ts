/**
 * TR-069 Multi-Vendor CPE Data Models & Parameter Profiles
 * Isolates Safe Baseline TR-098/TR-181 requests from Optical Discovery.
 * Eliminates SOAP Fault 9005 by testing optical candidates separately and caching supported paths.
 */

export type CpeVendor =
  | 'HUAWEI'
  | 'ZTE'
  | 'VSOL'
  | 'RICHERLINK'
  | 'GENEXIS'
  | 'REALTEK'
  | 'SYROTECH'
  | 'CHINA_TELECOM' // Netlink, C-Data, DBC, Optilink, BDCOM, Digisol, Econet
  | 'TPLINK'
  | 'NOKIA'
  | 'TR181_STANDARD'
  | 'GENERIC_TR098';

export interface OpticalTelemetryScalingResult {
  rawValue: string;
  normalizedValue: number;
  unit: string;
  scaleFactor: number;
  sourcePath: string;
  vendor: CpeVendor;
  isReliable: boolean;
}

export class CwmpVendorProfiles {
  /**
   * Detects the specific CPE vendor and data model from Inform headers & payload
   */
  static detectVendor(
    manufacturer?: string,
    modelName?: string,
    oui?: string,
    productClass?: string,
    rawXml?: string
  ): CpeVendor {
    const text = ((manufacturer || '') + ' ' + (modelName || '') + ' ' + (oui || '') + ' ' + (productClass || '') + ' ' + (rawXml || '')).toLowerCase();
    let detected: CpeVendor = 'CHINA_TELECOM';

    // 1. Syrotech ONTs (SY-GPON series)
    if (/syrotech|sy-gpon|syro/i.test(text)) {
      detected = 'SYROTECH';
    }
    // 2. Realtek / OEM Realtek chipsets (OUI 00E04C, XPON+1GE, etc.)
    else if (/realtek|00e04c|xpon\+1ge/i.test(text) || oui === '00E04C') {
      detected = 'REALTEK';
    }
    // 3. Genexis Titanium / Platinum / Earth series
    else if (/genexis|gnxs|titanium|platinum|earth/i.test(text)) {
      detected = 'GENEXIS';
    }
    // 4. Huawei EchoLife / OptiXstar series
    else if (/huawei|echolife|hg8|eg8|optix|hw_gpon|x_hw_/i.test(text) || (oui === '00259E' && !/genexis|gnxs|titanium|earth/i.test(text)) || oui === '001E10') {
      detected = 'HUAWEI';
    }
    // 5. ZTE NetSphere / ZXHN series
    else if (/zte|zxhn|f670|f660|f680|x_zte/i.test(text) || oui === '002293' || oui === '0019C6') {
      detected = 'ZTE';
    }
    // 6. V-SOL (V2801, V2804, etc.)
    else if (/vsol|v-sol|v280|x_vsol/i.test(text) || oui === '000C43' || oui === '5422F8') {
      detected = 'VSOL';
    }
    // 7. RicherLink / RL Tech (RL821, RH821, RL-Tech, etc.)
    else if (/richerlink|rh821|rl801|rl804|rl821|rl[-_ ]?tech|rltech/i.test(text) || oui === 'E84D8E') {
      detected = 'RICHERLINK';
    }
    // 8. TP-Link (Archer, XC220, etc.)
    else if (/tp-link|tplink|archer|xc220|x_tplink/i.test(text) || oui === '003192' || oui === '50C7BF') {
      detected = 'TPLINK';
    }
    // 9. Nokia / Alcatel-Lucent (G-140W, etc.)
    else if (/nokia|alcatel|alu_|g-140|g-240|isom/i.test(text) || oui === '001FE2' || oui === '002194') {
      detected = 'NOKIA';
    }
    // 10. TR-181 Device:2 Data Model (USP / Modern TR-181 ONTs)
    else if (/device\.optical\.|device\.wifi\.|device\.ip\./i.test(text)) {
      detected = 'TR181_STANDARD';
    }

    // Explicit warning when OUI/heuristic guess disagrees with <Manufacturer> from Inform
    if (manufacturer && manufacturer !== 'Unknown' && manufacturer !== 'Generic' && manufacturer !== 'HGU') {
      const cleanMan = manufacturer.toLowerCase().replace(/[-_ \t]/g, '');
      const detectedLow = detected.toLowerCase().replace(/[-_ \t]/g, '');
      if (!cleanMan.includes(detectedLow) && !detectedLow.includes(cleanMan) && detected !== 'CHINA_TELECOM' && detected !== 'TR181_STANDARD') {
        console.warn(`[CWMP ACS] [VENDOR_MISMATCH_WARN] Inform <Manufacturer> '${manufacturer}' differs from detected vendor profile '${detected}' for OUI: '${oui}', Model: '${modelName}'`);
      }
    }

    return detected;
  }

  /**
   * Converts 16-character Hex PON Serial Number (e.g. 48575443... -> HWTC...)
   */
  static formatPonSerialNumber(rawSn?: string): string {
    if (!rawSn) return '';
    const clean = String(rawSn).trim();

    // If already standard format (e.g. HWTC12345678, ZTEG12345678, VSOL12345678, GNXS12345678)
    if (/^[A-Za-z]{4}[0-9A-Fa-f]{8,12}$/.test(clean)) {
      return clean.toUpperCase();
    }

    // If 16 hex characters (4 bytes vendor prefix in ASCII + 4 bytes serial)
    if (/^[0-9A-Fa-f]{16}$/.test(clean)) {
      const hexPrefix = clean.substring(0, 8);
      const suffix = clean.substring(8);
      let vendorAscii = '';
      for (let i = 0; i < 8; i += 2) {
        vendorAscii += String.fromCharCode(parseInt(hexPrefix.substr(i, 2), 16));
      }
      if (/^[A-Za-z0-9]{4}$/.test(vendorAscii)) {
        return `${vendorAscii.toUpperCase()}${suffix.toUpperCase()}`;
      }
    }

    return clean;
  }

  /**
   * Automatically extracts 10-digit mobile phone and clean customer name from PPPoE subscriber ID
   * Example: 'ss8549293374_sid@ftth.bsnl.in' -> { phone: '+918549293374', cleanName: 'Subscriber 8549293374' }
   */
  static enrichSubscriberFromPppoe(pppoeUsername?: string): { phone?: string; cleanName?: string } {
    if (!pppoeUsername) return {};
    const clean = String(pppoeUsername).trim();

    // Match 10-digit Indian mobile number
    const match = clean.match(/(?:^|[^0-9])([6-9]\d{9})(?:[^0-9]|$)/);
    if (match && match[1]) {
      const phoneDigits = match[1];
      const namePart = clean.split('@')[0].replace(/[0-9_.-]/g, ' ').trim();
      return {
        phone: `+91${phoneDigits}`,
        cleanName: namePart ? namePart.toUpperCase() : `Subscriber ${phoneDigits}`,
      };
    }

    return {};
  }

  /**
   * Checks whether a given CPE model supports dual-band 2.4 GHz + 5.0 GHz Wi-Fi
   */
  static isDualBandModel(vendor?: string, modelName?: string, productClass?: string): boolean {
    const text = `${vendor || ''} ${modelName || ''} ${productClass || ''}`.toLowerCase();
    // Explicit single-band ONLY if specifically tagged as single-band / bridge-only / earth-2022
    if (/single[-_ ]?band|1t1r|bridge[-_ ]?ont|onu[-_ ]?1ge|earth[-_ ]?2022/i.test(text)) return false;
    // All modern GPON / XPON HGUs (Genexis, Huawei, ZTE, Syrotech, VSOL, RicherLink, TP-Link, Netlink) support dual-band or have multi-SSID
    return true;
  }

  /**
   * PHASE 2: Returns Safe Standard Baseline TR-098 / TR-181 parameters.
   * Covers Wi-Fi (2.4G & 5G), LAN hosts, multi-slot WAN connections (Slots 1 & 2 for PPP and IP),
   * and safe vendor optical telemetry paths.
   */
  static getSafeBaselineParameters(vendor: CpeVendor, modelName?: string): string[] {
    if (vendor === 'TR181_STANDARD') {
      return [
        'Device.WiFi.SSID.1.SSID',
        'Device.WiFi.AccessPoint.1.Security.KeyPassphrase',
        'Device.WiFi.Radio.1.Channel',
        'Device.WiFi.SSID.2.SSID',
        'Device.WiFi.AccessPoint.2.Security.KeyPassphrase',
        'Device.WiFi.Radio.2.Channel',
        'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries',
        'Device.WiFi.AccessPoint.1.AssociatedDevice.',
        'Device.WiFi.AccessPoint.2.AssociatedDeviceNumberOfEntries',
        'Device.WiFi.AccessPoint.2.AssociatedDevice.',
        'Device.PPP.Interface.1.Username',
        'Device.PPP.Interface.1.ConnectionStatus',
        'Device.PPP.Interface.2.Username',
        'Device.PPP.Interface.2.ConnectionStatus',
        'Device.IP.Interface.1.IPv4Address.1.IPAddress',
        'Device.IP.Interface.1.Status',
        'Device.IP.Interface.2.IPv4Address.1.IPAddress',
        'Device.Ethernet.VLANTermination.1.VLANID',
        'Device.Hosts.HostNumberOfEntries',
        'Device.Hosts.Host.',
        'Device.Optical.Interface.1.OpticalSignalLevel',
        'Device.Optical.Interface.1.TransmitOpticalPower',
      ];
    }

    const isDual = this.isDualBandModel(vendor, modelName);
    const isTplink = vendor === 'TPLINK' || (modelName && /archer|c6|c5|c20|c50/i.test(modelName));
    const wlan5gInstance = isTplink ? 3 : (vendor === 'VSOL' || vendor === 'RICHERLINK') ? 2 : 5;
    const wlan5gParams = isDual ? [
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.SSID`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.PreSharedKey.1.KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.KeyPassphrase`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.PreSharedKey.1.PreSharedKey`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.Channel`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.BeaconType`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.Enable`,
    ] : [];

    // Explicit baseline host queries for devices that do not support wildcard partial paths
    const explicitHostParams: string[] = [];
    for (let h = 1; h <= 16; h++) {
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.MACAddress`);
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.IPAddress`);
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.HostName`);
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.UserHostName`);
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.InterfaceType`);
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.Active`);
      explicitHostParams.push(`InternetGatewayDevice.LANDevice.1.Hosts.Host.${h}.LeaseTimeRemaining`);
    }

    // Comprehensive Universal TR-098 Baseline (Using standard TR-069 subtrees to prevent Fault 9005):
    return [
      'InternetGatewayDevice.DeviceInfo.Manufacturer',
      'InternetGatewayDevice.DeviceInfo.ManufacturerOUI',
      'InternetGatewayDevice.DeviceInfo.ModelName',
      'InternetGatewayDevice.DeviceInfo.Description',
      'InternetGatewayDevice.DeviceInfo.SerialNumber',
      'InternetGatewayDevice.DeviceInfo.HardwareVersion',
      'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
      'InternetGatewayDevice.DeviceInfo.UpTime',
      // Wi-Fi 2.4 GHz (Guaranteed universal on all TR-098 Wi-Fi CPEs; secondary bands discovered via GPN / rawParameters)
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
      // Wi-Fi 5 GHz
      ...wlan5gParams,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.TotalAssociations`,
      `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlan5gInstance}.AssociatedDevice.`,
      // Secondary / Multi-Band WLAN Association Hooks (TP-Link 3, Generic 2 & 5)
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.SSID',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.TotalAssociations',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.AssociatedDevice.',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice.',
      // LAN Host Count & Full Connected Host Subtree (Hostnames, MACs, IPs, Active status)
      'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries',
      'InternetGatewayDevice.LANDevice.1.Hosts.Host.',
      // Explicit top hosts for full inventory without wildcard reliance
      ...explicitHostParams,
      // Universal WAN Connection Subtree (Discovers all active PPP and IP connection slots without leaf path mismatches)
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.',
      // Management Server
      'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
    ];
  }

  /**
   * PHASE 3: Returns candidate optical parameter paths for the vendor.
   * ACS will test candidates individually or use cached working paths to avoid 9005 aborts.
   */
  static getOpticalCandidates(vendor: CpeVendor): string[] {
    switch (vendor) {
      case 'SYROTECH':
        return [
          'InternetGatewayDevice.X_SyroTech.GPON.OpticalRxPower',
          'InternetGatewayDevice.WANDevice.1.X_SYROTECH_OpticalInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.RXPower',
        ];

      case 'HUAWEI':
        return [
          'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalRxPower',
          'InternetGatewayDevice.DeviceInfo.X_HW_GPON.OpticalModuleInformation.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower',
        ];

      case 'ZTE':
        return [
          'InternetGatewayDevice.X_ZTE-COM_Gpon.OpticalPowerRx',
          'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower',
        ];

      case 'VSOL':
      case 'RICHERLINK':
        return [
          'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower',
        ];

      case 'TPLINK':
        return [
          'InternetGatewayDevice.WANDevice.1.X_TPLINK_OptInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
        ];

      case 'GENEXIS':
        return [
          'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.RXPower',
          'InternetGatewayDevice.X_GNXS_Gpon.OpticalRxPower',
          'InternetGatewayDevice.X_Genexis_Gpon.OpticalRxPower',
        ];

      case 'NOKIA':
        return [
          'InternetGatewayDevice.X_00000C_Gpon.OpticalPowerRx',
          'InternetGatewayDevice.WANDevice.1.X_NOKIA_OpticalInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_ALU_COM_OntOpticalInfo.ReceivePower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
        ];

      case 'TR181_STANDARD':
        return [
          'Device.Optical.Interface.1.OpticalSignalLevel',
        ];

      case 'CHINA_TELECOM':
      default:
        // Syrotech, Netlink, Genexis, C-Data, DBC, Realtek, Econet, RL Tech
        return [
          'InternetGatewayDevice.X_SyroTech.GPON.OpticalRxPower',
          'InternetGatewayDevice.X_DBC.GPON.OpticalRxPower',
          'InternetGatewayDevice.X_Netlink.GPON.OpticalRxPower',
          'InternetGatewayDevice.X_RL_Tech.GPON.OpticalRxPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.WANGponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.WANEponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_CTC_EPONInterfaceConfig.RXPower',
          'InternetGatewayDevice.WANDevice.1.X_BROADCOM_COM_OpticalInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_ECONET_GponInterfaceConfig.RXPower',
          'InternetGatewayDevice.DeviceInfo.X_CT-COM_OpticalInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_SYROTECH_OpticalInfo.RxPower',
          'InternetGatewayDevice.WANDevice.1.X_NETLINK_OpticalInfo.RxPower',
          'Device.Optical.Interface.1.OpticalSignalLevel',
        ];
    }
  }

  /**
   * Given a confirmed working optical RX path, returns the corresponding companion metrics in that same tree.
   */
  static getOpticalCompanionPaths(rxPath: string): string[] {
    if (rxPath.includes('X_SyroTech.GPON')) {
      return [
        'InternetGatewayDevice.X_SyroTech.GPON.OpticalTxPower',
        'InternetGatewayDevice.X_SyroTech.GPON.ONU_ID',
        'InternetGatewayDevice.X_SyroTech.GPON.GEM_Port',
        'InternetGatewayDevice.X_SyroTech.GPON.LOID',
        'InternetGatewayDevice.X_SyroTech.GPON.PLOAMStatus',
      ];
    }

    if (rxPath.includes('X_DBC.GPON')) {
      return [
        'InternetGatewayDevice.X_DBC.GPON.OpticalTxPower',
        'InternetGatewayDevice.X_DBC.GPON.ONU_ID',
        'InternetGatewayDevice.X_DBC.GPON.GEM_Port',
        'InternetGatewayDevice.X_DBC.GPON.LOID',
        'InternetGatewayDevice.X_DBC.GPON.PLOAMStatus',
      ];
    }

    if (rxPath.includes('X_Netlink.GPON')) {
      return [
        'InternetGatewayDevice.X_Netlink.GPON.OpticalTxPower',
        'InternetGatewayDevice.X_Netlink.GPON.ONU_ID',
        'InternetGatewayDevice.X_Netlink.GPON.GEM_Port',
        'InternetGatewayDevice.X_Netlink.GPON.LOID',
        'InternetGatewayDevice.X_Netlink.GPON.PLOAMStatus',
      ];
    }

    if (rxPath.includes('X_RL_Tech.GPON')) {
      return [
        'InternetGatewayDevice.X_RL_Tech.GPON.OpticalTxPower',
        'InternetGatewayDevice.X_RL_Tech.GPON.ONU_ID',
        'InternetGatewayDevice.X_RL_Tech.GPON.GEM_Port',
        'InternetGatewayDevice.X_RL_Tech.GPON.LOID',
        'InternetGatewayDevice.X_RL_Tech.GPON.PLOAMStatus',
      ];
    }

    if (rxPath.includes('X_00000C_Gpon')) {
      return [
        'InternetGatewayDevice.X_00000C_Gpon.OpticalPowerTx',
        'InternetGatewayDevice.X_00000C_Gpon.ONU_ID',
        'InternetGatewayDevice.X_00000C_Gpon.GEM_Port',
        'InternetGatewayDevice.X_00000C_Gpon.LOID',
        'InternetGatewayDevice.X_00000C_Gpon.PLOAMState',
      ];
    }

    if (rxPath.includes('X_GNXS_Gpon') || rxPath.includes('X_Genexis_Gpon')) {
      return [
        'InternetGatewayDevice.X_GNXS_Gpon.OpticalTxPower',
        'InternetGatewayDevice.X_GNXS_Gpon.ONU_ID',
        'InternetGatewayDevice.X_GNXS_Gpon.GEM_Port',
        'InternetGatewayDevice.X_GNXS_Gpon.LOID',
        'InternetGatewayDevice.X_GNXS_Gpon.PLOAMState',
      ];
    }

    if (rxPath.includes('X_ZTE-COM_Gpon')) {
      return [
        'InternetGatewayDevice.X_ZTE-COM_Gpon.OpticalPowerTx',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.ONU_ID',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.GEM_Port',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.LOID',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.PLOAMState',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.Temperature',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.Voltage',
        'InternetGatewayDevice.X_ZTE-COM_Gpon.BiasCurrent',
      ];
    }

    if (rxPath.includes('X_CT-COM_EponInterfaceConfig')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower',
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.BiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TransceiverTemperature',
      ];
    }

    if (rxPath.includes('X_CMCC_EponInterfaceConfig')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.TXPower',
        'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.BiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.TransceiverTemperature',
      ];
    }

    if (rxPath.includes('WANGponInterfaceConfig') || rxPath.includes('WANEponInterfaceConfig')) {
      const base = rxPath.substring(0, rxPath.lastIndexOf('.'));
      return [
        `${base}.TXPower`,
        `${base}.BiasCurrent`,
        `${base}.SupplyVoltage`,
        `${base}.TransceiverTemperature`,
      ];
    }

    if (rxPath.includes('X_CT-COM_GponInterfaceConfig') || rxPath.includes('X_GponInterfaceConfig')) {
      const base = rxPath.substring(0, rxPath.lastIndexOf('.'));
      return [
        `${base}.TXPower`,
        `${base}.TransceiverTemperature`,
        `${base}.SupplyVoltage`,
        `${base}.BiasCurrent`,
      ];
    }

    if (rxPath.includes('X_HW_DEBUG.SMP.ONT')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalTxPower',
        'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalVoltage',
        'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalBiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.Temperature',
      ];
    }

    if (rxPath.includes('X_ZTE-COM_WANPONInterfaceConfig')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXPower',
        'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXBiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.SupplyVoltage',
        'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_BoardTemperature',
      ];
    }

    if (rxPath.includes('X_CT-COM_GponInterfaceConfig')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower',
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.Voltage',
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.BiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.Temperature',
      ];
    }

    if (rxPath.includes('X_GponInterfaceConfig')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.TXPower',
        'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.TransceiverTxPower',
        'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.Voltage',
        'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.BiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.Temperature',
      ];
    }

    if (rxPath.includes('X_VSOL_OpticalInfo')) {
      return [
        'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.TxPower',
        'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.Voltage',
        'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.BiasCurrent',
        'InternetGatewayDevice.WANDevice.1.X_VSOL_OpticalInfo.Temperature',
      ];
    }

    if (rxPath.includes('Device.Optical.Interface')) {
      return [
        'Device.Optical.Interface.1.TransmitOpticalPower',
        'Device.Optical.Interface.1.TxBiasCurrent',
        'Device.Optical.Interface.1.Voltage',
        'Device.Optical.Interface.1.Temperature',
      ];
    }

    return [];
  }

  /**
   * Telemetry Normalization & Scaling Rules configured strictly by vendor & path.
   * Avoids blind arbitrary conversion.
   */
  static normalizeOpticalRx(
    vendor: CpeVendor,
    paramPath: string,
    raw: string | number | undefined
  ): OpticalTelemetryScalingResult | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const cleanStr = String(raw).replace(/dBm|dbm|\s+/g, '').trim();
    const num = parseFloat(cleanStr);
    if (isNaN(num)) return undefined;

    if (num === 0) {
      return { rawValue: cleanStr, normalizedValue: -40.0, unit: 'dBm', scaleFactor: 1, sourcePath: paramPath, vendor, isReliable: true };
    }

    let scale = 1;
    let normalized = num;

    // TR-181 Device.Optical.Interface.1.OpticalSignalLevel is in 0.001 dBm
    if (paramPath.startsWith('Device.Optical.') || Math.abs(num) >= 10000) {
      scale = 1000;
      normalized = Math.abs(num) / 1000;
    }
    // TR-098 vendor extensions (Huawei, ZTE, CTC, VSOL) report in 0.01 dBm (e.g. -2145 or 2145)
    else if (Math.abs(num) >= 100) {
      scale = 100;
      normalized = Math.abs(num) / 100;
    }
    // Float representation (e.g. -21.45 or 21.45)
    else {
      scale = 1;
      normalized = Math.abs(num);
    }

    if (normalized > 50) normalized = 40.0;
    const finalValue = -Number(normalized.toFixed(2));

    return {
      rawValue: cleanStr,
      normalizedValue: finalValue,
      unit: 'dBm',
      scaleFactor: scale,
      sourcePath: paramPath,
      vendor,
      isReliable: true,
    };
  }

  static normalizeOpticalTx(
    vendor: CpeVendor,
    paramPath: string,
    raw: string | number | undefined
  ): OpticalTelemetryScalingResult | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const cleanStr = String(raw).replace(/dBm|dbm|\s+/g, '').trim();
    const num = parseFloat(cleanStr);
    if (isNaN(num)) return undefined;

    let scale = 1;
    let normalized = num;

    if (Math.abs(num) >= 1000) {
      scale = 1000;
      normalized = num / 1000;
    } else if (Math.abs(num) >= 100) {
      scale = 100;
      normalized = num / 100;
    }

    return {
      rawValue: cleanStr,
      normalizedValue: Number(normalized.toFixed(2)),
      unit: 'dBm',
      scaleFactor: scale,
      sourcePath: paramPath,
      vendor,
      isReliable: true,
    };
  }

  /**
   * Automatically classifies real discovered parameter paths into capability domains
   */
  static classifyParameter(path: string): string {
    const p = path.toLowerCase();
    if (p.includes('deviceinfo') || p.includes('serialnumber') || p.includes('softwareversion') || p.includes('hardwareversion') || p.includes('devicesummary')) return 'IDENTITY';
    if (p.includes('wlan') || p.includes('wifi') || p.includes('ssid') || p.includes('presharedkey') || p.includes('beacontype') || p.includes('radio') || p.includes('accesspoint')) return 'WIFI';
    if (p.includes('optical') || p.includes('rxpower') || p.includes('txpower') || p.includes('laser') || p.includes('opti') || p.includes('opticalsignallevel') || p.includes('biascurrent') || p.includes('opticalvoltage')) return 'OPTICAL';
    if (p.includes('gpon') || p.includes('epon') || p.includes('pon')) return 'PON';
    if (p.includes('wanppp') || (p.includes('ppp') && p.includes('user'))) return 'PPPOE';
    if (p.includes('vlan')) return 'VLAN';
    if (p.includes('wandevice') || p.includes('wanconnection') || p.includes('externalipaddress') || p.includes('connectionstatus') || p.includes('wanipconnection')) return 'WAN';
    if (p.includes('hosts') || p.includes('hostnumberofentries')) return 'HOSTS';
    if (p.includes('lanethernet') || p.includes('ethernet.interface')) return 'PORTS';
    if (p.includes('cpu') || p.includes('memory') || p.includes('ram') || p.includes('temp') || p.includes('uptime')) return 'HARDWARE';
    if (p.includes('diagnostic') || p.includes('ipping') || p.includes('traceroute') || p.includes('downloaddiagnostics') || p.includes('uploaddiagnostics')) return 'DIAGNOSTICS';
    if (p.includes('voice') || p.includes('voip') || p.includes('sip')) return 'VOICE';
    if (p.includes('usb')) return 'USB';
    if (p.includes('firewall') || p.includes('filter')) return 'FIREWALL';
    if (p.includes('nat') || p.includes('portmapping')) return 'NAT';
    if (p.includes('dns')) return 'DNS';
    if (p.includes('dhcp')) return 'DHCP';
    if (p.includes('landevice') || p.includes('lan.')) return 'LAN';
    if (p.includes('managementserver') || p.includes('time') || p.includes('userinterface')) return 'SYSTEM';
    return 'OTHER';
  }

  /**
   * Deterministically classifies the frequency band of a discovered Wi-Fi interface
   * using explicit CPE parameter evidence (RFBand, Standard, Channel, Radio reference).
   * Never assumes band based only on instance index.
   */
  static determineWifiBand(
    rawParams: Record<string, any>,
    instance: number,
    ssid: string
  ): '2.4GHz' | '5GHz' | '6GHz' | 'UNKNOWN' {
    const rawKeys = Object.keys(rawParams);

    // 1. Explicit Band Parameter (Universal + Vendor extensions e.g. TP-Link, Huawei, ZTE)
    const bandKey = rawKeys.find((k) =>
      new RegExp(`(WLANConfiguration\\.${instance}\\.(X_TP_Band|X_RFBand|RFBand|OperatingFrequencyBand|SupportedFrequencyBands)|Device\\.WiFi\\.Radio\\.${instance}\\.OperatingFrequencyBand)`, 'i').test(k)
    );
    if (bandKey && rawParams[bandKey]) {
      const val = String(rawParams[bandKey]).toLowerCase();
      if (val.includes('5g') || val.includes('5ghz') || val.includes('5.0')) return '5GHz';
      if (val.includes('2.4') || val.includes('2g') || val.includes('2.4ghz')) return '2.4GHz';
      if (val.includes('6g') || val.includes('6ghz')) return '6GHz';
    }

    // 2. Explicit Operating Channel Numbers (1-14 = 2.4G, 36-165 = 5G)
    const chanKey = rawKeys.find((k) =>
      new RegExp(`(WLANConfiguration\\.${instance}\\.Channel|Device\\.WiFi\\.Radio\\.${instance}\\.Channel)`, 'i').test(k)
    );
    if (chanKey && rawParams[chanKey] !== undefined) {
      const chan = parseInt(String(rawParams[chanKey]), 10);
      if (!isNaN(chan)) {
        if (chan >= 36 && chan <= 165) return '5GHz';
        if (chan >= 1 && chan <= 14) return '2.4GHz';
      }
    }

    // 3. Explicit Operating Standards
    const stdKey = rawKeys.find((k) =>
      new RegExp(`(WLANConfiguration\\.${instance}\\.(Standard|OperatingStandards)|Device\\.WiFi\\.Radio\\.${instance}\\.OperatingStandards)`, 'i').test(k)
    );
    if (stdKey && rawParams[stdKey]) {
      const val = String(rawParams[stdKey]).toLowerCase();
      if (val.includes('11ac') || val.includes('11a,') || val.includes('ac,') || val === 'a') return '5GHz';
      if (val.includes('11ax')) return '5GHz';
      if (val.includes('11b') || val.includes('11g') || val.includes('b,g,n')) return '2.4GHz';
    }

    // 4. Possible Channels String Evidence
    const possKey = rawKeys.find((k) =>
      new RegExp(`(WLANConfiguration\\.${instance}\\.PossibleChannels)`, 'i').test(k)
    );
    if (possKey && rawParams[possKey]) {
      const p = String(rawParams[possKey]);
      if (/36|40|44|48|149|153|157|161|165/.test(p) && !/1,2,3,4,5/.test(p)) return '5GHz';
      if (/1,2,3,4,5|1-11|1-13|1-14/.test(p)) return '2.4GHz';
    }

    // 5. Explicit Radio Reference in TR-181
    const radioRefKey = rawKeys.find((k) =>
      new RegExp(`(Device\\.WiFi\\.SSID\\.${instance}\\.LowerLayers)`, 'i').test(k)
    );
    if (radioRefKey && rawParams[radioRefKey]) {
      const ref = String(rawParams[radioRefKey]);
      if (/Radio\\.2/i.test(ref)) return '5GHz';
      if (/Radio\\.1/i.test(ref)) return '2.4GHz';
    }

    // 6. Explicit SSID Name Hint (e.g. ends with _5G / -5G vs _2.4G / -2.4G)
    if (ssid) {
      const cleanSsid = ssid.toUpperCase();
      if (/[-_ ]5G(HZ)?$/i.test(cleanSsid) || /[-_ ]5\\.0G/i.test(cleanSsid)) return '5GHz';
      if (/[-_ ]2\\.4G(HZ)?$/i.test(cleanSsid) || /[-_ ]2G/i.test(cleanSsid)) return '2.4GHz';
    }

    // 7. Standard TR-098 Default Primary Instance 1
    if (instance === 1) {
      return '2.4GHz';
    }

    // If no conclusive proof exists from the CPE, do NOT guess
    return 'UNKNOWN';
  }

  /**
   * Universal Client Identification Engine:
   * Maps DHCP HostNames, IEEE OUI prefixes, and randomized MAC flags to real brand models
   */
  static resolveFriendlyDeviceName(
    rawName?: string | null,
    mac?: string | null,
    iface?: string | null
  ): string {
    if (rawName && typeof rawName === 'string') {
      let clean = rawName
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/["']/g, '')
        .trim();

      if (clean && !/^unknown$/i.test(clean) && clean !== '0.0.0.0') {
        if (/^android-[a-f0-9]+$/i.test(clean)) {
          return `Android Smartphone (${mac ? mac.slice(-5).toUpperCase() : clean.slice(-4)})`;
        }
        if (/^(galaxy|samsung)[-_ ]/i.test(clean)) {
          return `Samsung Galaxy (${clean.replace(/^samsung[-_ ]/i, '')})`;
        }
        if (/^(oneplus|nord)[-_ ]/i.test(clean)) {
          return `OnePlus (${clean})`;
        }
        if (/^(redmi|poco|xiaomi)[-_ ]/i.test(clean)) {
          return `Xiaomi (${clean})`;
        }
        if (/^(vivo|oppo|realme)[-_ ]/i.test(clean)) {
          return `${clean.toUpperCase()}`;
        }
        if (/iphone/i.test(clean)) {
          return clean.includes("'") ? clean : `${clean.replace(/iphone/i, '').replace(/[-_]/g, ' ').trim()} iPhone`.trim();
        }
        if (/ipad/i.test(clean)) {
          return clean;
        }
        if (/desktop|laptop|thinkpad|macbook/i.test(clean)) {
          return `PC / Laptop (${clean})`;
        }
        if (
          !/^client[-_]?\d+$/i.test(clean) &&
          !/^host[-_]?\d+$/i.test(clean) &&
          !/^(device|host|wireless client|wired client|lan client)\s*\([a-f0-9:]+\)$/i.test(clean)
        ) {
          return clean;
        }
      }
    }

    if (mac) {
      const cleanMac = mac.replace(/[: -]/g, '').toUpperCase();
      if (cleanMac.length >= 6) {
        const p3 = cleanMac.slice(0, 6);
        const firstByte = parseInt(cleanMac.slice(0, 2), 16);
        const isRandomized = !isNaN(firstByte) && (firstByte & 0x02) !== 0;

        const brandMap: Record<string, string> = {
          // Apple (iPhone, iPad, MacBook)
          'CCF735': 'Apple iPhone / iPad',
          '3C64CF': 'Apple MacBook / Device',
          '74563C': 'Apple iPhone / Device',
          'F01898': 'Apple iPhone',
          'BCD074': 'Apple iPad',
          'AC6784': 'Apple MacBook',
          '38F9D3': 'Apple Device',
          '40A6D9': 'Apple iPhone',
          'A483E7': 'Apple Device',
          'DCA904': 'Apple MacBook',
          'F8FFC2': 'Apple iPad',
          'E8802E': 'Apple Device',
          '70ECE4': 'Apple iPhone',
          'A860B6': 'Apple Watch',
          'FC183C': 'Apple Device',
          'B8782E': 'Apple iPhone',
          'D4619D': 'Apple MacBook',
          '20EE28': 'Apple iPhone',
          '689C70': 'Apple iPad',
          'F0D1A9': 'Apple Device',
          'B0BE76': 'Apple iPhone',
          'ACBC32': 'Apple MacBook',
          '2CF0EE': 'Apple Device',
          // Samsung Galaxy & Smart Things
          '085BD6': 'Samsung Galaxy Phone',
          '5CE931': 'Samsung Galaxy Device',
          '5CE91E': 'Samsung Galaxy',
          '88665A': 'Samsung Smart Device',
          '34145F': 'Samsung Galaxy Phone',
          '44783E': 'Samsung Galaxy Tab',
          '8C7712': 'Samsung Smart TV',
          'A0C589': 'Samsung Device',
          'B47C9C': 'Samsung Galaxy Phone',
          'C0BDD1': 'Samsung Device',
          'D0B76E': 'Samsung Galaxy Phone',
          'E8508B': 'Samsung Smart Device',
          'F47B5E': 'Samsung Galaxy Phone',
          'FCA13E': 'Samsung Galaxy',
          '0007AB': 'Samsung Electronics',
          '001247': 'Samsung Electronics',
          '0015B9': 'Samsung Electronics',
          '00166C': 'Samsung Mobile',
          '001A8A': 'Samsung Mobile',
          // Xiaomi / Redmi / POCO
          'D84489': 'Xiaomi Redmi Smartphone',
          '94652D': 'Xiaomi / Redmi Phone',
          '68DFDD': 'Xiaomi Redmi Smartphone',
          '7C49EB': 'Xiaomi POCO Phone',
          'ACF7F3': 'Xiaomi Smart Device',
          '34CE00': 'Xiaomi Smartphone',
          '286C07': 'Xiaomi Redmi Phone',
          '184F32': 'Xiaomi Device',
          '584498': 'Xiaomi Smart TV',
          '640980': 'Xiaomi Redmi Phone',
          '7811DC': 'Xiaomi Smartphone',
          '8035C1': 'Xiaomi Device',
          // OnePlus / Oppo / Realme
          'A842A1': 'OPPO / Realme Smartphone',
          '6490C1': 'OnePlus Smartphone',
          '74D21D': 'OnePlus Phone',
          '9C2EA1': 'Oppo Smartphone',
          'A4C3F0': 'OnePlus / Oppo Phone',
          'C8D083': 'Realme Smartphone',
          'E0DCFF': 'Realme Smartphone',
          'F460E2': 'Oppo Smartphone',
          '2C5BB8': 'OnePlus Phone',
          // Vivo
          '5076AF': 'Vivo Smartphone',
          '54A51B': 'Vivo Phone',
          '842AFD': 'Vivo Smartphone',
          'C07E40': 'Vivo Phone',
          'DC729B': 'Vivo Smartphone',
          'E4AAEA': 'Vivo Phone',
          // Shenzhen Bilian / MediaTek / Smart IoT
          '40AE30': 'Smart Home IoT Device',
          // Intel / Laptops / PCs
          '001B77': 'Intel Laptop / PC',
          '001E64': 'Intel Wireless NIC',
          '3413E8': 'Intel Desktop / Laptop',
          '4851B7': 'Intel Wi-Fi 6 Client',
          '5C879C': 'Intel PC / Laptop',
          '6805CA': 'Intel Laptop Client',
          '7CB27D': 'Intel Desktop',
          '8086F2': 'Intel Core Laptop',
          'A44CC8': 'Intel Wi-Fi NIC',
          'B46921': 'Intel Wireless Client',
          'E8D8D1': 'Intel PC / Laptop',
          // Realtek / NICs
          'A8E207': 'Realtek Wireless NIC',
          '00E04C': 'Realtek Gigabit Ethernet',
          '000CE7': 'Realtek Wi-Fi Adapter',
          '74DA38': 'Realtek Wi-Fi Client',
          'B0D59D': 'Realtek NIC',
          '001A73': 'Realtek Semiconductor',
          // Espressif / Smart IoT / Home Automation
          '240AC4': 'Espressif Smart IoT Device',
          '2462AB': 'Smart Home Automation Plug',
          '246F28': 'Smart Wi-Fi Switch / Bulb',
          '30AEA4': 'Espressif Smart Plug',
          '3C71BF': 'Smart IoT Controller',
          '483FDA': 'Espressif IoT Sensor',
          '4C11AE': 'Smart Home IoT Device',
          '5CCF7F': 'Espressif Smart Switch',
          '600194': 'Smart Plug / Bulb',
          '68C63A': 'Espressif IoT Node',
          '84F3EB': 'Smart Light Controller',
          'A4CF12': 'Smart IoT Appliance',
          'B4E62D': 'Espressif Smart Home',
          'C44F33': 'Smart Home Switch',
          'CC50E3': 'Espressif Smart Device',
          'D8A01D': 'Smart Automation Node',
          'DC4F22': 'Espressif IoT Device',
          // Amazon (Echo, Fire TV, Kindle)
          '6045BD': 'Amazon Echo / FireTV',
          '747548': 'Amazon FireTV Stick',
          'AC63BE': 'Amazon Echo Dot',
          'B47C9E': 'Amazon Fire Tablet',
          'F0F002': 'Amazon Smart Device',
          '00FC8B': 'Amazon Echo Show',
          '44650D': 'Amazon FireTV 4K',
          '6854FD': 'Amazon Echo Device',
          // Google (Pixel, Nest, Chromecast)
          '3C8CF8': 'Google Chromecast / Nest',
          'F4F5D8': 'Google Pixel Phone',
          '94EBCD': 'Google Nest Mini',
          '546009': 'Google Pixel Smartphone',
          '48D6D5': 'Google Nest Hub',
          '001A11': 'Google Home Device',
          // TP-Link
          'B0A732': 'TP-Link Wireless Client',
          '30DE4B': 'TP-Link Router / Extender',
          '50C7BF': 'TP-Link Tapo Smart Camera',
          '6032B1': 'TP-Link Archer Client',
          '704F57': 'TP-Link Smart Plug',
          '98DAC4': 'TP-Link Kasa Smart Device',
          'C006C3': 'TP-Link Tapo Wi-Fi Cam',
          'EC086B': 'TP-Link Wireless Extender',
          // Sony (PlayStation, Bravia)
          'D80D17': 'Sony PlayStation 5 / TV',
          '00041F': 'Sony Interactive PS4/PS5',
          '001315': 'Sony Bravia 4K TV',
          '001A80': 'Sony Smart Device',
          '00248D': 'Sony Electronics Device',
          'F8461C': 'Sony PlayStation Console',
          // LG Electronics (webOS TV)
          'F44EFD': 'LG WebOS Smart 4K TV',
          '001E75': 'LG Smart Electronics',
          '10F96F': 'LG ThinQ Smart Appliance',
          '203D66': 'LG Smart TV',
          '58A2B5': 'LG WebOS TV',
          'A823FE': 'LG Smart Device',
          // Dell / HP / Lenovo
          'D4BED9': 'Dell XPS / Inspiron Laptop',
          '14FEB5': 'Dell Computer PC',
          '001422': 'Dell Precision Desktop',
          'F0921C': 'HP Pavilion / Envy Laptop',
          '9C8E99': 'HP EliteBook PC',
          '001E0B': 'HP Computer Client',
          '00215D': 'Lenovo ThinkPad Laptop',
          '54EE75': 'Lenovo Legion / IdeaPad',
          '8CDCD4': 'Lenovo Laptop PC',
        };

        if (brandMap[p3]) {
          return `${brandMap[p3]} (${mac.slice(-5).toUpperCase()})`;
        }

        if (isRandomized) {
          return `Smartphone / Tablet (Private Wi-Fi ${mac.slice(-5).toUpperCase()})`;
        }

        return `Wireless Client (${mac.slice(-5).toUpperCase()})`;
      }
    }

    if (iface && iface.includes('5G')) return '5GHz High-Speed Client';
    if (iface && (iface.includes('eth') || iface.includes('lan'))) return 'Ethernet Wired Client';
    return '2.4GHz Wireless Client';
  }

  /**
   * Deterministically classifies if a client device is Wi-Fi vs physical wired Ethernet
   */
  static isWirelessClient(mac?: string | null, friendlyName?: string | null, rawIface?: string | null): boolean {
    if (rawIface && /wifi|wlan|wireless|802\.11/i.test(rawIface)) return true;
    if (rawIface && /5g/i.test(rawIface)) return true;

    if (mac) {
      const cleanMac = mac.replace(/[: -]/g, '').toUpperCase();
      if (cleanMac.length >= 6) {
        const firstByte = parseInt(cleanMac.slice(0, 2), 16);
        // Randomized MAC address (iOS Private Wi-Fi Address, Android MAC Randomization, Windows Random Hardware Addresses)
        // These are EXCLUSIVELY generated for Wi-Fi interfaces!
        if (!isNaN(firstByte) && (firstByte & 0x02) !== 0) return true;

        const p3 = cleanMac.slice(0, 6);
        // Wireless-only device OUIs (Smartphones, Tablets, Smart Watches, Smart Home IoT, Smart TVs)
        const wirelessOUIs = new Set([
          // Apple (iPhone, iPad, Watch)
          'CCF735', '3C64CF', '74563C', 'F01898', 'BCD074', 'AC6784', '38F9D3', '40A6D9',
          'A483E7', 'DCA904', 'F8FFC2', 'E8802E', '70ECE4', 'A860B6', 'FC183C', 'B8782E',
          'D4619D', '20EE28', '689C70', 'F0D1A9', 'B0BE76', 'ACBC32', '2CF0EE',
          // Samsung Galaxy & Smart Things
          '085BD6', '5CE931', '5CE91E', '88665A', '34145F', '44783E', '8C7712', 'A0C589',
          'B47C9C', 'C0BDD1', 'D0B76E', 'E8508B', 'F47B5E', 'FCA13E', '0007AB', '001247',
          '0015B9', '00166C', '001A8A',
          // Xiaomi / Redmi / POCO
          'D84489', '94652D', '68DFDD', '7C49EB', 'ACF7F3', '34CE00', '286C07', '184F32',
          '584498', '640980', '7811DC', '8035C1',
          // OnePlus / Oppo / Realme
          'A842A1', '6490C1', '74D21D', '9C2EA1', 'A4C3F0', 'C8D083', 'E0DCFF', 'F460E2', '2C5BB8',
          // Vivo
          '5076AF', '54A51B', '842AFD', 'C07E40', 'DC729B', 'E4AAEA',
          // Smart IoT / MediaTek / Bilian / Espressif / Tuya
          '40AE30', '240AC4', '2462AB', '246F28', '30AEA4', '3C71BF', '483FDA', '4C11AE',
          '5CCF7F', '600194', '68C63A', '84F3EB', 'A4CF12', 'B4E62D', 'C44F33', 'CC50E3',
          'D8A01D', 'DC4F22', '50C7BF', '704F57', '98DAC4', 'C006C3',
          // Amazon & Google
          '6045BD', '747548', 'AC63BE', 'B47C9E', 'F0F002', '00FC8B', '44650D', '6854FD',
          '3C8CF8', 'F4F5D8', '94EBCD', '546009', '48D6D5', '001A11',
        ]);

        if (wirelessOUIs.has(p3)) return true;
      }
    }

    if (friendlyName) {
      if (/phone|smartphone|iphone|ipad|galaxy|realme|oppo|oneplus|redmi|xiaomi|poco|vivo|tapo|iot|alexa|echo|firetv|chromecast|nest|smart\s*plug|bulb|sensor|watch/i.test(friendlyName)) {
        return true;
      }
    }

    // If rawIface is missing or unknown, default to true
    if (!rawIface || rawIface === 'unknown') return true;

    return false;
  }
}

export interface DiscoveredWifiInterface {
  instance: number;
  ssid: string;
  band: '2.4GHz' | '5GHz' | '6GHz' | 'UNKNOWN';
  radioPath?: string;
  channel?: number;
  security?: string;
  password?: string;
  status: 'Active' | 'Disabled' | 'UNKNOWN';
  sourcePaths: {
    ssidPath?: string;
    keyPath?: string;
    channelPath?: string;
    beaconPath?: string;
    bandPath?: string;
    standardPath?: string;
    radioRefPath?: string;
  };
}
