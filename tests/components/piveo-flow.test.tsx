import { render, screen } from '@testing-library/react';
import { PiveoFlowPage } from '@/components/piveo/PiveoFlowPage';

it('renders 4-step core controls', () => {
  render(
    <PiveoFlowPage
      model="gemini-2.5-flash-image-preview"
      aspectRatio="1:1"
      brandKits={[]}
      activeBrandKit={null}
      onActivateBrandKit={() => {}}
    />
  );

  expect(screen.getByText(/Product/i)).toBeInTheDocument();
  expect(screen.getByText(/Model/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /BrandKit/i })).toBeInTheDocument();
  expect(screen.getByText(/Generate Images \+ Video/i)).toBeInTheDocument();
});
