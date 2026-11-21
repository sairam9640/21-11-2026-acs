import { Redis } from 'ioredis';

export class RedisService {
  private static client: Redis | null = null;
  private static isConnected = false;
  private static fallbackMap = new Map<string, { value: string; expiresAt: number }>();

  static init(): void {
    if (this.client) return;

    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: 2000,
        retryStrategy: (times) => {
          if (times > 5) {
            return null; // Stop retrying and stay in fallback mode
          }
          return Math.min(times * 500, 2000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('[RedisService] Connected to Redis cluster/instance successfully.');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        // Suppress noisy logs in dev mode when Redis is not running
        if (process.env.NODE_ENV !== 'production') {
          // Log once or quietly
        } else {
          console.warn('[RedisService] Redis connection error (using in-memory fallback):', err.message);
        }
      });
    } catch (err: any) {
      this.isConnected = false;
      this.client = null;
      console.warn('[RedisService] Could not initialize Redis client, falling back to memory:', err.message);
    }
  }

  static get isOnline(): boolean {
    return this.isConnected && this.client !== null;
  }

  static async set(key: string, value: any, ttlSeconds: number = 120): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (this.isOnline && this.client) {
      try {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
        return;
      } catch (err) {
        // Fall back to memory
      }
    }

    // In-Memory Fallback
    this.fallbackMap.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  static async get<T = any>(key: string): Promise<T | null> {
    if (this.isOnline && this.client) {
      try {
        const data = await this.client.get(key);
        if (!data) return null;
        try {
          return JSON.parse(data);
        } catch {
          return data as any;
        }
      } catch (err) {
        // Fall through to memory
      }
    }

    // In-Memory Fallback
    const item = this.fallbackMap.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.fallbackMap.delete(key);
      return null;
    }

    try {
      return JSON.parse(item.value);
    } catch {
      return item.value as any;
    }
  }

  static async del(key: string): Promise<void> {
    if (this.isOnline && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // ignore
      }
    }
    this.fallbackMap.delete(key);
  }
}

// Auto-initialize on import
RedisService.init();
