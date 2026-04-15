import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TrackEventDto } from '../dto/track-event.dto';

@Injectable()
export class EventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  emit(dto: TrackEventDto): void {
    this.emitter.emit(`user.${dto.event_type}`, dto);
  }
}
