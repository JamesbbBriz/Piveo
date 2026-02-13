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

interface AnnotateForm {
  name: string;
  category: string;
  size: string;
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
  const [annotatingProduct, setAnnotatingProduct] = useState<ProductCatalogItem | null>(null);
  const [annotateForm, setAnnotateForm] = useState<AnnotateForm>({
    name: "",
    category: "",
    size: "",
    description: "",
  });
  const [awaitingPaste, setAwaitingPaste] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pasteTargetRef = useRef<HTMLDivElement>(null);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onloadend = () => {
          onAddProduct({
            id: crypto.randomUUID(),
            name: `产品 ${products.length + 1}`,
            imageUrl: reader.result as string,
            createdAt: Date.now(),
          });
        };
        reader.readAsDataURL(file);
        setAwaitingPaste(false);
        return;
      }
    }
  };

  const primePaste = () => {
    pasteTargetRef.current?.focus();
  };

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

  const startAnnotate = (product: ProductCatalogItem) => {
    setAnnotatingProduct(product);
    setAnnotateForm({
      name: product.name,
      category: product.category || "",
      size: product.size || "",
      description: product.description || "",
    });
  };

  const saveAnnotate = () => {
    if (!annotatingProduct) return;
    const trimmedName = annotateForm.name.trim();
    if (!trimmedName) return;

    onUpdateProduct(annotatingProduct.id, {
      name: trimmedName,
      category: annotateForm.category.trim() || undefined,
      size: annotateForm.size.trim() || undefined,
      description: annotateForm.description.trim() || undefined,
    });
    setAnnotatingProduct(null);
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
            <div className="flex items-center gap-2">
              <div
                ref={pasteTargetRef}
                tabIndex={0}
                onFocus={() => setAwaitingPaste(true)}
                onBlur={() => setAwaitingPaste(false)}
                onPaste={handlePaste}
                className="sr-only"
                aria-label="粘贴产品图片目标"
              />
              <button
                onClick={primePaste}
                className={`h-8 px-2.5 rounded-md border text-[11px] transition-colors ${
                  awaitingPaste
                    ? "border-banana-500/40 bg-banana-500/10 text-banana-400"
                    : "border-dark-600 bg-dark-800 text-gray-300 hover:text-gray-100 hover:border-gray-500"
                }`}
                title="粘贴产品图"
              >
                粘贴产品
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-400 hover:text-gray-200 flex items-center justify-center transition-colors"
              >
                <Icon name="times" />
              </button>
            </div>
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
                    {product.size && (
                      <span className="text-[10px] text-gray-400">{product.size}</span>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-1 mt-0.5">
                      <button
                        onClick={() => startAnnotate(product)}
                        className="flex-1 px-2 py-1 text-xs rounded bg-dark-800/80 border border-dark-600 text-gray-300 hover:border-banana-500 hover:text-banana-400 transition-colors"
                      >
                        <Icon name="tag" className="mr-1" />
                        标注
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
            <p className={`text-xs ${awaitingPaste ? "text-banana-400" : "text-gray-500"}`}>
              {awaitingPaste
                ? "现在直接按 Cmd/Ctrl + V 即可把剪贴板图片放进产品库。"
                : "提示：点击标注可添加产品尺寸和描述"}
            </p>
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

      {/* Annotate Modal */}
      {annotatingProduct && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => setAnnotatingProduct(null)}>
          <div
            className="bg-dark-900 border border-dark-700 rounded-xl w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-dark-700">
              <h3 className="text-sm font-semibold text-gray-100">产品标注</h3>
              <button onClick={() => setAnnotatingProduct(null)} className="text-gray-400 hover:text-gray-200">
                <Icon name="times" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex gap-4">
                <img
                  src={annotatingProduct.imageUrl}
                  alt={annotatingProduct.name}
                  className="w-20 h-20 rounded-lg object-cover border border-dark-600 shrink-0"
                />
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    placeholder="产品名称"
                    value={annotateForm.name}
                    onChange={(e) => setAnnotateForm({ ...annotateForm, name: e.target.value })}
                    className={inputClass + " w-full"}
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="分类（如：发饰、包包）"
                    value={annotateForm.category}
                    onChange={(e) => setAnnotateForm({ ...annotateForm, category: e.target.value })}
                    className={inputClass + " w-full"}
                  />
                </div>
              </div>
              <input
                type="text"
                placeholder="尺寸（如：30×20×15cm、手掌大小、A4纸大小）"
                value={annotateForm.size}
                onChange={(e) => setAnnotateForm({ ...annotateForm, size: e.target.value })}
                className={inputClass + " w-full"}
              />
              <textarea
                placeholder="产品描述..."
                rows={3}
                value={annotateForm.description}
                onChange={(e) => setAnnotateForm({ ...annotateForm, description: e.target.value })}
                className={inputClass + " w-full resize-none"}
              />
            </div>
            <div className="px-5 py-3 border-t border-dark-700 flex gap-2 justify-end">
              <button
                onClick={() => setAnnotatingProduct(null)}
                className="px-4 py-1.5 text-xs rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveAnnotate}
                className="px-4 py-1.5 text-xs rounded-lg bg-banana-500 text-dark-900 hover:bg-banana-400 font-medium transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
