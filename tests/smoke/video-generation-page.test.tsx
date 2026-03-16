import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { VideoGenerationPage } from '@/components/video/VideoGenerationPage';

vi.mock('@/services/videoJobs', () => ({
  listVideoJobs: vi.fn(async () => []),
  createAndRunVideoJob: vi.fn(),
  deleteVideoJob: vi.fn(),
  rerunVideoJob: vi.fn(),
  refreshVideoJob: vi.fn(),
}));

it('renders core veo video generation controls', async () => {
  render(<VideoGenerationPage />);

  expect(await screen.findByText(/首尾帧生成视频/)).toBeInTheDocument();
  expect(screen.getAllByText(/veo_3_1-fl/i).length).toBeGreaterThan(0);
  expect(screen.getByLabelText(/当前视频模型/i)).toHaveTextContent(/veo_3_1-fl/i);
  expect(screen.getByText(/固定 8 秒/)).toBeInTheDocument();
  expect(screen.getByLabelText(/首帧/i, { selector: 'input' })).toBeInTheDocument();
  expect(screen.getByLabelText(/尾帧/i, { selector: 'input' })).toBeInTheDocument();
  expect(screen.getByLabelText(/提示词/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /生成视频/i })).toBeInTheDocument();
  expect(screen.getByText(/仅支持横屏和竖屏两种尺寸/i)).toBeInTheDocument();

  const aspectSelect = screen.getByLabelText(/视频比例/i);
  const resolutionSelect = screen.getByLabelText(/视频分辨率/i);
  const aspectOptions = within(aspectSelect).getAllByRole('option').map((option) => option.textContent);
  const resolutionOptions = within(resolutionSelect).getAllByRole('option').map((option) => option.textContent);

  expect(aspectOptions).toEqual(['16:9', '9:16']);
  expect(resolutionOptions).toEqual(['1080p']);
  expect(resolutionSelect).toBeDisabled();
});
