# StyleSense 👗

StyleSense is a modern, high-performance Fashion Recommendation & Search Engine built with a modular monorepo architecture. It features a complete e-commerce backend powered by NestJS and a responsive frontend built with Next.js 14.

The system is designed for high-scale retail operations, utilizing Elasticsearch for lightning-fast catalog search, Redis Streams for durable user behavior tracking, and PostgreSQL as the reliable source of truth.

## 🏗 Architecture

StyleSense employs a modular monolith architecture running in a unified runtime separated by well-defined module boundaries:

- **Product Module**: Manages product CRUD operations, SKU-level variants, and optimistic locking to prevent race conditions during updates.
- **Search Module**: Integrates with Elasticsearch 8. Features real-time catalog syncing via internal events and provides faceted searching with weights and boosts.
- **Events Module**: Collects user behavioral events (views, cart adds, purchases). Pushes securely onto Redis Streams for asynchronous decoupling.
- **Recommendations Module**: Calculates user-specific recommendations in real-time utilizing Redis sorted sets, factoring in recency scoring and exploring new inventory.
- **Cache Module**: Wrapper around `ioredis` handling cache-aside patterns, sets, and lists.
- **Frontend App**: Next.js 14 server components shell with rich client-side search facets and interaction tracking.

## 🛠 Tech Stack

- **Backend**: NestJS 10, TypeScript 5, TypeORM 0.3
- **Frontend**: Next.js 14 (App Router), Tailwind CSS
- **Database**: PostgreSQL 15
- **Search Engine**: Elasticsearch 8.11
- **Real-Time Data**: Redis 7 (Sorted Sets, Streams)
- **Deployment**: Docker Compose

## 🚀 Quickstart Guide

### Prerequisites
Make sure you have Node 20+, Docker, and Docker Compose installed.

### 1. Environment Setup

Clone the project and copy the `.env.example` file to create your environment variables:

```bash
cp .env.example .env
cp .env apps/api/.env
cp .env apps/web/.env
```

### 2. Run the Infrastructure Layer

Start PostgreSQL, Redis, and Elasticsearch using Docker Compose:

```bash
docker compose up -d postgres redis elasticsearch
```

### 3. Install Dependencies

Install packages for both the API and Web apps:

```bash
npm install -w api
npm install -w web
```

### 4. Start the Application

You can start the NestJS backend and Next.js frontend in development mode.

**Terminal 1 (Backend API):**
```bash
cd apps/api
npm run start:dev
```
*The API will start at `http://localhost:3000` and automatically synchronize the PostgreSQL schema on its first run.*

**Terminal 2 (Frontend Web):**
```bash
cd apps/web
npm run dev
```
*The frontend will run at `http://localhost:3001`.*

## 📦 Seeding Sample Data

To populate your database and Elasticsearch index with some initial fashion items (required for search and recommendations to work properly):

```bash
# Ensure the API is running, then run:
cd apps/api
npm run seed
```

This will:
- Create 8 generic products with multiple SKUs/variants.
- Persist them into PostgreSQL.
- Trigger an event emitter to re-index all created products into Elasticsearch.

## 🌐 API Verification & Smoke Tests

You can test that the system and recommendation engine are functioning properly by running these commands:

**Check Backend Health:**
```bash
curl -s http://localhost:3000/health/ready
```

**Search the Catalog:**
```bash
curl -s "http://localhost:3000/search?q=kurta" | jq
```

**Track a Purchase Event:**
```bash
# Get a product ID first to test the streaming backend
PROD_ID=$(curl -s http://localhost:3000/products | jq -r '.data.items[0].id')

# Simulate a purchase event
curl -s -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d "{\"event_id\":\"$(uuidgen)\",\"user_id\":\"demo-user\",\"product_id\":\"$PROD_ID\",\"event_type\":\"purchase\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"metadata\":{\"source\":\"docs\"}}"
```

## 📝 License
StyleSense is totally open-source and free to customize. See `LICENSE` for details.
