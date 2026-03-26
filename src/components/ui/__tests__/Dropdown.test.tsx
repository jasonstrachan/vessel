import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

    const triggerLabel = container.querySelector('button > span');
    expect(triggerLabel).toHaveClass('truncate', 'whitespace-nowrap');

    fireEvent.click(screen.getByRole('button'));

    const optionLabel = await screen.findByText(longOptions[1].label);
    expect(optionLabel.tagName).toBe('SPAN');
    expect(optionLabel).toHaveClass('truncate', 'whitespace-nowrap');
  });
});
