import type { PiveoSceneOption, PiveoStylePreset } from './types';

export const SCENE_OPTIONS: PiveoSceneOption[] = [
  {
    id: 'product',
    label: 'Product',
    hint: '产品生成、背景替换、角度扩展',
    icon: 'cube',
  },
  {
    id: 'model',
    label: 'Model',
    hint: '换装、换场景、人像生成',
    icon: 'user',
  },
];

export const STYLE_LIBRARY: PiveoStylePreset[] = [
  {
    id: 'studio-clean',
    name: 'Studio Clean',
    thumbnail:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&q=80',
    promptTemplate: '干净棚拍，主体清晰，光影平衡，适配独立站商品主图。',
    sceneCompat: ['product', 'model'],
  },
  {
    id: 'lifestyle-soft',
    name: 'Lifestyle Soft',
    thumbnail:
      'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=600&q=80',
    promptTemplate: '生活化场景，柔和自然光，突出商品使用感与氛围。',
    sceneCompat: ['product', 'model'],
  },
  {
    id: 'instagram-bold',
    name: 'Instagram Bold',
    thumbnail:
      'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=600&q=80',
    promptTemplate: '高对比色彩，强视觉冲击，适合社媒传播封面。',
    sceneCompat: ['product', 'model'],
  },
  {
    id: 'editorial-fashion',
    name: 'Editorial Fashion',
    thumbnail:
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80',
    promptTemplate: '时尚编辑风构图，人物姿态高级，强调面料与剪裁细节。',
    sceneCompat: ['model'],
  },
  {
    id: 'detail-macro',
    name: 'Detail Macro',
    thumbnail:
      'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=600&q=80',
    promptTemplate: '细节特写，材质纹理清晰，适合商品卖点图。',
    sceneCompat: ['product'],
  },
  {
    id: 'minimal-white',
    name: 'Minimal White',
    thumbnail:
      'https://images.unsplash.com/photo-1479064555552-3ef4979f8908?auto=format&fit=crop&w=600&q=80',
    promptTemplate: '极简白底，边缘干净，电商标准展示风格。',
    sceneCompat: ['product', 'model'],
  },
];
