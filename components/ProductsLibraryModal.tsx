import React, { useRef, useState } from "react";
import { ProductCatalogItem } from "../types";
import { Icon } from "./Icon";
import { ImagePreviewModal } from "./ImagePreviewModal";

interface ProductsLibraryModalProps {
  products: ProductCatalogItem[];
  onAddProduct: (product: ProductCatalogItem) => void;
  onUpdateProduct: (productId: string, updates: Partial<Omit<ProductCatalogItem, 'id' | 'createdAt'>>) => void;
  onDeleteProduct: (productId: string) => void;
  onClose: () => void;
}

interface EditForm {
  name: string;
  category: string;
  width: string;
  height: string;
  depth: string;
  description: string;
}

export const ProductsLibraryModal: React.FC<ProductsLibraryModalProps> = ({
  products,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onClose,
}) => {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    category: "",
    width: "",
    height: "",
    depth: "",
    description: "",
  });
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const newProduct: ProductCatalogItem = {
        id: crypto.randomUUID(),
        name: `产品 ${products.length + 1}`,
        imageUrl: reader.result as string,
        createdAt: Date.now(),
      };
      onAddProduct(newProduct);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const startEdit = (product: ProductCatalogItem) => {
    setEditingProductId(product.id);
    setEditForm({
      name: product.name,
      category: product.category || "",
      width: product.dimensions?.width?.toString() || "",
      height: product.dimensions?.height?.toString() || "",
      depth: product.dimensions?.depth?.toString() || "",
      description: product.description || "",
    });
  };

  const saveEdit = (productId: string) => {
    const trimmedName = editForm.name.trim();
    if (!trimmedName) return;

    const width = parseFloat(editForm.width);
    const height = parseFloat(editForm.height);
    const depth = parseFloat(editForm.depth);

    const dimensions: { width?: number; height?: number; depth?: number } = {};
    if (width > 0) dimensions.width = width;
    if (height > 0) dimensions.height = height;
    if (depth > 0) dimensions.depth = depth;

    const updates: Partial<Omit<ProductCatalogItem, 'id' | 'createdAt'>> = {
      name: trimmedName,
    };

    const trimmedCategory = editForm.category.trim();
    if (trimmedCategory) updates.category = trimmedCategory;

    if (Object.keys(dimensions).length > 0) updates.dimensions = dimensions;

    const trimmedDescription = editForm.description.trim();
    if (trimmedDescription) updates.description = trimmedDescription;

    onUpdateProduct(productId, updates);
    setEditingProductId(null);
  };

  const cancelEdit = () => {
    setEditingProductId(null);
  };

  const formatDimensions = (dimensions?: { width?: number; height?: number; depth?: number }) => {
    if (!dimensions) return null;
    const parts = [dimensions.width, dimensions.height, dimensions.depth].filter(v => v && v > 0);
    if (parts.length === 0) return null;
    return parts.join("×") + "cm";
  };

  const inputClass = "px-2 py-1.5 text-xs rounded bg-dark-900 border border-dark-600 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-banana-500";

  return (
    <>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div
          className="bg-dark-900 border border-dark-700 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
            <div className="flex items-center gap-3">
              <Icon name="cube" className="text-banana-400 text-xl" />
              <h2 className="text-xl font-semibold text-gray-100">产品库</h2>
              <span className="px-2 py-0.5 text-xs rounded-full bg-dark-800 text-gray-400 border border-dark-600">
                {products.length} 个产品
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-400 hover:text-gray-200 flex items-center justify-center transition-colors"
            >
              <Icon name="times" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {/* Upload Card */}
              <div
                onClick={() => uploadInputRef.current?.click()}
                className="aspect-square rounded-lg border-2 border-dashed border-dark-600 bg-dark-800/40 hover:border-banana-500 hover:bg-dark-800 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-banana-400"
              >
                <Icon name="plus" className="text-3xl" />
                <span className="text-xs">上传产品</span>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                />
              </div>

              {/* Product Cards */}
              {products.map((product) => (
                <div
                  key={product.id}
                  className="aspect-square rounded-lg border border-dark-700 bg-dark-800/60 overflow-hidden group relative"
                >
                  {/* Image */}
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    onClick={() => setPreviewImageUrl(product.imageUrl)}
                    className="w-full h-full object-cover cursor-pointer group-hover:opacity-90 transition-opacity"
                    loading="lazy"
                    decoding="async"
                  />

                  {/* Bottom overlay with info */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-200 font-medium truncate flex-1">
                        {product.name}
                      </span>
                      {product.category && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-banana-500/20 text-banana-300 border border-banana-500/30 whitespace-nowrap">
                          {product.category}
                        </span>
                      )}
                    </div>
                    {formatDimensions(product.dimensions) && (
                      <span className="text-[10px] text-gray-400">
                        {formatDimensions(product.dimensions)}
                      </span>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-1 mt-0.5">
                      <button
                        onClick={() => startEdit(product)}
                        className="flex-1 px-2 py-1 text-xs rounded bg-dark-800/80 border border-dark-600 text-gray-300 hover:border-banana-500 hover:text-banana-400 transition-colors"
                      >
                        <Icon name="edit" className="mr-1" />
                        编辑
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`确定要删除产品"${product.name}"吗？`)) {
                            onDeleteProduct(product.id);
                          }
                        }}
                        className="flex-1 px-2 py-1 text-xs rounded bg-dark-800/80 border border-red-500/40 text-red-300 hover:bg-red-500/20 transition-colors"
                      >
                        <Icon name="trash" className="mr-1" />
                        删除
                      </button>
                    </div>
                  </div>

                  {/* Delete button (top-right) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`确定要删除产品"${product.name}"吗？`)) {
                        onDeleteProduct(product.id);
                      }
                    }}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs shadow-lg hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Icon name="times" />
                  </button>

                  {/* Edit form overlay */}
                  {editingProductId === product.id && (
                    <div className="absolute inset-0 bg-dark-900/95 p-3 flex flex-col gap-2 overflow-y-auto">
                      <input
                        type="text"
                        placeholder="产品名称"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className={inputClass}
                        autoFocus
                      />
                      <input
                        type="text"
                        placeholder="分类（如：发饰、包包）"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className={inputClass}
                      />
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          placeholder="宽cm"
                          value={editForm.width}
                          onChange={(e) => setEditForm({ ...editForm, width: e.target.value })}
                          className={`w-1/3 ${inputClass}`}
                        />
                        <input
                          type="number"
                          placeholder="高cm"
                          value={editForm.height}
                          onChange={(e) => setEditForm({ ...editForm, height: e.target.value })}
                          className={`w-1/3 ${inputClass}`}
                        />
                        <input
                          type="number"
                          placeholder="深cm"
                          value={editForm.depth}
                          onChange={(e) => setEditForm({ ...editForm, depth: e.target.value })}
                          className={`w-1/3 ${inputClass}`}
                        />
                      </div>
                      <textarea
                        placeholder="产品描述..."
                        rows={2}
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className={`${inputClass} resize-none`}
                      />
                      <div className="flex gap-1 mt-auto">
                        <button
                          onClick={() => saveEdit(product.id)}
                          className="flex-1 px-2 py-1.5 text-xs rounded bg-banana-500 text-dark-900 hover:bg-banana-400 font-medium transition-colors"
                        >
                          保存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex-1 px-2 py-1.5 text-xs rounded bg-dark-700 text-gray-300 hover:bg-dark-600 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {products.length === 0 && (
              <div className="py-16 text-center">
                <Icon name="cube" className="text-6xl text-gray-700 mb-4" />
                <p className="text-gray-500 text-sm">还没有产品，点击上方卡片添加第一个产品</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-dark-700 flex items-center justify-between bg-dark-900/60">
            <p className="text-xs text-gray-500">提示：点击编辑可添加产品尺寸和描述</p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* Image Preview */}
      {previewImageUrl && (
        <ImagePreviewModal
          imageUrl={previewImageUrl}
          onClose={() => setPreviewImageUrl(null)}
        />
      )}
    </>
  );
};
