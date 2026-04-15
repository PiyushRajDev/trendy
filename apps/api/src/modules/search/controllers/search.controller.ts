import { Controller, Get, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchService } from '../services/search.service';
import { SearchQueryDto } from '../dto/search-query.dto';
import { Product } from '../../product/entities/product.entity';

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
  ) {}

  @Get()
  search(@Query() dto: SearchQueryDto) {
    return this.searchService.search(dto);
  }

  @Post('reindex')
  async reindex() {
    const products = await this.productRepo.find({ where: { is_deleted: false }, relations: ['variants'] });
    await this.searchService.reindexAll(products);
    return { reindexed: products.length };
  }
}
