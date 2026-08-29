import React, { useRef, useState } from 'react';
import { ImageAttachment } from '../../sdk/types';
import { fileToImageAttachment, SAMPLE_VISION_PRESETS, SampleImageSpec } from '../../services/visionService';

interface MobileImagePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageSelected: (attachment: ImageAttachment) => void;
  isDarkTheme?: boolean;
}

export const MobileImagePickerModal: React.FC<MobileImagePickerModalProps> = ({
  isOpen,
  onClose,
  onImageSelected,
  isDarkTheme = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setIsProcessing(true);
      try {
        const attachment = await fileToImageAttachment(e.target.files[0]);
        onImageSelected(attachment);
        onClose();
      } catch (err) {
        console.error('File read failed:', err);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setIsProcessing(true);
      try {
        const attachment = await fileToImageAttachment(e.dataTransfer.files[0]);
        onImageSelected(attachment);
        onClose();
      } catch (err) {
        console.error('Drop read failed:', err);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleSelectPreset = (preset: SampleImageSpec) => {
    const attachment: ImageAttachment = {
      id: `img_${Date.now()}_${preset.id}`,
      name: preset.name,
      mimeType: 'image/svg+xml',
      dataUrl: preset.dataUrl,
      sizeBytes: 4096,
      uploadedAt: Date.now(),
      previewUrl: preset.dataUrl,
    };
    onImageSelected(attachment);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div
        className={`w-full max-w-md rounded-t-3xl sm:rounded-2xl border shadow-2xl transition-all max-h-[85vh] flex flex-col overflow-hidden ${
          isDarkTheme
            ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
            : 'bg-white border-zinc-200 text-zinc-900'
        }`}
        onDragOver={e => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkTheme ? 'border-zinc-800' : 'border-zinc-100'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">add_photo_alternate</span>
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">Attach Visual Artifact</h3>
              <p className="text-[11px] text-zinc-500">Multimodal vision for Agent Sam</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 ${
              isDarkTheme ? 'hover:text-zinc-200' : 'hover:text-zinc-700'
            }`}
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Native Upload Button / Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-sky-500 bg-sky-500/5'
                : isDarkTheme
                ? 'border-zinc-700 hover:border-zinc-500 bg-zinc-950/50'
                : 'border-zinc-300 hover:border-sky-500 bg-zinc-50/70'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="w-12 h-12 mx-auto rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-2xl">cloud_upload</span>
            </div>
            <p className="font-semibold text-xs mb-1">
              {isProcessing ? 'Processing image...' : 'Tap to upload or drag & drop'}
            </p>
            <p className="text-[11px] text-zinc-500">
              Supports UI screenshots, architecture diagrams, error traces (PNG, JPG, WebP, SVG)
            </p>
          </div>

          {/* Quick Presets for Demo / Testing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Or pick a test sample
              </span>
              <span className="text-[10px] text-sky-500 font-medium">Instant Gemini Vision</span>
            </div>

            <div className="space-y-2">
              {SAMPLE_VISION_PRESETS.map(preset => (
                <div
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all hover:scale-[1.01] ${
                    isDarkTheme
                      ? 'border-zinc-800 bg-zinc-800/40 hover:bg-zinc-800/80 hover:border-zinc-700'
                      : 'border-zinc-200/80 bg-zinc-50 hover:bg-white hover:border-sky-300 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-700/20 bg-zinc-950 flex items-center justify-center shrink-0">
                      <img
                        src={preset.dataUrl}
                        alt={preset.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs tracking-tight">{preset.name}</span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase ${
                            preset.category === 'UI_MOCKUP'
                              ? 'bg-sky-500/10 text-sky-500'
                              : preset.category === 'ARCHITECTURE_DIAGRAM'
                              ? 'bg-purple-500/10 text-purple-500'
                              : 'bg-rose-500/10 text-rose-500'
                          }`}
                        >
                          {preset.category.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 line-clamp-1">{preset.description}</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-zinc-400 text-sm">arrow_forward</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
