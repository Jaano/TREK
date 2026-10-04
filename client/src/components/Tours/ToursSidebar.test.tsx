import { act, fireEvent, render, screen, waitFor, within } from '../../../tests/helpers/render'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TourListItem } from '@trek/shared'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { useSettingsStore } from '../../store/settingsStore'
import { useTripStore } from '../../store/tripStore'
import { toursApi } from '../../api/client'
import ToursSidebar from './ToursSidebar'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))

vi.mock('../shared/Toast', () => ({ useToast: () => toast }))

vi.mock('../../../../server/src/config', () => { throw new Error('Config initialization is forbidden in client tests') })
vi.mock('../../../../server/src/db/database', () => { throw new Error('Legacy database imports are forbidden in client tests') })
vi.mock('../../../../server/src/nest/database/database.service', () => { throw new Error('Database service imports are forbidden in client tests') })
vi.mock('better-sqlite3', () => { throw new Error('SQLite imports are forbidden in client tests') })

const tour: TourListItem = {
  place_id: 42,
  name: 'Selected ridge walk',
  tour_type: 'hike',
  distance: 4,
  elevation_gain: 100,
  elevation_loss: 80,
  duration: null,
  difficulty: null,
  wanderer_ref: null,
  match_confidence: null,
  tour_group_id: null,
  max_hiking_difficulty: 2,
  planned: false,
  caution: false,
}

beforeEach(() => {
  resetAllStores()
  seedStore(useSettingsStore, { settings: { distance_unit: 'metric' } })
})

describe('ToursSidebar', () => {
  it('uses the compact counted dropdown for All, Unplanned and Planned', () => {
    render(<ToursSidebar tripId={1} days={[]} tours={[tour, { ...tour, place_id: 43, name: 'Planned walk', planned: true }]} onAssignToDay={vi.fn()} onSelectTour={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Show' })
    expect(trigger).toHaveTextContent('All')
    expect(trigger).toHaveTextContent('2')
    fireEvent.click(trigger)
    const choices = screen.getByRole('group', { name: 'Show' })
    expect(within(choices).getByRole('button', { name: /All\s*2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(choices).getByRole('button', { name: /Unplanned\s*1/ })).toBeInTheDocument()
    expect(within(choices).getByRole('button', { name: /Planned\s*1/ })).toBeInTheDocument()
  })

  it('uses the place selection id for the same selected background as a place row', () => {
    render(<ToursSidebar tripId={1} days={[]} tours={[tour]} selectedPlaceId={42} onAssignToDay={vi.fn()} onSelectTour={vi.fn()} />)
    const row = screen.getByRole('option', { name: /Selected ridge walk/i })
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(row).toHaveStyle({ background: 'var(--border-faint)' })
  })

  it('selects the tour from keyboard activation', () => {
    const onSelectTour = vi.fn()
    render(<ToursSidebar tripId={1} days={[]} tours={[tour]} selectedPlaceId={null} onAssignToDay={vi.fn()} onSelectTour={onSelectTour} />)
    const row = screen.getByRole('option', { name: /Selected ridge walk/i })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelectTour).toHaveBeenCalledWith(tour, row)
  })

  it.each([
    ['en', 'A deliberately long English hiking tour name that should wrap without pushing its metrics aside'],
    ['de', 'Eine außergewöhnlich lange deutsche Wanderung mit ausführlicher Bezeichnung für schmale Seitenleisten'],
  ])('keeps %s title, badges, atomic metrics and full-width action in separate rows', (language, name) => {
    seedStore(useSettingsStore, { settings: { language, distance_unit: 'metric' } })
    const onAssignToDay = vi.fn()
    const { container } = render(<ToursSidebar
      canEdit={true}
      canAssign={true}
      tripId={1}
      days={[{ id: 7, trip_id: 1, day_number: 1, title: 'Day one', date: null } as never]}
      tours={[{ ...tour, name, distance: 1.9, elevation_gain: 13, elevation_loss: 11, has_waypoints: true }]}
      selectedPlaceId={42}
      onAssignToDay={onAssignToDay}
      onSelectTour={vi.fn()}
    />)

    const row = screen.getByRole('option', { name: new RegExp(name) })
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(row.querySelector('span[title]')).toHaveAttribute('title', name)
    const metrics = row.querySelector('[data-testid="tour-metrics"]')!
    expect(metrics).toHaveTextContent('1.9 km')
    expect(metrics).toHaveTextContent('13 m')
    expect(metrics).toHaveTextContent('11 m')
    for (const metric of metrics.children) expect(metric).toHaveClass('whitespace-nowrap')
    expect(metrics.children[0].getAttribute('aria-label')).toContain('1.9 km')
    expect(metrics.children[1].getAttribute('aria-label')).toContain('13 m')
    expect(metrics.children[2].getAttribute('aria-label')).toContain('11 m')
    expect(screen.getByText('TREK')).toBeInTheDocument()
    expect(screen.getByLabelText(/Maximum trail difficulty|Maximale Wanderschwierigkeit|T2/)).toBeInTheDocument()
    const actionRow = row.querySelector('[data-testid="tour-action-row"]')!
    expect(actionRow).toHaveClass('w-full')
    expect(actionRow.querySelector('button')).toHaveClass('w-full')
    expect(container.querySelector('[data-testid="tour-metrics"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Add to day|Zum Tag hinzufügen/ }))
    expect(screen.getByRole('button', { name: /Day one/ })).toBeInTheDocument()
  })

  it('leaves the post-write refresh to the shared assignment handler', async () => {
    let resolveAssignment!: () => void
    const assignment = new Promise<void>(resolve => { resolveAssignment = resolve })
    const onAssignToDay = vi.fn(() => assignment)
    const onToursChanged = vi.fn()
    render(<ToursSidebar
      canEdit={true}
      canAssign={true}
      tripId={1}
      days={[{ id: 7, trip_id: 1, day_number: 1, title: 'Day one', date: null } as never]}
      tours={[tour]}
      onAssignToDay={onAssignToDay}
      onToursChanged={onToursChanged}
      onSelectTour={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Add to day|Zum Tag hinzufügen/ }))
    fireEvent.click(screen.getByRole('button', { name: /Day one/ }))
    expect(onAssignToDay).toHaveBeenCalledWith(42, 7)
    expect(onToursChanged).not.toHaveBeenCalled()

    await act(async () => { resolveAssignment(); await assignment })
    expect(onToursChanged).not.toHaveBeenCalled()
  })

  it('keeps the day picker open and does not refresh when assignment fails', async () => {
    const onToursChanged = vi.fn()
    render(<ToursSidebar
      canAssign={true}
      tripId={1}
      days={[{ id: 7, trip_id: 1, day_number: 1, title: 'Day one', date: null } as never]}
      tours={[tour]}
      onAssignToDay={vi.fn().mockResolvedValue(false)}
      onToursChanged={onToursChanged}
      onSelectTour={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Add to day|Zum Tag hinzufügen/ }))
    fireEvent.click(screen.getByRole('button', { name: /Day one/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Day one/ })).toBeInTheDocument())
    expect(onToursChanged).not.toHaveBeenCalled()
  })

  it('quarantines returned Tour ids before loading the imported Places', async () => {
    const importCall = vi.spyOn(toursApi, 'importGpx').mockResolvedValue({
      tours: [tour], caution: false, skipped: 0,
    })
    const onToursChanged = vi.fn()
    const loadTrip = vi.spyOn(useTripStore.getState(), 'loadTrip').mockResolvedValue(undefined)
    const { container } = render(<ToursSidebar
      tripId={1}
      days={[]}
      tours={[]}
      canEdit={true}
      onAssignToDay={vi.fn()}
      onToursChanged={onToursChanged}
      onSelectTour={vi.fn()}
    />)

    const input = container.querySelector('input[type="file"]')!
    const file = new File(['<gpx/>'], 'ridge.gpx', { type: 'application/gpx+xml' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(loadTrip).toHaveBeenCalledWith(1))
    expect(onToursChanged).toHaveBeenCalledWith([42])
    expect(onToursChanged.mock.invocationCallOrder[0]).toBeLessThan(loadTrip.mock.invocationCallOrder[0])
    expect(importCall).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('reports duplicate-only GPX success without refetching or invalidating unchanged data', async () => {
    vi.spyOn(toursApi, 'importGpx').mockResolvedValue({ tours: [], caution: false, skipped: 3 })
    const onToursChanged = vi.fn()
    const loadTrip = vi.spyOn(useTripStore.getState(), 'loadTrip').mockResolvedValue(undefined)
    const { container } = render(<ToursSidebar
      tripId={1}
      days={[]}
      tours={[]}
      canEdit={true}
      onAssignToDay={vi.fn()}
      onToursChanged={onToursChanged}
      onSelectTour={vi.fn()}
    />)

    fireEvent.change(container.querySelector('input[type=file]')!, {
      target: { files: [new File(['<gpx/>'], 'already-imported.gpx', { type: 'application/gpx+xml' })] },
    })

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('All places were already in the trip.'))
    expect(onToursChanged).not.toHaveBeenCalled()
    expect(loadTrip).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
