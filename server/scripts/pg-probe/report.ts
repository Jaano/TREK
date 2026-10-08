/**
 * Turns what the Postgres probe saw into counts, a console log and the
 * Markdown the CI job writes to its step summary.
 */

import type { BaselineVerdict } from './baseline';
import type { HelperResult } from './helper-cases';
import type { StatementRecord } from './recorder';

export interface MethodResult {
  /** `Class.method`. */
  key: string;
  statements: readonly StatementRecord[];
  /** Why the method was not called at all. */
  unprobeable?: string;
  /** The method threw (in JS, after or before its SQL); the statements it sent still count. */
  threw?: string;
  timedOut?: boolean;
}

export interface FailedStatement {
  method: string;
  code: string;
  message: string;
  sql: string;
}

export interface ProbeSummary {
  methods: number;
  called: number;
  unprobeable: number;
  /** Called, but sent no SQL (a pure helper, or it threw before reaching the database). */
  withoutSql: number;
  timedOut: number;
  /** Distinct statements per method, summed. */
  statements: number;
  failedStatements: FailedStatement[];
  /** `Class.method` → distinct statements Postgres refused; every called method appears, zeros included. */
  failingByMethod: Map<string, number>;
  /** SQLSTATE → distinct failing statements. */
  failuresByCode: Map<string, number>;
}

export function summarize(results: readonly MethodResult[]): ProbeSummary {
  const summary: ProbeSummary = {
    methods: results.length,
    called: 0,
    unprobeable: 0,
    withoutSql: 0,
    timedOut: 0,
    statements: 0,
    failedStatements: [],
    failingByMethod: new Map(),
    failuresByCode: new Map(),
  };
  for (const result of results) {
    if (result.unprobeable !== undefined) {
      summary.unprobeable += 1;
      continue;
    }
    summary.called += 1;
    if (result.timedOut) summary.timedOut += 1;
    if (result.statements.length === 0) summary.withoutSql += 1;
    const seen = new Set<string>();
    const failed = new Map<string, StatementRecord>();
    for (const statement of result.statements) {
      seen.add(statement.sql);
      if (!statement.outcome.ok && !failed.has(statement.sql)) failed.set(statement.sql, statement);
    }
    summary.statements += seen.size;
    summary.failingByMethod.set(result.key, failed.size);
    for (const statement of failed.values()) {
      const outcome = statement.outcome;
      if (!('code' in outcome)) continue;
      summary.failedStatements.push({ method: result.key, code: outcome.code, message: outcome.message, sql: statement.sql });
      summary.failuresByCode.set(outcome.code, (summary.failuresByCode.get(outcome.code) ?? 0) + 1);
    }
  }
  return summary;
}

/** SQL on one line, cut to `max` characters, for a log or a table cell. */
export function oneLine(sql: string, max = 160): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/`/g, "'");
}

export interface ReportInput {
  summary: ProbeSummary;
  verdict: BaselineVerdict;
  helpers: readonly HelperResult[];
  schemaFailures: readonly { statement: string; message: string }[];
  results: readonly MethodResult[];
}

export function helperFailures(helpers: readonly HelperResult[]): HelperResult[] {
  return helpers.filter((result) => result.failure !== null);
}

/** True when the run passes: every helper case on both engines, and the ratchet. */
export function passed(input: Pick<ReportInput, 'verdict' | 'helpers'>): boolean {
  return helperFailures(input.helpers).length === 0 && input.verdict.grown.length === 0 && input.verdict.stale.length === 0;
}

export function formatConsole(input: ReportInput): string {
  const { summary, verdict } = input;
  const lines: string[] = [];
  const failures = helperFailures(input.helpers);
  lines.push(`Dialect helpers: ${input.helpers.length - failures.length}/${input.helpers.length} cases pass on SQLite and Postgres.`);
  for (const failure of failures) lines.push(`  FAIL  [${failure.engine}] ${failure.name}: ${failure.failure}`);
  if (input.schemaFailures.length > 0) {
    lines.push(`Schema: ${input.schemaFailures.length} DDL statement(s) Postgres refused (their tables are missing below):`);
    for (const failure of input.schemaFailures) lines.push(`  ${failure.message}  <-  ${oneLine(failure.statement, 120)}`);
  }
  lines.push(
    `Repositories: ${summary.methods} methods, ${summary.called} called, ${summary.unprobeable} unprobeable, ` +
      `${summary.withoutSql} sent no SQL, ${summary.timedOut} timed out.`,
  );
  lines.push(`Statements: ${summary.statements} distinct, ${summary.failedStatements.length} refused by Postgres.`);
  for (const [code, count] of [...summary.failuresByCode.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${code}: ${count}`);
  }
  for (const failed of summary.failedStatements) {
    lines.push(`  ${failed.method}  ${failed.code}  ${failed.message}`);
    lines.push(`      ${oneLine(failed.sql)}`);
  }
  if (verdict.unseeded) {
    lines.push('Baseline: not measured yet (failing is null). This run passes and writes the first measurement as the next baseline.');
  }
  for (const entry of verdict.grown) {
    lines.push(`FAIL  ${entry.method} sends ${entry.now} statement(s) Postgres refuses, ${entry.allowed} allowed.`);
  }
  for (const entry of verdict.stale) {
    lines.push(`FAIL  ${entry.method} is held at ${entry.allowed} failing statement(s) but fails ${entry.now} now; lower the baseline.`);
  }
  lines.push(passed(input) ? 'Postgres probe passed.' : 'Postgres probe failed.');
  return lines.join('\n');
}

export function formatMarkdown(input: ReportInput): string {
  const { summary, verdict } = input;
  const failures = helperFailures(input.helpers);
  const out: string[] = ['## Postgres probe', ''];
  out.push(passed(input) ? 'Result: **passed**' : 'Result: **failed**', '');
  out.push('| | |', '|---|---|');
  out.push(`| Dialect helper cases (SQLite and Postgres) | ${input.helpers.length - failures.length} of ${input.helpers.length} pass |`);
  out.push(`| Schema statements refused | ${input.schemaFailures.length} |`);
  out.push(`| Repository methods | ${summary.methods} (${summary.called} called, ${summary.unprobeable} unprobeable) |`);
  out.push(`| Distinct statements | ${summary.statements} |`);
  out.push(`| Refused by Postgres | ${summary.failedStatements.length} |`);
  out.push('');
  if (verdict.unseeded) out.push('The baseline has not been measured yet; the `pg-probe-baseline` artifact holds the first one.', '');
  if (verdict.grown.length > 0 || verdict.stale.length > 0) {
    out.push('### Ratchet', '', '| Method | Allowed | Now |', '|---|---|---|');
    for (const entry of [...verdict.grown, ...verdict.stale]) out.push(`| ${cell(entry.method)} | ${entry.allowed} | ${entry.now} |`);
    out.push('');
  }
  if (failures.length > 0) {
    out.push('### Helper cases that failed', '', '| Engine | Case | Why |', '|---|---|---|');
    for (const failure of failures) out.push(`| ${failure.engine} | ${cell(failure.name)} | ${cell(failure.failure ?? '')} |`);
    out.push('');
  }
  if (summary.failuresByCode.size > 0) {
    out.push('### Refused statements by SQLSTATE', '', '| SQLSTATE | Statements |', '|---|---|');
    for (const [code, count] of [...summary.failuresByCode.entries()].sort((a, b) => b[1] - a[1])) out.push(`| ${code} | ${count} |`);
    out.push('');
    out.push('<details><summary>Every refused statement</summary>', '', '| Method | SQLSTATE | Message |', '|---|---|---|');
    for (const failed of summary.failedStatements) out.push(`| ${cell(failed.method)} | ${failed.code} | ${cell(failed.message)} |`);
    out.push('', '</details>', '');
  }
  const unprobeable = input.results.filter((result) => result.unprobeable !== undefined);
  if (unprobeable.length > 0) {
    out.push('<details><summary>Methods the probe could not call</summary>', '', '| Method | Why |', '|---|---|');
    for (const result of unprobeable) out.push(`| ${cell(result.key)} | ${cell(result.unprobeable ?? '')} |`);
    out.push('', '</details>', '');
  }
  return `${out.join('\n')}\n`;
}
