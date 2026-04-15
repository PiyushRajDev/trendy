import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ProductService } from './product.service';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { ProductMetrics } from '../entities/product-metrics.entity';
import { CacheService } from '../../cache/services/cache.service';

describe('ProductService', () => {
  let service: ProductService;
  let productRepo: jest.Mocked<Repository<Product>>;
  let dataSource: jest.Mocked<DataSource>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: getRepositoryToken(Product), useValue: { save: jest.fn(), findOne: jest.fn(), createQueryBuilder: jest.fn(), create: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(ProductVariant), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(ProductMetrics), useValue: { save: jest.fn() } },
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProductService);
    productRepo = module.get(getRepositoryToken(Product));
    dataSource = module.get(DataSource);
    cacheService = module.get(CacheService);
  });

  it('findById returns cached product if available', async () => {
    cacheService.get.mockResolvedValue(JSON.stringify({ id: '1', name: 'Test' }));
    const result = await service.findById('1');
    expect(result).toEqual({ id: '1', name: 'Test' });
    expect(productRepo.findOne).not.toHaveBeenCalled();
  });

  it('findById hits DB on cache miss', async () => {
    cacheService.get.mockResolvedValue(null);
    const product = { id: '1', name: 'Test', is_deleted: false } as Product;
    productRepo.findOne.mockResolvedValue(product);
    const result = await service.findById('1');
    expect(result).toEqual(product);
    expect(cacheService.set).toHaveBeenCalled();
  });

  it('findById throws NotFoundException if not found', async () => {
    cacheService.get.mockResolvedValue(null);
    productRepo.findOne.mockResolvedValue(null);
    await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('update throws ConflictException on version mismatch', async () => {
    dataSource.query.mockResolvedValue([[], 0]);
    await expect(
      service.update('1', { name: 'New', version: 1 } as any, 1)
    ).rejects.toThrow(ConflictException);
  });
});
