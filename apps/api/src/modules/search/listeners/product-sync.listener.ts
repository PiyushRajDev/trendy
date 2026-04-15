import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SearchService } from '../services/search.service';

@Injectable()
export class ProductSyncListener {
  private readonly logger = new Logger(ProductSyncListener.name);

  constructor(private readonly searchService: SearchService) {}

  @OnEvent('product.created', { async: true })
  async handleProductCreated(product: any): Promise<void> {
    await this.syncWithRetry(product);
  }

  @OnEvent('product.updated', { async: true })
  async handleProductUpdated(product: any): Promise<void> {
    await this.syncWithRetry(product);
  }

  private async syncWithRetry(product: any): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.searchService.indexProduct(product);
        return;
      } catch (err) {
        this.logger.warn(`ES index attempt ${attempt} failed for ${product.id}: ${err}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
    this.logger.error(`Failed to index product ${product.id} after 3 attempts — manual reindex needed`);
  }

  @OnEvent('product.deleted', { async: true })
  async handleProductDeleted({ id }: { id: string }): Promise<void> {
    await this.searchService.removeFromIndex(id).catch((e) =>
      this.logger.error(`ES delete failed for ${id}: ${e}`),
    );
  }
}
