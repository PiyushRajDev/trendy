export default () => ({
  nodeEnv:          process.env.NODE_ENV ?? 'development',
  port:             parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl:      process.env.DATABASE_URL,
  redisHost:        process.env.REDIS_HOST ?? 'localhost',
  redisPort:        parseInt(process.env.REDIS_PORT ?? '6379', 10),
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
});
