import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Icon } from './Icon';
import { useToast } from './Toast';
import type { BrandKit, BrandKitImage, BrandTasteProfile, ImageRating } from '@/types';
import { canDistill, distillBrandTaste } from '@/services/brandTaste';
import { syncService } from '@/services/sync';

interface BrandKitPanelProps {
  brandKits: BrandKit[];
  onAdd: (kit: BrandKit) => void;
  onUpdate: (id: string, updates: Partial<BrandKit>) => void;
  onDelete: (id: string) => void;
  onActivate: (id: string | null) => void;
  onSetRatings: (kitId: string, ratings: ImageRating[]) => void;
  onSetTasteProfile: (kitId: string, profile: BrandTasteProfile | undefined) => void;
}

/* ── Tag Chips Input ── */
const TagInput: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}> = ({ tags, onChange, placeholder }) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput('');
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-dark-800 border border-dark-600 rounded-lg min-h-[36px]">
      {tags.map((tag, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-dark-700 border border-dark-500 rounded-full text-[11px] text-gray-200">
          {tag}
          <button onClick={() => onChange(tags.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400">
            <Icon name="times" className="text-[8px]" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[60px] bg-transparent text-[11px] text-gray-200 outline-none placeholder-gray-600"
      />
    </div>
  );
};

/* ── Color Palette Input ── */
const ColorPaletteInput: React.FC<{
  colors: string[];
  onChange: (colors: string[]) => void;
}> = ({ colors, onChange }) => {
  const [input, setInput] = useState('');

  const addColor = () => {
    const c = input.trim();
    if (c && /^#[0-9a-fA-F]{3,8}$/.test(c) && !colors.includes(c)) {
      onChange([...colors, c]);
      setInput('');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {colors.map((color, i) => (
          <button
            key={i}
            onClick={() => onChange(colors.filter((_, j) => j !== i))}
            className="group relative w-7 h-7 rounded-md border border-dark-500 shadow-sm"
            style={{ backgroundColor: color }}
            title={`${color} — 点击移除`}
          >
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/50 rounded-md">
              <Icon name="times" className="text-white text-[9px]" />
            </span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addColor()}
          placeholder="#FF5733"
          className="flex-1 h-7 px-2 bg-dark-800 border border-dark-600 rounded-md text-[11px] text-gray-200 outline-none focus:border-banana-500/50 placeholder-gray-600"
        />
        <button
          onClick={addColor}
          className="h-7 px-3 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:border-gray-500 transition-colors"
        >
          添加
        </button>
      </div>
    </div>
  );
};

/* ── Image Upload Area ── */
const ImageUploadArea: React.FC<{
  images: BrandKitImage[];
  imageType: BrandKitImage['imageType'];
  label: string;
  onChange: (images: BrandKitImage[]) => void;
}> = ({ images, imageType, label, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = images.filter((img) => img.imageType === imageType);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    const newImages: BrandKitImage[] = [];
    let loaded = 0;

    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        newImages.push({
          id: uuidv4(),
          imageUrl: reader.result as string,
          imageType,
          sortOrder: filtered.length + i,
          createdAt: Date.now(),
        });
        loaded++;
        if (loaded === files.length) {
          onChange([...images, ...newImages]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeImage = (id: string) => {
    onChange(images.filter((img) => img.id !== id));
  };

  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {filtered.map((img) => (
          <div key={img.id} className="relative group">
            <img
              src={img.imageUrl}
              alt=""
              className="w-16 h-16 rounded-md object-cover border border-dark-600"
              loading="lazy"
              decoding="async"
            />
            <button
              onClick={() => removeImage(img.id)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Icon name="times" />
            </button>
          </div>
        ))}
        <button
          onClick={() => inputRef.current?.click()}
          className="w-16 h-16 rounded-md border-2 border-dashed border-dark-600 bg-dark-800/50 flex items-center justify-center text-gray-500 hover:border-gray-500 hover:text-gray-400 transition-colors"
        >
          <Icon name="plus" className="text-sm" />
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
    </div>
  );
};

/* ── Kit Editor ── */
const KitEditor: React.FC<{
  kit: BrandKit;
  onUpdate: (updates: Partial<BrandKit>) => void;
  onBack: () => void;
  onDelete: () => void;
  onActivate: () => void;
  onSetRatings: (ratings: ImageRating[]) => void;
  onSetTasteProfile: (profile: BrandTasteProfile | undefined) => void;
}> = ({ kit, onUpdate, onBack, onDelete, onActivate, onSetRatings, onSetTasteProfile }) => {
  const [isDistilling, setIsDistilling] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<BrandTasteProfile | null>(null);
  const [ratingsLoaded, setRatingsLoaded] = useState(false);
  const { addToast } = useToast();

  // Lazy-load ratings when entering editor
  useEffect(() => {
    if (ratingsLoaded) return;
    let cancelled = false;
    syncService.fetchBrandKitRatings(kit.id).then((serverRatings) => {
      if (cancelled) return;
      const mapped: ImageRating[] = serverRatings.map((r: any) => ({
        id: r.id,
        brandKitId: r.brand_kit_id,
        imageUrl: r.blob_id ? `/api/data/blobs/${r.blob_id}` : r.image_url || '',
        blobId: r.blob_id ?? undefined,
        prompt: r.prompt || '',
        model: r.model || '',
        rating: r.rating,
        createdAt: r.created_at,
      }));
      onSetRatings(mapped);
      setRatingsLoaded(true);
    }).catch(() => {
      setRatingsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [kit.id, ratingsLoaded, onSetRatings]);

  const ratings = kit.ratings ?? [];
  const onBrandRatings = ratings.filter((r) => r.rating === 'on-brand');
  const offBrandRatings = ratings.filter((r) => r.rating === 'off-brand');
  const distillCheck = canDistill(ratings);

  const handleDistill = useCallback(async () => {
    if (isDistilling) return;
    setIsDistilling(true);
    try {
      const result = await distillBrandTaste(kit, ratings);
      setPendingProfile(result.profile);
      addToast({ type: 'success', message: 'AI 品味分析完成，请确认结果' });
    } catch (e: any) {
      addToast({ type: 'error', message: `分析失败：${e.message || '未知错误'}` });
    } finally {
      setIsDistilling(false);
    }
  }, [kit, ratings, isDistilling, addToast]);

  const handleConfirmProfile = useCallback(() => {
    if (!pendingProfile) return;
    onSetTasteProfile(pendingProfile);
    syncService.saveTasteProfile(kit.id, pendingProfile);
    setPendingProfile(null);
    addToast({ type: 'success', message: '品味画像已保存' });
  }, [pendingProfile, kit.id, onSetTasteProfile, addToast]);

  const handleClearProfile = useCallback(() => {
    onSetTasteProfile(undefined);
    syncService.saveTasteProfile(kit.id, null);
    addToast({ type: 'success', message: '品味画像已清除' });
  }, [kit.id, onSetTasteProfile, addToast]);

  // Profile to display: pending (unconfirmed) takes priority, then saved
  const displayProfile = pendingProfile ?? kit.tasteProfile;
  const isPending = pendingProfile !== null;

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-700 flex items-center gap-2">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-200 transition-colors">
          <Icon name="arrow-left" className="text-xs" />
        </button>
        <span className="text-xs font-bold text-gray-300 tracking-wider flex-1">编辑品牌套件</span>
        <button
          onClick={onActivate}
          className={`h-7 px-3 rounded-md text-[11px] font-semibold transition-colors ${
            kit.isActive
              ? "bg-banana-500/20 border border-banana-500 text-banana-400"
              : "border border-dark-600 bg-dark-800 text-gray-400 hover:border-banana-500 hover:text-banana-400"
          }`}
        >
          {kit.isActive ? "已激活" : "激活"}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">品牌名称</label>
          <input
            value={kit.name}
            onChange={(e) => onUpdate({ name: e.target.value, updatedAt: Date.now() })}
            className="w-full h-8 px-2 bg-dark-800 border border-dark-600 rounded-md text-[12px] text-gray-200 outline-none focus:border-banana-500/50"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">品牌描述</label>
          <textarea
            value={kit.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value, updatedAt: Date.now() })}
            placeholder="品牌简介、定位、目标客户…"
            rows={2}
            className="w-full px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-md text-[11px] text-gray-200 outline-none focus:border-banana-500/50 resize-y placeholder-gray-600"
          />
        </div>

        {/* Style Keywords */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">视觉风格关键词</label>
          <TagInput
            tags={kit.styleKeywords}
            onChange={(tags) => onUpdate({ styleKeywords: tags, updatedAt: Date.now() })}
            placeholder="输入后按回车，如：极简、暖调、自然光"
          />
        </div>

        {/* Color Palette */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">品牌色彩</label>
          <ColorPaletteInput
            colors={kit.colorPalette}
            onChange={(colors) => onUpdate({ colorPalette: colors, updatedAt: Date.now() })}
          />
        </div>

        {/* Mood Keywords */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">品牌氛围</label>
          <TagInput
            tags={kit.moodKeywords}
            onChange={(tags) => onUpdate({ moodKeywords: tags, updatedAt: Date.now() })}
            placeholder="输入后按回车，如：温馨、高级感、活力"
          />
        </div>

        {/* Reference Images */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">品牌参考素材</label>
          <ImageUploadArea
            images={kit.images}
            imageType="reference"
            label="风格参考图"
            onChange={(images) => onUpdate({ images, updatedAt: Date.now() })}
          />
          <div className="mt-2">
            <ImageUploadArea
              images={kit.images}
              imageType="logo"
              label="品牌 Logo"
              onChange={(images) => onUpdate({ images, updatedAt: Date.now() })}
            />
          </div>
          <div className="mt-2">
            <ImageUploadArea
              images={kit.images}
              imageType="mood_board"
              label="Mood Board"
              onChange={(images) => onUpdate({ images, updatedAt: Date.now() })}
            />
          </div>
        </div>

        {/* ── Brand Taste Learning Section ── */}
        <div className="border-t border-dark-700 pt-4">
          <label className="text-[11px] text-gray-500 mb-2 block">品牌品味学习</label>

          {/* Rating stats */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[11px] text-green-400 flex items-center gap-1">
              <span>👍</span> 符合 {onBrandRatings.length}
            </span>
            <span className="text-[11px] text-red-400 flex items-center gap-1">
              <span>👎</span> 不符合 {offBrandRatings.length}
            </span>
          </div>

          {/* On-brand thumbnails */}
          {onBrandRatings.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-gray-500 mb-1">符合品牌</div>
              <div className="flex flex-wrap gap-1">
                {onBrandRatings.slice(0, 6).map((r) => (
                  <img key={r.id} src={r.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover border border-green-500/30" loading="lazy" decoding="async" />
                ))}
                {onBrandRatings.length > 6 && (
                  <div className="w-10 h-10 rounded-md bg-dark-800 border border-dark-600 flex items-center justify-center text-[9px] text-gray-500">
                    +{onBrandRatings.length - 6}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Off-brand thumbnails */}
          {offBrandRatings.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] text-gray-500 mb-1">不符合品牌</div>
              <div className="flex flex-wrap gap-1">
                {offBrandRatings.slice(0, 4).map((r) => (
                  <img key={r.id} src={r.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover border border-red-500/30" loading="lazy" decoding="async" />
                ))}
                {offBrandRatings.length > 4 && (
                  <div className="w-10 h-10 rounded-md bg-dark-800 border border-dark-600 flex items-center justify-center text-[9px] text-gray-500">
                    +{offBrandRatings.length - 4}
                  </div>
                )}
              </div>
            </div>
          )}

          {ratings.length === 0 && (
            <p className="text-[10px] text-gray-600 mb-3">
              在图片详情中点击「符合品牌」或「不符合」来积累评价
            </p>
          )}

          {/* Distill button */}
          <button
            onClick={handleDistill}
            disabled={!distillCheck.ready || isDistilling}
            className="w-full h-9 rounded-lg border border-purple-500/50 bg-purple-500/10 text-[11px] text-purple-300 font-semibold hover:bg-purple-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {isDistilling ? (
              <>
                <Icon name="spinner" className="fa-spin text-[10px]" />
                分析中...
              </>
            ) : (
              <>
                <span className="text-sm">✨</span>
                {distillCheck.ready ? '提炼品牌偏好' : distillCheck.message}
              </>
            )}
          </button>
        </div>

        {/* ── AI Taste Analysis Result ── */}
        {displayProfile && (
          <div className="border-t border-dark-700 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="text-sm">🧠</span>
                AI 品味分析
                {displayProfile.ratingCountAtDistill > 0 && (
                  <span className="text-[9px] text-gray-600">基于 {displayProfile.ratingCountAtDistill} 张评价</span>
                )}
              </label>
              {isPending && (
                <span className="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">待确认</span>
              )}
            </div>

            {/* Preferences */}
            {displayProfile.learnedPreferences.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-gray-500 mb-1">偏好</div>
                <div className="flex flex-wrap gap-1">
                  {displayProfile.learnedPreferences.map((p, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[9px] rounded-full border border-green-500/20">{p}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Avoidances */}
            {displayProfile.learnedAvoidances.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-gray-500 mb-1">禁忌</div>
                <div className="flex flex-wrap gap-1">
                  {displayProfile.learnedAvoidances.map((a, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[9px] rounded-full border border-red-500/20">{a}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {displayProfile.compositionNotes && (
              <div className="mb-1.5">
                <span className="text-[10px] text-gray-500">构图：</span>
                <span className="text-[10px] text-gray-300">{displayProfile.compositionNotes}</span>
              </div>
            )}
            {displayProfile.colorNotes && (
              <div className="mb-1.5">
                <span className="text-[10px] text-gray-500">色彩：</span>
                <span className="text-[10px] text-gray-300">{displayProfile.colorNotes}</span>
              </div>
            )}
            {displayProfile.moodNotes && (
              <div className="mb-2">
                <span className="text-[10px] text-gray-500">氛围：</span>
                <span className="text-[10px] text-gray-300">{displayProfile.moodNotes}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              {isPending ? (
                <>
                  <button
                    onClick={handleConfirmProfile}
                    className="flex-1 h-7 rounded-md border border-green-500/50 bg-green-500/10 text-[11px] text-green-400 font-medium hover:bg-green-500/20 transition-colors"
                  >
                    确认写入
                  </button>
                  <button
                    onClick={() => setPendingProfile(null)}
                    className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-400 hover:border-gray-500 transition-colors"
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleDistill}
                    disabled={!distillCheck.ready || isDistilling}
                    className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-400 hover:border-gray-500 transition-colors disabled:opacity-40"
                  >
                    重新分析
                  </button>
                  <button
                    onClick={handleClearProfile}
                    className="h-7 px-3 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-500 hover:text-red-400 hover:border-red-900/50 transition-colors"
                  >
                    清除
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Delete */}
        <button
          onClick={onDelete}
          className="w-full h-8 rounded-md border border-dark-700 text-[11px] text-gray-500 hover:text-red-400 hover:border-red-900/50 transition-colors flex items-center justify-center gap-1.5"
        >
          <Icon name="trash-alt" className="text-[10px]" />
          删除品牌套件
        </button>
      </div>
    </div>
  );
};

/* ── Main Panel ── */
export const BrandKitPanel: React.FC<BrandKitPanelProps> = ({
  brandKits,
  onAdd,
  onUpdate,
  onDelete,
  onActivate,
  onSetRatings,
  onSetTasteProfile,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { addToast } = useToast();

  const editingKit = editingId ? brandKits.find((k) => k.id === editingId) : null;

  const handleCreate = () => {
    const kit: BrandKit = {
      id: uuidv4(),
      name: `品牌 ${brandKits.length + 1}`,
      styleKeywords: [],
      colorPalette: [],
      moodKeywords: [],
      isActive: false,
      images: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onAdd(kit);
    setEditingId(kit.id);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('确定要删除此品牌套件吗？')) return;
    onDelete(id);
    setEditingId(null);
    addToast({ type: 'success', message: '品牌套件已删除' });
  };

  const handleActivate = (id: string) => {
    const kit = brandKits.find((k) => k.id === id);
    if (!kit) return;
    onActivate(kit.isActive ? null : id);
    addToast({ type: 'success', message: kit.isActive ? '已停用品牌套件' : '已激活品牌套件' });
  };

  if (editingKit) {
    return (
      <KitEditor
        kit={editingKit}
        onUpdate={(updates) => onUpdate(editingKit.id, updates)}
        onBack={() => setEditingId(null)}
        onDelete={() => handleDelete(editingKit.id)}
        onActivate={() => handleActivate(editingKit.id)}
        onSetRatings={(ratings) => onSetRatings(editingKit.id, ratings)}
        onSetTasteProfile={(profile) => onSetTasteProfile(editingKit.id, profile)}
      />
    );
  }

  const activeKit = brandKits.find((k) => k.isActive);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-200">品牌套件</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">定义品牌视觉 DNA，影响所有图片生成</p>
        </div>
        <button
          onClick={handleCreate}
          className="h-8 px-4 rounded-lg bg-banana-500 text-dark-900 text-[12px] font-semibold hover:bg-banana-400 transition-colors flex items-center gap-1.5"
        >
          <Icon name="plus" className="text-[11px]" />
          新建
        </button>
      </div>

      {/* Active indicator */}
      {activeKit && (
        <div className="mx-6 mt-3 p-3 rounded-lg border border-banana-500/30 bg-banana-500/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-banana-500 animate-pulse" />
            <span className="text-[11px] text-banana-400 font-medium">当前激活：{activeKit.name}</span>
          </div>
          {activeKit.styleKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {activeKit.styleKeywords.map((kw, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-banana-500/10 text-banana-400 text-[9px] rounded-full">{kw}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Kit list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-2">
        {brandKits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Icon name="palette" className="text-4xl mb-3 opacity-30" />
            <p className="text-sm">还没有品牌套件</p>
            <p className="text-[11px] text-gray-600 mt-1">创建品牌套件来统一生成图片的视觉风格</p>
          </div>
        ) : (
          brandKits.map((kit) => (
            <div
              key={kit.id}
              onClick={() => setEditingId(kit.id)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors hover:border-gray-500 ${
                kit.isActive ? "border-banana-500/50 bg-banana-500/5" : "border-dark-600 bg-dark-800"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] text-gray-200 font-medium">{kit.name}</span>
                {kit.isActive && (
                  <span className="text-[9px] text-banana-400 bg-banana-500/20 px-1.5 py-0.5 rounded-full">激活</span>
                )}
              </div>
              {kit.description && (
                <p className="text-[10px] text-gray-500 line-clamp-1">{kit.description}</p>
              )}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {kit.colorPalette.slice(0, 6).map((color, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-sm border border-dark-500"
                    style={{ backgroundColor: color }}
                  />
                ))}
                {kit.styleKeywords.slice(0, 3).map((kw, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-dark-700 text-gray-400 text-[9px] rounded-full">{kw}</span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
