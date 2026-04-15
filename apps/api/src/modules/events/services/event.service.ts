import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/services/cache.service';
import { StreamProducer } from '../producers/stream.producer';
import { EventPublisher } from '../publishers/event.publisher';
import { TrackEventDto } from '../dto/track-event.dto';

const DEDUP_TTL = 86400; // 24h

@Injectable()
export class EventService {
  constructor(
    private readonly cache: CacheService,
    private readonly producer: StreamProducer,
    private readonly publisher: EventPublisher,
  ) {}

  async track(dto: TrackEventDto): Promise<void> {
    const dedupKey = `v1:event-dedup:${dto.event_id}`;
    const isNew = await this.cache.setNX(dedupKey, '1', DEDUP_TTL);
    if (!isNew) return;

    await this.producer.publish(dto);
    this.publisher.emit(dto);
  }
}
