import type { BatchJob } from '@/types';
import {
  SET_BATCH_JOBS,
  ADD_BATCH_JOB,
  UPDATE_BATCH_JOB,
  DELETE_BATCH_JOB,
  SET_SELECTED_BATCH_JOB_ID,
  SET_BATCH_GENERATING,
  SET_BATCH_GENERATION_PROGRESS,
  SET_REFINING_SLOT_IDS,
} from './actions';

export interface BatchState {
  batchJobs: BatchJob[];
  selectedBatchJobId: string | null;
  isBatchGenerating: boolean;
  batchGenerationProgress: {
    currentSlot: number;
    totalSlots: number;
    currentSlotLabel: string;
  } | null;
  refiningSlotIds: Set<string>;
}

export const batchInitialState: BatchState = {
  batchJobs: [],
  selectedBatchJobId: null,
  isBatchGenerating: false,
  batchGenerationProgress: null,
  refiningSlotIds: new Set(),
};

export type BatchAction =
  | { type: typeof SET_BATCH_JOBS; payload: BatchJob[] }
  | { type: typeof ADD_BATCH_JOB; payload: BatchJob }
  | { type: typeof UPDATE_BATCH_JOB; payload: { id: string; updater: (job: BatchJob) => BatchJob } }
  | { type: typeof DELETE_BATCH_JOB; payload: string }
  | { type: typeof SET_SELECTED_BATCH_JOB_ID; payload: string | null }
  | { type: typeof SET_BATCH_GENERATING; payload: boolean }
  | { type: typeof SET_BATCH_GENERATION_PROGRESS; payload: BatchState['batchGenerationProgress'] }
  | { type: typeof SET_REFINING_SLOT_IDS; payload: Set<string> };

export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case SET_BATCH_JOBS:
      return { ...state, batchJobs: action.payload };

    case ADD_BATCH_JOB:
      return { ...state, batchJobs: [action.payload, ...state.batchJobs] };

    case UPDATE_BATCH_JOB: {
      const { id, updater } = action.payload;
      return {
        ...state,
        batchJobs: state.batchJobs.map((j) => (j.id === id ? updater(j) : j)),
      };
    }

    case DELETE_BATCH_JOB:
      return {
        ...state,
        batchJobs: state.batchJobs.filter((j) => j.id !== action.payload),
      };

    case SET_SELECTED_BATCH_JOB_ID:
      return { ...state, selectedBatchJobId: action.payload };

    case SET_BATCH_GENERATING:
      return { ...state, isBatchGenerating: action.payload };

    case SET_BATCH_GENERATION_PROGRESS:
      return { ...state, batchGenerationProgress: action.payload };

    case SET_REFINING_SLOT_IDS:
      return { ...state, refiningSlotIds: action.payload };

    default:
      return state;
  }
}
