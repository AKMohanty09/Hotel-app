import crypto from 'node:crypto';
import type { OrderChannel } from '../src/types/domain.ts';

export interface ExternalOrderWebhookPayload {
  externalOrderId: string;
  outletId?: string;
  customerAlias?: string;
  items: {
    menuItemId?: string;
    code?: string;
    name?: string;
    quantity: number;
    instructions?: string;
  }[];
  packagingNotes?: string;
  platformFee?: number;
  expectedPickupMinutes?: number;
}

export interface DeliveryPlatformAdapter {
  platform: 'swiggy' | 'zomato' | 'direct_online';
  verifySignature(rawBody: string, signatureHeader: string | undefined, secret: string | undefined): boolean;
  normalizePayload(body: unknown): ExternalOrderWebhookPayload;
  buildStatusSyncNote(externalOrderId: string, newStatus: string, isConnected: boolean): string;
}

function makeAdapter(platform: 'swiggy' | 'zomato' | 'direct_online'): DeliveryPlatformAdapter {
  return {
    platform,
    verifySignature(rawBody, signatureHeader, secret) {
      if (!secret) {
        // Without partner secret configured, only explicit sandbox/test invocations are accepted
        return false;
      }
      if (!signatureHeader) return false;
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const provided = signatureHeader.replace(/^sha256=/, '');
      if (expected.length !== provided.length) return false;
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    },
    normalizePayload(body: unknown): ExternalOrderWebhookPayload {
      const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      const externalOrderId = String(payload.externalOrderId || payload.order_id || `${platform.toUpperCase()}-${Date.now().toString().slice(-6)}`);
      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      return {
        externalOrderId,
        outletId: payload.outletId ? String(payload.outletId) : undefined,
        customerAlias: payload.customerAlias ? String(payload.customerAlias) : undefined,
        items: rawItems.map((entry) => {
          const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
          return {
            menuItemId: item.menuItemId ? String(item.menuItemId) : undefined,
            code: item.code ? String(item.code) : undefined,
            name: item.name ? String(item.name) : undefined,
            quantity: Math.max(1, Math.min(50, Math.floor(Number(item.quantity || 1)))),
            instructions: item.instructions ? String(item.instructions) : undefined,
          };
        }),
        packagingNotes: payload.packagingNotes ? String(payload.packagingNotes) : 'Standard tamper-evident delivery seal',
        platformFee: Number.isFinite(Number(payload.platformFee)) ? Number(payload.platformFee) : 0,
        expectedPickupMinutes: Number.isFinite(Number(payload.expectedPickupMinutes))
          ? Number(payload.expectedPickupMinutes)
          : 22,
      };
    },
    buildStatusSyncNote(externalOrderId, newStatus, isConnected) {
      if (!isConnected) {
        return `Status "${newStatus}" saved locally for ${externalOrderId}. Outbound partner API sync requires live partner credentials.`;
      }
      return `Status "${newStatus}" queued for outbound ${platform} partner sync on ${externalOrderId}.`;
    },
  };
}

export const integrationAdapters: Record<'swiggy' | 'zomato' | 'direct_online', DeliveryPlatformAdapter> = {
  swiggy: makeAdapter('swiggy'),
  zomato: makeAdapter('zomato'),
  direct_online: makeAdapter('direct_online'),
};

export function isOnlineChannel(channel: OrderChannel): boolean {
  return channel === 'swiggy' || channel === 'zomato' || channel === 'direct_online' || channel === 'takeaway';
}
