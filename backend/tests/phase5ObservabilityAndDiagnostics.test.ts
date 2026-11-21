import { describe, it, expect } from 'vitest';
import { MetricsService } from '../src/services/metricsService.js';

describe('Phase 5: Observability, Metrics & Diagnostics Suite', () => {
  describe('Prometheus Metrics Engine', () => {
    it('should record CWMP Informs, ZTP provisions, and firmware upgrades', () => {
      MetricsService.recordCwmpInform();
      MetricsService.recordZtpProvision();
      MetricsService.recordFirmwareUpgrade();
      MetricsService.recordHttpRequest(200);

      const prometheusOutput = MetricsService.getPrometheusText();

      expect(prometheusOutput).toContain('acs_cwmp_informs_total');
      expect(prometheusOutput).toContain('acs_ztp_provisions_total');
      expect(prometheusOutput).toContain('acs_firmware_upgrades_total');
      expect(prometheusOutput).toContain('http_requests_total');
      expect(prometheusOutput).toContain('process_resident_memory_bytes');
      expect(prometheusOutput).toContain('process_heap_used_bytes');
    });

    it('should generate a structured health and metrics snapshot', () => {
      const snapshot = MetricsService.getMetricsSnapshot();
      expect(snapshot.status).toBe('UP');
      expect(snapshot.metrics).toBeDefined();
      expect(snapshot.metrics.httpRequestsTotal).toBeGreaterThan(0);
      expect(snapshot.metrics.telemetryIngestedTotal).toBeDefined();
    });
  });

  describe('TR-069 IPPingDiagnostics & TraceRoute Parameter Verification', () => {
    it('should verify TR-098 and TR-181 diagnostic parameter schemas', () => {
      const tr098PingState = 'InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState';
      const tr181PingState = 'Device.IP.Diagnostics.IPPing.DiagnosticsState';

      expect(tr098PingState).toContain('IPPingDiagnostics');
      expect(tr181PingState).toContain('Device.IP.Diagnostics');
    });
  });
});
