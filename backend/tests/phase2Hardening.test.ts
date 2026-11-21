import { describe, it, expect, beforeEach } from 'vitest';
import { RedisService } from '../src/services/redisService.js';
import { CwmpXmlParser, escapeXml } from '../src/services/cwmpXmlParser.js';

describe('Phase 2 Architecture & Hardening Test Suite', () => {
  beforeEach(() => {
    // Clean up
  });

  describe('RedisService & Distributed Session Cache', () => {
    it('should store and retrieve session objects accurately', async () => {
      const sessionData = {
        sessionId: 'test-session-123',
        serialNumber: 'ALCL12345678',
        vendor: 'NOKIA',
        stage: 'INFORM_ACKED',
        timestamp: Date.now(),
      };

      await RedisService.set('cwmp:session:test-session-123', sessionData, 10);
      const retrieved = await RedisService.get<typeof sessionData>('cwmp:session:test-session-123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.serialNumber).toBe('ALCL12345678');
      expect(retrieved?.stage).toBe('INFORM_ACKED');
    });

    it('should handle deletion cleanly', async () => {
      await RedisService.set('cwmp:session:to-delete', { foo: 'bar' }, 10);
      await RedisService.del('cwmp:session:to-delete');
      const retrieved = await RedisService.get('cwmp:session:to-delete');
      expect(retrieved).toBeNull();
    });
  });

  describe('CwmpXmlParser (fast-xml-parser Streaming Engine)', () => {
    it('should escape XML entities to prevent injection', () => {
      const dangerous = '<script>alert("xss")</script> & "quotes" \'single\'';
      const escaped = escapeXml(dangerous);
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot; &apos;single&apos;');
    });

    it('should parse TR-069 ParameterValueStruct fast and accurately', () => {
      const sampleSoapXml = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
          <soapenv:Body>
            <cwmp:Inform>
              <DeviceId>
                <Manufacturer>Genexis</Manufacturer>
                <OUI>002207</OUI>
                <ProductClass>Platinum-4410</ProductClass>
                <SerialNumber>GNX123456</SerialNumber>
              </DeviceId>
              <ParameterList soapenc:arrayType="cwmp:ParameterValueStruct[3]">
                <ParameterValueStruct>
                  <Name>InternetGatewayDevice.DeviceInfo.SoftwareVersion</Name>
                  <Value xsi:type="xsd:string">V2.1.0</Value>
                </ParameterValueStruct>
                <ParameterValueStruct>
                  <Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress</Name>
                  <Value xsi:type="xsd:string">100.64.12.34</Value>
                </ParameterValueStruct>
                <ParameterValueStruct>
                  <Name>InternetGatewayDevice.ManagementServer.ConnectionRequestURL</Name>
                  <Value xsi:type="xsd:string">http://100.64.12.34:7547/cr</Value>
                </ParameterValueStruct>
              </ParameterList>
            </cwmp:Inform>
          </soapenv:Body>
        </soapenv:Envelope>
      `;

      const result = CwmpXmlParser.extractParameterMap(sampleSoapXml);
      expect(result.parameters.get('InternetGatewayDevice.DeviceInfo.SoftwareVersion')).toBe('V2.1.0');
      expect(result.parameters.get('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress')).toBe('100.64.12.34');
      expect(result.parameters.get('InternetGatewayDevice.ManagementServer.ConnectionRequestURL')).toBe('http://100.64.12.34:7547/cr');
    });

    it('should extract tag values accurately', () => {
      const xml = '<DeviceId><SerialNumber>ZTEGC123456</SerialNumber></DeviceId>';
      expect(CwmpXmlParser.extractTag(xml, 'SerialNumber')).toBe('ZTEGC123456');
    });

    it('should generate serial number aliases for GPON ONT formats', () => {
      const aliases = CwmpXmlParser.getSerialNumberAliases('HWTC12345678');
      expect(aliases).toContain('HWTC12345678');
      expect(aliases).toContain('hwtc12345678');
    });
  });
});
