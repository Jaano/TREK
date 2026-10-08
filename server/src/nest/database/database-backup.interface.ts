/**
 * How a backup, a restore and the demo reset get at the core database, without
 * knowing which engine holds it.
 *
 * The admin backup (`nest/backup/backup.impl.ts`), its restore, and the demo
 * baseline save and hourly reset (`demo/demo-reset.ts`) all go through this
 * port. The only implementation today is `SqliteDatabaseBackup`
 * (`nest/backup/`), which does what those paths always did: `VACUUM INTO` for a
 * consistent copy of the file, a file swap under a closed connection for a
 * restore. An engine that is not one local file would plug in here with a
 * logical dump and load instead.
 *
 * Lives in the shared database kernel, not in the backup domain, so the admin
 * domain (the demo reset job, the baseline route) can inject it without
 * importing the backup domain.
 */
export interface DatabaseBackupStrategy {
  /** The name the database takes inside a backup archive. */
  readonly archiveEntry: string;

  /**
   * Where the live database is, for log lines. The file path for SQLite; it
   * names no file only for the in-memory database the test suites run on.
   */
  location(): string;

  /** Whether there is a database this strategy can copy. False for an in-memory one. */
  canSnapshot(): boolean;

  /**
   * Flushes what the engine keeps beside its main store (SQLite's WAL) into it.
   * Best effort for every caller: a failure leaves the snapshot consistent, just
   * slower to take.
   */
  checkpoint(): Promise<void>;

  /**
   * Writes a consistent, point-in-time copy of the live database to `target`,
   * which must not exist yet. Throws when no complete copy could be written,
   * and then leaves nothing at `target`.
   */
  snapshot(target: string): Promise<void>;

  /**
   * Checks an unpacked archive's database before anything is replaced. Returns
   * null when it can be restored, or the refusal in the restore route's words.
   */
  verify(extractDir: string): DatabaseBackupRefusal | null;

  /**
   * Keeps a copy of the database a restore is about to replace. Best effort: a
   * database broken enough to need the restore may not copy, and that must not
   * block the recovery. Resolves with where the copy went, or null.
   */
  keepCopyBeforeRestore(): Promise<string | null>;

  /**
   * Puts `source` (a database this strategy wrote or verified) in place of the
   * live one, then reopens the connection, migrating it forward. The reopen
   * runs even when the swap throws, so the process is never left without a
   * connection; the swap's error is rethrown after it.
   *
   * Resolves with `reopenError` set when the new database landed but the
   * connection could not be reopened: the caller reports "restart required".
   */
  replace(source: string): Promise<{ reopenError: unknown }>;
}

/** A refusal in the restore route's own words and status. */
export interface DatabaseBackupRefusal {
  error: string;
  status: number;
}

/** Injection token for the active `DatabaseBackupStrategy`. */
export const DATABASE_BACKUP = Symbol('DATABASE_BACKUP');
