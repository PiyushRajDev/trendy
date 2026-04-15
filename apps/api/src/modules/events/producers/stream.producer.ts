import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { TrackEventDto } from '../dto/track-event.dto';

const STREAM_KEY = 'stream:events';

@Injectable()
export class StreamProducer {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async publish(dto: TrackEventDto): Promise<void> {
    await this.redis.xadd(
      STREAM_KEY, '*',
      'event_id',   dto.event_id,
      'user_id',    dto.user_id,
      'product_id', dto.product_id,
      'event_type', dto.event_type,
      'timestamp',  dto.timestamp,
      'source',     dto.metadata.source,
    );
  }
}
