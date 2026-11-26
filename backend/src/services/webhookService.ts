import crypto from 'crypto';
import { EventBusService } from './eventBusService.js';

export interface WebhookPayload {
  eventId: string;
  provider: 'WHATSAPP' | 'STRIPE' | 'RAZORPAY';
  eventType: string;
  timestamp: string;
  tenantId?: string;
  data: Record<string, any>;
}

export class WebhookService {
  private static processedEventIds: Set<string> = new Set();

  /**
   * Securely resolves provider webhook secret, strictly requiring it in production
   */
  static getProviderSecret(provider: 'WHATSAPP' | 'STRIPE' | 'RAZORPAY'): string {
    const envKey = `${provider}_WEBHOOK_SECRET`;
    const secret = (process.env[envKey] || '').trim();
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`FATAL: Mandatory security secret ${envKey} must be set in production! Webhook verification blocked.`);
      }
      // Isolated test suite mock secret (only permitted in non-production/test environments)
      return `whsec_${provider.toLowerCase()}_master_secret_2026`;
    }
    return secret;
  }

  /**
   * Validates HMAC-SHA256 signature against provider secret
   */
  static validateSignature(provider: 'WHATSAPP' | 'STRIPE' | 'RAZORPAY', rawPayload: string, signature: string): boolean {
    const secret = this.getProviderSecret(provider);
    if (!secret) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawPayload)
      .digest('hex');

    // Safe timing-safe comparison
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return signature === expectedSignature;
    }
  }

  /**
   * Processes inbound webhook with idempotency check
   */
  static async processWebhook(payload: WebhookPayload): Promise<{ status: 'PROCESSED' | 'DUPLICATE_SKIPPED'; eventId: string }> {
    // 1. Idempotency Check
    if (this.processedEventIds.has(payload.eventId)) {
      return { status: 'DUPLICATE_SKIPPED', eventId: payload.eventId };
    }

    // 2. Mark event ID as processed
    this.processedEventIds.add(payload.eventId);
    if (this.processedEventIds.size > 5000) {
      const firstItem = this.processedEventIds.values().next().value;
      if (firstItem) this.processedEventIds.delete(firstItem);
    }

    // 3. Publish to typed Event Bus for downstream domain consumption
    if (payload.provider === 'WHATSAPP') {
      await EventBusService.publish({
        eventType: 'TicketCreated',
        tenantId: payload.tenantId || 'global',
        correlationId: payload.eventId,
        payload: {
          source: 'WHATSAPP_INBOUND',
          from: payload.data.from,
          messageText: payload.data.text,
        },
      });
    }

    return { status: 'PROCESSED', eventId: payload.eventId };
  }
}
