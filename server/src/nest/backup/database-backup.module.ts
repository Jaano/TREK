import { Global, Module } from '@nestjs/common';
import { DATABASE_BACKUP } from '../database/database-backup.interface';
import { DatabaseLifecycleModule } from '../database/database-lifecycle.module';
import { MaintenanceModule } from '../database/maintenance.module';
import { SqliteDatabaseBackup } from './sqlite-database-backup';

/**
 * Binds the database backup port (`DATABASE_BACKUP`) to the engine in use.
 *
 * Global because its consumers sit in two domains that must not depend on each
 * other: the backup domain itself and the admin domain (the demo reset job and
 * the baseline route). They inject the token from the shared database kernel
 * and never import this file. `BackupModule` imports it, which is what puts it
 * in the application.
 */
@Global()
@Module({
  imports: [DatabaseLifecycleModule, MaintenanceModule],
  providers: [SqliteDatabaseBackup, { provide: DATABASE_BACKUP, useExisting: SqliteDatabaseBackup }],
  exports: [DATABASE_BACKUP],
})
export class DatabaseBackupModule {}
