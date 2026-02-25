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
});
