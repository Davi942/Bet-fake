import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class Database implements OnApplicationShutdown {
  readonly pool = new Pool({ connectionTimeoutMillis: 3000, query_timeout: 5000 });

  constructor() {
    // PostgreSQL restart can close idle connections. Keep HTTP alive to report
    // readiness as 503; pg discards the failed connection and reconnects later.
    this.pool.on('error', (error: Error) => {
      console.error('PostgreSQL idle connection lost:', error.message);
    });
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
