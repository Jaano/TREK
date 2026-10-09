// FE-PLANNER-BOOKINGEXPENSE-001 to -004: the expense wish of the booking and
// transport forms, desktop and phone alike.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildBudgetItem } from '../../../tests/helpers/factories';
import { useBookingExpenseIntent } from './useBookingExpenseIntent';

describe('useBookingExpenseIntent', () => {
  it('FE-PLANNER-BOOKINGEXPENSE-001: create notes the wish before the save it starts reads it', () => {
    const seen: unknown[] = [];
    const { result } = renderHook(() =>
      useBookingExpenseIntent(async () => {
        seen.push(result.current.take());
      })
    );
    act(() => result.current.create());
    expect(seen).toEqual([{ create: true }]);
    expect(result.current.take()).toBeNull();
  });

  it('FE-PLANNER-BOOKINGEXPENSE-002: edit saves first with the linked item, and reset forgets an old wish', () => {
    const submit = vi.fn(async () => undefined);
    const item = buildBudgetItem({ id: 7 });
    const { result } = renderHook(() => useBookingExpenseIntent(submit));
    act(() => result.current.edit(item));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.take()).toEqual({ editItem: item });
    expect(result.current.take()).toBeNull();

    act(() => result.current.create());
    result.current.reset();
    expect(result.current.take()).toBeNull();
  });

  it('FE-PLANNER-BOOKINGEXPENSE-003: remove deletes the linked expense and reports a failure', async () => {
    const remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('nope'));
    const onError = vi.fn();
    const item = buildBudgetItem({ id: 3 });
    const { result } = renderHook(() => useBookingExpenseIntent(async () => undefined, { remove, onError }));
    await result.current.remove(item);
    expect(remove).toHaveBeenCalledWith(item);
    expect(onError).not.toHaveBeenCalled();
    await result.current.remove(item);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('FE-PLANNER-BOOKINGEXPENSE-004: without a removal, as on the phone, remove does nothing', async () => {
    const submit = vi.fn(async () => undefined);
    const { result } = renderHook(() => useBookingExpenseIntent(submit));
    await expect(result.current.remove(buildBudgetItem())).resolves.toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
  });
});
