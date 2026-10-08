import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { logError, logInfo } from '../audit/audit-log.logger';
import { CronRegistrarService } from '../scheduling/cron-registrar.service';
import { SessionsService } from './sessions.service';

/**
 * Nightly removal of the `user_sessions` rows that no longer let anyone in:
 * expired ones, and revoked ones. Every sign-in writes a row, so without this
 * the table would grow by one row per login for as long as the install runs.
 * Deleting a revoked row changes nothing for its token, which a missing row
 * refuses just the same.
 */
@Injectable()
export class SessionPurgeJob implements OnApplicationBootstrap {
  constructor(
    private readonly sessions: SessionsService,
    private readonly registrar: CronRegistrarService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.registrar.isEnabled()) return;
    this.registrar.register('session-purge', '45 3 * * *', () => this.tick());
  }

  async tick(now: Date = new Date()): Promise<void> {
    try {
      const removed = await this.sessions.purgeInactive(now);
      if (removed > 0) logInfo(`Session purge: removed ${removed} expired or revoked session(s)`);
    } catch (err: unknown) {
      logError(`Session purge: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
