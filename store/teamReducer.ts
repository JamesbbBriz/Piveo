import type { Team } from '@/types';
import {
  SET_TEAMS,
  SET_CURRENT_TEAM_ID,
  ADD_TEAM,
  UPDATE_TEAM,
  DELETE_TEAM,
} from './actions';

export interface TeamState {
  teams: Team[];
  currentTeamId: string | null;  // null = personal space
}

export const teamInitialState: TeamState = {
  teams: [],
  currentTeamId: null,
};

export type TeamAction =
  | { type: typeof SET_TEAMS; payload: Team[] }
  | { type: typeof SET_CURRENT_TEAM_ID; payload: string | null }
  | { type: typeof ADD_TEAM; payload: Team }
  | { type: typeof UPDATE_TEAM; payload: { id: string; updater: (t: Team) => Team } }
  | { type: typeof DELETE_TEAM; payload: string };

export function teamReducer(state: TeamState, action: TeamAction): TeamState {
  switch (action.type) {
    case SET_TEAMS:
      return { ...state, teams: action.payload };

    case SET_CURRENT_TEAM_ID:
      return { ...state, currentTeamId: action.payload };

    case ADD_TEAM:
      return { ...state, teams: [...state.teams, action.payload] };

    case UPDATE_TEAM: {
      const { id, updater } = action.payload;
      return {
        ...state,
        teams: state.teams.map((t) => (t.id === id ? updater(t) : t)),
      };
    }

    case DELETE_TEAM:
      return {
        ...state,
        teams: state.teams.filter((t) => t.id !== action.payload),
      };

    default:
      return state;
  }
}
