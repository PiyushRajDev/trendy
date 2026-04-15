import { Test } from '@nestjs/testing';
import { EventService } from './event.service';
import { StreamProducer } from '../producers/stream.producer';
import { EventPublisher } from '../publishers/event.publisher';
import { CacheService } from '../../cache/services/cache.service';

describe('EventService', () => {
  let service: EventService;
  let cache: jest.Mocked<CacheService>;
  let producer: jest.Mocked<StreamProducer>;
  let publisher: jest.Mocked<EventPublisher>;

  const dto = {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    user_id: 'user-1',
    product_id: '550e8400-e29b-41d4-a716-446655440001',
    event_type: 'product_view',
    timestamp: new Date().toISOString(),
    metadata: { source: 'search' },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: StreamProducer, useValue: { publish: jest.fn() } },
        { provide: EventPublisher, useValue: { emit: jest.fn() } },
        { provide: CacheService, useValue: { setNX: jest.fn() } },
      ],
    }).compile();

    service = module.get(EventService);
    cache = module.get(CacheService);
    producer = module.get(StreamProducer);
    publisher = module.get(EventPublisher);
  });

  it('tracks new event — publishes to stream and emits locally', async () => {
    cache.setNX.mockResolvedValue(true);
    await service.track(dto as any);
    expect(producer.publish).toHaveBeenCalledWith(dto);
    expect(publisher.emit).toHaveBeenCalledWith(dto);
  });

  it('silently drops duplicate event', async () => {
    cache.setNX.mockResolvedValue(false);
    await service.track(dto as any);
    expect(producer.publish).not.toHaveBeenCalled();
    expect(publisher.emit).not.toHaveBeenCalled();
  });
});
