import { useCallback, useState } from 'react';

import apiClient from '../../api/client';
import { useTranslation } from '../../i18n';
import { getApiErrorMessage } from '../../types';
import { useToast } from '../shared/Toast';

interface VacayUserPickerOptions {
  /** Where the users that can be picked come from. */
  endpoint: '/addons/vacay/available-users' | '/addons/vacay/shares/available-users';
  /** What sending does with the picked user. */
  submit: (userId: number) => Promise<void>;
  successKey: string;
  errorKey: string;
  /**
   * Empty the list when loading it fails (the phone sheets). Otherwise the list
   * from the last load stays.
   */
  clearOnLoadError: boolean;
}

/**
 * Picking another TREK user for a vacay action and sending it: the fusion invite
 * and the read-only calendar share. Each view keeps its own dialog or sheet.
 */
export function useVacayUserPicker<U extends { id: number; username: string }>({
  endpoint,
  submit,
  successKey,
  errorKey,
  clearOnLoadError,
}: VacayUserPickerOptions) {
  const { t } = useTranslation();
  const toast = useToast();
  const [available, setAvailable] = useState<U[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get(endpoint).then((r) => r.data);
      setAvailable(data.users);
    } catch {
      if (clearOnLoadError) setAvailable([]);
    }
  }, [endpoint, clearOnLoadError]);

  /** Sends to the picked user; `onSent` runs right after the success toast. */
  const send = async (onSent: () => void) => {
    if (!selected) return;
    setSending(true);
    try {
      await submit(selected);
      toast.success(t(successKey));
      onSent();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t(errorKey)));
    } finally {
      setSending(false);
    }
  };

  const selectedUser = available.find((u) => u.id === selected);

  return { available, selected, setSelected, selectedUser, sending, load, send };
}
