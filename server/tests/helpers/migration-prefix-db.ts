import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROADTRIP_PREFERENCE_KEYS } from '@trek/shared';
import Database from 'better-sqlite3';
import ts from 'typescript';
import { readEnv } from '../../src/app-config';
import { encrypt_api_key } from '../../src/nest/common/crypto/apiKeyCrypto';
import { createTables } from '../../src/db/schema';
import { seedDocumentProviders } from '../../src/db/document-provider-seed';
import { reseatBookedNights } from '../../src/db/reseat-booked-nights';

const migrationPath = resolve(__dirname, '../../src/db/migrations.ts');
const migrationSource = readFileSync(migrationPath, 'utf8');
const localRequire = createRequire(migrationPath);

function migrationArray(source: string): { file: ts.SourceFile; array: ts.ArrayLiteralExpression } {
  const file = ts.createSourceFile('migrations.ts', source, ts.ScriptTarget.Latest, true);
  let array: ts.ArrayLiteralExpression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'migrations'
      && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      array = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!array) throw new Error('Migration array not found');
  return { file, array };
}

export function createMigrationPrefixDatabase(version: number): Database.Database {
  const { file, array } = migrationArray(migrationSource);
  if (!Number.isInteger(version) || version < 0 || version > array.elements.length) {
    throw new RangeError(`Unsupported migration prefix version: ${version}`);
  }
  const truncated = migrationSource.slice(0, array.getStart(file))
    + `[${array.elements.slice(0, version).map(element => element.getFullText(file)).join(',')}]`
    + migrationSource.slice(array.end);
  const compiled = ts.transpileModule(truncated, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    '@trek/shared': { ROADTRIP_PREFERENCE_KEYS },
    '../app-config': { readEnv },
    '../nest/common/crypto/apiKeyCrypto': { encrypt_api_key },
    './document-provider-seed': { seedDocumentProviders },
    './reseat-booked-nights': { reseatBookedNights },
  };
  const loaded = { exports: {} as { runMigrations?: (db: Database.Database) => void } };
  new Function('require', 'module', 'exports', compiled)(
    (specifier: string) => dependencies[specifier] ?? localRequire(specifier), loaded, loaded.exports,
  );

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    createTables(db);
    if (!loaded.exports.runMigrations) throw new Error('runMigrations export not found');
    loaded.exports.runMigrations(db);
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    if (row?.version !== version) throw new Error(`Expected schema version ${version}, got ${row?.version ?? 'none'}`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}