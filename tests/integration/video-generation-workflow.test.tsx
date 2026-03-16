import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VideoGenerationPage } from '@/components/video/VideoGenerationPage';

const mocks = vi.hoisted(() => ({
  listVideoJobs: vi.fn(),
  createAndRunVideoJob: vi.fn(),
  deleteVideoJob: vi.fn(),
  rerunVideoJob: vi.fn(),
  refreshVideoJob: vi.fn(),
  convertImageToUploadWebp: vi.fn(),
}));

vi.mock('@/services/videoJobs', () => mocks);
vi.mock('@/services/uploadPipeline', () => ({
  convertImageToUploadWebp: mocks.convertImageToUploadWebp,
}));

beforeEach(() => {
  mocks.listVideoJobs.mockReset();
  mocks.createAndRunVideoJob.mockReset();
  mocks.deleteVideoJob.mockReset();
  mocks.rerunVideoJob.mockReset();
  mocks.refreshVideoJob.mockReset();
  mocks.convertImageToUploadWebp.mockReset();
  mocks.listVideoJobs.mockResolvedValue([]);
  mocks.convertImageToUploadWebp.mockResolvedValue({
    output: 'data:image/webp;base64,converted-frame',
    width: 1024,
    height: 1024,
    mime: 'image/webp',
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

it('submits a video job with required fields and refreshes history', async () => {
  mocks.createAndRunVideoJob.mockResolvedValue({
    id: 'job-1',
    title: '镜头推进',
    model: 'veo-3.1',
    status: 'completed',
    prompt: '镜头从首帧平滑推进到尾帧，产品保持居中。',
    startFrameUrl: '/api/data/blobs/start',
    aspectRatio: '16:9',
    resolution: '720p',
    durationSec: 8,
    candidateCount: 2,
    upstreamTasks: [],
    results: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  mocks.listVideoJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([
    {
      id: 'job-1',
      title: '镜头推进',
      model: 'veo-3.1',
      status: 'completed',
      prompt: '镜头从首帧平滑推进到尾帧，产品保持居中。',
      startFrameUrl: '/api/data/blobs/start',
      aspectRatio: '16:9',
      resolution: '720p',
      durationSec: 8,
      candidateCount: 2,
      upstreamTasks: [],
      results: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);

  render(<VideoGenerationPage />);
  await screen.findByText(/还没有视频任务/);

  const startInput = screen.getByLabelText(/首帧/i, { selector: 'input' });
  if (!(startInput instanceof HTMLInputElement)) throw new Error('start input not found');

  const file = new File(['frame'], 'start.png', { type: 'image/png' });
  fireEvent.change(startInput, { target: { files: [file] } });
  await waitFor(() => {
    expect(mocks.convertImageToUploadWebp).toHaveBeenCalled();
  });
  fireEvent.change(screen.getByLabelText(/提示词/i), {
    target: { value: '镜头从首帧平滑推进到尾帧，产品保持居中。' },
  });
  fireEvent.change(screen.getByLabelText(/候选数量/i), { target: { value: '2' } });
  const submitButton = screen.getByRole('button', { name: /生成视频/i });
  await waitFor(() => expect(submitButton).not.toBeDisabled());
  fireEvent.click(submitButton);

  await waitFor(() => {
    expect(mocks.createAndRunVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '镜头从首帧平滑推进到尾帧，产品保持居中。',
        candidateCount: 2,
        durationSec: 8,
        model: 'veo_3_1-fl',
      })
    );
  });

  expect(await screen.findByText(/镜头推进/)).toBeInTheDocument();
});

it('auto refreshes processing jobs in the background', async () => {
  const processingJob = {
    id: 'job-processing',
    title: '山路飞驰',
    model: 'veo_3_1-fl',
    status: 'processing' as const,
    prompt: '车辆沿山路前进。',
    startFrameUrl: '/api/data/blobs/start',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSec: 8,
    candidateCount: 1,
    upstreamTasks: [{ id: 'task-1', candidateIndex: 0, status: 'queued' }],
    results: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  mocks.listVideoJobs.mockResolvedValue([processingJob]);
  mocks.refreshVideoJob.mockResolvedValue({
    ...processingJob,
    status: 'completed',
    upstreamTasks: [{ id: 'task-1', candidateIndex: 0, status: 'completed' }],
    results: [
      {
        id: 'result-1',
        videoUrl: '/api/data/blobs/video-1',
        durationSec: 8,
        createdAt: Date.now(),
      },
    ],
  });

  render(<VideoGenerationPage />);
  expect(await screen.findByText(/山路飞驰/)).toBeInTheDocument();

  await waitFor(() => {
    expect(mocks.refreshVideoJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-processing' }));
  }, { timeout: 7000 });
}, 10000);

it('supports rerun and delete actions from history', async () => {
  const job = {
    id: 'job-2',
    title: '商品旋转',
    model: 'veo-3.1',
    status: 'completed' as const,
    prompt: '产品轻微旋转并保持中心稳定。',
    startFrameUrl: '/api/data/blobs/start',
    endFrameUrl: '/api/data/blobs/end',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSec: 10,
    candidateCount: 1,
    upstreamTasks: [],
    results: [
      {
        id: 'result-1',
        videoUrl: '/api/data/blobs/video-1',
        durationSec: 10,
        createdAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  mocks.listVideoJobs.mockResolvedValue([job]);
  mocks.rerunVideoJob.mockResolvedValue({ ...job, id: 'job-3', title: '商品旋转 - 重跑' });
  mocks.deleteVideoJob.mockResolvedValue(undefined);

  render(<VideoGenerationPage />);
  expect(await screen.findByText(/商品旋转/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /重新生成/i }));
  await waitFor(() => {
    expect(mocks.rerunVideoJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-2' }));
  });

  fireEvent.click(screen.getByRole('button', { name: /删除/i }));
  await waitFor(() => {
    expect(mocks.deleteVideoJob).toHaveBeenCalledWith('job-2');
  });
});
