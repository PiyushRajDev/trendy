import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '../../cache/services/cache.service';
import { ProductService } from '../../product/services/product.service';

const RECS_TTL = 300;   // 5 min

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly productService: ProductService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getForUser(userId: string): Promise<any[]> {
    const cacheKey = `v1:user:${userId}:recs`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const recentIds = await this.cache.lRange(`v1:user:${userId}:recent`, 0, 19);
    const trending  = await this.getTrendingRaw(50);

    const scored = trending.map(({ id, score }) => ({
      id,
      score: recentIds.includes(id) ? score * 1.2 : score,   // personalization boost
    }));
    scored.sort((a, b) => b.score - a.score);

    const topIds   = scored.slice(0, 10).map((p) => p.id);
    const products = await this.productService.findByIds(topIds);

    // Preserve score-sorted order (findByIds does not guarantee input order)
    const idIndex = new Map(topIds.map((id, i) => [id, i]));
    products.sort((a, b) => (idIndex.get(a.id) ?? 999) - (idIndex.get(b.id) ?? 999));

    await this.cache.set(cacheKey, JSON.stringify(products), RECS_TTL);
    return products;
  }

  async getTrending(limit = 10): Promise<any[]> {
    const raw = await this.getTrendingRaw(limit);
    return this.productService.findByIds(raw.map((r) => r.id));
  }

  private async getTrendingRaw(limit: number): Promise<Array<{ id: string; score: number }>> {
    const raw = await this.cache.zRevRangeWithScores('v1:trending:products', 0, limit - 1);
    const result: Array<{ id: string; score: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ id: raw[i], score: parseFloat(raw[i + 1]) });
    }
    return result;
  }

  // Batch flush Redis metric counters → Postgres every 30s
  @Cron('*/30 * * * * *')
  async flushMetrics(): Promise<void> {
    const productIds = await this.cache.sMembers('v1:metrics:dirty-products');
    if (!productIds.length) return;

    const processed: string[] = [];
    for (const productId of productIds) {
      const views     = parseFloat(await this.cache.getDel(`v1:metrics:product_views:${productId}`) ?? '0');
      const clicks    = parseFloat(await this.cache.getDel(`v1:metrics:product_clicks:${productId}`) ?? '0');
      const cartAdds  = parseFloat(await this.cache.getDel(`v1:metrics:add_to_carts:${productId}`) ?? '0');
      const purchases = parseFloat(await this.cache.getDel(`v1:metrics:purchases:${productId}`) ?? '0');

      if (views || clicks || cartAdds || purchases) {
        await this.dataSource.query(
          `INSERT INTO product_metrics
             (product_id, views_count, clicks_count, cart_adds_count, purchases_count, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (product_id) DO UPDATE SET
             views_count     = product_metrics.views_count + EXCLUDED.views_count,
             clicks_count    = product_metrics.clicks_count + EXCLUDED.clicks_count,
             cart_adds_count = product_metrics.cart_adds_count + EXCLUDED.cart_adds_count,
             purchases_count = product_metrics.purchases_count + EXCLUDED.purchases_count,
             updated_at      = NOW()`,
          [productId, views, clicks, cartAdds, purchases],
        );
      }
      processed.push(productId);
    }

    await this.cache.sRem('v1:metrics:dirty-products', ...processed);
    if (processed.length) this.logger.debug(`Flushed metrics for ${processed.length} products`);
  }
}
