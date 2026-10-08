import { act, fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'

/** Scaffolding for the tests of the road trip rail's parts, each rendered on its own. */

/**
 * What the tooltip says once the pointer has rested on the element long enough.
 *
 * The pointer leaves again and the real clock is back before it returns, so a case can
 * read one tooltip after another and render on with real timers.
 */
export function tooltipOf(el: Element): string {
  vi.useFakeTimers()
  fireEvent.mouseEnter(el)
  act(() => { vi.advanceTimersByTime(300) })
  const text = screen.getByRole('tooltip').textContent ?? ''
  fireEvent.mouseLeave(el)
  vi.useRealTimers()
  return text
}
