import type { Session, Project } from '@/types';
import {
  SET_SESSIONS,
  ADD_SESSION,
  UPDATE_SESSION,
  DELETE_SESSION,
  SET_CURRENT_SESSION_ID,
  SET_PROJECTS,
  ADD_PROJECT,
  UPDATE_PROJECT,
  DELETE_PROJECT,
  SET_CURRENT_PROJECT_ID,
  REPLACE_IMAGE_URLS,
  LOAD_SESSION_MESSAGES,
} from './actions';

export interface ProjectState {
  sessions: Session[];
  currentSessionId: string | null;
  projects: Project[];
  currentProjectId: string | null;
}

export const projectInitialState: ProjectState = {
  sessions: [],
  currentSessionId: null,
  projects: [],
  currentProjectId: null,
};

export type ProjectAction =
  | { type: typeof SET_SESSIONS; payload: Session[] }
  | { type: typeof ADD_SESSION; payload: Session }
  | { type: typeof UPDATE_SESSION; payload: { id: string; updater: (s: Session) => Session } }
  | { type: typeof DELETE_SESSION; payload: string }
  | { type: typeof SET_CURRENT_SESSION_ID; payload: string | null }
  | { type: typeof SET_PROJECTS; payload: Project[] }
  | { type: typeof ADD_PROJECT; payload: Project }
  | { type: typeof UPDATE_PROJECT; payload: { id: string; updater: (p: Project) => Project } }
  | { type: typeof DELETE_PROJECT; payload: string }
  | { type: typeof SET_CURRENT_PROJECT_ID; payload: string | null }
  | { type: typeof REPLACE_IMAGE_URLS; payload: { sessionId: string; replacements: Map<string, string> } }
  | { type: typeof LOAD_SESSION_MESSAGES; payload: { sessionId: string; messages: any[] } };

export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case SET_SESSIONS:
      return { ...state, sessions: action.payload };

    case ADD_SESSION:
      return { ...state, sessions: [action.payload, ...state.sessions] };

    case UPDATE_SESSION: {
      const { id, updater } = action.payload;
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === id ? updater(s) : s)),
      };
    }

    case DELETE_SESSION:
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.payload),
      };

    case SET_CURRENT_SESSION_ID:
      return { ...state, currentSessionId: action.payload };

    case SET_PROJECTS:
      return { ...state, projects: action.payload };

    case ADD_PROJECT:
      return { ...state, projects: [action.payload, ...state.projects] };

    case UPDATE_PROJECT: {
      const { id, updater } = action.payload;
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === id ? updater(p) : p)),
      };
    }

    case DELETE_PROJECT:
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.payload),
      };

    case SET_CURRENT_PROJECT_ID:
      return { ...state, currentProjectId: action.payload };

    case LOAD_SESSION_MESSAGES:
      return {
        ...state,
        sessions: state.sessions.map((s) => {
          if (s.id !== action.payload.sessionId) return s;
          return { ...s, messages: action.payload.messages, messagesLoaded: true };
        }),
      };

    case REPLACE_IMAGE_URLS:
      return {
        ...state,
        sessions: state.sessions.map((s) => {
          if (s.id !== action.payload.sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((msg) => ({
              ...msg,
              parts: msg.parts.map((part) => {
                if (part.type !== 'image' || !action.payload.replacements.has(part.imageUrl)) return part;
                return { ...part, imageUrl: action.payload.replacements.get(part.imageUrl)! };
              }),
            })),
          };
        }),
      };

    default:
      return state;
  }
}
