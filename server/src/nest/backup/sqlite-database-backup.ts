import fs from 'fs';
import path from 'path';
import { Injectable } from '@nestjs/common';
import { MaintenanceRepository } from '../../db/repositories/MaintenanceRepository';
import { DatabaseLifecycle } from '../database/database-lifecycle.service';
import type { DatabaseBackupRefusal, DatabaseBackupStrategy } from '../database/database-backup.interface';
import { logInfo, logWarn } from '../audit/audit-log.logger';
import { checkBackupDatabase } from './backup-archive';

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The backup port for the one engine TREK runs on: a SQLite file.
 *
 * Every step is what `backup.impl.ts` and `demo/demo-reset.ts` did inline
 * before the port existed. A snapshot is `VACUUM INTO`, which takes a
 * consistent copy even under concurrent writers. A restore closes the
 * connection, swaps the file by copy and rename (a crash mid-swap leaves the
 * old or the new file, never neither), drops the old `-wal`/`-shm` sidecars,
 * and reopens through `DatabaseLifecycle`, which migrates the restored file
 * forward.
 *
 * The file is always `DatabaseLifecycle.file`, the path the connection was
 * opened on, so `TREK_DB_FILE` moves the backup, the restore and the demo reset
 * along with the database.
 */
@Injectable()
export class SqliteDatabaseBackup implements DatabaseBackupStrategy {
  readonly archiveEntry = 'travel.db';

  constructor(
    private readonly lifecycle: DatabaseLifecycle,
    private readonly maintenance: MaintenanceRepository,
  ) {}

  location(): string {
    return this.lifecycle.file;
  }

  canSnapshot(): boolean {
    const file = this.lifecycle.file;
    return file !== ':memory:' && fs.existsSync(file);
  }

  async checkpoint(): Promise<void> {
    await this.maintenance.walCheckpoint();
  }

  async snapshot(target: string): Promise<void> {
    try {
      await this.maintenance.vacuumInto(target);
    } catch (err) {
      // A VACUUM INTO that failed part-way (a full disk) can leave a truncated
      // file behind. Nothing may mistake it for a copy.
      fs.rmSync(target, { force: true });
      throw err;
    }
  }

  verify(extractDir: string): DatabaseBackupRefusal | null {
    return checkBackupDatabase(extractDir);
  }

  /**
   * A copy of the database a restore is about to replace, next to it. The swap
   * deletes the current file, and a restore of the wrong archive used to leave
   * nothing to go back to.
   */
  async keepCopyBeforeRestore(): Promise<string | null> {
    const target = path.join(path.dirname(this.lifecycle.file), `pre-restore-${Date.now()}.db`);
    try {
      await this.snapshot(target);
      logInfo(`Restore: the replaced database was kept as ${target}`);
      return target;
    } catch (err) {
      logWarn(`Restore: could not keep a copy of the current database (${describeError(err)})`);
      return null;
    }
  }

  async replace(source: string): Promise<{ reopenError: unknown }> {
    const dest = this.lifecycle.file;
    this.lifecycle.close();
    let reopenError: unknown = null;
    try {
      // Copy to a temp file on the SAME filesystem, drop the old sidecars (they
      // belong to the database being replaced and would corrupt the new one),
      // then rename into place. The rename is atomic.
      const tmp = dest + '.restore-tmp';
      fs.copyFileSync(source, tmp);
      for (const ext of ['-wal', '-shm']) {
        try {
          fs.unlinkSync(dest + ext);
        } catch {
          /* no sidecar to drop */
        }
      }
      fs.renameSync(tmp, dest);
    } finally {
      // Reopening must always run, even when the swap threw, so the process is
      // never left without a connection. A reopen failure is reported, not
      // thrown: the files already landed and the caller has to say "restart".
      try {
        await this.lifecycle.reopen();
      } catch (err) {
        reopenError = err;
      }
    }
    return { reopenError };
  }
}
