import { Controller, Get, Param } from '@nestjs/common';
import { RecommendationService } from '../services/recommendation.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recService: RecommendationService) {}

  @Get('trending')
  trending() {
    return this.recService.getTrending(20);
  }

  @Get(':userId')
  forUser(@Param('userId') userId: string) {
    return this.recService.getForUser(userId);
  }
}
