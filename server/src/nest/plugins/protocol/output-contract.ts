/**
 * What a plugin receives back from the host, per RPC method.
 *
 * Before this table the entity reads handed plugins whatever the query produced,
 * mostly `SELECT t.*`, with credentials stripped by a denylist (`withoutFeedToken`).
 * Every column a migration added reached every plugin holding the read grant, and a
 * column rename became an unversioned break of a published API. The entity results
 * now go through an allowlist instead: the fields below are exactly what plugins
 * received when the contract was drawn, minus the credentials, and a new column stays
 * on the host until someone adds it here on purpose.
 *
 * The plugin SDK publishes the same lists (`PLUGIN_ENTITY_FIELDS`), generated from
 * this file by `server/scripts/gen-plugin-facts.ts`, and type-checks its own entity
 * interfaces against them. `tests/unit/plugins/output-contract.schema.test.ts` holds
 * the column lists to the migrated schema, so a new column fails CI until it is
 * classified as published or withheld.
 *
 * Pure data and one pure function, like envelope.ts: no imports with side effects.
 */
import type { KnownMethod, UnconditionalMethod } from './envelope';

export interface PluginEntityContract {
  /** The table the rows are read from. */
  readonly table: string;
  /** The table's columns a plugin receives, in the order the row carries them. */
  readonly columns: readonly string[];
  /** Columns a plugin never receives: credentials, whichever read path carries them. */
  readonly withheld: readonly string[];
  /**
   * True when the reads select the whole row (`t.*`), so every column of `table` has
   * to be listed in `columns` or `withheld` and the schema test enforces it. False
   * when every read names its columns, which keeps the rest out by construction.
   */
  readonly wholeRow: boolean;
  /** Keys the host adds on top of the row: joined names, counts, hydrated children. */
  readonly derived: readonly string[];
}

export const PLUGIN_ENTITY_CONTRACT = {
  trip: {
    table: 'trips',
    columns: [
      'id', 'user_id', 'title', 'description', 'start_date', 'end_date', 'currency', 'cover_image',
      'is_archived', 'reminder_days', 'created_at', 'updated_at', 'reminder_sent_for',
    ],
    // The sole credential of the anonymous calendar feed.
    withheld: ['feed_token'],
    wholeRow: true,
    derived: ['day_count', 'place_count', 'is_owner', 'owner_username', 'shared_count'],
  },
  place: {
    table: 'places',
    columns: [
      'id', 'trip_id', 'name', 'description', 'lat', 'lng', 'address', 'category_id', 'price', 'currency',
      'reservation_status', 'reservation_notes', 'reservation_datetime', 'place_time', 'end_time',
      'duration_minutes', 'notes', 'image_url', 'google_place_id', 'google_ftid', 'website', 'phone',
      'transport_mode', 'created_at', 'updated_at', 'osm_id', 'route_geometry', 'route_color', 'stop_type',
      'fill_percent', 'amap_poi_id', 'source', 'email', 'opening_hours',
    ],
    withheld: [],
    wholeRow: true,
    derived: [
      'category_name', 'category_color', 'category_icon', 'tour_place_id', 'category', 'tags', 'ratings',
      'rating_avg', 'rating_count',
    ],
  },
  day: {
    table: 'days',
    columns: ['id', 'trip_id', 'day_number', 'date', 'notes', 'title', 'default_transport_mode'],
    withheld: [],
    wholeRow: true,
    derived: ['assignments', 'notes_items'],
  },
  reservation: {
    table: 'reservations',
    columns: [
      'id', 'trip_id', 'day_id', 'end_day_id', 'place_id', 'assignment_id', 'title', 'accommodation_id',
      'reservation_time', 'reservation_end_time', 'location', 'confirmation_number', 'notes', 'status', 'type',
      'created_at', 'metadata', 'day_plan_position', 'needs_review', 'external_source', 'external_id',
      'external_owner_user_id', 'external_synced_at', 'sync_enabled', 'external_hash', 'url', 'ingest_state',
    ],
    withheld: [],
    wholeRow: true,
    derived: [
      'day_number', 'place_name', 'accommodation_place_id', 'accommodation_name', 'accommodation_start_day_id',
      'accommodation_end_day_id', 'day_positions', 'endpoints', 'travelers',
    ],
  },
  packingItem: {
    table: 'packing_items',
    columns: [
      'id', 'trip_id', 'name', 'checked', 'category', 'sort_order', 'created_at', 'weight_grams', 'bag_id',
      'quantity', 'updated_at', 'is_private', 'owner_id', 'packed_quantity',
    ],
    withheld: [],
    wholeRow: true,
    derived: ['owner_username', 'recipients', 'contributors'],
  },
  tripFile: {
    table: 'trip_files',
    columns: [
      'id', 'trip_id', 'place_id', 'reservation_id', 'filename', 'original_name', 'file_size', 'mime_type',
      'description', 'created_at', 'note_id', 'uploaded_by', 'starred', 'deleted_at', 'message_id',
    ],
    withheld: [],
    wholeRow: true,
    derived: [
      'reservation_title', 'uploaded_by_name', 'uploaded_by_avatar', 'url', 'linked_reservation_ids',
      'linked_place_ids', 'linked_budget_item_ids',
    ],
  },
  budgetItem: {
    table: 'budget_items',
    columns: [
      'id', 'trip_id', 'category', 'name', 'total_price', 'persons', 'days', 'note', 'sort_order', 'created_at',
      'paid_by_user_id', 'expense_date', 'reservation_id', 'currency', 'exchange_rate', 'ticket_json', 'place_id',
    ],
    withheld: [],
    wholeRow: true,
    derived: ['members', 'payers', 'receipts'],
  },
  assignment: {
    table: 'day_assignments',
    columns: [
      'id', 'day_id', 'place_id', 'order_index', 'notes', 'assignment_time', 'assignment_end_time', 'end_day',
      'leg_transport_mode', 'incoming_leg_transport_mode', 'route_excluded', 'accommodation_id', 'created_at',
    ],
    withheld: [],
    // The assignment read model names its fields one by one.
    wholeRow: false,
    derived: ['participants', 'tour_place_id', 'tour_route_geometry', 'place'],
  },
  user: {
    table: 'users',
    columns: ['id', 'username', 'display_name', 'avatar'],
    // Everything else on the users table is account data or a credential, and the
    // two reads that return users (users.getById, trips.members) name these four.
    withheld: [],
    wholeRow: false,
    derived: [],
  },
} as const satisfies Record<string, PluginEntityContract>;

export type PluginEntityName = keyof typeof PLUGIN_ENTITY_CONTRACT;

/**
 * The output of one RPC method.
 *
 * - `entity`: rows of a published entity, allowlisted field by field.
 * - `host`: a value the host assembles itself (an acknowledgement, a model answer,
 *   a token) or data the plugin owns (its own database, its metadata, a peer's
 *   answer). There is no stored row behind it to leak.
 * - `readModel`: a domain read model shared with the REST route, passed through as
 *   the app returns it. The SDK types these results as `unknown`; they are the next
 *   candidates for an entity contract.
 */
export type PluginMethodOutput =
  | { readonly kind: 'entity'; readonly entity: PluginEntityName; readonly many: boolean }
  | { readonly kind: 'host' }
  | { readonly kind: 'readModel' };

const row = (entity: PluginEntityName): PluginMethodOutput => ({ kind: 'entity', entity, many: false });
const rows = (entity: PluginEntityName): PluginMethodOutput => ({ kind: 'entity', entity, many: true });
const HOST: PluginMethodOutput = { kind: 'host' };
const READ_MODEL: PluginMethodOutput = { kind: 'readModel' };

/** One entry per wire method; the `satisfies` makes a method without an entry a compile error. */
export const PLUGIN_METHOD_OUTPUT = {
  'db.exec': HOST,
  'db.query': HOST,
  'db.migrate': HOST,
  'db.tx': HOST,
  'trips.getById': row('trip'),
  'trips.getPlaces': rows('place'),
  'trips.getReservations': rows('reservation'),
  'trips.getDays': rows('day'),
  'trips.getAccommodations': READ_MODEL,
  'trips.listMine': rows('trip'),
  'reservations.listMine': rows('reservation'),
  'reservations.create': row('reservation'),
  'reservations.update': row('reservation'),
  'reservations.delete': HOST,
  'accommodations.create': READ_MODEL,
  'accommodations.update': READ_MODEL,
  'accommodations.delete': HOST,
  'packing.list': rows('packingItem'),
  'packing.create': row('packingItem'),
  'packing.update': row('packingItem'),
  'packing.delete': HOST,
  'packing.listBags': READ_MODEL,
  'packing.createBag': READ_MODEL,
  'packing.updateBag': READ_MODEL,
  'packing.deleteBag': HOST,
  'packing.setBagMembers': READ_MODEL,
  'files.list': rows('tripFile'),
  'files.getContent': HOST,
  'files.create': row('tripFile'),
  'files.createLink': READ_MODEL,
  'files.update': row('tripFile'),
  'files.softDelete': HOST,
  'collab.listNotes': READ_MODEL,
  'collab.listPolls': READ_MODEL,
  'collab.listMessages': READ_MODEL,
  'collab.createNote': READ_MODEL,
  'collab.createPoll': READ_MODEL,
  'collab.votePoll': READ_MODEL,
  'collab.createMessage': READ_MODEL,
  'trips.addMember': HOST,
  'trips.removeMember': HOST,
  'trips.create': row('trip'),
  'journal.listMine': READ_MODEL,
  'journal.getEntries': READ_MODEL,
  'atlas.visited': READ_MODEL,
  'atlas.bucketList': READ_MODEL,
  'rates.get': HOST,
  'vacay.mine': READ_MODEL,
  'daynotes.list': READ_MODEL,
  'daynotes.create': READ_MODEL,
  'daynotes.update': READ_MODEL,
  'daynotes.delete': HOST,
  'collections.listMine': READ_MODEL,
  'collections.get': READ_MODEL,
  'collections.create': READ_MODEL,
  'collections.update': READ_MODEL,
  'collections.savePlace': READ_MODEL,
  'collections.copyToTrip': READ_MODEL,
  'collections.deletePlace': HOST,
  'atlas.markCountry': HOST,
  'atlas.unmarkCountry': HOST,
  'atlas.markRegion': HOST,
  'atlas.unmarkRegion': HOST,
  'atlas.createBucketItem': READ_MODEL,
  'atlas.deleteBucketItem': HOST,
  'vacay.toggleEntry': READ_MODEL,
  'vacay.toggleCompanyHoliday': READ_MODEL,
  'journal.createEntry': READ_MODEL,
  'journal.addEntryPhoto': READ_MODEL,
  'journal.updateEntry': READ_MODEL,
  'journal.deleteEntry': HOST,
  'journal.createJourney': READ_MODEL,
  'journal.deleteJourney': HOST,
  'weather.get': HOST,
  'categories.list': READ_MODEL,
  'tags.list': READ_MODEL,
  'tags.create': READ_MODEL,
  'tags.update': READ_MODEL,
  'tags.delete': HOST,
  'trips.members': rows('user'),
  'todos.list': READ_MODEL,
  'todos.create': READ_MODEL,
  'todos.update': READ_MODEL,
  'todos.delete': HOST,
  'costs.getByTrip': rows('budgetItem'),
  'costs.listMine': rows('budgetItem'),
  'costs.create': row('budgetItem'),
  'costs.update': row('budgetItem'),
  'costs.delete': HOST,
  'places.create': row('place'),
  'places.update': row('place'),
  'places.delete': HOST,
  'days.create': row('day'),
  'days.update': row('day'),
  'days.delete': HOST,
  'itinerary.assign': row('assignment'),
  'itinerary.unassign': HOST,
  'trips.update': row('trip'),
  'meta.get': HOST,
  'meta.set': HOST,
  'meta.list': HOST,
  'meta.delete': HOST,
  'users.getById': row('user'),
  'ws.broadcastToTrip': HOST,
  'ws.broadcastToUser': HOST,
  'notify.send': HOST,
  'ai.complete': HOST,
  'ai.extract': HOST,
  'oauth.getToken': HOST,
  'scheduler.set': HOST,
  'scheduler.cancel': HOST,
  'plugins.call': HOST,
  'events.emit': HOST,
  'settings.get': HOST,
} as const satisfies Record<KnownMethod | UnconditionalMethod, PluginMethodOutput>;

/** The fields a plugin receives for `entity`: its published columns, then the derived keys. */
export function pluginEntityFields(entity: PluginEntityName): readonly string[] {
  const contract: PluginEntityContract = PLUGIN_ENTITY_CONTRACT[entity];
  return [...contract.columns, ...contract.derived];
}

/**
 * A copy of `row` holding only the published fields, in the row's own key order.
 * Values are passed on untouched. Anything that is not a plain row (null, undefined,
 * a primitive) passes through as it is, so "not found" keeps its wire form.
 */
function pickFields(value: unknown, fields: ReadonlySet<string>): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (fields.has(key)) out[key] = field;
  }
  return out;
}

function outputOf(method: string): PluginMethodOutput | undefined {
  return (PLUGIN_METHOD_OUTPUT as Readonly<Record<string, PluginMethodOutput | undefined>>)[method];
}

/** Whether `method` returns published entity rows, i.e. whether its result is shaped. */
export function returnsEntity(method: string): boolean {
  return outputOf(method)?.kind === 'entity';
}

/** Applies the method's output contract to a handler's result. Unlisted methods pass through. */
export function shapePluginOutput(method: string, result: unknown): unknown {
  const output = outputOf(method);
  if (output?.kind !== 'entity') return result;
  const fields: ReadonlySet<string> = new Set(pluginEntityFields(output.entity));
  if (output.many) return Array.isArray(result) ? result.map((item) => pickFields(item, fields)) : result;
  return pickFields(result, fields);
}
