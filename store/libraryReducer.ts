import type { ModelCharacter, ProductCatalogItem, SystemTemplate } from '@/types';
import {
  SET_MODELS,
  ADD_MODEL,
  UPDATE_MODEL,
  DELETE_MODEL,
  SET_PRODUCTS,
  ADD_PRODUCT,
  UPDATE_PRODUCT,
  DELETE_PRODUCT,
  SET_TEMPLATES,
} from './actions';

export interface LibraryState {
  models: ModelCharacter[];
  products: ProductCatalogItem[];
  templates: SystemTemplate[];
}

export const libraryInitialState: LibraryState = {
  models: [],
  products: [],
  templates: [],
};

export type LibraryAction =
  | { type: typeof SET_MODELS; payload: ModelCharacter[] }
  | { type: typeof ADD_MODEL; payload: ModelCharacter }
  | { type: typeof UPDATE_MODEL; payload: { id: string; updates: Partial<ModelCharacter> } }
  | { type: typeof DELETE_MODEL; payload: string }
  | { type: typeof SET_PRODUCTS; payload: ProductCatalogItem[] }
  | { type: typeof ADD_PRODUCT; payload: ProductCatalogItem }
  | { type: typeof UPDATE_PRODUCT; payload: { id: string; updates: Partial<Omit<ProductCatalogItem, 'id' | 'createdAt'>> } }
  | { type: typeof DELETE_PRODUCT; payload: string }
  | { type: typeof SET_TEMPLATES; payload: SystemTemplate[] };

export function libraryReducer(state: LibraryState, action: LibraryAction): LibraryState {
  switch (action.type) {
    case SET_MODELS:
      return { ...state, models: action.payload };

    case ADD_MODEL:
      return { ...state, models: [...state.models, action.payload] };

    case UPDATE_MODEL: {
      const { id, updates } = action.payload;
      return {
        ...state,
        models: state.models.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      };
    }

    case DELETE_MODEL:
      return {
        ...state,
        models: state.models.filter((m) => m.id !== action.payload),
      };

    case SET_PRODUCTS:
      return { ...state, products: action.payload };

    case ADD_PRODUCT:
      return { ...state, products: [...state.products, action.payload] };

    case UPDATE_PRODUCT: {
      const { id, updates } = action.payload;
      return {
        ...state,
        products: state.products.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      };
    }

    case DELETE_PRODUCT:
      return {
        ...state,
        products: state.products.filter((p) => p.id !== action.payload),
      };

    case SET_TEMPLATES:
      return { ...state, templates: action.payload };

    default:
      return state;
  }
}
