import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../../tests/helpers/render';
import { LeftPanelTab } from './TripPlannerPage';

// FE-PAGE-PLANNER-LEFTTAB-001 to FE-PAGE-PLANNER-LEFTTAB-004

describe('LeftPanelTab', () => {
  it('FE-PAGE-PLANNER-LEFTTAB-001: an open panel shows a flap on its edge that collapses it', () => {
    const onToggle = vi.fn();
    render(<LeftPanelTab hidden={false} label="Collapse" onToggle={onToggle} />);
    const tab = screen.getByRole('button', { name: 'Collapse' });
    expect(tab).toHaveClass('text-content-faint');
    expect(tab.style.position).toBe('absolute');
    expect(tab.style.right).toBe('-28px');
    expect(tab.style.borderRadius).toBe('0 10px 10px 0');
    fireEvent.click(tab);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('FE-PAGE-PLANNER-LEFTTAB-002: a hidden panel leaves a raised accent tile', () => {
    render(<LeftPanelTab hidden label="Plan" onToggle={vi.fn()} />);
    const tab = screen.getByRole('button', { name: 'Plan' });
    expect(tab).toHaveClass('bg-accent');
    expect(tab.style.position).toBe('fixed');
    expect(tab.style.left).toBe('10px');
    expect(tab.style.borderRadius).toBe('10px');
  });

  it('FE-PAGE-PLANNER-LEFTTAB-003: says nothing about its state and has no focus ring by default', () => {
    render(<LeftPanelTab hidden={false} label="Collapse" onToggle={vi.fn()} />);
    const tab = screen.getByRole('button', { name: 'Collapse' });
    expect(tab).not.toHaveAttribute('aria-expanded');
    expect(tab).not.toHaveClass('focus-visible:outline');
  });

  it('FE-PAGE-PLANNER-LEFTTAB-004: an announced tab states whether the panel is open and shows a focus ring', () => {
    const { rerender } = render(<LeftPanelTab hidden={false} label="Collapse" onToggle={vi.fn()} announced />);
    const tab = screen.getByRole('button', { name: 'Collapse' });
    expect(tab).toHaveAttribute('aria-expanded', 'true');
    expect(tab).toHaveClass('text-content-faint', 'focus-visible:outline');
    rerender(<LeftPanelTab hidden label="Plan" onToggle={vi.fn()} announced />);
    const hiddenTab = screen.getByRole('button', { name: 'Plan' });
    expect(hiddenTab).toHaveAttribute('aria-expanded', 'false');
    expect(hiddenTab).toHaveClass('bg-accent', 'focus-visible:outline');
  });
});
