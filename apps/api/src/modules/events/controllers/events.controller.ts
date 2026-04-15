import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EventService } from '../services/event.service';
import { TrackEventDto } from '../dto/track-event.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly eventService: EventService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  track(@Body() dto: TrackEventDto) {
    return this.eventService.track(dto);
  }
}
