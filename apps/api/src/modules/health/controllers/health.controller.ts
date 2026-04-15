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
