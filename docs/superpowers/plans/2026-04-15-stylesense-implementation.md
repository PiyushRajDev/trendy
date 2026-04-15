# StyleSense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build StyleSense — a Fashion Recommendation & Search Engine with NestJS, PostgreSQL 15, Elasticsearch 8, Redis 7 (Streams), and Next.js 14, all wired via Docker Compose.

**Architecture:** Modular monolith — one NestJS process with 6 internal modules (product, search, events, recommendations, cache, health) communicating through service interfaces. Redis Streams handles durable user behavior events; EventEmitter2 handles fast in-process reactions for ES catalog sync. ES is a derived index; Postgres is source of truth.

**Tech Stack:** NestJS 10, TypeScript 5, TypeORM 0.3 (synchronize:true for dev), PostgreSQL 15, Elasticsearch 8, ioredis 5, @nestjs/event-emitter, @nestjs/schedule, @nestjs/throttler, Next.js 14 App Router, Docker Compose 3.8

---

## File Map

```
apps/api/src/
├── main.ts
├── app.module.ts
├── infrastructure/
│   ├── database/database.module.ts
│   ├── redis/redis.module.ts          (global, exports REDIS_CLIENT token)
│   ├── elasticsearch/elasticsearch.module.ts  (global, exports ES_CLIENT token)
│   └── logger/logger.module.ts
├── config/configuration.ts
├── common/
│   ├── interceptors/logging.interceptor.ts
│   ├── interceptors/transform.interceptor.ts
│   ├── guards/throttler.guard.ts
│   └── dto/pagination.dto.ts
└── modules/
    ├── product/
    │   ├── product.module.ts
    │   ├── controllers/product.controller.ts
    │   ├── services/product.service.ts
    │   ├── entities/product.entity.ts
    │   ├── entities/product-variant.entity.ts
    │   ├── entities/product-metrics.entity.ts
    │   └── dto/ (create, update, list)
    ├── search/
    │   ├── search.module.ts
    │   ├── controllers/search.controller.ts
    │   ├── services/search.service.ts
    │   ├── listeners/product-sync.listener.ts
    │   └── dto/search-query.dto.ts
    ├── events/
    │   ├── events.module.ts
    │   ├── controllers/events.controller.ts
    │   ├── services/event.service.ts
    │   ├── producers/stream.producer.ts
    │   ├── publishers/event.publisher.ts
    │   ├── consumers/stream.consumer.ts
    │   └── dto/track-event.dto.ts
    ├── recommendations/
    │   ├── recommendations.module.ts
    │   ├── controllers/recommendations.controller.ts
    │   └── services/recommendation.service.ts
    ├── cache/
    │   ├── cache.module.ts
    │   └── services/cache.service.ts
    └── health/
        ├── health.module.ts
        └── controllers/health.controller.ts

apps/web/src/app/
├── page.tsx                    (search page — server component shell)
├── products/[id]/page.tsx      (product detail + recs)
├── components/
│   ├── SearchBar.tsx           (client component)
│   ├── ProductCard.tsx
│   ├── ProductGrid.tsx
│   ├── FilterPanel.tsx         (client component)
│   └── Recommendations.tsx     (client component — reads localStorage userId)
└── lib/
    ├── api.ts                  (fetch wrappers)
    └── user-id.ts              (anonymous UUID from localStorage)
```

---

### Task 1: Monorepo Scaffold + Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/api/` (NestJS CLI scaffold)
- Create: `apps/web/` (Next.js scaffold)
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`

- [ ] **Step 1: Create directory structure and scaffold apps**

```bash
mkdir -p apps
cd apps
npx @nestjs/cli new api --skip-git --package-manager npm --strict
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir --import-alias "@/*" --skip-install
cd web && npm install && cd ..
cd ..
```

- [ ] **Step 2: Install API dependencies**

```bash
cd apps/api
npm install @nestjs/config @nestjs/typeorm typeorm pg \
  @elastic/elasticsearch ioredis \
  @nestjs/event-emitter @nestjs/schedule @nestjs/throttler \
  class-validator class-transformer uuid \
  nest-winston winston
npm install -D @types/uuid @types/supertest supertest
cd ../..
```

- [ ] **Step 3: Create docker-compose.yml**

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      - NODE_ENV=development
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      elasticsearch:
        condition: service_healthy
    networks:
      - stylesense-net
    volumes:
      - ./apps/api/src:/app/src   # hot reload in dev

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3000
      - API_URL=http://api:3000
      - PORT=3001
    depends_on:
      - api
    networks:
      - stylesense-net

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: stylesense
      POSTGRES_USER: stylesense
      POSTGRES_PASSWORD: stylesense
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stylesense"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - stylesense-net

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - stylesense-net

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    volumes:
      - es_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9200/_cluster/health | grep -qE '\"status\":\"(green|yellow)\"'"]
      interval: 15s
      timeout: 10s
      retries: 12
    networks:
      - stylesense-net

volumes:
  postgres_data:
  redis_data:
  es_data:

networks:
  stylesense-net:
    driver: bridge
```

- [ ] **Step 4: Create .env.example**

```bash
# .env.example
DATABASE_URL=postgresql://stylesense:stylesense@localhost:5432/stylesense
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_URL=http://localhost:9200
PORT=3000
NODE_ENV=development
```

```bash
cp .env.example .env
```

- [ ] **Step 5: Create apps/api/Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

- [ ] **Step 6: Create apps/web/Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
```

Add `output: 'standalone'` to `apps/web/next.config.ts`:
```typescript
const nextConfig = { output: 'standalone' };
export default nextConfig;
```

- [ ] **Step 7: Verify Docker Compose boots**

```bash
docker compose up -d postgres redis elasticsearch
docker compose ps
# All three should show status: healthy within 60s
```

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example apps/api/Dockerfile apps/web/Dockerfile apps/web/next.config.ts
git commit -m "feat: scaffold monorepo with Docker Compose and all infra services"
```

---

### Task 2: NestJS Infrastructure Modules

**Files:**
- Create: `apps/api/src/infrastructure/database/database.module.ts`
- Create: `apps/api/src/infrastructure/redis/redis.module.ts`
- Create: `apps/api/src/infrastructure/elasticsearch/elasticsearch.module.ts`
- Create: `apps/api/src/infrastructure/logger/logger.module.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create database module**

```typescript
// apps/api/src/infrastructure/database/database.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [__dirname + '/../../modules/**/*.entity{.ts,.js}'],
        synchronize: true,   // dev only — use migrations in prod
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),
  ],
})
export class DatabaseModule {}
```

- [ ] **Step 2: Create Redis module**

```typescript
// apps/api/src/infrastructure/redis/redis.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          lazyConnect: false,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

- [ ] **Step 3: Create Elasticsearch infrastructure module**

```typescript
// apps/api/src/infrastructure/elasticsearch/elasticsearch.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export const ES_CLIENT = 'ES_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ES_CLIENT,
      useFactory: (config: ConfigService): Client => {
        return new Client({
          node: config.get<string>('ELASTICSEARCH_URL', 'http://localhost:9200'),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [ES_CLIENT],
})
export class ElasticsearchInfraModule {}
```

- [ ] **Step 4: Create logger module**

```typescript
// apps/api/src/infrastructure/logger/logger.module.ts
import { Module, Global } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

@Global()
@Module({
  imports: [
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context }) =>
              `${timestamp} [${context ?? 'App'}] ${level}: ${message}`,
            ),
          ),
        }),
      ],
    }),
  ],
})
export class LoggerModule {}
```

- [ ] **Step 5: Create common interceptors**

```typescript
// apps/api/src/common/interceptors/logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const start = Date.now();
    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        this.logger.log(`${method} ${url} → ${res.statusCode} (${Date.now() - start}ms)`);
      }),
    );
  }
}
```

```typescript
// apps/api/src/common/interceptors/transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => ({
        data: data?.data ?? data,
        meta: data?.meta ?? {},
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

- [ ] **Step 6: Create PaginationDto**

```typescript
// apps/api/src/common/dto/pagination.dto.ts
import { IsOptional, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
```

- [ ] **Step 7: Wire AppModule and main.ts**

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { ElasticsearchInfraModule } from './infrastructure/elasticsearch/elasticsearch.module';
import { LoggerModule } from './infrastructure/logger/logger.module';

import { ProductModule } from './modules/product/product.module';
import { SearchModule } from './modules/search/search.module';
import { EventsModule } from './modules/events/events.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { CacheModule } from './modules/cache/cache.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule,
    RedisModule,
    ElasticsearchInfraModule,
    LoggerModule,
    ProductModule,
    SearchModule,
    EventsModule,
    RecommendationsModule,
    CacheModule,
    HealthModule,
  ],
})
export class AppModule {}
```

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`StyleSense API running on :${port}`);
}
bootstrap();
```

- [ ] **Step 8: Verify API starts (with infra up)**

```bash
docker compose up -d postgres redis elasticsearch
cd apps/api && npm run start:dev
# Expected: "StyleSense API running on :3000" with no connection errors
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/
git commit -m "feat: wire NestJS infrastructure modules (DB, Redis, ES, Logger)"
```

---

### Task 3: Cache Module

**Files:**
- Create: `apps/api/src/modules/cache/cache.module.ts`
- Create: `apps/api/src/modules/cache/services/cache.service.ts`

- [ ] **Step 1: Create CacheService**

```typescript
// apps/api/src/modules/cache/services/cache.service.ts
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async getDel(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async incrByFloat(key: string, increment: number): Promise<void> {
    await this.redis.incrbyfloat(key, increment);
  }

  async zIncrBy(key: string, increment: number, member: string): Promise<void> {
    await this.redis.zincrby(key, increment, member);
  }

  async zRevRangeWithScores(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.zrevrange(key, start, stop, 'WITHSCORES');
  }

  async zRevRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.zrevrange(key, start, stop);
  }

  async lPush(key: string, ...values: string[]): Promise<void> {
    await this.redis.lpush(key, ...values);
  }

  async lTrim(key: string, start: number, stop: number): Promise<void> {
    await this.redis.ltrim(key, start, stop);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.lrange(key, start, stop);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  async sAdd(key: string, ...members: string[]): Promise<void> {
    await this.redis.sadd(key, ...members);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  async sRem(key: string, ...members: string[]): Promise<void> {
    if (members.length > 0) await this.redis.srem(key, ...members);
  }
}
```

- [ ] **Step 2: Create CacheModule**

```typescript
// apps/api/src/modules/cache/cache.module.ts
import { Module, Global } from '@nestjs/common';
import { CacheService } from './services/cache.service';

@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/cache/
git commit -m "feat: add global CacheService wrapping ioredis"
```

---

### Task 4: Product Entities + Module

**Files:**
- Create: `apps/api/src/modules/product/entities/product.entity.ts`
- Create: `apps/api/src/modules/product/entities/product-variant.entity.ts`
- Create: `apps/api/src/modules/product/entities/product-metrics.entity.ts`
- Create: `apps/api/src/modules/product/dto/create-product.dto.ts`
- Create: `apps/api/src/modules/product/dto/update-product.dto.ts`
- Create: `apps/api/src/modules/product/dto/list-products.dto.ts`

- [ ] **Step 1: Create Product entity**

```typescript
// apps/api/src/modules/product/entities/product.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { ProductVariant } from './product-variant.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100 })
  brand: string;

  @Column({ length: 100 })
  category: string;

  @Column('text', { array: true, default: [] })
  tags: string[];

  @Column({ nullable: true, length: 500 })
  image_url: string | null;

  @Column({ default: false })
  is_deleted: boolean;

  @Column({ default: 1 })
  version: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => ProductVariant, (v) => v.product, { cascade: true })
  variants: ProductVariant[];
}
```

- [ ] **Step 2: Create ProductVariant entity**

```typescript
// apps/api/src/modules/product/entities/product-variant.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_variants')
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id' })
  product_id: string;

  @Column({ unique: true, length: 100 })
  sku_code: string;

  @Column({ nullable: true, length: 20 })
  size: string | null;

  @Column({ nullable: true, length: 50 })
  color: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ default: 0 })
  stock: number;

  @CreateDateColumn()
  created_at: Date;
}
```

- [ ] **Step 3: Create ProductMetrics entity**

```typescript
// apps/api/src/modules/product/entities/product-metrics.entity.ts
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('product_metrics')
export class ProductMetrics {
  @PrimaryColumn('uuid')
  product_id: string;

  @Column({ type: 'bigint', default: 0 })
  views_count: number;

  @Column({ type: 'bigint', default: 0 })
  clicks_count: number;

  @Column({ type: 'bigint', default: 0 })
  cart_adds_count: number;

  @Column({ type: 'bigint', default: 0 })
  purchases_count: number;

  @UpdateDateColumn()
  updated_at: Date;
}
```

- [ ] **Step 4: Create DTOs**

```typescript
// apps/api/src/modules/product/dto/create-product.dto.ts
import { IsString, IsArray, IsOptional, IsUrl, ArrayMaxSize } from 'class-validator';

export class CreateVariantDto {
  @IsString() sku_code: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() color?: string;
  @IsString() price: string;  // string for decimal precision
  @IsOptional() stock?: number;
}

export class CreateProductDto {
  @IsString() name: string;
  @IsString() brand: string;
  @IsString() category: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) tags?: string[];
  @IsOptional() @IsUrl() image_url?: string;
  @IsOptional() @IsArray() variants?: CreateVariantDto[];
}
```

```typescript
// apps/api/src/modules/product/dto/update-product.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { IsInt, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsInt()
  @Min(1)
  version: number;  // required for optimistic locking
}
```

```typescript
// apps/api/src/modules/product/dto/list-products.dto.ts
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListProductsDto extends PaginationDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() brand?: string;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/product/entities/ apps/api/src/modules/product/dto/
git commit -m "feat: add product entities (Product, ProductVariant, ProductMetrics) and DTOs"
```

---

### Task 5: Product Service + Repository + Controller

**Files:**
- Create: `apps/api/src/modules/product/services/product.service.ts`
- Create: `apps/api/src/modules/product/controllers/product.controller.ts`
- Create: `apps/api/src/modules/product/product.module.ts`
- Create: `apps/api/src/modules/product/services/product.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/product/services/product.service.spec.ts
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
        { provide: getRepositoryToken(Product), useValue: { save: jest.fn(), findOne: jest.fn(), createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(ProductVariant), useValue: {} },
        { provide: getRepositoryToken(ProductMetrics), useValue: {} },
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest product.service.spec --no-coverage
# Expected: FAIL — ProductService not implemented yet
```

- [ ] **Step 3: Implement ProductService**

```typescript
// apps/api/src/modules/product/services/product.service.ts
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

const PRODUCT_TTL = 3600; // 1 hour

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
    const product = this.productRepo.create({
      name: dto.name,
      brand: dto.brand,
      category: dto.category,
      tags: dto.tags ?? [],
      image_url: dto.image_url ?? null,
    });
    const saved = await this.productRepo.save(product);

    if (dto.variants?.length) {
      const variants = dto.variants.map((v) =>
        this.variantRepo.create({ ...v, product_id: saved.id }),
      );
      await this.variantRepo.save(variants);
    }

    await this.metricsRepo.save({ product_id: saved.id });

    // Async ES sync via internal event
    this.eventEmitter.emit('product.updated', { ...saved, variants: dto.variants ?? [] });

    return this.findById(saved.id);
  }

  async findById(id: string): Promise<Product> {
    const cacheKey = `v1:product:${id}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

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
    return this.productRepo.find({ where: { id: In(ids), is_deleted: false } });
  }

  async findAll(dto: ListProductsDto): Promise<{ items: Product[]; total: number; nextCursor: string | null }> {
    const { limit = 20, cursor, category, brand } = dto;

    const qb = this.productRepo.createQueryBuilder('p')
      .where('p.is_deleted = false')
      .orderBy('p.id', 'ASC')
      .take(limit + 1);  // fetch one extra to detect next page

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
      [dto.name, dto.brand, dto.category, dto.tags ?? [], dto.image_url ?? null,
       id, expectedVersion],
    );
    if (!result[0]?.length) {
      throw new ConflictException('Version mismatch — concurrent update detected');
    }

    await this.cache.del(`v1:product:${id}`);
    this.eventEmitter.emit('product.updated', result[0][0]);

    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    const exists = await this.productRepo.findOne({ where: { id, is_deleted: false } });
    if (!exists) throw new NotFoundException(`Product ${id} not found`);

    await this.dataSource.query(
      'UPDATE products SET is_deleted=true, updated_at=NOW() WHERE id=$1', [id],
    );
    await this.cache.del(`v1:product:${id}`);
    this.eventEmitter.emit('product.deleted', { id });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest product.service.spec --no-coverage
# Expected: PASS (4 tests)
```

- [ ] **Step 5: Create ProductController**

```typescript
// apps/api/src/modules/product/controllers/product.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param,
  ParseUUIDPipe, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProductService } from '../services/product.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ListProductsDto } from '../dto/list-products.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  findAll(@Query() dto: ListProductsDto) {
    return this.productService.findAll(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.update(id, dto, dto.version);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.softDelete(id);
  }
}
```

- [ ] **Step 6: Create ProductModule**

```typescript
// apps/api/src/modules/product/product.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductMetrics } from './entities/product-metrics.entity';
import { ProductService } from './services/product.service';
import { ProductController } from './controllers/product.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductVariant, ProductMetrics])],
  providers: [ProductService],
  controllers: [ProductController],
  exports: [ProductService],
})
export class ProductModule {}
```

- [ ] **Step 7: Verify endpoints work**

```bash
docker compose up -d postgres redis elasticsearch
cd apps/api && npm run start:dev &

# Create a product
curl -s -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Blue Kurta","brand":"Fab India","category":"Ethnic Wear","tags":["cotton","summer"],"variants":[{"sku_code":"BK-M-BLU","size":"M","color":"Blue","price":"999.00","stock":50}]}' | jq .

# List products
curl -s http://localhost:3000/products | jq .
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/product/
git commit -m "feat: add ProductModule with CRUD, keyset pagination, optimistic locking, cache-aside"
```

---

### Task 6: Search Module

**Files:**
- Create: `apps/api/src/modules/search/services/search.service.ts`
- Create: `apps/api/src/modules/search/listeners/product-sync.listener.ts`
- Create: `apps/api/src/modules/search/controllers/search.controller.ts`
- Create: `apps/api/src/modules/search/dto/search-query.dto.ts`
- Create: `apps/api/src/modules/search/search.module.ts`

- [ ] **Step 1: Create SearchService with index management and query**

```typescript
// apps/api/src/modules/search/services/search.service.ts
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
    await this.ensureIndex();
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
    await this.es.update({
      index: INDEX,
      id: productId,
      doc: { is_deleted: true },
    });
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
      filter.push({ range: { price: { ...(minPrice && { gte: minPrice }), ...(maxPrice && { lte: maxPrice }) } } });
    }

    let query: any = { bool: { must, filter } };

    // Boost by business signals when sorting by relevance
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
    const operations = products.flatMap((p) => [
      { index: { _index: INDEX, _id: p.id } },
      { id: p.id, name: p.name, brand: p.brand, category: p.category,
        tags: p.tags, is_deleted: p.is_deleted, created_at: p.created_at },
    ]);
    await this.es.bulk({ operations });
    this.logger.log(`Reindexed ${products.length} products`);
  }
}
```

- [ ] **Step 2: Create product sync listener**

```typescript
// apps/api/src/modules/search/listeners/product-sync.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SearchService } from '../services/search.service';

@Injectable()
export class ProductSyncListener {
  private readonly logger = new Logger(ProductSyncListener.name);

  constructor(private readonly searchService: SearchService) {}

  @OnEvent('product.updated', { async: true })
  async handleProductUpdated(product: any): Promise<void> {
    // Retry up to 3 times with exponential backoff
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
```

- [ ] **Step 3: Create SearchQueryDto**

```typescript
// apps/api/src/modules/search/dto/search-query.dto.ts
import { IsOptional, IsString, IsNumber, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SearchQueryDto extends PaginationDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() brand?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxPrice?: number;

  @IsOptional()
  @IsIn(['relevance', 'price_asc', 'price_desc', 'popularity'])
  sort?: string = 'relevance';
}
```

- [ ] **Step 4: Create SearchController**

```typescript
// apps/api/src/modules/search/controllers/search.controller.ts
import { Controller, Get, Post, Query, Inject } from '@nestjs/common';
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
    const products = await this.productRepo.find({ where: { is_deleted: false } });
    await this.searchService.reindexAll(products);
    return { reindexed: products.length };
  }
}
```

- [ ] **Step 5: Create SearchModule**

```typescript
// apps/api/src/modules/search/search.module.ts
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
```

- [ ] **Step 6: Test search**

```bash
# Reindex existing products
curl -s -X POST http://localhost:3000/search/reindex | jq .

# Search
curl -s "http://localhost:3000/search?q=kurta&category=Ethnic+Wear" | jq .
curl -s "http://localhost:3000/search?sort=price_asc&minPrice=500&maxPrice=2000" | jq .
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/search/
git commit -m "feat: add SearchModule with Elasticsearch BM25+function_score, async product sync"
```

---

### Task 7: Events Module

**Files:**
- Create: `apps/api/src/modules/events/dto/track-event.dto.ts`
- Create: `apps/api/src/modules/events/producers/stream.producer.ts`
- Create: `apps/api/src/modules/events/publishers/event.publisher.ts`
- Create: `apps/api/src/modules/events/services/event.service.ts`
- Create: `apps/api/src/modules/events/consumers/stream.consumer.ts`
- Create: `apps/api/src/modules/events/controllers/events.controller.ts`
- Create: `apps/api/src/modules/events/events.module.ts`
- Create: `apps/api/src/modules/events/services/event.service.spec.ts`

- [ ] **Step 1: Create TrackEventDto**

```typescript
// apps/api/src/modules/events/dto/track-event.dto.ts
import { IsString, IsUUID, IsIn, IsISO8601, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class EventMetaDto {
  @IsIn(['search', 'recommendation', 'homepage', 'direct'])
  source: string;
}

export class TrackEventDto {
  @IsUUID()
  event_id: string;

  @IsString()
  user_id: string;

  @IsUUID()
  product_id: string;

  @IsIn(['product_view', 'product_click', 'add_to_cart', 'purchase'])
  event_type: string;

  @IsISO8601()
  timestamp: string;

  @IsObject()
  @ValidateNested()
  @Type(() => EventMetaDto)
  metadata: EventMetaDto;
}
```

- [ ] **Step 2: Create StreamProducer**

```typescript
// apps/api/src/modules/events/producers/stream.producer.ts
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { TrackEventDto } from '../dto/track-event.dto';

const STREAM_KEY = 'stream:events';

@Injectable()
export class StreamProducer {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async publish(dto: TrackEventDto): Promise<void> {
    await this.redis.xadd(
      STREAM_KEY, '*',
      'event_id',   dto.event_id,
      'user_id',    dto.user_id,
      'product_id', dto.product_id,
      'event_type', dto.event_type,
      'timestamp',  dto.timestamp,
      'source',     dto.metadata.source,
    );
  }
}
```

- [ ] **Step 3: Create EventPublisher (in-process bus)**

```typescript
// apps/api/src/modules/events/publishers/event.publisher.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TrackEventDto } from '../dto/track-event.dto';

@Injectable()
export class EventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  emit(dto: TrackEventDto): void {
    // Fast in-process notification (not durable — Redis Stream is the durability source)
    this.emitter.emit(`user.${dto.event_type}`, dto);
  }
}
```

- [ ] **Step 4: Write failing test for EventService**

```typescript
// apps/api/src/modules/events/services/event.service.spec.ts
import { Test } from '@nestjs/testing';
import { EventService } from './event.service';
import { StreamProducer } from '../producers/stream.producer';
import { EventPublisher } from '../publishers/event.publisher';
import { CacheService } from '../../cache/services/cache.service';

describe('EventService', () => {
  let service: EventService;
  let cache: jest.Mocked<CacheService>;
  let producer: jest.Mocked<StreamProducer>;
  let publisher: jest.Mocked<EventPublisher>;

  const dto = {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    user_id:  'user-1',
    product_id: '550e8400-e29b-41d4-a716-446655440001',
    event_type: 'product_view',
    timestamp: new Date().toISOString(),
    metadata: { source: 'search' },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: StreamProducer, useValue: { publish: jest.fn() } },
        { provide: EventPublisher, useValue: { emit: jest.fn() } },
        { provide: CacheService, useValue: { setNX: jest.fn() } },
      ],
    }).compile();

    service  = module.get(EventService);
    cache    = module.get(CacheService);
    producer = module.get(StreamProducer);
    publisher = module.get(EventPublisher);
  });

  it('tracks new event — publishes to stream and emits locally', async () => {
    cache.setNX.mockResolvedValue(true);   // new event
    await service.track(dto as any);
    expect(producer.publish).toHaveBeenCalledWith(dto);
    expect(publisher.emit).toHaveBeenCalledWith(dto);
  });

  it('silently drops duplicate event', async () => {
    cache.setNX.mockResolvedValue(false);   // duplicate
    await service.track(dto as any);
    expect(producer.publish).not.toHaveBeenCalled();
    expect(publisher.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run test to confirm failure**

```bash
cd apps/api && npx jest event.service.spec --no-coverage
# Expected: FAIL — EventService not found
```

- [ ] **Step 6: Implement EventService**

```typescript
// apps/api/src/modules/events/services/event.service.ts
import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/services/cache.service';
import { StreamProducer } from '../producers/stream.producer';
import { EventPublisher } from '../publishers/event.publisher';
import { TrackEventDto } from '../dto/track-event.dto';

const DEDUP_TTL = 86400; // 24h

@Injectable()
export class EventService {
  constructor(
    private readonly cache: CacheService,
    private readonly producer: StreamProducer,
    private readonly publisher: EventPublisher,
  ) {}

  async track(dto: TrackEventDto): Promise<void> {
    const dedupKey = `v1:event-dedup:${dto.event_id}`;
    const isNew = await this.cache.setNX(dedupKey, '1', DEDUP_TTL);
    if (!isNew) return;   // duplicate — silently drop

    await this.producer.publish(dto);   // durable
    this.publisher.emit(dto);           // fast in-process
  }
}
```

- [ ] **Step 7: Run tests to confirm pass**

```bash
cd apps/api && npx jest event.service.spec --no-coverage
# Expected: PASS (2 tests)
```

- [ ] **Step 8: Create EventsController**

```typescript
// apps/api/src/modules/events/controllers/events.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EventService } from '../services/event.service';
import { TrackEventDto } from '../dto/track-event.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly eventService: EventService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  track(@Body() dto: TrackEventDto) {
    return this.eventService.track(dto);
  }
}
```

- [ ] **Step 9: Create StreamConsumer**

```typescript
// apps/api/src/modules/events/consumers/stream.consumer.ts
import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { CacheService } from '../../cache/services/cache.service';

const STREAM_KEY   = 'stream:events';
const GROUP_NAME   = 'recommendations';
const CONSUMER_ID  = 'consumer-1';

const EVENT_WEIGHTS: Record<string, number> = {
  product_view:  1,
  product_click: 2,
  add_to_cart:   5,
  purchase:      10,
};

@Injectable()
export class StreamConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumer.name);
  private running = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit() {
    await this.createGroup();
    this.running = true;
    this.consume().catch((e) => this.logger.error('Consumer crashed', e));
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async createGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
    } catch (e: any) {
      if (!e.message?.includes('BUSYGROUP')) throw e;
    }
  }

  private async consume(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.redis.xreadgroup(
          'GROUP', GROUP_NAME, CONSUMER_ID,
          'COUNT', '50',
          'BLOCK', '2000',
          'STREAMS', STREAM_KEY, '>',
        ) as any;

        if (!result) continue;

        for (const [, entries] of result) {
          for (const [msgId, fields] of entries) {
            try {
              await this.processEvent(this.parseFields(fields));
              await this.redis.xack(STREAM_KEY, GROUP_NAME, msgId);
            } catch (e) {
              this.logger.error(`Failed to process event ${msgId}: ${e}`);
              // Message stays in PEL for retry — do NOT ack
            }
          }
        }
      } catch (e) {
        if (this.running) {
          this.logger.error('XREADGROUP error, retrying in 2s', e);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }

  private parseFields(fields: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
    return obj;
  }

  private async processEvent(event: Record<string, string>): Promise<void> {
    const { user_id, product_id, event_type } = event;
    const weight = EVENT_WEIGHTS[event_type] ?? 0;
    if (!weight || !product_id) return;

    // Increment Redis metric counters (batch-flushed to Postgres by cron)
    await this.cache.incrByFloat(`v1:metrics:${event_type}s:${product_id}`, weight);
    await this.cache.sAdd('v1:metrics:dirty-products', product_id);

    // Update trending sorted set (TTL 15m)
    await this.cache.zIncrBy('v1:trending:products', weight, product_id);
    await this.cache.expire('v1:trending:products', 900);

    // Bust user recs cache
    await this.cache.del(`v1:user:${user_id}:recs`);

    // Track recent views per user
    if (event_type === 'product_view') {
      await this.cache.lPush(`v1:user:${user_id}:recent`, product_id);
      await this.cache.lTrim(`v1:user:${user_id}:recent`, 0, 19);
      await this.cache.expire(`v1:user:${user_id}:recent`, 604800); // 7d
    }
  }
}
```

- [ ] **Step 10: Create EventsModule**

```typescript
// apps/api/src/modules/events/events.module.ts
import { Module } from '@nestjs/common';
import { EventService } from './services/event.service';
import { EventsController } from './controllers/events.controller';
import { StreamProducer } from './producers/stream.producer';
import { EventPublisher } from './publishers/event.publisher';
import { StreamConsumer } from './consumers/stream.consumer';

@Module({
  providers: [EventService, StreamProducer, EventPublisher, StreamConsumer],
  controllers: [EventsController],
})
export class EventsModule {}
```

- [ ] **Step 11: Test event tracking**

```bash
curl -s -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "'$(uuidgen)'",
    "user_id": "user-abc",
    "product_id": "<product-id-from-step-5>",
    "event_type": "product_view",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "metadata": {"source": "search"}
  }'
# Expected: 202 Accepted

# Verify stream got the message
redis-cli XLEN stream:events
# Expected: 1
```

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/events/
git commit -m "feat: add EventsModule with Redis Streams, dedup, stream consumer with scoring updates"
```

---

### Task 8: Recommendations Module

**Files:**
- Create: `apps/api/src/modules/recommendations/services/recommendation.service.ts`
- Create: `apps/api/src/modules/recommendations/controllers/recommendations.controller.ts`
- Create: `apps/api/src/modules/recommendations/recommendations.module.ts`
- Create: `apps/api/src/modules/recommendations/services/recommendation.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/modules/recommendations/services/recommendation.service.spec.ts
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd apps/api && npx jest recommendation.service.spec --no-coverage
# Expected: FAIL
```

- [ ] **Step 3: Implement RecommendationService**

```typescript
// apps/api/src/modules/recommendations/services/recommendation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '../../cache/services/cache.service';
import { ProductService } from '../../product/services/product.service';

const RECS_TTL    = 300;   // 5 min
const TRENDING_TTL = 900;  // 15 min

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
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd apps/api && npx jest recommendation.service.spec --no-coverage
# Expected: PASS (2 tests)
```

- [ ] **Step 5: Create RecommendationsController**

```typescript
// apps/api/src/modules/recommendations/controllers/recommendations.controller.ts
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
```

- [ ] **Step 6: Create RecommendationsModule**

```typescript
// apps/api/src/modules/recommendations/recommendations.module.ts
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
```

- [ ] **Step 7: Test recommendations**

```bash
# Send a few events first
for i in 1 2 3; do
  curl -s -X POST http://localhost:3000/events \
    -H "Content-Type: application/json" \
    -d "{\"event_id\":\"$(uuidgen)\",\"user_id\":\"user-abc\",\"product_id\":\"<product-id>\",\"event_type\":\"product_view\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"metadata\":{\"source\":\"search\"}}"
done

# Get trending (wait 30s for cron flush, or check Redis)
curl -s http://localhost:3000/recommendations/trending | jq .

# Get user recs (cold start returns trending)
curl -s http://localhost:3000/recommendations/user-abc | jq .
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/recommendations/
git commit -m "feat: add RecommendationsModule with scoring, personalization boost, 30s cron flush"
```

---

### Task 9: Health Module

**Files:**
- Create: `apps/api/src/modules/health/controllers/health.controller.ts`
- Create: `apps/api/src/modules/health/health.module.ts`

- [ ] **Step 1: Create HealthController**

```typescript
// apps/api/src/modules/health/controllers/health.controller.ts
import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Client } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { ES_CLIENT } from '../../../infrastructure/elasticsearch/elasticsearch.module';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(ES_CLIENT) private readonly es: Client,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    const checks = await Promise.allSettled([
      this.db.query('SELECT 1'),
      this.redis.ping(),
      this.es.ping(),
    ]);

    const [db, redis, elasticsearch] = checks.map((c) => c.status === 'fulfilled');
    const healthy = db && redis && elasticsearch;

    return {
      status: healthy ? 'ok' : 'degraded',
      checks: { db, redis, elasticsearch },
      timestamp: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 2: Create HealthModule**

```typescript
// apps/api/src/modules/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 3: Verify health endpoints**

```bash
curl -s http://localhost:3000/health/live | jq .
# Expected: { "data": { "status": "ok", ... } }

curl -s http://localhost:3000/health/ready | jq .
# Expected: { "data": { "status": "ok", "checks": { "db": true, "redis": true, "elasticsearch": true } } }
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/health/
git commit -m "feat: add health endpoints with liveness and dependency readiness checks"
```

---

### Task 10: Next.js Frontend

**Files:**
- Create: `apps/web/src/app/lib/api.ts`
- Create: `apps/web/src/app/lib/user-id.ts`
- Create: `apps/web/src/app/components/SearchBar.tsx`
- Create: `apps/web/src/app/components/ProductCard.tsx`
- Create: `apps/web/src/app/components/FilterPanel.tsx`
- Create: `apps/web/src/app/components/Recommendations.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/products/[id]/page.tsx`

- [ ] **Step 1: Create API client**

```typescript
// apps/web/src/app/lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function searchProducts(params: {
  q?: string; category?: string; brand?: string;
  minPrice?: number; maxPrice?: number; sort?: string; page?: number;
}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  });
  const res = await fetch(`${API_URL}/search?${sp}`, { cache: 'no-store' });
  if (!res.ok) return { data: [], meta: { total: 0 } };
  return res.json();
}

export async function getProduct(id: string) {
  const res = await fetch(`${API_URL}/products/${id}`, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return res.json();
}

export async function getRecommendations(userId: string) {
  const res = await fetch(`${API_URL}/recommendations/${userId}`, { cache: 'no-store' });
  if (!res.ok) return { data: [] };
  return res.json();
}

export async function trackEvent(event: {
  event_id: string; user_id: string; product_id: string;
  event_type: string; metadata: { source: string };
}) {
  await fetch(`${API_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, timestamp: new Date().toISOString() }),
  }).catch(() => {});  // fire-and-forget, never block UI
}
```

- [ ] **Step 2: Create anonymous user ID helper**

```typescript
// apps/web/src/app/lib/user-id.ts
'use client';

export function getUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  let id = localStorage.getItem('ss-user-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('ss-user-id', id);
  }
  return id;
}
```

- [ ] **Step 3: Create ProductCard component**

```typescript
// apps/web/src/app/components/ProductCard.tsx
import Link from 'next/link';

export function ProductCard({ product }: { product: any }) {
  const minPrice = product.variants?.length
    ? Math.min(...product.variants.map((v: any) => Number(v.price)))
    : null;

  return (
    <Link href={`/products/${product.id}`} className="group block rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="bg-gray-100 h-48 flex items-center justify-center text-gray-400 text-sm">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
          : 'No image'}
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide">{product.brand}</p>
        <p className="font-medium text-gray-900 text-sm mt-0.5 line-clamp-2">{product.name}</p>
        {minPrice && (
          <p className="mt-1 text-indigo-600 font-semibold">₹{minPrice.toLocaleString('en-IN')}</p>
        )}
        <div className="mt-1 flex gap-1 flex-wrap">
          {product.tags?.slice(0, 3).map((t: string) => (
            <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Create SearchBar client component**

```typescript
// apps/web/src/app/components/SearchBar.tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams(params.toString());
    if (q) sp.set('q', q); else sp.delete('q');
    router.push(`/?${sp}`);
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder="Search kurta, saree, shoes..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit" className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
        Search
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Create FilterPanel client component**

```typescript
// apps/web/src/app/components/FilterPanel.tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';

const CATEGORIES = ['Ethnic Wear', 'Casual Wear', 'Footwear', 'Accessories', 'Sportswear'];
const SORTS = [
  { value: 'relevance',  label: 'Relevance' },
  { value: 'price_asc',  label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'popularity', label: 'Popularity' },
];

export function FilterPanel() {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value); else sp.delete(key);
    router.push(`/?${sp}`);
  };

  return (
    <aside className="w-56 shrink-0 space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Sort By</p>
        {SORTS.map((s) => (
          <label key={s.value} className="flex items-center gap-2 text-sm cursor-pointer py-1">
            <input type="radio" name="sort" value={s.value}
              checked={(params.get('sort') ?? 'relevance') === s.value}
              onChange={() => set('sort', s.value)} />
            {s.label}
          </label>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Category</p>
        {CATEGORIES.map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm cursor-pointer py-1">
            <input type="checkbox" checked={params.get('category') === c}
              onChange={(e) => set('category', e.target.checked ? c : '')} />
            {c}
          </label>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Price Range</p>
        <div className="flex gap-2">
          <input type="number" placeholder="Min" className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
            value={params.get('minPrice') ?? ''}
            onChange={(e) => set('minPrice', e.target.value)} />
          <input type="number" placeholder="Max" className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
            value={params.get('maxPrice') ?? ''}
            onChange={(e) => set('maxPrice', e.target.value)} />
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Create Recommendations client component**

```typescript
// apps/web/src/app/components/Recommendations.tsx
'use client';
import { useEffect, useState } from 'react';
import { getRecommendations } from '../lib/api';
import { getUserId } from '../lib/user-id';
import { ProductCard } from './ProductCard';

export function Recommendations({ title = 'You May Also Like' }: { title?: string }) {
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    const userId = getUserId();
    getRecommendations(userId).then((res) => setProducts(res.data ?? []));
  }, []);

  if (!products.length) return null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Create search page (server component)**

```typescript
// apps/web/src/app/page.tsx
import { Suspense } from 'react';
import { searchProducts } from './lib/api';
import { SearchBar } from './components/SearchBar';
import { FilterPanel } from './components/FilterPanel';
import { ProductCard } from './components/ProductCard';

interface PageProps {
  searchParams: { q?: string; category?: string; brand?: string; minPrice?: string; maxPrice?: string; sort?: string; page?: string };
}

export default async function HomePage({ searchParams }: PageProps) {
  const result = await searchProducts({
    q:        searchParams.q,
    category: searchParams.category,
    brand:    searchParams.brand,
    minPrice: searchParams.minPrice ? Number(searchParams.minPrice) : undefined,
    maxPrice: searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined,
    sort:     searchParams.sort,
  });

  const products: any[] = result.data ?? [];
  const total: number   = result.meta?.total ?? 0;

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">StyleSense</h1>
        <p className="text-gray-500 text-sm">Fashion Recommendation & Search Engine</p>
      </div>

      <Suspense>
        <SearchBar />
      </Suspense>

      <div className="mt-6 flex gap-8">
        <Suspense>
          <FilterPanel />
        </Suspense>

        <div className="flex-1">
          <p className="text-sm text-gray-500 mb-4">{total} results</p>
          {products.length === 0 ? (
            <p className="text-gray-400 text-center py-20">No products found. Try a different search.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Create product detail page**

```typescript
// apps/web/src/app/products/[id]/page.tsx
import { notFound } from 'next/navigation';
import { getProduct, trackEvent } from '../../lib/api';
import { Recommendations } from '../../components/Recommendations';
import { ProductCard } from '../../components/ProductCard';
import { TrackView } from './TrackView';

export default async function ProductPage({ params }: { params: { id: string } }) {
  const res = await getProduct(params.id);
  if (!res?.data) notFound();
  const product = res.data;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <TrackView productId={product.id} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-gray-100 rounded-xl h-96 flex items-center justify-center text-gray-400">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover rounded-xl" />
            : 'No image'}
        </div>

        <div>
          <p className="text-sm text-gray-500 uppercase tracking-wide">{product.brand}</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{product.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{product.category}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {product.tags?.map((t: string) => (
              <span key={t} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full">{t}</span>
            ))}
          </div>

          {product.variants?.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-medium text-gray-700 mb-2">Available variants</p>
              <div className="space-y-2">
                {product.variants.map((v: any) => (
                  <div key={v.id} className="flex justify-between items-center border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-700">{v.size && `Size ${v.size}`}{v.color && ` · ${v.color}`}</span>
                    <span className="font-semibold text-indigo-600">₹{Number(v.price).toLocaleString('en-IN')}</span>
                    <span className={v.stock > 0 ? 'text-green-600' : 'text-red-500'}>
                      {v.stock > 0 ? `${v.stock} left` : 'Out of stock'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Recommendations title="You May Also Like" />
    </main>
  );
}
```

```typescript
// apps/web/src/app/products/[id]/TrackView.tsx
'use client';
import { useEffect } from 'react';
import { trackEvent } from '../../lib/api';
import { getUserId } from '../../lib/user-id';

export function TrackView({ productId }: { productId: string }) {
  useEffect(() => {
    trackEvent({
      event_id:   crypto.randomUUID(),
      user_id:    getUserId(),
      product_id: productId,
      event_type: 'product_view',
      metadata:   { source: 'direct' },
    });
  }, [productId]);

  return null;
}
```

- [ ] **Step 9: Verify frontend**

```bash
docker compose up -d
cd apps/web && npm run dev
# Open http://localhost:3001
# Search for "kurta" — results should appear
# Click a product — TrackView fires, recommendations appear on detail page
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/
git commit -m "feat: add Next.js frontend with search page, product detail, and recommendation section"
```

---

### Task 11: Sample Data Seed + README

**Files:**
- Create: `scripts/seed.ts`
- Modify: `apps/api/package.json` (add seed script)

- [ ] **Step 1: Create seed script**

```typescript
// scripts/seed.ts
import fetch from 'node-fetch';

const API = 'http://localhost:3000';

const products = [
  { name: 'Anarkali Kurta Set', brand: 'Biba', category: 'Ethnic Wear', tags: ['cotton', 'festive', 'printed'], image_url: null,
    variants: [{ sku_code: 'AK-S-RED', size: 'S', color: 'Red', price: '1299.00', stock: 30 }, { sku_code: 'AK-M-RED', size: 'M', color: 'Red', price: '1299.00', stock: 20 }] },
  { name: 'Classic White Sneakers', brand: 'Puma', category: 'Footwear', tags: ['casual', 'leather', 'everyday'],
    variants: [{ sku_code: 'CWS-42', size: '42', color: 'White', price: '2499.00', stock: 15 }] },
  { name: 'Slim Fit Chinos', brand: 'Marks & Spencer', category: 'Casual Wear', tags: ['stretch', 'office'],
    variants: [{ sku_code: 'SFC-32-KHA', size: '32', color: 'Khaki', price: '1799.00', stock: 40 }, { sku_code: 'SFC-34-KHA', size: '34', color: 'Khaki', price: '1799.00', stock: 25 }] },
  { name: 'Floral Maxi Dress', brand: 'W', category: 'Casual Wear', tags: ['summer', 'floral', 'rayon'],
    variants: [{ sku_code: 'FMD-M-BLU', size: 'M', color: 'Blue', price: '1599.00', stock: 18 }] },
  { name: 'Leather Handbag', brand: 'Baggit', category: 'Accessories', tags: ['vegan', 'office', 'tote'],
    variants: [{ sku_code: 'LHB-BRN', color: 'Brown', price: '1999.00', stock: 12 }] },
  { name: 'Sports Running Shoes', brand: 'Nike', category: 'Footwear', tags: ['running', 'mesh', 'cushioned'],
    variants: [{ sku_code: 'SRS-41-BLK', size: '41', color: 'Black', price: '3499.00', stock: 22 }, { sku_code: 'SRS-43-BLK', size: '43', color: 'Black', price: '3499.00', stock: 10 }] },
  { name: 'Silk Saree', brand: 'Nalli', category: 'Ethnic Wear', tags: ['silk', 'wedding', 'traditional'],
    variants: [{ sku_code: 'SS-GOLD', color: 'Gold', price: '8999.00', stock: 5 }] },
  { name: 'Yoga Pants', brand: 'Decathlon', category: 'Sportswear', tags: ['flex', 'gym', 'moisture-wicking'],
    variants: [{ sku_code: 'YP-S-BLK', size: 'S', color: 'Black', price: '799.00', stock: 60 }, { sku_code: 'YP-M-BLK', size: 'M', color: 'Black', price: '799.00', stock: 50 }] },
];

async function seed() {
  console.log('Seeding products...');
  for (const p of products) {
    const res = await fetch(`${API}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    const data = await res.json() as any;
    console.log(`  ✓ ${data.data?.name ?? 'error'}`);
  }

  // Trigger reindex
  await fetch(`${API}/search/reindex`, { method: 'POST' });
  console.log('Reindexed all products in Elasticsearch.');
  console.log('Done! Visit http://localhost:3001');
}

seed().catch(console.error);
```

Add to `apps/api/package.json` scripts:
```json
"seed": "npx ts-node -r tsconfig-paths/register ../../scripts/seed.ts"
```

Install `node-fetch` for the seed script:
```bash
npm install -D node-fetch@2 @types/node-fetch ts-node tsconfig-paths
```

- [ ] **Step 2: Run seed**

```bash
docker compose up -d
# Wait for API to be healthy, then:
cd apps/api && npm run seed
# Expected: 8 products seeded and reindexed
```

- [ ] **Step 3: Smoke-test full system**

```bash
# Search
curl -s "http://localhost:3000/search?q=kurta" | jq '.data | length'
# Expected: at least 1

# Health
curl -s http://localhost:3000/health/ready | jq '.data.status'
# Expected: "ok"

# Track event and get recs
PROD_ID=$(curl -s http://localhost:3000/products | jq -r '.data.items[0].id')
curl -s -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d "{\"event_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"user_id\":\"test-user\",\"product_id\":\"$PROD_ID\",\"event_type\":\"purchase\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"metadata\":{\"source\":\"homepage\"}}"

sleep 2
curl -s "http://localhost:3000/recommendations/trending" | jq '.data | length'
# Expected: at least 1
```

- [ ] **Step 4: Commit**

```bash
git add scripts/
git commit -m "feat: add seed script with 8 sample fashion products"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| Product CRUD + PostgreSQL | Task 4, 5 |
| SKU-level variants | Task 4 (ProductVariant entity) |
| product_metrics persistence | Task 4 (entity), Task 8 (cron flush) |
| ES full-text search + filters + sort | Task 6 |
| ES multi-field mapping | Task 6 (ensureIndex) |
| ES async sync via events | Task 6 (ProductSyncListener) |
| ES retry on failure | Task 6 (3-attempt backoff) |
| POST /events with dedup | Task 7 (EventService.setNX) |
| Redis Streams (XADD/XREADGROUP) | Task 7 (StreamProducer, StreamConsumer) |
| Scoring: weights + recency + boost | Task 8 (getForUser, getTrendingRaw) |
| Personalization boost 1.2x | Task 8 (getForUser scoring) |
| New product exploration boost | NOT yet implemented — add 1.5x boost in StreamConsumer.processEvent by checking product created_at |
| Cold start fallback | Task 8 (lRange returns [] → getTrendingRaw) |
| Batch cron flush to Postgres | Task 8 (flushMetrics @Cron 30s) |
| Cache-aside for products | Task 5 (findById) |
| Versioned Redis keys (v1:) | Tasks 7, 8 |
| Optimistic locking | Task 5 (update with version WHERE clause) |
| Rate limiting (stricter on /events) | Task 7 (EventsController @Throttle) |
| Keyset pagination | Task 5 (findAll with cursor) |
| LoggingInterceptor | Task 2 |
| TransformInterceptor | Task 2 |
| /health/live + /health/ready | Task 9 |
| Docker Compose (all 5 services) | Task 1 |
| Next.js search page | Task 10 |
| Product detail + recs | Task 10 |
| TrackView fires on product page load | Task 10 (TrackView.tsx) |
| Sample seed data | Task 11 |

**Gap found:** New product exploration boost (score × 1.5 for products < 24h old) was designed in the spec but not wired into StreamConsumer. Add to `processEvent` in Task 7's StreamConsumer:

```typescript
// In processEvent, after computing weight — check product age via a Redis key set at creation
// ProductService.create() should: await this.cache.set(`v1:product:${saved.id}:created_at`, saved.created_at.toISOString(), 86400 * 2);
// Then in StreamConsumer.processEvent:
const createdAt = await this.redis.get(`v1:product:${product_id}:created_at`);
const ageHours  = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 3600000 : 999;
const explorationBoost = ageHours < 24 ? 1.5 : 1.0;
const boostedWeight = weight * explorationBoost;
await this.cache.incrByFloat(`v1:metrics:${event_type}s:${product_id}`, boostedWeight);
await this.cache.zIncrBy('v1:trending:products', boostedWeight, product_id);
```

Add `await this.cache.set(\`v1:product:${saved.id}:created_at\`, saved.created_at.toISOString(), 172800)` to `ProductService.create()` after saving.

**Placeholder scan:** None found. All steps contain actionable code.

**Type consistency:** `ProductService.findByIds` returns `Product[]`, consumed by `RecommendationService.getForUser` — consistent. `CacheService.zRevRangeWithScores` returns `string[]` (alternating id/score pairs), parsed correctly in `getTrendingRaw` — consistent.
