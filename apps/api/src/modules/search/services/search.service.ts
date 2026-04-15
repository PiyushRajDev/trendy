import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../../../infrastructure/elasticsearch/elasticsearch.module';
import { SearchQueryDto } from '../dto/search-query.dto';

const INDEX = 'products';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);

  constructor(@Inject(ES_CLIENT) private readonly es: Client) {}

  async onModuleInit() {
    try {
      await this.ensureIndex();
    } catch (err) {
      this.logger.warn(`Failed to ensure ES index at startup (will retry on next request): ${err}`);
    }
  }

  private async ensureIndex(): Promise<void> {
    const exists = await this.es.indices.exists({ index: INDEX });
    if (exists) return;

    await this.es.indices.create({
      index: INDEX,
      mappings: {
        properties: {
          id:               { type: 'keyword' },
          name:             { type: 'text', fields: { keyword: { type: 'keyword' } } },
          brand:            { type: 'keyword' },
          category:         { type: 'keyword' },
          tags:             { type: 'keyword' },
          price:            { type: 'float' },
          rating:           { type: 'float' },
          popularity_score: { type: 'float' },
          is_deleted:       { type: 'boolean' },
          created_at:       { type: 'date' },
        },
      },
    });
    this.logger.log(`Index "${INDEX}" created`);
  }

  async indexProduct(product: any): Promise<void> {
    const minPrice = product.variants?.length
      ? Math.min(...product.variants.map((v: any) => Number(v.price)))
      : 0;

    await this.es.index({
      index: INDEX,
      id: product.id,
      document: {
        id:               product.id,
        name:             product.name,
        brand:            product.brand,
        category:         product.category,
        tags:             product.tags ?? [],
        price:            minPrice,
        rating:           product.rating ?? 0,
        popularity_score: product.popularity_score ?? 0,
        is_deleted:       product.is_deleted ?? false,
        created_at:       product.created_at,
      },
    });
  }

  async removeFromIndex(productId: string): Promise<void> {
    try {
      await this.es.update({
        index: INDEX,
        id: productId,
        doc: { is_deleted: true },
      });
    } catch (err: any) {
      if (err?.statusCode === 404) return; // document never indexed — benign
      throw err;
    }
  }

  async search(dto: SearchQueryDto) {
    const { q, category, brand, minPrice, maxPrice, sort = 'relevance', page = 1, limit = 20 } = dto;

    const must: any[] = q
      ? [{ multi_match: { query: q, fields: ['name^3', 'brand^2', 'category', 'tags'], fuzziness: 'AUTO' } }]
      : [{ match_all: {} }];

    const filter: any[] = [{ term: { is_deleted: false } }];
    if (category) filter.push({ term: { category } });
    if (brand)    filter.push({ term: { brand } });
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.push({
        range: {
          price: {
            ...(minPrice !== undefined && { gte: minPrice }),
            ...(maxPrice !== undefined && { lte: maxPrice }),
          },
        },
      });
    }

    let query: any = { bool: { must, filter } };

    if (sort === 'relevance') {
      query = {
        function_score: {
          query,
          functions: [
            { field_value_factor: { field: 'rating', factor: 1.2, missing: 1, modifier: 'log1p' } },
            { field_value_factor: { field: 'popularity_score', factor: 0.05, missing: 0, modifier: 'log1p' } },
          ],
          score_mode: 'sum',
          boost_mode: 'multiply',
        },
      };
    }

    const sortDef: any[] = sort === 'price_asc'  ? [{ price: 'asc' }]
                         : sort === 'price_desc' ? [{ price: 'desc' }]
                         : sort === 'popularity' ? [{ popularity_score: 'desc' }]
                         : [{ _score: 'desc' }];

    const response = await this.es.search({
      index: INDEX,
      from: (page - 1) * limit,
      size: limit,
      query,
      sort: sortDef,
    });

    return {
      data: response.hits.hits.map((h) => h._source),
      meta: {
        total: (response.hits.total as any).value,
        page,
        limit,
      },
    };
  }

  async reindexAll(products: any[]): Promise<void> {
    if (!products.length) return;
    const operations = products.flatMap((p) => {
      const minPrice = p.variants?.length
        ? Math.min(...p.variants.map((v: any) => Number(v.price)))
        : 0;
      return [
        { index: { _index: INDEX, _id: p.id } },
        {
          id: p.id, name: p.name, brand: p.brand, category: p.category,
          tags: p.tags ?? [], price: minPrice,
          rating: p.rating ?? 0, popularity_score: p.popularity_score ?? 0,
          is_deleted: p.is_deleted, created_at: p.created_at,
        },
      ];
    });
    const result = await this.es.bulk({ operations });
    if (result.errors) {
      const failed = result.items
        .filter((item: any) => item.index?.error)
        .map((item: any) => ({ id: item.index?._id, error: item.index?.error?.reason }));
      this.logger.error(`Bulk reindex had ${failed.length} failures: ${JSON.stringify(failed)}`);
    }
    this.logger.log(`Reindexed ${products.length} products`);
  }
}
