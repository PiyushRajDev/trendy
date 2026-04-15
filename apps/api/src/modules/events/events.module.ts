import { Module } from '@nestjs/common';
import { EventService } from './services/event.service';
import { EventsController } from './controllers/events.controller';
import { StreamProducer } from './producers/stream.producer';
import { EventPublisher } from './publishers/event.publisher';
import { StreamConsumer } from './consumers/stream.consumer';

@Module({
  providers: [EventService, StreamProducer, EventPublisher, StreamConsumer],
  controllers: [EventsController],
})
export class EventsModule {}
