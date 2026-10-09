// FE-PLANNER-BOOKINGFORM-001 to -004: the travellers and picked files of the
// transport and booking forms, desktop and phone alike.
import { describe, expect, it, vi } from 'vitest';

import { buildReservation } from '../../../tests/helpers/factories';
import type { Reservation } from '../../types';
import { toggledTraveler, travelerIdsOf, travelersChanged, uploadBookingFiles } from './bookingFormModel';

const withTravelers = (...ids: number[]) =>
  buildReservation({ travelers: ids.map((user_id) => ({ user_id, username: `u${user_id}` })) } as Partial<Reservation>);

describe('bookingFormModel', () => {
  it('FE-PLANNER-BOOKINGFORM-001: a booking opens with its travellers, a new one with nobody', () => {
    expect([...travelerIdsOf(withTravelers(3, 1))]).toEqual([3, 1]);
    expect(travelerIdsOf(null).size).toBe(0);
    expect(travelerIdsOf(buildReservation()).size).toBe(0);
  });

  it('FE-PLANNER-BOOKINGFORM-002: toggling adds a missing traveller and drops a picked one, on a copy', () => {
    const prev = new Set([1]);
    const added = toggledTraveler(prev, 2);
    expect([...added]).toEqual([1, 2]);
    expect([...toggledTraveler(added, 1)]).toEqual([2]);
    expect([...prev]).toEqual([1]);
  });

  it('FE-PLANNER-BOOKINGFORM-003: only a real change counts, whatever the order', () => {
    expect(travelersChanged(withTravelers(1, 2), new Set([2, 1]))).toEqual({ changed: false, nextIds: [2, 1] });
    expect(travelersChanged(withTravelers(1, 2), new Set([1]))).toEqual({ changed: true, nextIds: [1] });
    expect(travelersChanged(withTravelers(1), new Set([2]))).toEqual({ changed: true, nextIds: [2] });
    expect(travelersChanged(null, new Set())).toEqual({ changed: false, nextIds: [] });
    expect(travelersChanged(undefined, new Set([4]))).toEqual({ changed: true, nextIds: [4] });
  });

  it('FE-PLANNER-BOOKINGFORM-004: the picked files go up one after the other against the saved booking', async () => {
    const order: string[] = [];
    const upload = vi.fn(async (fd: FormData) => {
      order.push(`start:${(fd.get('file') as File).name}`);
      await Promise.resolve();
      order.push(`end:${(fd.get('file') as File).name}`);
    });
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')];
    await uploadBookingFiles(upload, 42, files, 'Hotel stay');
    expect(order).toEqual(['start:a.pdf', 'end:a.pdf', 'start:b.pdf', 'end:b.pdf']);
    const fd = upload.mock.calls[1][0];
    expect(fd.get('reservation_id')).toBe('42');
    expect(fd.get('description')).toBe('Hotel stay');

    upload.mockClear();
    await uploadBookingFiles(upload, 42, [], 'none');
    expect(upload).not.toHaveBeenCalled();
  });
});
