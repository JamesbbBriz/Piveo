import type { ModelCharacter, ProductCatalogItem, SystemTemplate, BrandKit, ImageRating, BrandTasteProfile } from '@/types';
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
  SET_BRAND_KITS,
  ADD_BRAND_KIT,
  UPDATE_BRAND_KIT,
  DELETE_BRAND_KIT,
  SET_ACTIVE_BRAND_KIT,
  SET_BRAND_TASTE_RATINGS,
  ADD_BRAND_TASTE_RATING,
  REMOVE_BRAND_TASTE_RATING,
  SET_BRAND_TASTE_PROFILE,
} from './actions';

export interface LibraryState {
  models: ModelCharacter[];
  products: ProductCatalogItem[];
  templates: SystemTemplate[];
  brandKits: BrandKit[];
}

export const libraryInitialState: LibraryState = {
  models: [],
  products: [],
  templates: [],
  brandKits: [],
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
  | { type: typeof SET_TEMPLATES; payload: SystemTemplate[] }
  | { type: typeof SET_BRAND_KITS; payload: BrandKit[] }
  | { type: typeof ADD_BRAND_KIT; payload: BrandKit }
  | { type: typeof UPDATE_BRAND_KIT; payload: { id: string; updates: Partial<BrandKit> } }
  | { type: typeof DELETE_BRAND_KIT; payload: string }
  | { type: typeof SET_ACTIVE_BRAND_KIT; payload: string | null }
  | { type: typeof SET_BRAND_TASTE_RATINGS; payload: { kitId: string; ratings: ImageRating[] } }
  | { type: typeof ADD_BRAND_TASTE_RATING; payload: { kitId: string; rating: ImageRating } }
  | { type: typeof REMOVE_BRAND_TASTE_RATING; payload: { kitId: string; ratingId: string } }
  | { type: typeof SET_BRAND_TASTE_PROFILE; payload: { kitId: string; profile: BrandTasteProfile | undefined } };

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

    case SET_BRAND_KITS:
      return { ...state, brandKits: action.payload };

    case ADD_BRAND_KIT:
      return { ...state, brandKits: [...state.brandKits, action.payload] };

    case UPDATE_BRAND_KIT: {
      const { id, updates } = action.payload;
      return {
        ...state,
        brandKits: state.brandKits.map((k) => (k.id === id ? { ...k, ...updates } : k)),
      };
    }

    case DELETE_BRAND_KIT:
      return {
        ...state,
        brandKits: state.brandKits.filter((k) => k.id !== action.payload),
      };

    case SET_ACTIVE_BRAND_KIT: {
      const activeId = action.payload;
      return {
        ...state,
        brandKits: state.brandKits.map((k) => ({
          ...k,
          isActive: k.id === activeId,
        })),
      };
    }

    case SET_BRAND_TASTE_RATINGS: {
      const { kitId, ratings } = action.payload;
      return {
        ...state,
        brandKits: state.brandKits.map((k) => k.id === kitId ? { ...k, ratings } : k),
      };
    }

    case ADD_BRAND_TASTE_RATING: {
      const { kitId, rating } = action.payload;
      return {
        ...state,
        brandKits: state.brandKits.map((k) => {
          if (k.id !== kitId) return k;
          const existing = k.ratings ?? [];
          const replaced = existing.filter((r) => r.id !== rating.id);
          return { ...k, ratings: [...replaced, rating] };
        }),
      };
    }

    case REMOVE_BRAND_TASTE_RATING: {
      const { kitId, ratingId } = action.payload;
      return {
        ...state,
        brandKits: state.brandKits.map((k) => {
          if (k.id !== kitId) return k;
          return { ...k, ratings: (k.ratings ?? []).filter((r) => r.id !== ratingId) };
        }),
      };
    }

    case SET_BRAND_TASTE_PROFILE: {
      const { kitId, profile } = action.payload;
      return {
        ...state,
        brandKits: state.brandKits.map((k) => k.id === kitId ? { ...k, tasteProfile: profile } : k),
      };
    }

    default:
      return state;
  }
}
