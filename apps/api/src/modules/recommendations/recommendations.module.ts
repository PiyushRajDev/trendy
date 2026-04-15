import { Module } from '@nestjs/common';
import { RecommendationService } from './services/recommendation.service';
import { RecommendationsController } from './controllers/recommendations.controller';
import { ProductModule } from '../product/product.module';

@Module({
  imports: [ProductModule],
  providers: [RecommendationService],
  controllers: [RecommendationsController],
})
export class RecommendationsModule {}
