// FE-COMP-VACAYPICK-001 to -009: picking a user for the fusion invite and the calendar share.
import { act, renderHook } from '@testing-library/react';

import apiClient from '../../api/client';
import { useVacayUserPicker } from './useVacayUserPicker';

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../shared/Toast', () => ({ useToast: () => toast }));
vi.mock('../../i18n', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const USERS = [
  { id: 2, username: 'bob' },
  { id: 3, username: 'carol' },
];

const submit = vi.fn<(userId: number) => Promise<void>>();

function picker(clearOnLoadError: boolean) {
  return renderHook(() =>
    useVacayUserPicker<{ id: number; username: string }>({
      endpoint: '/addons/vacay/shares/available-users',
      submit,
      successKey: 'vacay.shareSent',
      errorKey: 'vacay.shareFailed',
      clearOnLoadError,
    })
  );
}

beforeEach(() => {
  submit.mockReset().mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('useVacayUserPicker', () => {
  it('FE-COMP-VACAYPICK-001: loads the users from the endpoint and resolves the picked one', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { users: USERS } });
    const { result } = picker(false);
    await act(() => result.current.load());
    expect(get).toHaveBeenCalledWith('/addons/vacay/shares/available-users');
    expect(result.current.available).toEqual(USERS);
    act(() => result.current.setSelected(3));
    expect(result.current.selectedUser).toEqual(USERS[1]);
  });

  it('FE-COMP-VACAYPICK-002: a failed load keeps the last list on desktop', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: { users: USERS } });
    const { result } = picker(false);
    await act(() => result.current.load());
    get.mockRejectedValueOnce(new Error('down'));
    await act(() => result.current.load());
    expect(result.current.available).toEqual(USERS);
  });

  it('FE-COMP-VACAYPICK-003: a failed load empties the list on the phone', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: { users: USERS } });
    const { result } = picker(true);
    await act(() => result.current.load());
    get.mockRejectedValueOnce(new Error('down'));
    await act(() => result.current.load());
    expect(result.current.available).toEqual([]);
  });

  it('FE-COMP-VACAYPICK-004: sending without a pick does nothing', async () => {
    const onSent = vi.fn();
    const { result } = picker(false);
    await act(() => result.current.send(onSent));
    expect(submit).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('FE-COMP-VACAYPICK-005: a sent pick toasts success, then runs onSent', async () => {
    const order: string[] = [];
    toast.success.mockImplementation(() => order.push('toast'));
    const { result } = picker(false);
    act(() => result.current.setSelected(2));
    await act(() => result.current.send(() => order.push('sent')));
    expect(submit).toHaveBeenCalledWith(2);
    expect(toast.success).toHaveBeenCalledWith('vacay.shareSent');
    expect(order).toEqual(['toast', 'sent']);
    expect(result.current.sending).toBe(false);
  });

  it('FE-COMP-VACAYPICK-006: a failed send toasts the server error and skips onSent', async () => {
    submit.mockRejectedValue(new Error('already shared'));
    const onSent = vi.fn();
    const { result } = picker(false);
    act(() => result.current.setSelected(2));
    await act(() => result.current.send(onSent));
    expect(toast.error).toHaveBeenCalledWith('already shared');
    expect(onSent).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('FE-COMP-VACAYPICK-007: the desktop dialogs (no sheetOpen) never load on their own', () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { users: USERS } });
    picker(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('FE-COMP-VACAYPICK-008: every opening of a phone sheet clears the pick, folds the list and reloads', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { users: USERS } });
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useVacayUserPicker<{ id: number; username: string }>({
          endpoint: '/addons/vacay/available-users',
          submit,
          successKey: 'vacay.inviteSent',
          errorKey: 'vacay.inviteError',
          clearOnLoadError: true,
          sheetOpen: open,
        }),
      { initialProps: { open: false } }
    );
    expect(get).not.toHaveBeenCalled();
    await act(async () => rerender({ open: true }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.available).toEqual(USERS);
    act(() => result.current.togglePicker());
    act(() => result.current.setSelected(2));
    expect(result.current.pickerOpen).toBe(true);
    await act(async () => rerender({ open: false }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.selected).toBe(2);
    await act(async () => rerender({ open: true }));
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.selected).toBeNull();
    expect(result.current.pickerOpen).toBe(false);
  });

  it('FE-COMP-VACAYPICK-009: toggling unfolds the inline list and picking a user folds it again', () => {
    const { result } = picker(true);
    expect(result.current.pickerOpen).toBe(false);
    act(() => result.current.togglePicker());
    expect(result.current.pickerOpen).toBe(true);
    act(() => result.current.pick(3));
    expect(result.current.selected).toBe(3);
    expect(result.current.pickerOpen).toBe(false);
    act(() => result.current.togglePicker());
    act(() => result.current.togglePicker());
    expect(result.current.pickerOpen).toBe(false);
  });
});
