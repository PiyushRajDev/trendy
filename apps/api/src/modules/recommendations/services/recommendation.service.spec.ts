import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RecommendationService } from './recommendation.service';
import { ProductService } from '../../product/services/product.service';
import { CacheService } from '../../cache/services/cache.service';

describe('RecommendationService', () => {
  let service: RecommendationService;
  let cache: jest.Mocked<CacheService>;
  let productService: jest.Mocked<ProductService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RecommendationService,
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn(), zRevRangeWithScores: jest.fn(), lRange: jest.fn() } },
        { provide: ProductService, useValue: { findByIds: jest.fn() } },
        { provide: DataSource, useValue: { query: jest.fn() } },
      ],
    }).compile();

    service = module.get(RecommendationService);
    cache = module.get(CacheService);
    productService = module.get(ProductService);
  });

  it('returns cached recommendations', async () => {
    cache.get.mockResolvedValue(JSON.stringify([{ id: '1' }]));
    const result = await service.getForUser('user-1');
    expect(result).toEqual([{ id: '1' }]);
    expect(cache.zRevRangeWithScores).not.toHaveBeenCalled();
  });

  it('returns trending for cold-start user (no recent history)', async () => {
    cache.get.mockResolvedValue(null);
    cache.lRange.mockResolvedValue([]);               // no recent views
    cache.zRevRangeWithScores.mockResolvedValue(['prod-1', '100', 'prod-2', '80']);
    productService.findByIds.mockResolvedValue([{ id: 'prod-1' } as any, { id: 'prod-2' } as any]);
    const result = await service.getForUser('new-user');
    expect(result).toHaveLength(2);
  });
});
