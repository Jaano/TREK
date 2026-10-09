// FE-FILES-ACTIONS-001 to FE-FILES-ACTIONS-010: the paste and link rules the desktop file
// manager and the phone's files tab and link sheet share.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTripFile } from '../../../tests/helpers/factories';
import { filesApi } from '../../api/client';
import { filesFromClipboard, planFileLinkToggle, runFileLinkRecordStep, toggleFileLink } from './fileActions';

function clipboard(items: { kind: string; file: File | null }[]): DataTransfer {
  return { items: items.map((i) => ({ kind: i.kind, getAsFile: () => i.file })) } as unknown as DataTransfer;
}

describe('filesFromClipboard', () => {
  it('FE-FILES-ACTIONS-001: keeps the file items in order and skips text and empty ones', () => {
    const a = new File(['a'], 'a.png');
    const b = new File(['b'], 'b.pdf');
    const data = clipboard([
      { kind: 'file', file: a },
      { kind: 'string', file: null },
      { kind: 'file', file: null },
      { kind: 'file', file: b },
    ]);
    expect(filesFromClipboard(data)).toEqual([a, b]);
  });

  it('FE-FILES-ACTIONS-002: no clipboard data or no items means no files', () => {
    expect(filesFromClipboard(null)).toEqual([]);
    expect(filesFromClipboard(undefined)).toEqual([]);
    expect(filesFromClipboard({} as DataTransfer)).toEqual([]);
  });
});

describe('planFileLinkToggle', () => {
  it('FE-FILES-ACTIONS-003: the first link goes into the free column', () => {
    const file = buildTripFile({ place_id: null, reservation_id: null });
    expect(planFileLinkToggle(file, 'place_id', 5)).toEqual({ kind: 'update', data: { place_id: 5 } });
    expect(planFileLinkToggle(file, 'reservation_id', 7)).toEqual({ kind: 'update', data: { reservation_id: 7 } });
  });

  it('FE-FILES-ACTIONS-004: a further link becomes a link record', () => {
    const file = buildTripFile({ place_id: 1, reservation_id: 2 });
    expect(planFileLinkToggle(file, 'place_id', 5)).toEqual({ kind: 'addLink' });
    expect(planFileLinkToggle(file, 'reservation_id', 7)).toEqual({ kind: 'addLink' });
  });

  it('FE-FILES-ACTIONS-005: unlinking the column target clears the column', () => {
    const file = buildTripFile({ place_id: 5, reservation_id: 7 });
    expect(planFileLinkToggle(file, 'place_id', 5)).toEqual({ kind: 'update', data: { place_id: null } });
    expect(planFileLinkToggle(file, 'reservation_id', 7)).toEqual({ kind: 'update', data: { reservation_id: null } });
  });

  it('FE-FILES-ACTIONS-006: unlinking a target linked by record removes the record', () => {
    const file = buildTripFile({ place_id: 1, linked_place_ids: [5], reservation_id: 2, linked_reservation_ids: [7] });
    expect(planFileLinkToggle(file, 'place_id', 5)).toEqual({ kind: 'removeLink' });
    expect(planFileLinkToggle(file, 'reservation_id', 7)).toEqual({ kind: 'removeLink' });
  });
});

describe('running a link toggle', () => {
  beforeEach(() => {
    vi.spyOn(filesApi, 'update').mockResolvedValue({});
    vi.spyOn(filesApi, 'addLink').mockResolvedValue({});
    vi.spyOn(filesApi, 'removeLink').mockResolvedValue({});
    vi.spyOn(filesApi, 'getLinks').mockResolvedValue({
      links: [
        { id: 70, place_id: null, reservation_id: 7 },
        { id: 50, place_id: '5', reservation_id: null },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FE-FILES-ACTIONS-007: adding a record posts the target in its own field', async () => {
    await runFileLinkRecordStep(1, 9, 'place_id', 5, 'addLink');
    await runFileLinkRecordStep(1, 9, 'reservation_id', 7, 'addLink');
    expect(filesApi.addLink).toHaveBeenNthCalledWith(1, 1, 9, { place_id: 5 });
    expect(filesApi.addLink).toHaveBeenNthCalledWith(2, 1, 9, { reservation_id: 7 });
  });

  it('FE-FILES-ACTIONS-008: removing a record looks it up by the target, numeric or not', async () => {
    await runFileLinkRecordStep(1, 9, 'place_id', 5, 'removeLink');
    await runFileLinkRecordStep(1, 9, 'reservation_id', 7, 'removeLink');
    expect(filesApi.getLinks).toHaveBeenCalledWith(1, 9);
    expect(filesApi.removeLink).toHaveBeenNthCalledWith(1, 1, 9, 50);
    expect(filesApi.removeLink).toHaveBeenNthCalledWith(2, 1, 9, 70);
  });

  it('FE-FILES-ACTIONS-009: no matching record or no links array removes nothing', async () => {
    await runFileLinkRecordStep(1, 9, 'place_id', 99, 'removeLink');
    vi.mocked(filesApi.getLinks).mockResolvedValue({});
    await runFileLinkRecordStep(1, 9, 'place_id', 5, 'removeLink');
    expect(filesApi.removeLink).not.toHaveBeenCalled();
  });

  it('FE-FILES-ACTIONS-010: toggleFileLink writes the column or the record, and rethrows', async () => {
    await toggleFileLink(1, buildTripFile({ id: 9, place_id: null }), 'place_id', 5);
    expect(filesApi.update).toHaveBeenCalledWith(1, 9, { place_id: 5 });

    await toggleFileLink(1, buildTripFile({ id: 9, place_id: 1 }), 'place_id', 5);
    expect(filesApi.addLink).toHaveBeenCalledWith(1, 9, { place_id: 5 });

    vi.mocked(filesApi.update).mockRejectedValue(new Error('nope'));
    await expect(toggleFileLink(1, buildTripFile({ id: 9, reservation_id: 7 }), 'reservation_id', 7)).rejects.toThrow(
      'nope'
    );
  });
});
