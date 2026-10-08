import type { SchedulerLeases } from '../entities/SchedulerLeases.entity';
import { TrekRepository } from './_shared/trek-repository';

/**
 * `scheduler_leases`: which process may run a cron job's tick, and until when
 * (`CronRegistrarService`). A lease is free when no row exists yet, when its
 * `expires_at` has passed, or when the asking process already holds it.
 */
export class SchedulerLeasesRepository extends TrekRepository<SchedulerLeases> {
  /**
   * Take (or renew) the lease on `name` for `owner` until `until`, if it is
   * free at `now`. The decision is one conditional UPDATE, so of two
   * processes asking at the same moment exactly one gets a changed row; the
   * insert before it only makes sure there is a row to race on. True when
   * `owner` holds the lease afterwards.
   */
  async acquire(name: string, owner: string, now: number, until: number): Promise<boolean> {
    await this.upsert(
      { name, owner, expires_at: 0 },
      { onConflictFields: ['name'], onConflictAction: 'ignore' },
    );
    const changed = await this.nativeUpdate(
      { name, $or: [{ expires_at: { $lte: now } }, { owner }] },
      { owner, expires_at: until },
    );
    return changed > 0;
  }

  /** Move the expiry of a lease `owner` still holds; false when somebody else has it now. */
  async extend(name: string, owner: string, until: number): Promise<boolean> {
    const changed = await this.nativeUpdate({ name, owner }, { expires_at: until });
    return changed > 0;
  }

  /** The current holder and expiry, for diagnostics and tests. */
  async holder(name: string): Promise<{ owner: string; expires_at: number } | null> {
    const row = await this.findOne({ name }, { fields: ['owner', 'expires_at'] });
    return row ? { owner: row.owner, expires_at: row.expires_at } : null;
  }
}
