import type { ApiConfig } from '@/services/apiConfig';
import type { DefaultPreferences } from '@/components/SettingsPanel';
import type { ErrorDetails } from '@/components/ErrorDetailsModal';
import type { MaskEditorHistoryItem } from '@/components/MaskEditorModal';
import type { QueueStats } from '@/services/generationQueue';
import {
  SET_GENERATING,
  SET_GENERATION_STAGE,
  SET_GENERATION_PROGRESS,
  SET_ENHANCING,
  SET_PREVIEW_IMAGE,
  SET_ERROR_DETAILS,
  SET_MASK_EDIT_CONTEXT,
  SET_MASK_HISTORY_ITEMS,
  SET_ADVANCED_PANEL_OPEN,
  SET_QUEUE_STATS,
  SET_CURRENT_VIEW,
  SET_INPUT_TEXT,
  SET_SELECTED_IMAGE,
  SET_API_CONFIG,
  SET_DEFAULT_PREFERENCES,
  SET_AUTH_USER,
  SET_AUTH_READY,
  SET_AUTH_LOADING,
  SET_IS_SUPER_ADMIN,
} from './actions';

export type MaskEditContextType = {
  source: "chat";
} | {
  source: "batch";
  jobId: string;
  slotId: string;
  versionId?: string;
  historyItems: MaskEditorHistoryItem[];
} | null;

export interface UIState {
  isGenerating: boolean;
  generationStage: string | null;
  generationProgress: { current: number; total: number } | null;
  isEnhancing: boolean;
  previewImageUrl: string | null;
  errorDetails: ErrorDetails | null;
  maskEditContext: MaskEditContextType;
  maskHistoryItems: MaskEditorHistoryItem[];
  isAdvancedPanelOpen: boolean;
  queueStats: QueueStats | null;
  currentView: 'chat' | 'batch';
  inputText: string;
  selectedImage: string | null;
  apiConfig: ApiConfig;
  defaultPreferences: DefaultPreferences;
  authUser: string | null;
  authReady: boolean;
  authLoading: boolean;
  isSuperAdmin: boolean;
}

export type UIAction =
  | { type: typeof SET_GENERATING; payload: boolean }
  | { type: typeof SET_GENERATION_STAGE; payload: string | null }
  | { type: typeof SET_GENERATION_PROGRESS; payload: { current: number; total: number } | null }
  | { type: typeof SET_ENHANCING; payload: boolean }
  | { type: typeof SET_PREVIEW_IMAGE; payload: string | null }
  | { type: typeof SET_ERROR_DETAILS; payload: ErrorDetails | null }
  | { type: typeof SET_MASK_EDIT_CONTEXT; payload: MaskEditContextType }
  | { type: typeof SET_MASK_HISTORY_ITEMS; payload: MaskEditorHistoryItem[] }
  | { type: typeof SET_ADVANCED_PANEL_OPEN; payload: boolean }
  | { type: typeof SET_QUEUE_STATS; payload: QueueStats | null }
  | { type: typeof SET_CURRENT_VIEW; payload: 'chat' | 'batch' }
  | { type: typeof SET_INPUT_TEXT; payload: string }
  | { type: typeof SET_SELECTED_IMAGE; payload: string | null }
  | { type: typeof SET_API_CONFIG; payload: ApiConfig }
  | { type: typeof SET_DEFAULT_PREFERENCES; payload: DefaultPreferences }
  | { type: typeof SET_AUTH_USER; payload: string | null }
  | { type: typeof SET_AUTH_READY; payload: boolean }
  | { type: typeof SET_AUTH_LOADING; payload: boolean }
  | { type: typeof SET_IS_SUPER_ADMIN; payload: boolean };

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case SET_GENERATING:
      return { ...state, isGenerating: action.payload };

    case SET_GENERATION_STAGE:
      return { ...state, generationStage: action.payload };

    case SET_GENERATION_PROGRESS:
      return { ...state, generationProgress: action.payload };

    case SET_ENHANCING:
      return { ...state, isEnhancing: action.payload };

    case SET_PREVIEW_IMAGE:
      return { ...state, previewImageUrl: action.payload };

    case SET_ERROR_DETAILS:
      return { ...state, errorDetails: action.payload };

    case SET_MASK_EDIT_CONTEXT:
      return { ...state, maskEditContext: action.payload };

    case SET_MASK_HISTORY_ITEMS:
      return { ...state, maskHistoryItems: action.payload };

    case SET_ADVANCED_PANEL_OPEN:
      return { ...state, isAdvancedPanelOpen: action.payload };

    case SET_QUEUE_STATS:
      return { ...state, queueStats: action.payload };

    case SET_CURRENT_VIEW:
      return { ...state, currentView: action.payload };

    case SET_INPUT_TEXT:
      return { ...state, inputText: action.payload };

    case SET_SELECTED_IMAGE:
      return { ...state, selectedImage: action.payload };

    case SET_API_CONFIG:
      return { ...state, apiConfig: action.payload };

    case SET_DEFAULT_PREFERENCES:
      return { ...state, defaultPreferences: action.payload };

    case SET_AUTH_USER:
      return { ...state, authUser: action.payload };

    case SET_AUTH_READY:
      return { ...state, authReady: action.payload };

    case SET_AUTH_LOADING:
      return { ...state, authLoading: action.payload };

    case SET_IS_SUPER_ADMIN:
      return { ...state, isSuperAdmin: action.payload };

    default:
      return state;
  }
}
