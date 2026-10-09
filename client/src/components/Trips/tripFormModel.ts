import { MAX_TRIP_DAYS, tripSpanDays } from '@trek/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

interface TripFormFields {
  title: string;
  startDate: string;
  endDate: string;
}

/**
 * Why the title and range of the trip form cannot be saved, or '' when they can.
 * Only a range being set is held to the limit, as on the server: a trip that
 * already carries a longer one can still be renamed.
 */
export function tripFormError(
  { title, startDate, endDate }: TripFormFields,
  trip: { start_date?: string | null; end_date?: string | null } | null,
  t: T
): string {
  if (!title.trim()) return t('dashboard.titleRequired');
  if (startDate && endDate) {
    const span = tripSpanDays(startDate, endDate);
    if (span < 1) return t('dashboard.endDateError');
    const datesTouched = !trip || startDate !== (trip.start_date || '') || endDate !== (trip.end_date || '');
    if (datesTouched && span > MAX_TRIP_DAYS) return t('dashboard.tripTooLong', { count: MAX_TRIP_DAYS });
  }
  return '';
}

/**
 * The end date the phone sheet shows after the start moved to `value`: a valid
 * range keeps its length, an end before the new start follows it.
 */
export function endDateForNewStart(startDate: string, endDate: string, value: string): string {
  if (value && endDate && startDate && endDate >= startDate) {
    const duration = Math.round(
      (new Date(endDate + 'T00:00:00Z').getTime() - new Date(startDate + 'T00:00:00Z').getTime()) / 86400000
    );
    const newEnd = new Date(value + 'T00:00:00Z');
    newEnd.setDate(newEnd.getDate() + duration);
    return newEnd.toISOString().split('T')[0];
  }
  if (value && (!endDate || endDate < value)) return value;
  return endDate;
}
