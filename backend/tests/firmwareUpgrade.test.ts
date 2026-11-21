import { describe, it, expect } from 'vitest';
import { CwmpXmlParser, escapeXml } from '../src/services/cwmpXmlParser.js';

describe('Phase 3: TR-069 Firmware Upgrade & Lifecycle Test Suite', () => {
  describe('TR-069 <cwmp:Download> XML Generation & Escaping', () => {
    it('should generate valid Download SOAP XML with escaped parameters', () => {
      const commandKey = 'FW-UPG-TEST-001';
      const fileType = '1 Firmware Upgrade Image';
      const firmwareUrl = 'http://10.0.0.1:7547/firmware/download/64bf1234?token=abc&v=1';
      const fileSize = 15728640;
      const fileName = 'firmware_v2.1.bin';

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

      expect(downloadXml).toContain('<CommandKey>FW-UPG-TEST-001</CommandKey>');
      expect(downloadXml).toContain('&amp;v=1');
      expect(downloadXml).toContain('<FileSize>15728640</FileSize>');
      expect(downloadXml).toContain('<FileType>1 Firmware Upgrade Image</FileType>');
    });
  });

  describe('CwmpXmlParser DownloadResponse & TransferComplete Parsing', () => {
    it('should parse DownloadResponse with Status code correctly', () => {
      const downloadResponseXml = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
          <soapenv:Header>
            <cwmp:ID soapenv:mustUnderstand="1">6</cwmp:ID>
          </soapenv:Header>
          <soapenv:Body>
            <cwmp:DownloadResponse>
              <Status>1</Status>
              <StartTime>2026-11-14T17:30:00Z</StartTime>
              <CompleteTime>0001-01-01T00:00:00Z</CompleteTime>
            </cwmp:DownloadResponse>
          </soapenv:Body>
        </soapenv:Envelope>
      `;

      const result = CwmpXmlParser.extractDownloadResponse(downloadResponseXml);
      expect(result.status).toBe(1);
      expect(result.startTime).toBe('2026-11-14T17:30:00Z');
    });

    it('should parse successful TransferComplete (FaultCode 0)', () => {
      const transferCompleteXml = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
          <soapenv:Header>
            <cwmp:ID soapenv:mustUnderstand="1">7</cwmp:ID>
          </soapenv:Header>
          <soapenv:Body>
            <cwmp:TransferComplete>
              <CommandKey>FW-UPG-TEST-001</CommandKey>
              <FaultStruct>
                <FaultCode>0</FaultCode>
                <FaultString></FaultString>
              </FaultStruct>
              <StartTime>2026-11-14T17:30:00Z</StartTime>
              <CompleteTime>2026-11-14T17:32:15Z</CompleteTime>
            </cwmp:TransferComplete>
          </soapenv:Body>
        </soapenv:Envelope>
      `;

      const result = CwmpXmlParser.extractTransferComplete(transferCompleteXml);
      expect(result.commandKey).toBe('FW-UPG-TEST-001');
      expect(result.faultCode).toBe(0);
      expect(result.startTime).toBe('2026-11-14T17:30:00Z');
      expect(result.completeTime).toBe('2026-11-14T17:32:15Z');
    });

    it('should parse failed TransferComplete with fault message', () => {
      const failedTransferXml = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
          <soapenv:Header>
            <cwmp:ID soapenv:mustUnderstand="1">7</cwmp:ID>
          </soapenv:Header>
          <soapenv:Body>
            <cwmp:TransferComplete>
              <CommandKey>FW-UPG-TEST-FAIL</CommandKey>
              <FaultStruct>
                <FaultCode>9010</FaultCode>
                <FaultString>Download failure: Connection timed out</FaultString>
              </FaultStruct>
              <StartTime>2026-11-14T17:30:00Z</StartTime>
              <CompleteTime>2026-11-14T17:30:45Z</CompleteTime>
            </cwmp:TransferComplete>
          </soapenv:Body>
        </soapenv:Envelope>
      `;

      const result = CwmpXmlParser.extractTransferComplete(failedTransferXml);
      expect(result.commandKey).toBe('FW-UPG-TEST-FAIL');
      expect(result.faultCode).toBe(9010);
      expect(result.faultString).toContain('Connection timed out');
    });
  });
});
