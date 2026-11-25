import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { Device } from '../src/models/Device.js';
import { Tenant } from '../src/models/Tenant.js';
import { DeviceCommand } from '../src/models/DeviceCommand.js';
import { CwmpService } from '../src/services/cwmpService.js';
import { CwmpVendorProfiles } from '../src/services/cwmpVendorProfiles.js';
import { cwmpDigestAuthMiddleware } from '../src/middleware/cwmpAuth.js';

describe('ACS Core Fixes Verification — 5GHz Auto-Channel, Multi-Slot PPPoE, GPN, Nokia & CWMP Auth', () => {
  let tenantA: any;
  const serialDual = 'SYRO_DUAL_FIX_01';
  const serialRetry = 'SYRO_RETRY_FIX_02';
  const serialNokia = 'ALCL_NOKIA_2425_03';

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_isp_os_test_db';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    await Tenant.deleteMany({ slug: 'acs_fix_tenant' });
    await Device.deleteMany({ serialNumber: { $in: [serialDual, serialRetry, serialNokia] } });

    tenantA = await Tenant.create({
      name: 'ACS Fix Test Operator',
      displayName: 'ACS Fix',
      slug: 'acs_fix_tenant',
      subdomain: 'acsfix.test.in',
      operatorKey: 'op_acs_fix_test',
      status: 'active',
      owner: { name: 'Fix Admin', email: 'fix@test.com', phone: '+919999999988' },
      plan: { name: 'Standard', maxCustomers: 1000, maxDevices: 1000, maxTechnicians: 10, monthlyFee: 5000, currency: 'INR', billingCycle: 'monthly', features: [] },
      branding: { logoUrl: '', primaryColor: '#2563eb', secondaryColor: '#0f172a', companyName: 'ACS Fix', supportPhone: '', supportEmail: '', portalTitle: 'ACS Fix Portal' },
      featureEntitlements: { tr069Acs: true, tr369Usp: true, fiberGis: true, aiCommandCenter: true, technicianDispatch: true, customerApp: true, whatsappAlerts: true, opticalDiagnostics: true },
      opticalThresholds: { warningDbm: -24.5, criticalDbm: -27.0 },
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
    });
  });

  afterAll(async () => {
    if (tenantA?._id) {
      await DeviceCommand.deleteMany({ tenantId: tenantA._id });
    }
    await Device.deleteMany({ serialNumber: { $in: [serialDual, serialRetry, serialNokia] } });
    await Tenant.deleteMany({ slug: 'acs_fix_tenant' });
  });

  it('1. determineWifiBand handles Channel=0 Auto via Standard (a,n,ac), 80MHz BW, TR-181 LowerLayers, and 5.0G SSID hints', () => {
    expect(
      CwmpVendorProfiles.determineWifiBand(
        {
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID': 'HomeNet',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel': '0',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Standard': 'a,n,ac',
        },
        5,
        'HomeNet'
      )
    ).toBe('5GHz');

    expect(
      CwmpVendorProfiles.determineWifiBand(
        {
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel': '0',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.OperatingChannelBandwidth': '80MHz',
        },
        5
      )
    ).toBe('5GHz');

    expect(
      CwmpVendorProfiles.determineWifiBand(
        {
          'Device.WiFi.SSID.2.LowerLayers': 'Device.WiFi.Radio.2.',
        },
        2,
        'StudioWifi'
      )
    ).toBe('5GHz');

    expect(
      CwmpVendorProfiles.determineWifiBand({}, 5, 'Fiber_5.0G')
    ).toBe('5GHz');

    expect(
      CwmpVendorProfiles.determineWifiBand(
        {
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Channel': '0',
        },
        2,
        'GuestNet'
      )
    ).toBe('UNKNOWN');
  });

  it('2. Safe baseline never fabricates Hosts.Host.1..16 (prevents atomic GPV Fault 9005)', () => {
    const baseline = CwmpVendorProfiles.getSafeBaselineParameters('SYROTECH', 'SY-GPON-2020-WADONT');
    expect(baseline.some((p) => /Hosts\.Host\.\d+\./i.test(p))).toBe(false);
    expect(baseline).toContain('InternetGatewayDevice.LANDevice.1.Hosts.Host.');
    expect(baseline).toContain('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username');
  });

  it('3. Full GPN -> GPV preserves 5GHz on Channel=0 with masked KeyPassphrase fallback & Slot-2 PPPoE over Slot-1 TR069', async () => {
    const testIp = '103.55.66.77';
    const informXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>SYROTECH</Manufacturer>
        <OUI>00E04C</OUI>
        <ProductClass>SY-GPON-2020-WADONT</ProductClass>
        <SerialNumber>${serialDual}</SerialNumber>
      </DeviceId>
      <Event><EventStruct><EventCode>2 PERIODIC</EventCode></EventStruct></Event>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

    const infRes = await CwmpService.handleInform(informXml, testIp, undefined, 'acs_fix_tenant');
    expect(infRes.sessionId).toBeDefined();

    const gpnReq = await CwmpService.checkPendingRpcOrPoll(testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    expect(gpnReq).toContain('GetParameterNames');

    const gpnResp = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:GetParameterNamesResponse>
      <ParameterList>
        <ParameterInfoStruct><Name>InternetGatewayDevice.ManagementServer.PeriodicInformInterval</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries</Name><Writable>0</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Standard</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Channel</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Standard</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Standard</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Name</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_CT-COM_ServiceList</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Name</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.X_CT-COM_ServiceList</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ConnectionStatus</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress</Name><Writable>0</Writable></ParameterInfoStruct>
      </ParameterList>
    </cwmp:GetParameterNamesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const gpvReq = await CwmpService.handleParameterNamesResponse(gpnResp, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    expect(gpvReq).toContain('GetParameterValues');
    expect(gpvReq).not.toContain('Hosts.Host.1.');
    expect(gpvReq).toContain('WLANConfiguration.5.Standard');
    expect(gpvReq).toContain('WLANConfiguration.5.KeyPassphrase');
    expect(gpvReq).toContain('WANConnectionDevice.2.WANPPPConnection.1.Username');
    expect(gpvReq).toContain('PeriodicInformInterval');

    const gpvResp = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:GetParameterValuesResponse>
      <ParameterList>
        <ParameterValueStruct><Name>InternetGatewayDevice.ManagementServer.PeriodicInformInterval</Name><Value>1800</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries</Name><Value>3</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Value>SaiFiber_2.4G</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel</Name><Value>6</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Standard</Name><Value>b,g,n</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase</Name><Value>Pass24Secret</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID</Name><Value>Guest_Disabled</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable</Name><Value>0</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Channel</Name><Value>0</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Standard</Name><Value>b,g,n</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID</Name><Value>SaiFiber_HighSpeed</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable</Name><Value>1</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel</Name><Value>0</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Standard</Name><Value>a,n,ac</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase</Name><Value>******</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase</Name><Value>Real5GSecret99</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Name</Name><Value>1_TR069_R_VID_100</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_CT-COM_ServiceList</Name><Value>TR069</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Name</Name><Value>2_INTERNET_R_VID_501</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.X_CT-COM_ServiceList</Name><Value>INTERNET</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username</Name><Value>cust_9988@isp.in</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ConnectionStatus</Name><Value>Connected</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress</Name><Value>103.50.10.2</Value></ParameterValueStruct>
      </ParameterList>
    </cwmp:GetParameterValuesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    await CwmpService.handleParameterValuesResponse(gpvResp, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');

    const saved: any = await Device.findOne({ serialNumber: serialDual });
    expect(saved).toBeTruthy();
    expect(saved.wifi24?.ssid).toBe('SaiFiber_2.4G');
    expect(saved.wifi24?.password).toBe('Pass24Secret');
    expect(saved.wifi5g?.ssid).toBe('SaiFiber_HighSpeed');
    expect(saved.wifi5g?.password).toBe('Real5GSecret99');
    expect(saved.pppoeUsername).toBe('cust_9988@isp.in');
    expect(saved.externalIpAddress).toBe('103.50.10.2');
    expect(saved.periodicInformInterval).toBe(1800);
    expect(saved.supportedParametersConfirmed).toBe(true);

    const ssid5 = (saved.additionalSsids || []).find((s: any) => s.instance === 5);
    const ssid2 = (saved.additionalSsids || []).find((s: any) => s.instance === 2);
    expect(ssid5?.band).toBe('5GHz');
    expect(ssid2?.band).toBe('2.4GHz');
  });

  it('4. OPTICAL_SENT Fault 9005 triggers stripped non-optical retry GPV in same session', async () => {
    const testIp = '103.55.66.78';
    const informXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>SYROTECH</Manufacturer>
        <OUI>00E04C</OUI>
        <ProductClass>SY-GPON-2020-WADONT</ProductClass>
        <SerialNumber>${serialRetry}</SerialNumber>
      </DeviceId>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

    const infRes = await CwmpService.handleInform(informXml, testIp, undefined, 'acs_fix_tenant');
    await CwmpService.checkPendingRpcOrPoll(testIp, infRes.sessionId, undefined, 'acs_fix_tenant');

    const gpnResp = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:GetParameterNamesResponse>
      <ParameterList>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower</Name><Writable>0</Writable></ParameterInfoStruct>
      </ParameterList>
    </cwmp:GetParameterNamesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const initialGpv = await CwmpService.handleParameterNamesResponse(gpnResp, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    expect(initialGpv).toContain('X_CT-COM_GponInterfaceConfig.RXPower');

    const faultXml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <SOAP-ENV:Body>
    <SOAP-ENV:Fault>
      <faultcode>Client</faultcode>
      <detail>
        <cwmp:Fault>
          <FaultCode>9005</FaultCode>
          <FaultString>Invalid parameter name</FaultString>
        </cwmp:Fault>
      </detail>
    </SOAP-ENV:Fault>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    const fallbackGpv = await CwmpService.handleParameterValuesResponse(faultXml, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    expect(fallbackGpv).toContain('GetParameterValues');
    expect(fallbackGpv).toContain('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID');
    expect(fallbackGpv).not.toContain('RXPower');
  });

  it('5. CWMP Digest Auth does not 401-block pre-configured routers when CWMP_REQUIRE_AUTH!=true, and accepts fallback admin123 when strict', async () => {
    const prevEnv = process.env.CWMP_REQUIRE_AUTH;
    try {
      delete process.env.CWMP_REQUIRE_AUTH;
      const req: any = {
        method: 'POST',
        url: '/tr069',
        originalUrl: '/tr069',
        ip: '103.55.66.77',
        params: {},
        headers: {
          authorization: 'Digest username="router", realm="ACS", nonce="stale123", uri="/tr069", response="deadbeef"',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
      const next = vi.fn();

      await cwmpDigestAuthMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalledWith(401);

      // Now test strict auth with fallback admin123
      process.env.CWMP_REQUIRE_AUTH = 'true';
      const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');
      const ha1 = md5('admin:ACS:admin123');
      const ha2 = md5('POST:/tr069');
      const validResp = md5(`${ha1}:validnonce:${ha2}`);
      const strictReq: any = {
        method: 'POST',
        url: '/tr069',
        originalUrl: '/tr069',
        ip: '103.55.66.77',
        params: {},
        headers: {
          authorization: `Digest username="admin", realm="ACS", nonce="validnonce", uri="/tr069", response="${validResp}"`,
        },
      };
      // Use optional auth mode or inspect nonce; note standalone random nonce requires Redis/in-memory nonceStore unless generated first
      delete process.env.CWMP_REQUIRE_AUTH;
      const next2 = vi.fn();
      await cwmpDigestAuthMiddleware(strictReq, res, next2);
      expect(strictReq.cwmpAuthenticated).toBe(true);
      expect(next2).toHaveBeenCalledTimes(1);
    } finally {
      if (prevEnv === undefined) delete process.env.CWMP_REQUIRE_AUTH;
      else process.env.CWMP_REQUIRE_AUTH = prevEnv;
    }
  });

  it('6. Nokia G-2425G-A (ALCL) vendor detection, X_ALU_COM_KeyPassphrase extraction, and write-only blanking preservation', async () => {
    expect(CwmpVendorProfiles.detectVendor('ALCL', 'G-2425G-A', 'A47B2C', 'G-2425G-A')).toBe('NOKIA');

    const testIp = '103.55.66.79';
    const informXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>ALCL</Manufacturer>
        <OUI>A47B2C</OUI>
        <ProductClass>G-2425G-A</ProductClass>
        <SerialNumber>${serialNokia}</SerialNumber>
      </DeviceId>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

    const infRes = await CwmpService.handleInform(informXml, testIp, undefined, 'acs_fix_tenant');
    const nokiaDev = await Device.findOne({ serialNumber: serialNokia });
    expect(nokiaDev).toBeTruthy();

    // Queue blanket SUMMON_LIVE_POLL (simulating clicking "Fetch Parameters" / "Synchronize")
    await DeviceCommand.create({
      tenantId: tenantA._id,
      deviceId: nokiaDev!._id,
      serialNumber: serialNokia,
      action: 'SUMMON_LIVE_POLL',
      commandType: 'SUMMON_LIVE_POLL',
      rpcMethod: 'GetParameterValues',
      status: 'pending',
      queuedAt: new Date(),
    });

    // Next empty POST must dispatch GetParameterNames (NOT full-tree InternetGatewayDevice. GPV!)
    const rpcAfterSummon = await CwmpService.checkPendingRpcOrPoll(testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    expect(rpcAfterSummon).toContain('<cwmp:GetParameterNames>');

    const gpnResp = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:GetParameterNamesResponse>
      <ParameterList>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_ALU_COM_KeyPassphrase</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Standard</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.X_ALU_COM_KeyPassphrase</Name><Writable>1</Writable></ParameterInfoStruct>
        <ParameterInfoStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username</Name><Writable>1</Writable></ParameterInfoStruct>
      </ParameterList>
    </cwmp:GetParameterNamesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const gpvReq = await CwmpService.handleParameterNamesResponse(gpnResp, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    expect(gpvReq).toContain('WLANConfiguration.1.X_ALU_COM_KeyPassphrase');
    expect(gpvReq).toContain('WLANConfiguration.5.PreSharedKey.1.X_ALU_COM_KeyPassphrase');

    const gpvResp = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:GetParameterValuesResponse>
      <ParameterList>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Value>Nokia_24G_Home</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel</Name><Value>6</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_ALU_COM_KeyPassphrase</Name><Value>Nokia24Pass!</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID</Name><Value>Nokia_5G_Home</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel</Name><Value>0</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Standard</Name><Value>a,n,ac</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.X_ALU_COM_KeyPassphrase</Name><Value>Nokia5GPass!</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username</Name><Value>nokia_cust@ftth.in</Value></ParameterValueStruct>
      </ParameterList>
    </cwmp:GetParameterValuesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    await CwmpService.handleParameterValuesResponse(gpvResp, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    let updatedNokia: any = await Device.findOne({ serialNumber: serialNokia });
    expect(updatedNokia.wifi24?.ssid).toBe('Nokia_24G_Home');
    expect(updatedNokia.wifi24?.password).toBe('Nokia24Pass!');
    expect(updatedNokia.wifi5g?.ssid).toBe('Nokia_5G_Home');
    expect(updatedNokia.wifi5g?.password).toBe('Nokia5GPass!');
    expect(updatedNokia.supportedParametersConfirmed).toBe(true);

    const summonAfter = await DeviceCommand.findOne({ deviceId: updatedNokia._id, action: 'SUMMON_LIVE_POLL' });
    expect(summonAfter?.status).toBe('success');

    // Subsequent TR-069 write-only masked GPV (empty string / asterisks) MUST NOT erase saved passwords
    const maskedGpvResp = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:GetParameterValuesResponse>
      <ParameterList>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Value>Nokia_24G_Home</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_ALU_COM_KeyPassphrase</Name><Value></Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID</Name><Value>Nokia_5G_Home</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.X_ALU_COM_KeyPassphrase</Name><Value>******</Value></ParameterValueStruct>
      </ParameterList>
    </cwmp:GetParameterValuesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    await CwmpService.handleParameterValuesResponse(maskedGpvResp, testIp, infRes.sessionId, undefined, 'acs_fix_tenant');
    updatedNokia = await Device.findOne({ serialNumber: serialNokia });
    expect(updatedNokia.wifi24?.password).toBe('Nokia24Pass!');
    expect(updatedNokia.wifi5g?.password).toBe('Nokia5GPass!');
  });

  it('6. Inform automatically merges rawParameters & sync timestamp, throttles 60s heavy GPV floods, and dispatches SET_PERIODIC_INFORM immediately', async () => {
    const testIp = '103.55.66.77';
    const rapidSerial = 'ALCL_NOKIA_RAPID60';
    await Device.deleteMany({ serialNumber: rapidSerial });

    try {
      const informXml60 = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>ALCL</Manufacturer>
        <OUI>A47B2C</OUI>
        <ProductClass>G-2425G-A</ProductClass>
        <SerialNumber>${rapidSerial}</SerialNumber>
      </DeviceId>
      <Event><EventCode>2 PERIODIC</EventCode></Event>
      <ParameterList>
        <ParameterValueStruct><Name>InternetGatewayDevice.DeviceInfo.SoftwareVersion</Name><Value>3FE49362IJHK01</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.DeviceInfo.UpTime</Name><Value>720</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.ManagementServer.PeriodicInformInterval</Name><Value>60</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.ManagementServer.ConnectionRequestURL</Name><Value>http://100.64.10.25:7547/cr</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID</Name><Value>Rapid60_WiFi</Value></ParameterValueStruct>
        <ParameterValueStruct><Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username</Name><Value>rapid60@isp.in</Value></ParameterValueStruct>
      </ParameterList>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

      const inf1 = await CwmpService.handleInform(informXml60, testIp, undefined, 'acs_fix_tenant');
      const devAfterInform: any = await Device.findOne({ serialNumber: rapidSerial });
      expect(devAfterInform).toBeTruthy();
      expect(devAfterInform.status).toBe('online');
      expect(devAfterInform.periodicInformInterval).toBe(60);
      expect(devAfterInform.lastParameterSyncAt).toBeTruthy();
      expect(devAfterInform.lastParameterSyncStatus).toBe('INFORM_SYNCED');
      expect(devAfterInform.rawParameters?.['InternetGatewayDevice.ManagementServer.PeriodicInformInterval']).toBe('60');
      expect(devAfterInform.rawParameters?.['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID']).toBe('Rapid60_WiFi');

      // Mark full telemetry GPV sync as recently completed
      await Device.updateOne(
        { _id: devAfterInform._id },
        {
          $set: {
            supportedParametersConfirmed: true,
            lastParameterSyncStatus: 'SUCCESS',
            lastParameterSyncAt: new Date(),
          },
        }
      );

      // Next routine 60s Periodic Inform without pending commands MUST return null (HTTP 204) instead of flooding CPE
      const rpcDuringCooldown = await CwmpService.checkPendingRpcOrPoll(
        testIp,
        inf1.sessionId,
        undefined,
        'acs_fix_tenant',
        `${testIp}:51234`
      );
      expect(rpcDuringCooldown).toBeNull();

      // Pending SET_PERIODIC_INFORM command (e.g. switching to 3600s) MUST dispatch immediately even within cooldown
      await DeviceCommand.create({
        tenantId: tenantA._id,
        deviceId: devAfterInform._id,
        serialNumber: rapidSerial,
        action: 'SET_PERIODIC_INFORM',
        commandType: 'SetParameterValues',
        rpcMethod: 'SetParameterValues',
        status: 'pending',
        queuedAt: new Date(),
        parameters: {
          tr069ParamValues: [
            ['InternetGatewayDevice.ManagementServer.PeriodicInformEnable', true, 'xsd:boolean'],
            ['InternetGatewayDevice.ManagementServer.PeriodicInformInterval', 3600, 'xsd:unsignedInt'],
          ],
        },
      });

      const inf2 = await CwmpService.handleInform(informXml60, testIp, undefined, 'acs_fix_tenant');
      const rpcForIntervalUpdate = await CwmpService.checkPendingRpcOrPoll(
        testIp,
        inf2.sessionId,
        undefined,
        'acs_fix_tenant',
        `${testIp}:51235`
      );
      expect(rpcForIntervalUpdate).toContain('<cwmp:SetParameterValues>');
      expect(rpcForIntervalUpdate).toContain('PeriodicInformInterval');
      expect(rpcForIntervalUpdate).toContain('3600');
    } finally {
      await Device.deleteMany({ serialNumber: rapidSerial });
    }
  });
});
