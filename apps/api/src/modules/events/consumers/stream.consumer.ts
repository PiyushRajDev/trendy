import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { CacheService } from '../../cache/services/cache.service';

const STREAM_KEY  = 'stream:events';
const GROUP_NAME  = 'recommendations';
const CONSUMER_ID = 'consumer-1';

const EVENT_WEIGHTS: Record<string, number> = {
  product_view:  1,
  product_click: 2,
  add_to_cart:   5,
  purchase:      10,
};

// Metric key suffixes — must match RecommendationService.flushMetrics key names
const METRIC_KEYS: Record<string, string> = {
  product_view:  'product_views',
  product_click: 'product_clicks',
  add_to_cart:   'add_to_carts',
  purchase:      'purchases',
};

@Injectable()
export class StreamConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumer.name);
  private running = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit() {
    await this.createGroup();
    this.running = true;
    this.consume().catch((e) => this.logger.error('Consumer crashed', e));
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async createGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
    } catch (e: any) {
      if (!e.message?.includes('BUSYGROUP')) throw e;
    }
  }

  private async consume(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.redis.xreadgroup(
          'GROUP', GROUP_NAME, CONSUMER_ID,
          'COUNT', '50',
          'BLOCK', '2000',
          'STREAMS', STREAM_KEY, '>',
        ) as any;

        if (!result) continue;

        for (const [, entries] of result) {
          for (const [msgId, fields] of entries) {
            try {
              await this.processEvent(this.parseFields(fields));
              await this.redis.xack(STREAM_KEY, GROUP_NAME, msgId);
            } catch (e) {
              this.logger.error(`Failed to process event ${msgId}: ${e}`);
              // Leave in PEL for retry — do NOT ack
            }
          }
        }
      } catch (e) {
        if (this.running) {
          this.logger.error('XREADGROUP error, retrying in 2s', e);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }

  private parseFields(fields: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
    return obj;
  }

  private async processEvent(event: Record<string, string>): Promise<void> {
    const { user_id, product_id, event_type } = event;
    const weight = EVENT_WEIGHTS[event_type] ?? 0;
    if (!weight || !product_id) return;

    const metricKey = METRIC_KEYS[event_type];
    await this.cache.incrByFloat(`v1:metrics:${metricKey}:${product_id}`, weight);
    await this.cache.sAdd('v1:metrics:dirty-products', product_id);

    await this.cache.zIncrBy('v1:trending:products', weight, product_id);
    await this.cache.expire('v1:trending:products', 900);

    await this.cache.del(`v1:user:${user_id}:recs`);

    if (event_type === 'product_view') {
      await this.cache.lPush(`v1:user:${user_id}:recent`, product_id);
      await this.cache.lTrim(`v1:user:${user_id}:recent`, 0, 19);
      await this.cache.expire(`v1:user:${user_id}:recent`, 604800);
    }
  }
}
