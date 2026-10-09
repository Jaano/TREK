import { filesApi } from '../../api/client';
import type { TripFile } from '../../types';

/** The files a paste carries, in clipboard order; text and other non-file items are skipped. */
export function filesFromClipboard(clipboardData: DataTransfer | null | undefined): File[] {
  const items = clipboardData?.items;
  if (!items) return [];
  const pasted: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) pasted.push(file);
    }
  }
  return pasted;
}

/** Which of a file's two link columns a toggle works on. */
export type FileLinkField = 'place_id' | 'reservation_id';

/**
 * What toggling one place or booking on a file does. The first link lives on the file
 * itself (`place_id` / `reservation_id`); any further one is a separate file link record.
 * So an unlinked target becomes the file's own link while that column is free and an extra
 * link record otherwise, and a linked target is cleared from the column it sits in or its
 * link record is removed.
 */
export type FileLinkStep =
  | { kind: 'update'; data: { place_id: number | null } | { reservation_id: number | null } }
  | { kind: 'addLink' }
  | { kind: 'removeLink' };

function linkedIds(file: TripFile, field: FileLinkField): number[] {
  const own = file[field];
  const extra = field === 'place_id' ? file.linked_place_ids : file.linked_reservation_ids;
  return [...(own != null ? [own] : []), ...(extra || []).filter((id) => id != null)];
}

export function planFileLinkToggle(file: TripFile, field: FileLinkField, targetId: number): FileLinkStep {
  const column = (value: number | null) => (field === 'place_id' ? { place_id: value } : { reservation_id: value });
  if (linkedIds(file, field).includes(targetId)) {
    if (file[field] === targetId) return { kind: 'update', data: column(null) };
    return { kind: 'removeLink' };
  }
  if (!file[field]) return { kind: 'update', data: column(targetId) };
  return { kind: 'addLink' };
}

interface FileLinkRecord {
  id: number;
  place_id?: number | string | null;
  reservation_id?: number | string | null;
}

/** Runs an `addLink` or `removeLink` step against the server. */
export async function runFileLinkRecordStep(
  tripId: number,
  fileId: number,
  field: FileLinkField,
  targetId: number,
  step: 'addLink' | 'removeLink'
): Promise<void> {
  if (step === 'addLink') {
    await filesApi.addLink(
      tripId,
      fileId,
      field === 'place_id' ? { place_id: targetId } : { reservation_id: targetId }
    );
    return;
  }
  const linksRes = (await filesApi.getLinks(tripId, fileId)) as { links?: FileLinkRecord[] };
  const link = (linksRes.links || []).find((l) => Number(l[field]) === targetId);
  if (link) await filesApi.removeLink(tripId, fileId, link.id);
}

/** Toggles one place or booking on a file, whichever of the server calls that takes. */
export async function toggleFileLink(
  tripId: number,
  file: TripFile,
  field: FileLinkField,
  targetId: number
): Promise<void> {
  const step = planFileLinkToggle(file, field, targetId);
  if (step.kind === 'update') await filesApi.update(tripId, file.id, step.data);
  else await runFileLinkRecordStep(tripId, file.id, field, targetId, step.kind);
}
