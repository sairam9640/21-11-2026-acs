import { describe, it, expect } from 'vitest';
import { CwmpVendorProfiles } from '../src/services/cwmpVendorProfiles.js';
import { UspService, IUspParameter } from '../src/services/uspService.js';

describe('Phase 4: Multi-Vendor CPE Normalization & ZTP Suite', () => {
  describe('Multi-Vendor Detection Heuristics', () => {
    it('should accurately detect Huawei ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('Huawei Technologies Co., Ltd', 'HG8145V5', '00259E', 'EchoLife');
      expect(vendor).toBe('HUAWEI');
    });

    it('should accurately detect ZTE ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('ZTE Corp', 'ZXHN F670L', '002293', 'ONT');
      expect(vendor).toBe('ZTE');
    });

    it('should accurately detect Syrotech ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('Syrotech', 'SY-GPON-1110-WDONT', '00E04C', 'GPON');
      expect(vendor).toBe('SYROTECH');
    });

    it('should accurately detect Genexis Platinum / Titanium ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('Genexis', 'Platinum-4410', '002207', 'HGU');
      expect(vendor).toBe('GENEXIS');
    });

    it('should accurately detect Nokia / Alcatel-Lucent ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('Nokia', 'G-140W-ME', '001FE2', 'ONT');
      expect(vendor).toBe('NOKIA');
    });

    it('should accurately detect TP-Link ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('TP-Link Technologies', 'XC220-G3v', '003192', 'Archer');
      expect(vendor).toBe('TPLINK');
    });

    it('should accurately detect V-Sol ONTs', () => {
      const vendor = CwmpVendorProfiles.detectVendor('V-SOL', 'V2804AX', '000C43', 'XPON');
      expect(vendor).toBe('VSOL');
    });
  });

  describe('Vendor-Specific Optical Candidate Profiles', () => {
    it('should return specific optical paths for Huawei', () => {
      const candidates = CwmpVendorProfiles.getOpticalCandidates('HUAWEI');
      expect(candidates).toContain('InternetGatewayDevice.WANDevice.1.X_HW_DEBUG.SMP.ONT.OpticalRxPower');
    });

    it('should return specific optical paths for ZTE', () => {
      const candidates = CwmpVendorProfiles.getOpticalCandidates('ZTE');
      expect(candidates).toContain('InternetGatewayDevice.X_ZTE-COM_Gpon.OpticalPowerRx');
    });

    it('should return safe baseline parameters for TR-098 CPEs', () => {
      const baseline = CwmpVendorProfiles.getSafeBaselineParameters('GENEXIS', 'Platinum-4410');
      expect(baseline).toContain('InternetGatewayDevice.DeviceInfo.SerialNumber');
      expect(baseline).toContain('InternetGatewayDevice.ManagementServer.ConnectionRequestURL');
      expect(baseline).toContain('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID');
    });
  });

  describe('USP / TR-181 Normalization Engine', () => {
    it('should normalize TR-181 USP parameters into device schema', () => {
      const uspParams: IUspParameter[] = [
        { path: 'Device.DeviceInfo.Manufacturer', value: 'Nokia' },
        { path: 'Device.DeviceInfo.ModelName', value: 'G-2425G-A' },
        { path: 'Device.DeviceInfo.SoftwareVersion', value: '3FE49362IJHK12' },
        { path: 'Device.Optical.Interface.1.RxPower', value: '-19.45' },
        { path: 'Device.WiFi.SSID.1.SSID', value: 'Airtel_Broadband_2.4' },
        { path: 'Device.PPP.Interface.1.Username', value: 'user@isp.net' },
        { path: 'Device.Ethernet.VLANTermination.1.VLANID', value: '100' },
      ];

      const normalized = UspService.normalizeUspData('proto::usp-agent-123', uspParams);

      expect(normalized.manufacturer).toBe('Nokia');
      expect(normalized.modelName).toBe('G-2425G-A');
      expect(normalized.softwareVersion).toBe('3FE49362IJHK12');
      expect(normalized.currentRxPowerDbm).toBe(-19.45);
      expect(normalized.opticalStatus).toBe('normal');
      expect(normalized.protocol).toBe('TR-369');
      expect(normalized.wanProfiles?.[0]?.connectionType).toBe('PPPoE');
      expect(normalized.wanProfiles?.[0]?.vlanId).toBe(100);
    });
  });
});
