import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Dropdown from '@/components/ui/Dropdown';

describe('Dropdown', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('opens menu when trigger is clicked', async () => {
    const onChange = jest.fn();
    render(<Dropdown value="a" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button'));

    const beta = await screen.findByText('Beta');
    expect(beta).toBeInTheDocument();
  });

  it('keeps plain-text values and options on a single truncated line', async () => {
    const onChange = jest.fn();
    const longOptions = [
      { value: 'a', label: 'Extremely Long Algorithm Name That Should Not Wrap In The Dropdown Trigger' },
      { value: 'b', label: 'Another Very Long Algorithm Name That Should Stay On One Line In Menus' },
    ];

    const { container } = render(<Dropdown value="a" options={longOptions} onChange={onChange} />);

    expect(container.firstElementChild).toHaveClass('min-w-0');

    const triggerLabel = container.querySelector('button > span');
    expect(triggerLabel).toHaveClass('truncate', 'whitespace-nowrap');

    fireEvent.click(screen.getByRole('button'));

    const optionLabel = await screen.findByText(longOptions[1].label);
    expect(optionLabel.tagName).toBe('SPAN');
    expect(optionLabel).toHaveClass('truncate', 'whitespace-nowrap');
  });

  it('accepts scoped menu overflow styles', () => {
    render(
      <Dropdown
        value="a"
        options={options}
        onChange={jest.fn()}
        menuClassName="max-h-64 overflow-y-auto"
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    const betaOption = screen.getByText('Beta').closest('[role="option"]');
    expect(betaOption?.parentElement).toHaveClass('max-h-64', 'overflow-y-auto');
  });

  describe('filtered option reordering', () => {
    const mixedOptions = [
      { value: 'default-a', label: 'Default A' },
      { value: 'default-b', label: 'Default B' },
      { value: 'custom-a', label: 'Custom A' },
      { value: 'custom-b', label: 'Custom B' },
      { value: 'add', label: '+ Add', isAction: true },
      { value: 'sample', label: 'Sample', isAction: true },
    ];

    const openMixedDropdown = (interactive = false) => {
      const onChange = jest.fn();
      const onAction = jest.fn();
      const onReorder = jest.fn();
      const onRemove = jest.fn();
      render(
        <Dropdown
          value="custom-a"
          options={mixedOptions}
          onChange={onChange}
          onAction={onAction}
          onReorder={onReorder}
          reorderable
          canReorderOption={(option) => option.value.startsWith('custom-')}
          renderOption={interactive ? (option) => (
            <div>
              <span>{option.label}</span>
              {option.value.startsWith('custom-') && (
                <button type="button" onClick={onRemove}>Remove {option.value}</button>
              )}
            </div>
          ) : undefined}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      const rows = screen.getAllByRole('option');
      const captures = rows.map((row, index) => {
        jest.spyOn(row, 'getBoundingClientRect').mockReturnValue({
          x: 20, y: 100 + index * 24, left: 20, top: 100 + index * 24,
          right: 220, bottom: 124 + index * 24, width: 200, height: 24,
          toJSON: () => ({}),
        });
        const set = jest.fn();
        const release = jest.fn();
        Object.defineProperties(row, {
          setPointerCapture: { configurable: true, value: set },
          releasePointerCapture: { configurable: true, value: release },
        });
        return { set, release };
      });
      return { rows, captures, onChange, onAction, onReorder, onRemove };
    };

    const pointer = (target: HTMLElement, type: string, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX: 70, clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 71 });
      fireEvent(target, event);
    };

    it.each([
      { from: 3, to: 2, startY: 184, endY: 154 },
      { from: 2, to: 3, startY: 160, endY: 190 },
    ])('emits full option indexes for drag $from to $to past fixed defaults', ({ from, to, startY, endY }) => {
      const { rows, captures, onReorder, onChange, onAction } = openMixedDropdown();
      expect(rows.map((row) => row.getAttribute('data-draggable')))
        .toEqual(['false', 'false', 'true', 'true', 'false', 'false']);
      pointer(rows[from], 'pointerdown', startY);
      expect(captures[from].set).toHaveBeenCalledWith(71);
      pointer(rows[from], 'pointermove', endY);
      pointer(rows[from], 'pointerup', endY);
      expect(captures[from].release).toHaveBeenCalledWith(71);
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith(from, to);
      expect(onChange).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it.each([
      { index: 3, value: 'custom-b', y: 184 },
      { index: 0, value: 'default-a', y: 112 },
    ])('selects stationary $value without reordering', ({ index, value, y }) => {
      const { rows, onChange, onAction, onReorder } = openMixedDropdown();
      pointer(rows[index], 'pointerdown', y);
      pointer(rows[index], 'pointerup', y);
      expect(onChange).toHaveBeenCalledWith(value);
      expect(onAction).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('keeps action rows on their action path', () => {
      const { rows, onChange, onAction, onReorder } = openMixedDropdown();
      pointer(rows[4], 'pointerdown', 208);
      pointer(rows[4], 'pointerup', 208);
      expect(onAction).toHaveBeenCalledWith('add');
      expect(onChange).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('does not start row selection or reorder from an interactive child', () => {
      const { rows, captures, onChange, onAction, onReorder, onRemove } = openMixedDropdown(true);
      const remove = within(rows[3]).getByRole('button', { name: 'Remove custom-b' });
      pointer(remove, 'pointerdown', 184);
      pointer(remove, 'pointerup', 184);
      fireEvent.click(remove);
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(captures[3].set).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('cancels a moved drag without selecting or reordering', () => {
      const { rows, captures, onChange, onAction, onReorder } = openMixedDropdown();
      const userSelect = document.body.style.userSelect;
      pointer(rows[3], 'pointerdown', 184);
      pointer(rows[3], 'pointermove', 154);
      expect(document.body.style.userSelect).toBe('none');
      pointer(rows[3], 'pointercancel', 154);
      expect(captures[3].release).toHaveBeenCalledWith(71);
      expect(document.body.style.userSelect).toBe(userSelect);
      expect(onChange).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
    });
  });
});
