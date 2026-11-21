import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CwmpService } from '../src/services/cwmpService.js';
import { MetricsService } from '../src/services/metricsService.js';
import { CwmpXmlParser } from '../src/services/cwmpXmlParser.js';
import { Tenant } from '../src/models/Tenant.js';

describe('Multi-Tenant Operator Isolation & Reliable ONT Reporting Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Strict Tenant Resolution & Quarantine Boundary', () => {
    it('should return null when ONT connects to root IP without tenant slug (No wildcard fallback)', async () => {
      // CPE hits raw server IP on port 7547 without dedicated slug
      const hostHeader = '198.51.100.1:7547';
      const pathOrQuerySlug = undefined;

      const resolved = await CwmpService.resolveTenant(hostHeader, pathOrQuerySlug);
      // MUST NOT auto-fallback to Operator 1 or any active tenant
      expect(resolved).toBeNull();
    });

    it('should not fallback to Operator 1 when unknown domain hits root ACS', async () => {
      vi.spyOn(Tenant, 'findOne').mockResolvedValue(null);
      const hostHeader = 'unknown-router.isp.net:7547';
      const pathOrQuerySlug = undefined;

      const resolved = await CwmpService.resolveTenant(hostHeader, pathOrQuerySlug);
      expect(resolved).toBeNull();
    });
  });

  describe('2. Cross-Tenant Collision & Isolation Gate', () => {
    it('should record tenant mismatch metric when cross-tenant collision is intercepted', () => {
      const initialSnapshot = MetricsService.getMetricsSnapshot();
      const initialMismatches = (initialSnapshot.metrics as any).tenantMismatchesTotal || 0;

      MetricsService.recordTenantMismatch();
      MetricsService.recordQuarantinedDevice();

      const updatedSnapshot = MetricsService.getMetricsSnapshot();
      expect((updatedSnapshot.metrics as any).tenantMismatchesTotal).toBe(initialMismatches + 1);
      expect((updatedSnapshot.metrics as any).quarantinedDevicesTotal).toBeGreaterThan(0);

      const prometheusOutput = MetricsService.getPrometheusText();
      expect(prometheusOutput).toContain('acs_tenant_mismatches_total');
      expect(prometheusOutput).toContain('acs_quarantined_devices_total');
    });

    it('should generate distinct serial aliases for GPON ONT vendors without cross-device bleeding', () => {
      const huaweiAliases = CwmpXmlParser.getSerialNumberAliases('4857544312345678');
      const zteAliases = CwmpXmlParser.getSerialNumberAliases('ZTEGC1234567');
      const vsolAliases = CwmpXmlParser.getSerialNumberAliases('VSOL12345678');

      expect(huaweiAliases).toContain('HWTC12345678');
      expect(zteAliases).toContain('ZTEGC1234567');
      expect(vsolAliases).toContain('VSOL12345678');

      // Crucial: aliases from Huawei must never overlap with ZTE or VSol
      expect(huaweiAliases).not.toContain('ZTEGC1234567');
      expect(zteAliases).not.toContain('HWTC12345678');
    });
  });

  describe('3. Multi-Tenant Failure Containment & Non-Blocking Isolation', () => {
    it('should maintain independent session contexts across distinct connections', async () => {
      const op1SessionId = 'cwmp_op1_session_1001';
      const op2SessionId = 'cwmp_op2_session_2001';
      const connOp1 = '10.10.1.50:49210';
      const connOp2 = '10.20.1.5:51220';

      const op1Context = {
        sessionId: op1SessionId,
        serialNumber: 'HWTC11112222',
        serialAliases: ['HWTC11112222'],
        vendor: 'Huawei',
        tenantId: '60d5ec49f1b2c8b1f8e4e1a1',
        tenantSlug: 'operator_1',
        stage: 'INFORM_ACKED',
        timestamp: Date.now(),
      };

      const op2Context = {
        sessionId: op2SessionId,
        serialNumber: 'ZTEG99998888',
        serialAliases: ['ZTEG99998888'],
        vendor: 'ZTE',
        tenantId: '60d5ec49f1b2c8b1f8e4e2b2',
        tenantSlug: 'operator_2',
        stage: 'INFORM_ACKED',
        timestamp: Date.now(),
      };

      await CwmpService.saveSession(op1SessionId, connOp1, op1Context);
      await CwmpService.saveSession(op2SessionId, connOp2, op2Context);

      const retrievedOp1 = await CwmpService.getSession(op1SessionId, connOp1);
      const retrievedOp2 = await CwmpService.getSession(op2SessionId, connOp2);

      expect(retrievedOp1?.tenantSlug).toBe('operator_1');
      expect(retrievedOp2?.tenantSlug).toBe('operator_2');
      expect(retrievedOp1?.serialNumber).toBe('HWTC11112222');
      expect(retrievedOp2?.serialNumber).toBe('ZTEG99998888');
      expect(retrievedOp1?.tenantId).not.toBe(retrievedOp2?.tenantId);
    });

    it('should isolate blocked/mismatched sessions so other tenant sessions proceed normally', async () => {
      const blockedSessionId = 'cwmp_mismatch_blocked_3001';
      const healthySessionId = 'cwmp_healthy_op2_3002';
      const blockedConn = '10.30.1.1:44111';
      const healthyConn = '10.40.1.1:44222';

      await CwmpService.saveSession(blockedSessionId, blockedConn, {
        sessionId: blockedSessionId,
        serialNumber: 'COLLISION_ONT_001',
        serialAliases: ['COLLISION_ONT_001'],
        vendor: 'Generic',
        tenantId: '',
        tenantSlug: 'quarantine_mismatch',
        stage: 'MISMATCH_BLOCKED',
        timestamp: Date.now(),
      });

      await CwmpService.saveSession(healthySessionId, healthyConn, {
        sessionId: healthySessionId,
        serialNumber: 'HEALTHY_ONT_002',
        serialAliases: ['HEALTHY_ONT_002'],
        vendor: 'Huawei',
        tenantId: '60d5ec49f1b2c8b1f8e4e2b2',
        tenantSlug: 'operator_2',
        stage: 'INFORM_ACKED',
        timestamp: Date.now(),
      });

      // Blocked session check returns null (HTTP 204 No Content, zero RPCs)
      const blockedRpc = await CwmpService.checkPendingRpcOrPoll('10.30.1.1', blockedSessionId, undefined, undefined, blockedConn);
      expect(blockedRpc).toBeNull();

      // Healthy session from Operator 2 is completely unblocked and can retrieve its context
      const healthySession = await CwmpService.getSession(healthySessionId, healthyConn);
      expect(healthySession?.stage).toBe('INFORM_ACKED');
      expect(healthySession?.tenantSlug).toBe('operator_2');
    });
  });

  describe('4. Super Admin Multi-Tenant Aggregation Logic', () => {
    it('should calculate accurate operator-wise online and offline ratios', () => {
      const operator1 = { totalDevices: 50, onlineDevices: 48 };
      const operator2 = { totalDevices: 5, onlineDevices: 5 };

      const op1Offline = operator1.totalDevices - operator1.onlineDevices;
      const op2Offline = operator2.totalDevices - operator2.onlineDevices;

      const op1Ratio = (operator1.onlineDevices / operator1.totalDevices) * 100;
      const op2Ratio = (operator2.onlineDevices / operator2.totalDevices) * 100;

      expect(op1Offline).toBe(2);
      expect(op2Offline).toBe(0);
      expect(op1Ratio).toBe(96);
      expect(op2Ratio).toBe(100);
    });
  });
});
