import type { Reservation } from '../../types';

/**
 * What the transport and the booking forms share on both shells: the travellers
 * picked for a booking (#1517) and the files picked before it was saved.
 */

/** The travellers a booking opens with. */
export function travelerIdsOf(reservation: Pick<Reservation, 'travelers'> | null | undefined): Set<number> {
  return new Set((reservation?.travelers || []).map((tv) => tv.user_id));
}

/** The picked travellers with one more or one less. */
export function toggledTraveler(prev: Set<number>, id: number): Set<number> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Whether the picked travellers differ from the ones the booking had, so the save only writes a real change. */
export function travelersChanged(reservation: Pick<Reservation, 'travelers'> | null | undefined, picked: Set<number>) {
  const original = (reservation?.travelers || []).map((tv) => tv.user_id);
  const nextIds = [...picked];
  return { changed: original.length !== nextIds.length || nextIds.some((id) => !original.includes(id)), nextIds };
}

/**
 * Uploads the files picked in a booking form against the saved booking, one after
 * the other, each described with the booking's title. Callers run it after both a
 * create and an edit: the form only holds files the user just picked, so nothing is
 * uploaded twice, and skipping the edit dropped them without a word (#2534).
 */
export async function uploadBookingFiles(
  upload: (fd: FormData) => Promise<unknown>,
  savedId: number,
  files: File[],
  description: string
): Promise<void> {
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('reservation_id', String(savedId));
    fd.append('description', description);
    await upload(fd);
  }
}
