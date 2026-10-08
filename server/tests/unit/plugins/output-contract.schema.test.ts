/**
 * The plugin output contract (protocol/output-contract.ts) against the real thing.
 *
 * Two questions, both answered on the migrated schema and the real domain services:
 *
 * - Does every column of a whole-row table have a decision? A migration that adds a
 *   column to `trips` fails here until the column is listed as published or withheld,
 *   which is the point: a new column no longer reaches plugins by default, and nobody
 *   forgets to decide.
 * - Does the contract drop anything a plugin received before it existed? Each entity
 *   method is called once directly on its handler and its result is put through the
 *   contract; the only keys allowed to disappear are the withheld credentials. A new
 *   key a read model starts carrying fails here the same way a new column does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSnapshotTestDb } from '../../helpers/db-mock';
import { createPluginRpcHostParts } from '../../helpers/plugin-host';
import { addTripMember, createBudgetItem, createDayAssignment, createPackingItem, createPlace, createReservation, createTrip, createUser } from '../../helpers/factories';
import { createTestPluginRegistry } from '../../../src/nest/plugins/host/rpc-kit/testing';
import type { PluginRpcContext } from '../../../src/nest/plugins/host/rpc-kit/types';
import type { PluginRpcHost } from '../../../src/nest/plugins/host/rpc-host';
import { KNOWN_PERMISSIONS, type RpcResponse } from '../../../src/nest/plugins/protocol/envelope';
import {
  PLUGIN_ENTITY_CONTRACT,
  PLUGIN_METHOD_OUTPUT,
  shapePluginOutput,
  type PluginEntityContract,
  type PluginEntityName,
} from '../../../src/nest/plugins/protocol/output-contract';

const testDb = createSnapshotTestDb();
afterAll(() => testDb.close());

const ENTITIES = Object.keys(PLUGIN_ENTITY_CONTRACT) as PluginEntityName[];
const contractOf = (entity: PluginEntityName): PluginEntityContract => PLUGIN_ENTITY_CONTRACT[entity];

const columnsOf = (table: string): string[] =>
  (testDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('the output contract against the migrated schema', () => {
  it.each(ENTITIES)('OUTCONTRACT-SCHEMA-001 %s names only columns its table has', (entity) => {
    const contract = contractOf(entity);
    const columns = columnsOf(contract.table);
    expect(columns.length).toBeGreaterThan(0);
    expect(contract.columns.filter((c) => !columns.includes(c))).toEqual([]);
    expect(contract.withheld.filter((c) => !columns.includes(c))).toEqual([]);
  });

  it.each(ENTITIES.filter((e) => contractOf(e).wholeRow))(
    'OUTCONTRACT-SCHEMA-002 every column of %s is published or withheld',
    (entity) => {
      const contract = contractOf(entity);
      const decided = new Set([...contract.columns, ...contract.withheld]);
      // A failure names the new column: add it to `columns` to publish it to plugins,
      // or to `withheld` if it is a credential.
      expect(columnsOf(contract.table).filter((c) => !decided.has(c))).toEqual([]);
    },
  );
});

describe('the output contract drops only the withheld fields', () => {
  let host: PluginRpcHost;
  let callHandler: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  let ownerId: number;
  let memberId: number;
  let tripId: number;
  let dayId: number;
  let placeId: number;

  beforeAll(async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    ownerId = owner.id;
    memberId = member.id;
    const trip = createTrip(testDb, owner.id, { start_date: '2026-05-01', end_date: '2026-05-03' });
    tripId = trip.id;
    addTripMember(testDb, trip.id, member.id);
    // A real credential in the row, so "withheld" is proven rather than vacuous.
    testDb.prepare("UPDATE trips SET feed_token = 'feed-secret' WHERE id = ?").run(trip.id);
    dayId = (testDb.prepare('SELECT id FROM days WHERE trip_id = ? ORDER BY day_number').get(trip.id) as { id: number }).id;
    placeId = createPlace(testDb, trip.id).id;
    createDayAssignment(testDb, dayId, placeId);
    createBudgetItem(testDb, trip.id);
    createPackingItem(testDb, trip.id);
    createReservation(testDb, trip.id, { day_id: dayId });

    const parts = await createPluginRpcHostParts(testDb);
    host = parts.factory.create('contract', new Set<string>(KNOWN_PERMISSIONS), {
      callPlugin: () => Promise.reject(new Error('no peer plugins here')),
      emitPluginEvent: () => Promise.reject(new Error('no peer plugins here')),
    });
    const listing = createTestPluginRegistry(parts.controllers).list();
    const ctx: PluginRpcContext = {
      pluginId: 'contract',
      actingUserId: owner.id,
      data: undefined as never,
      plugins: {
        call: () => Promise.reject(new Error('no peer plugins here')),
        emit: () => Promise.reject(new Error('no peer plugins here')),
      },
    };
    callHandler = async (method, params) => {
      const entry = listing.find((e) => e.name === method);
      const instance = parts.controllers.find((c) => c.constructor.name === entry?.className);
      if (!entry || !instance) throw new Error(`no handler for ${method}`);
      const handler = (instance as Record<string, (p: Record<string, unknown>, c: PluginRpcContext) => unknown>)[entry.methodName];
      return await handler.call(instance, params, ctx);
    };
  });

  /** The keys the contract may remove from `raw`: the entity's withheld columns. */
  const expectOnlyWithheldDropped = (method: string, raw: unknown) => {
    const output = PLUGIN_METHOD_OUTPUT[method as keyof typeof PLUGIN_METHOD_OUTPUT];
    if (output.kind !== 'entity') throw new Error(`${method} is not an entity method`);
    const withheld: readonly string[] = contractOf(output.entity).withheld;
    const rawRows = (output.many ? raw : [raw]) as Array<Record<string, unknown>>;
    const shapedRows = (output.many ? shapePluginOutput(method, raw) : [shapePluginOutput(method, raw)]) as Array<
      Record<string, unknown>
    >;
    expect(rawRows.length).toBeGreaterThan(0);
    rawRows.forEach((row, i) => {
      // Same keys, same order, same values: only a withheld key may go.
      expect(Object.keys(shapedRows[i])).toEqual(Object.keys(row).filter((k) => !withheld.includes(k)));
      for (const key of Object.keys(shapedRows[i])) expect(shapedRows[i][key]).toBe(row[key]);
    });
  };

  it('OUTCONTRACT-001 the writes return every field they returned before, minus credentials', async () => {
    const write = async (method: string, params: Record<string, unknown>) => {
      const raw = await callHandler(method, params);
      expectOnlyWithheldDropped(method, raw);
      return raw as { id: number };
    };
    await write('trips.update', { tripId, input: { title: 'Renamed' } });
    await write('trips.create', { input: { title: 'Another trip' } });
    const place = await write('places.create', { tripId, input: { name: 'Museum', lat: 1, lng: 2 } });
    await write('places.update', { tripId, placeId: place.id, input: { name: 'Museum of Art' } });
    const day = await write('days.create', { tripId, input: { notes: 'spare day' } });
    await write('days.update', { tripId, dayId: day.id, input: { title: 'Spare' } });
    await write('days.create', { tripId, input: { dated: true } });
    await write('itinerary.assign', { tripId, dayId, placeId: place.id });
    const reservation = await write('reservations.create', { tripId, input: { title: 'Flight', type: 'flight' } });
    await write('reservations.update', { tripId, reservationId: reservation.id, input: { title: 'Flight home' } });
    const item = await write('packing.create', { tripId, input: { name: 'Socks' } });
    await write('packing.update', { tripId, itemId: item.id, input: { name: 'Wool socks' } });
    const content = Buffer.from('boarding pass').toString('base64');
    const file = await write('files.create', { tripId, input: { name: 'pass.txt', content_base64: content, mimetype: 'text/plain' } });
    await write('files.update', { tripId, fileId: file.id, input: { description: 'Boarding pass' } });
    const cost = await write('costs.create', { tripId, input: { name: 'Dinner', total_price: 10 } });
    await write('costs.update', { tripId, itemId: cost.id, input: { name: 'Lunch' } });
  });

  it('OUTCONTRACT-002 the reads return every field they returned before, minus credentials', async () => {
    const reads: Array<[string, Record<string, unknown>]> = [
      ['trips.getById', { tripId }],
      ['trips.listMine', {}],
      ['trips.getPlaces', { tripId }],
      ['trips.getDays', { tripId }],
      ['trips.getReservations', { tripId }],
      ['reservations.listMine', {}],
      ['trips.members', { tripId }],
      ['users.getById', { id: memberId }],
      ['packing.list', { tripId }],
      ['files.list', { tripId }],
      ['costs.getByTrip', { tripId }],
      ['costs.listMine', {}],
    ];
    for (const [method, params] of reads) expectOnlyWithheldDropped(method, await callHandler(method, params));
  });

  it('OUTCONTRACT-003 through the router, a trip never carries its feed token', async () => {
    const dispatch = async (method: string, params: Record<string, unknown>) => {
      const res = await host.dispatch({ k: 'req', id: 'x', method, params }, ownerId);
      expect(res.ok).toBe(true);
      return (res as RpcResponse).result;
    };
    const trip = (await dispatch('trips.getById', { tripId })) as Record<string, unknown>;
    expect(trip.id).toBe(tripId);
    expect('feed_token' in trip).toBe(false);
    const mine = (await dispatch('trips.listMine', {})) as Array<Record<string, unknown>>;
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      expect('feed_token' in row).toBe(false);
      expect(row).toHaveProperty('owner_username');
    }
  });
});
