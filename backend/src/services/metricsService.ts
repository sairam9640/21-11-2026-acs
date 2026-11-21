import { CircuitBreakerRegistry } from './circuitBreaker.js';
import { EventBusService } from './eventBusService.js';

export class MetricsService {
  private static httpRequestsTotal = 0;
  private static httpErrorsTotal = 0;
  private static telemetryIngestedTotal = 0;
  private static commandsQueuedTotal = 0;
  private static commandsExecutedTotal = 0;
  private static aiInquiriesTotal = 0;
  private static notificationDispatchesTotal = 0;
  private static cwmpInformsTotal = 0;
  private static ztpProvisionsTotal = 0;
  private static firmwareUpgradesTotal = 0;
  private static tenantMismatchesTotal = 0;
  private static quarantinedDevicesTotal = 0;

  static recordCwmpInform() {
    this.cwmpInformsTotal += 1;
  }

  static recordZtpProvision() {
    this.ztpProvisionsTotal += 1;
  }

  static recordFirmwareUpgrade() {
    this.firmwareUpgradesTotal += 1;
  }

  static recordTenantMismatch() {
    this.tenantMismatchesTotal += 1;
  }

  static recordQuarantinedDevice() {
    this.quarantinedDevicesTotal += 1;
  }

  static recordHttpRequest(status: number) {
    this.httpRequestsTotal += 1;
    if (status >= 400) this.httpErrorsTotal += 1;
  }

  static recordTelemetryIngest(count = 1) {
    this.telemetryIngestedTotal += count;
  }

  static recordCommandQueued() {
    this.commandsQueuedTotal += 1;
  }

  static recordCommandExecuted() {
    this.commandsExecutedTotal += 1;
  }

  static recordAiInquiry() {
    this.aiInquiriesTotal += 1;
  }

  static recordNotification() {
    this.notificationDispatchesTotal += 1;
  }

  /**
   * Generates a snapshot of system health and metrics
   */
  static getMetricsSnapshot() {
    const circuitBreakers = Object.values(CircuitBreakerRegistry).map((cb) => cb.getStatus());
    const dlqCount = EventBusService.getDeadLetterQueue().length;

    return {
      status: 'UP',
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
      metrics: {
        httpRequestsTotal: this.httpRequestsTotal,
        httpErrorsTotal: this.httpErrorsTotal,
        telemetryIngestedTotal: this.telemetryIngestedTotal,
        commandsQueuedTotal: this.commandsQueuedTotal,
        commandsExecutedTotal: this.commandsExecutedTotal,
        aiInquiriesTotal: this.aiInquiriesTotal,
        tenantMismatchesTotal: this.tenantMismatchesTotal,
        quarantinedDevicesTotal: this.quarantinedDevicesTotal,
        notificationDispatchesTotal: this.notificationDispatchesTotal,
        deadLetterQueueCount: dlqCount,
      },
      circuitBreakers,
    };
  }

  /**
   * Generates standard Prometheus text output
   */
  static getPrometheusText(): string {
    const mem = process.memoryUsage();
    return [
      '# HELP http_requests_total Total number of HTTP requests received',
      '# TYPE http_requests_total counter',
      `http_requests_total ${this.httpRequestsTotal}`,
      '# HELP http_errors_total Total number of HTTP 4xx/5xx errors',
      '# TYPE http_errors_total counter',
      `http_errors_total ${this.httpErrorsTotal}`,
      '# HELP acs_cwmp_informs_total Total TR-069 Inform messages ingested from CPEs',
      '# TYPE acs_cwmp_informs_total counter',
      `acs_cwmp_informs_total ${this.cwmpInformsTotal}`,
      '# HELP acs_ztp_provisions_total Total Zero-Touch Provisioning actions dispatched',
      '# TYPE acs_ztp_provisions_total counter',
      `acs_ztp_provisions_total ${this.ztpProvisionsTotal}`,
      '# HELP acs_firmware_upgrades_total Total firmware upgrade operations executed',
      '# TYPE acs_firmware_upgrades_total counter',
      `acs_firmware_upgrades_total ${this.firmwareUpgradesTotal}`,
      '# HELP acs_tenant_mismatches_total Total cross-tenant routing mismatches detected and quarantined',
      '# TYPE acs_tenant_mismatches_total counter',
      `acs_tenant_mismatches_total ${this.tenantMismatchesTotal}`,
      '# HELP acs_quarantined_devices_total Total devices isolated in unassigned or conflicting quarantine',
      '# TYPE acs_quarantined_devices_total counter',
      `acs_quarantined_devices_total ${this.quarantinedDevicesTotal}`,
      '# HELP telemetry_samples_ingested_total Optical and device telemetry metrics ingested',
      '# TYPE telemetry_samples_ingested_total counter',
      `telemetry_samples_ingested_total ${this.telemetryIngestedTotal}`,
      '# HELP commands_queued_total Total device RPC commands enqueued',
      '# TYPE commands_queued_total counter',
      `commands_queued_total ${this.commandsQueuedTotal}`,
      '# HELP dead_letter_queue_depth Count of unprocessable messages in DLQ',
      '# TYPE dead_letter_queue_depth gauge',
      `dead_letter_queue_depth ${EventBusService.getDeadLetterQueue().length}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# HELP process_heap_used_bytes V8 heap bytes in active use',
      '# TYPE process_heap_used_bytes gauge',
      `process_heap_used_bytes ${mem.heapUsed}`,
    ].join('\n');
  }
}
