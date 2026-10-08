/**
 * The Postgres probe's ratchet: how many statements of each repository method
 * Postgres may still refuse.
 *
 * `scripts/pg-probe-baseline.json` maps `Class.method` to the number of
 * distinct statements of that method that failed on Postgres when the entry
 * was written. A method may fail no more statements than its entry (none
 * without one), and an entry above what its method fails now fails the check
 * too, so the change that fixes a statement lowers the baseline with it.
 * `--update` lowers entries and drops the ones that reach zero or whose
 * method is gone; it never raises or adds one. The only exception is the
 * first run: a baseline whose `failing` is `null` has never been measured,
 * so there is nothing to compare and the run fails (scripts/pg-probe.ts)
 * until the first measurement, written by `--update` or taken from the CI
 * artifact, is committed.
 */

import { readFileSync } from 'node:fs';

export interface ProbeBaseline {
  /** `Class.method` → failing statements allowed; `null` until the first measurement is written. */
  failing: Record<string, number> | null;
}

export interface BaselineVerdict {
  /** The baseline has never been measured: nothing to compare, and the run fails until it is seeded. */
  unseeded: boolean;
  /** Methods failing more statements than their entry allows. */
  grown: { method: string; allowed: number; now: number }[];
  /** Entries above what their method fails now (the method may be gone). */
  stale: { method: string; allowed: number; now: number }[];
}

export function parseBaseline(text: string, source: string): ProbeBaseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !('failing' in data)) {
    throw new Error(`${source} must be an object with a "failing" key`);
  }
  const failing = (data as { failing: unknown }).failing;
  if (failing === null) return { failing: null };
  if (typeof failing !== 'object' || Array.isArray(failing)) {
    throw new Error(`${source}: "failing" must be null or an object of Class.method to counts`);
  }
  const entries: Record<string, number> = {};
  for (const [method, count] of Object.entries(failing as Record<string, unknown>)) {
    if (!/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(method)) {
      throw new Error(`${source}: "${method}" is not a Class.method key`);
    }
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new Error(`${source}: ${method} holds ${JSON.stringify(count)}, expected a positive integer`);
    }
    entries[method] = count;
  }
  return { failing: entries };
}

export function readBaseline(path: string): ProbeBaseline {
  return parseBaseline(readFileSync(path, 'utf8'), path);
}

/** Compares what failed now (`Class.method` → failing statements, zero counts allowed) with the baseline. */
export function compareWithBaseline(baseline: ProbeBaseline, failingNow: ReadonlyMap<string, number>): BaselineVerdict {
  if (baseline.failing === null) return { unseeded: true, grown: [], stale: [] };
  const allowedFor = baseline.failing;
  const grown: BaselineVerdict['grown'] = [];
  const stale: BaselineVerdict['stale'] = [];
  for (const [method, now] of [...failingNow.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const allowed = allowedFor[method] ?? 0;
    if (now > allowed) grown.push({ method, allowed, now });
  }
  for (const method of Object.keys(allowedFor).sort()) {
    const allowed = allowedFor[method]!;
    const now = failingNow.get(method) ?? 0;
    if (now < allowed) stale.push({ method, allowed, now });
  }
  return { unseeded: false, grown, stale };
}

/**
 * The baseline `--update` writes: every entry lowered to what its method
 * fails now, zeros dropped, nothing added. An unseeded baseline is seeded
 * with everything that fails now.
 */
export function lowerBaseline(baseline: ProbeBaseline, failingNow: ReadonlyMap<string, number>): ProbeBaseline {
  const next: Record<string, number> = {};
  if (baseline.failing === null) {
    for (const [method, now] of failingNow) if (now > 0) next[method] = now;
  } else {
    for (const [method, allowed] of Object.entries(baseline.failing)) {
      const now = Math.min(allowed, failingNow.get(method) ?? 0);
      if (now > 0) next[method] = now;
    }
  }
  return { failing: Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))) };
}

export function formatBaseline(baseline: ProbeBaseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}
