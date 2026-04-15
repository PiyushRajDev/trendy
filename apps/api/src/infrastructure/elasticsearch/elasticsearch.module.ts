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
