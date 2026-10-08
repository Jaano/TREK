import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { logInfo, logError } from '../audit/audit-log.logger';
import { RuntimeEnvService } from '../app-config/runtime-env.service';
import { CronRegistrarService } from '../scheduling/cron-registrar.service';
import { DATABASE_BACKUP, type DatabaseBackupStrategy } from '../database/database-backup.interface';
import { withRequestContext } from '../database/request-context';
import { hasBaseline, resetDemoUser, saveBaseline } from '../../demo/demo-reset';

/**
 * Demo mode: hourly reset of demo user data (moved from src/scheduler.ts).
 * Gated on DEMO_MODE at bootstrap — parity: toggling it always required a
 * restart — and scheduled in the server-local zone (the old cron.schedule call
 * passed no timezone). demo-reset is a static import: its module top is
 * side-effect-free, and the close/swap/reopen sequence runs inside
 * resetDemoUser at tick time, through the injected backup port.
 *
 * It also saves the first baseline, on a demo boot that has none. That used to
 * happen inside the boot-time demo seed, which runs before the container can
 * hand anything in; here the port is injected like everywhere else.
 */
@Injectable()
export class DemoResetJob implements OnApplicationBootstrap {
  constructor(
    private readonly runtimeEnv: RuntimeEnvService,
    private readonly registrar: CronRegistrarService,
    @Inject(DATABASE_BACKUP) private readonly database: DatabaseBackupStrategy,
    private readonly em: EntityManager,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.runtimeEnv.isDemoMode()) return;
    if (this.registrar.isEnabled()) {
      // D6: the tick runs inside a request context, via CronRegistrarService's
      // one wrapper around every onTick.
      this.registrar.register('demo-reset', '0 * * * *', () => void this.tick(), { timezone: 'none' });
      logInfo('Demo hourly reset scheduled');
    }
    if (!hasBaseline()) await this.saveFirstBaseline();
  }

  async tick(): Promise<void> {
    try {
      await resetDemoUser(this.database);
    } catch (err: unknown) {
      logError(`Demo reset: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Boot runs outside any request, so the snapshot gets its own context. */
  private async saveFirstBaseline(): Promise<void> {
    try {
      await withRequestContext({ em: this.em }, () => saveBaseline(this.database));
    } catch (err: unknown) {
      logError(`Demo baseline: ${err instanceof Error ? err.message : err}`);
    }
  }
}
