import {
  Injectable, NotFoundException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { ProductMetrics } from '../entities/product-metrics.entity';
import { CacheService } from '../../cache/services/cache.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ListProductsDto } from '../dto/list-products.dto';

const PRODUCT_TTL = 3600;

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(ProductMetrics) private readonly metricsRepo: Repository<ProductMetrics>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateProductDto): Promise<Product> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const product = manager.create(Product, {
        name: dto.name,
        brand: dto.brand,
        category: dto.category,
        tags: dto.tags ?? [],
        image_url: dto.image_url ?? null,
      });
      const savedProduct = await manager.save(Product, product);

      if (dto.variants?.length) {
        const variants = dto.variants.map((v) =>
          manager.create(ProductVariant, { ...v, product: { id: savedProduct.id } }),
        );
        await manager.save(ProductVariant, variants);
      }

      await manager.save(ProductMetrics, { product_id: savedProduct.id });
      return savedProduct;
    });

    const created = await this.findById(saved.id);
    this.eventEmitter.emit('product.created', created);
    return created;
  }

  async findById(id: string): Promise<Product> {
    const cacheKey = `v1:product:${id}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return JSON.parse(cached) as Product;

    const product = await this.productRepo.findOne({
      where: { id, is_deleted: false },
      relations: ['variants'],
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    await this.cache.set(cacheKey, JSON.stringify(product), PRODUCT_TTL);
    return product;
  }

  async findByIds(ids: string[]): Promise<Product[]> {
    if (!ids.length) return [];
    return this.productRepo.find({
      where: { id: In(ids), is_deleted: false },
      relations: ['variants'],
    });
  }

  async findAll(dto: ListProductsDto): Promise<{ items: Product[]; total: number; nextCursor: string | null }> {
    const { limit = 20, cursor, category, brand } = dto;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .where('p.is_deleted = false')
      .orderBy('p.id', 'ASC')
      .take(limit + 1);

    if (category) qb.andWhere('p.category = :category', { category });
    if (brand) qb.andWhere('p.brand = :brand', { brand });
    if (cursor) qb.andWhere('p.id > :cursor', { cursor });

    const countQb = this.productRepo.createQueryBuilder('p').where('p.is_deleted = false');
    if (category) countQb.andWhere('p.category = :category', { category });
    if (brand) countQb.andWhere('p.brand = :brand', { brand });

    const [items, total] = await Promise.all([qb.getMany(), countQb.getCount()]);

    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, total, nextCursor };
  }

  async update(id: string, dto: UpdateProductDto, expectedVersion: number): Promise<Product> {
    const result = await this.dataSource.query(
      `UPDATE products
       SET name=$1, brand=$2, category=$3, tags=$4, image_url=$5,
           version=version+1, updated_at=NOW()
       WHERE id=$6 AND version=$7 AND is_deleted=false
       RETURNING *`,
      [
        dto.name, dto.brand, dto.category,
        dto.tags ?? [], dto.image_url ?? null,
        id, expectedVersion,
      ],
    );
    if (!result[0]?.length) {
      throw new ConflictException('Version mismatch — concurrent update detected');
    }

    await this.cache.del(`v1:product:${id}`);
    const updated = await this.findById(id);
    this.eventEmitter.emit('product.updated', updated);
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    const result = await this.dataSource.query(
      'UPDATE products SET is_deleted=true, updated_at=NOW() WHERE id=$1 AND is_deleted=false RETURNING id',
      [id],
    );
    if (!result[0]?.length) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    await this.cache.del(`v1:product:${id}`);
    this.eventEmitter.emit('product.deleted', { id });
  }
}
