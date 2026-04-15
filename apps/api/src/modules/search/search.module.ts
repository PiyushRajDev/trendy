import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './services/search.service';
import { SearchController } from './controllers/search.controller';
import { ProductSyncListener } from './listeners/product-sync.listener';
import { Product } from '../product/entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [SearchService, ProductSyncListener],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
