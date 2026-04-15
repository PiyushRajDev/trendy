# StyleSense — Fashion Recommendation & Search Engine
## System Design Specification
**Date:** 2026-04-15  
**Author:** PiyushRajDev  
**Status:** Approved

---

## 1. Problem Statement

Build a production-grade backend system simulating how a large-scale fashion e-commerce platform (Myntra-scale) handles product catalog management, advanced search, user behavior tracking, and personalized recommendations — with enough engineering rigor to be defensible under senior backend interview questioning.

---

## 2. Scope & Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Modular monolith | Right first choice before microservices; module boundaries allow future extraction |
| Event system | Redis Streams | Already in stack; consumer groups; persistent; sufficient for this scale |
| Auth | None (userId as param) | Interview signal is in search/recommendations/events, not auth boilerplate |
| Frontend | Next.js (Search + Product Detail + Recs) | Demonstrates full user journey end-to-end |
| Deployment | Docker Compose (local) | Shows system design, not DevOps |

---

## 3. Architecture

### 3.1 Style

**Modular Monolith with Clean Architecture layering.**

One NestJS process. Six internal modules. All cross-module communication through service interfaces — never through repositories. An internal EventEmitter2 bus handles domain events synchronously within the process. Redis Streams handles durable async event storage for analytics and retry.

```
POST /events
  → EventModule.track()
    → Redis Streams XADD (durable, O(1))     [async durability]
    → EventEmitter2.emit('product.viewed')   [in-process, fast]
      → RecommendationModule listener
        → update Redis scoring (trending set)
        → bust user recs cache
  → 202 Accepted                             [API never blocks on scoring]
```

### 3.2 Module Map

```
stylesense/apps/api/src/
├── modules/
│   ├── product/            ← Catalog CRUD, PostgreSQL source of truth
│   │   ├── controllers/
│   │   ├── services/       ← ProductService (public interface)
│   │   ├── repositories/   ← ProductRepository (private to module)
│   │   ├── entities/       ← TypeORM entities
│   │   ├── dto/
│   │   └── interfaces/     ← IProduct, IProductVariant
│   ├── search/             ← Elasticsearch read/write
│   │   ├── services/       ← SearchService (public interface)
│   │   └── ...
│   ├── events/             ← Event tracking
│   │   ├── event.service.ts        ← Public API, deduplication
│   │   ├── event.publisher.ts      ← EventEmitter2 emit
│   │   ├── stream.producer.ts      ← Redis Streams XADD
│   │   └── stream.consumer.ts      ← Redis Streams consumer group
│   ├── recommendations/    ← Scoring engine + cache
│   │   ├── services/
│   │   └── listeners/      ← @OnEvent handlers
│   ├── cache/              ← Redis wrapper + invalidation
│   └── health/             ← /health/live + /health/ready
├── infrastructure/
│   ├── database/           ← TypeORM config, migrations
│   ├── redis/              ← ioredis client
│   ├── elasticsearch/      ← @elastic/elasticsearch client
│   └── logger/             ← Winston setup
├── config/                 ← app.config, redis.config, db.config, es.config
├── common/
│   ├── interceptors/       ← LoggingInterceptor, TransformInterceptor
│   ├── pipes/              ← ValidationPipe
│   ├── guards/             ← ThrottlerGuard (rate limiting)
│   └── dto/                ← PaginationDto
└── main.ts
```

**Rule enforced:** A module's `repository/` is `private`. Other modules call only `service/` interfaces. This preserves extractability — any module can become a microservice by swapping the service call to an HTTP/gRPC client.

**EventEmitter2 role clarified:** EventEmitter2 is used exclusively for low-latency in-process reactions (e.g., busting a cache key the moment an event arrives). It is NOT the durability source. Redis Streams is the durability source. If EventEmitter2 fires but Redis is down, the in-process side-effects still run; durability is simply absent for that window. In production at higher scale, EventEmitter2 would be removed and all consumers would read exclusively from the Redis Stream — single source of truth for all event consumers.

---

## 4. Data Models

### 4.1 PostgreSQL

```sql
-- Source of truth for all product data

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  brand       VARCHAR(100) NOT NULL,
  category    VARCHAR(100) NOT NULL,
  tags        TEXT[] DEFAULT '{}',
  image_url   VARCHAR(500),
  is_deleted  BOOLEAN DEFAULT FALSE,
  version     INTEGER DEFAULT 1,           -- optimistic locking
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index for filtered + paginated listing
CREATE INDEX idx_products_category_price ON products (category, id);
CREATE INDEX idx_products_brand ON products (brand);

CREATE TABLE product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  sku_code    VARCHAR(100) UNIQUE NOT NULL,
  size        VARCHAR(20),
  color       VARCHAR(50),
  price       DECIMAL(10,2) NOT NULL,
  stock       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_variants_product_id ON product_variants (product_id);
CREATE INDEX idx_variants_price ON product_variants (price);

-- Analytics persistence (fallback when Redis resets)
CREATE TABLE product_metrics (
  product_id      UUID PRIMARY KEY REFERENCES products(id),
  views_count     BIGINT DEFAULT 0,
  clicks_count    BIGINT DEFAULT 0,
  cart_adds_count BIGINT DEFAULT 0,
  purchases_count BIGINT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**Optimistic locking:** On update, service executes `UPDATE products SET ... WHERE id = $1 AND version = $2`, incrementing version. If 0 rows updated → throw `ConflictException`. Prevents lost updates under concurrent writes.

**Read/write separation:** All writes target the primary. `GET /products`, recommendation queries, and analytics reads target the read replica (configured via `DATABASE_REPLICA_URL`).

### 4.2 Elasticsearch Index

```json
{
  "mappings": {
    "properties": {
      "id":       { "type": "keyword" },
      "name": {
        "type": "text",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "brand":    { "type": "keyword" },
      "category": { "type": "keyword" },
      "price":    { "type": "float" },
      "rating":   { "type": "float" },
      "tags":     { "type": "keyword" }
    }
  }
}
```

`name` multi-field supports both full-text relevance (`name`) and exact match / aggregations (`name.keyword`).

**Search ranking:** Queries use ES's BM25 relevance scoring for text match, combined with a `function_score` query that boosts results by `rating` and `popularity_score` (seeded from `product_metrics`). Filters (category, brand, price range) use `filter` context (not `query` context) — they don't affect relevance score, only include/exclude documents. Sorting by `price` or `popularity` bypasses BM25 entirely and uses field sort. This allows the interviewer answer: "I separate relevance ranking from business ranking."

**Consistency model:** ES is a derived index, not a source of truth. Search index lag of a few seconds is explicitly acceptable — catalog updates (new product, price change) are not latency-sensitive for the end user. A product appearing in search 2–3 seconds after creation is a reasonable trade-off for the decoupling benefits. When a product is written to Postgres, a `product.updated` event is pushed to the Redis Stream. The stream consumer indexes to ES and ACKs on success. Failure leaves the message pending — retried on next consumer tick. If ES is completely down, the admin endpoint `POST /search/reindex` re-syncs from Postgres on recovery.

### 4.3 Redis Key Schema (versioned)

```
v1:product:{id}               → JSON string, TTL 1h
v1:trending:products          → Sorted set, score = weighted event score, TTL 15m
v1:user:{userId}:recent       → List of productIds (LPUSH + LTRIM to 20), TTL 7d
v1:user:{userId}:recs         → JSON string (cached recommendation result), TTL 5m
v1:event-dedup:{event_id}     → "1" (NX flag for idempotency), TTL 24h
v1:metrics:views:{product_id} → Counter, flushed to Postgres every 30s
v1:metrics:clicks:{product_id}
v1:metrics:cart_adds:{product_id}
v1:metrics:purchases:{product_id}
stream:events                 → Redis Stream key (persistent, consumer group: recommendations)
```

**Key versioning:** Prefix `v1:` allows rolling key schema changes without a full cache flush. Bump to `v2:` when schema changes; old keys expire naturally by TTL.

### 4.4 Event Schema

```typescript
interface TrackEventDto {
  event_id:   string;   // UUID, client-generated for idempotency
  user_id:    string;
  product_id: string;
  event_type: 'product_view' | 'product_click' | 'add_to_cart' | 'purchase';
  timestamp:  string;   // ISO 8601
  metadata: {
    source: 'search' | 'recommendation' | 'homepage' | 'direct';
  };
}
```

Designed for extensibility — `metadata` accepts future ML features (session_id, position_in_results, A/B variant) without schema changes.

---

## 5. Recommendation Engine

### 5.1 Scoring Formula

```
global_score = (views × 1) + (clicks × 2) + (cart_adds × 5) + (purchases × 10)

recency_decay = 1.0 if event < 24h
              = 0.75 if event 24h–72h
              = 0.5 if event 72h–7d
              = 0 if event > 7d

personalization_boost = 1.2 if user interacted with this product/brand/category recently
                      = 1.0 otherwise

final_score = global_score × recency_decay × personalization_boost
```

Exploration boost for new products:
```
if product_age < 24h: score *= 1.5
```
Prevents new product starvation — earns trending exposure while accumulating real event data.

### 5.2 Recommendation Types

| Endpoint | Logic |
|---|---|
| `GET /recommendations/:userId` | User's `v1:user:{userId}:recs` cache → scoring on interacted products → personalized sorted set → fallback to trending (cold start) |
| `GET /recommendations/trending` | `v1:trending:products` sorted set (ZREVRANGE), TTL 15m |
| Product page "You may also like" | Same category + similar tags, excluding already viewed |

**Computation model (explicitly stated):** This implementation uses hybrid computation — the global trending sorted set is updated reactively on each event (async via stream consumer), while per-user personalization is computed on-demand and cached for 5 minutes. This is the right model at this scale. At 10x scale, the evolution path is: move to fully pre-computed per-user recommendations (background job recomputes on each event, result stored in Redis). Serve-time computation is eliminated entirely. The 5m cache TTL is already a step toward this — it amortizes compute cost across requests.

### 5.3 Cold Start

- **New user:** Falls back to `GET /recommendations/trending`
- **New product:** Gets exploration boost (`score × 1.5`) for first 24h

---

## 6. Event System

### 6.1 Flow

```
POST /events
  1. Validate + dedup (Redis SET v1:event-dedup:{event_id} NX EX 86400)
     └── duplicate → return 202 silently (idempotent)
  2. XADD stream:events (Redis Streams — durable)
  3. EventEmitter2.emit(event_type, payload)  (in-process — fast)
  4. Return 202 Accepted

Consumer group 'recommendations' reads stream:events:
  → update Redis scoring counters (O(1))
  → update v1:trending sorted set
  → bust v1:user:{userId}:recs

@Cron every 30s:
  → read Redis metric counters
  → batch-upsert product_metrics (Postgres)
  → reset counters
```

### 6.2 Backpressure Strategy

Under spike load (>2000 events/sec):
- **Purchase/cart events:** Always processed, never dropped
- **View/click events:** Shed under consumer lag > 10,000 messages
- Consumer group lag exposed via `GET /health/ready` — operator alert signal
- Reasoning: "We prioritize purchase signal quality over view completeness under load"

### 6.3 Degradation When Redis Is Down

- API routes: **unaffected** (Postgres still serves reads)
- Event durability: **degraded** — in-process EventEmitter2 still fires, but stream persistence lost
- Analytics: **partially lost** for events during outage window
- Communicated honestly: best-effort analytics is an acceptable trade-off for event tracking at this layer

---

## 7. API Specification

All endpoints return:
```json
{ "data": ..., "meta": { "page": 1, "limit": 20, "total": 150 } }
```

| Method | Path | Description |
|---|---|---|
| `GET` | `/products` | Paginated catalog. Hits Postgres read replica. Keyset pagination on `id`. Composite index on `(category, id)` |
| `GET` | `/products/:id` | Single product + variants. Cache-aside: Redis → Postgres fallback |
| `POST` | `/products` | Create. Writes Postgres → emits `product.updated` → async ES index → cache bust |
| `PUT` | `/products/:id` | Update with optimistic lock. Same async ES sync |
| `DELETE` | `/products/:id` | Soft delete (`is_deleted = true`). Removes from ES index |
| `GET` | `/search` | Elasticsearch query. Params: `q`, `category`, `brand`, `minPrice`, `maxPrice`, `sort` (relevance\|price\|rating\|popularity), `page`, `limit` |
| `POST` | `/events` | Track user event. 202 immediately. Deduped by `event_id` |
| `GET` | `/recommendations/:userId` | Personalized recs. Redis cache → scoring → cold start fallback |
| `GET` | `/recommendations/trending` | Global trending (Redis sorted set) |
| `GET` | `/health/live` | Process liveness |
| `GET` | `/health/ready` | Dependency readiness: Postgres + Redis + Elasticsearch |

---

## 8. Caching Strategy

| Key | TTL | Invalidation trigger |
|---|---|---|
| `v1:product:{id}` | 1h | Product update/delete |
| `v1:trending:products` | 15m | TTL-based (high churn, manual invalidation expensive) |
| `v1:user:{userId}:recs` | 5m | Any event from this user |
| `v1:user:{userId}:recent` | 7d | New view event (LPUSH + LTRIM) |

**Not cached:** Paginated product lists (cardinality explosion with filter combinations).

---

## 9. Performance & Reliability

| Concern | Solution |
|---|---|
| Rate limiting | `@nestjs/throttler` — 100 req/min per IP on general routes; **`POST /events` is stricter: 300 req/min with per-user throttle** to prevent event flooding and abuse |
| Request logging | `LoggingInterceptor` — logs method, path, status, duration automatically |
| Response transform | `TransformInterceptor` — wraps all responses in standard envelope |
| DB connection pool | TypeORM pool (min 2, max 10), PgBouncer noted as next scaling step |
| Slow queries | Keyset pagination (no OFFSET), composite indexes, read replica for reads |
| Elasticsearch bulk | `POST /search/reindex` uses bulk API with configurable batch size |
| Concurrency control | Optimistic locking on `products.version` column |

---

## 10. Frontend (Next.js)

**Pages:**
- `/` — Search page: search bar, filters (category, brand, price range, sort), product card grid
- `/products/[id]` — Product detail: full product info + variants + "You may also like" section

**API communication:** Next.js server components call the NestJS API directly. No client-side secrets. `userId` passed as a cookie-stored anonymous ID (UUID generated on first visit, stored in localStorage + sent as `X-User-Id` header).

**Security note on userId:** The `X-User-Id` header is spoofable — this is a known and accepted simplification. The system operates within a trusted boundary for this implementation. In production, `userId` would be extracted from a verified JWT/session token by an API Gateway or auth middleware, never trusted from the client directly. The module boundary is already clean enough to add this without refactoring any service internals.

---

## 11. Docker Compose

Services:
```yaml
services:
  api:          # NestJS — port 3000
  web:          # Next.js — port 3001
  postgres:     # PostgreSQL 15 — port 5432
  redis:        # Redis 7 — port 6379
  elasticsearch: # ES 8 — port 9200
```

All services networked on `stylesense-net`. Healthchecks on all infrastructure services. Postgres and Redis use named volumes for data persistence across restarts.

---

## 12. Scaling Roadmap (Interview-Ready)

| Scale trigger | Action |
|---|---|
| Read traffic 10x | Redis Replica nodes (read from replica, write to primary); ES data node scale-out |
| Redis single node (SPOF) | Redis Sentinel (automatic failover) → Redis Cluster (horizontal sharding) at higher scale |
| Write traffic 10x | Postgres primary vertical scale + PgBouncer |
| Event volume 100x | Extract stream consumer to dedicated worker process (module boundary already exists) |
| Recommendation latency | Pre-compute recommendations async on event, eliminate on-demand compute |
| Multi-region | Redis Cluster, Postgres global database, ES cross-cluster replication |
| Extract to microservices | `RecommendationModule` → dedicated service; swap `RecommendationService` import for HTTP client — zero refactor to module internals |

---

## 13. Trade-offs

| Decision | Trade-off accepted |
|---|---|
| Modular monolith | Single deploy unit — horizontal scaling requires stateless design (already true) |
| ES eventual consistency | Search index lags writes by 2–3 seconds — explicitly acceptable; catalog updates are not latency-sensitive |
| Redis analytics | Counter loss on Redis failure — acceptable for analytics, not for transactional data |
| No auth | Simplifies architecture — userId treated as trusted in this system boundary |
| TTL-based trending invalidation | 15min stale window — acceptable; manual invalidation on every event is too expensive |
| Best-effort event dedup | 24h Redis TTL — duplicate events possible after TTL; acceptable for analytics use case |
