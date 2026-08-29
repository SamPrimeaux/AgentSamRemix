import React, { useState } from 'react';
import { ImageAttachment, ImageAnalysisResult } from '../../sdk/types';

interface ImageInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachment: ImageAttachment | null;
  analysis: ImageAnalysisResult | null;
  isDarkTheme?: boolean;
  onLaunchMission?: (prompt: string) => void;
}

export const ImageInspectionModal: React.FC<ImageInspectionModalProps> = ({
  isOpen,
  onClose,
  attachment,
  analysis,
  isDarkTheme = false,
  onLaunchMission,
}) => {
  const [copiedOcr, setCopiedOcr] = useState(false);

  if (!isOpen || !attachment) return null;

  const handleCopyOcr = () => {
    if (analysis?.ocrText) {
      navigator.clipboard.writeText(analysis.ocrText);
      setCopiedOcr(true);
      setTimeout(() => setCopiedOcr(false), 2000);
    }
  };

  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'UI_MOCKUP':
        return 'bg-sky-500/10 text-sky-500 border-sky-500/30';
      case 'ARCHITECTURE_DIAGRAM':
        return 'bg-purple-500/10 text-purple-500 border-purple-500/30';
      case 'ERROR_LOG_TRACE':
        return 'bg-rose-500/10 text-rose-500 border-rose-500/30';
      case 'CODE_SNIPPET':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
      default:
        return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-3 sm:p-6">
      <div
        className={`w-full max-w-2xl max-h-[90vh] rounded-3xl border shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
          isDarkTheme
            ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
            : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        {/* Modal Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkTheme ? 'border-zinc-800' : 'border-zinc-100'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">visibility</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm tracking-tight">{attachment.name}</h3>
                {analysis && (
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${getCategoryColor(analysis.classification)}`}>
                    {analysis.classification.replace('_', ' ')}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 font-mono">
                {Math.round(attachment.sizeBytes / 1024)} KB • Multimodal Gemini Vision
              </p>
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

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* Visual Image Preview */}
          <div className="w-full max-h-72 rounded-2xl overflow-hidden border border-zinc-700/20 bg-zinc-950 flex items-center justify-center shadow-inner">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-h-72 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
          </div>

          {/* AI Analysis Summary */}
          {analysis ? (
            <div className="space-y-4">
              <div className={`p-4 rounded-2xl border ${isDarkTheme ? 'bg-zinc-800/40 border-zinc-800' : 'bg-sky-50/60 border-sky-100'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold tracking-tight">
                    <span className="material-symbols-outlined text-sky-500 text-base">auto_awesome</span>
                    <span>Agent Sam Vision Summary</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    {Math.round(analysis.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {analysis.summary}
                </p>
              </div>

              {/* Detected Entities */}
              {analysis.detectedEntities && analysis.detectedEntities.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    Detected Structural Entities
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.detectedEntities.map((entity, i) => (
                      <span
                        key={i}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${
                          isDarkTheme
                            ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                            : 'bg-zinc-100 border-zinc-200 text-zinc-700'
                        }`}
                      >
                        {entity}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* OCR Text */}
              {analysis.ocrText && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Extracted Text / OCR Transcript
                    </h4>
                    <button
                      onClick={handleCopyOcr}
                      className="text-[11px] text-sky-500 hover:text-sky-400 flex items-center gap-1 font-medium"
                    >
                      <span className="material-symbols-outlined text-xs">
                        {copiedOcr ? 'check' : 'content_copy'}
                      </span>
                      {copiedOcr ? 'Copied' : 'Copy Text'}
                    </button>
                  </div>
                  <div
                    className={`p-3 rounded-xl font-mono text-xs overflow-x-auto max-h-32 border ${
                      isDarkTheme
                        ? 'bg-black/60 border-zinc-800 text-zinc-300'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-800'
                    }`}
                  >
                    {analysis.ocrText}
                  </div>
                </div>
              )}

              {/* Suggested Actions */}
              {analysis.suggestedActions && analysis.suggestedActions.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    Actionable Engineering Strategy
                  </h4>
                  <div className="space-y-1.5">
                    {analysis.suggestedActions.map((action, i) => (
                      <div
                        key={i}
                        className={`text-xs p-2.5 rounded-xl border flex items-start gap-2.5 ${
                          isDarkTheme
                            ? 'bg-zinc-800/20 border-zinc-800 text-zinc-300'
                            : 'bg-zinc-50 border-zinc-200/80 text-zinc-700'
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 text-center text-zinc-400 text-xs border border-dashed rounded-2xl border-zinc-700">
              <span className="material-symbols-outlined text-3xl mb-2 text-sky-500 animate-spin">
                progress_activity
              </span>
              <p>Analyzing image structure with Gemini Vision...</p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className={`p-4 border-t flex items-center justify-between gap-3 ${isDarkTheme ? 'border-zinc-800 bg-zinc-950/40' : 'border-zinc-100 bg-zinc-50/50'}`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border ${
              isDarkTheme ? 'border-zinc-700 hover:bg-zinc-800 text-zinc-300' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-700'
            }`}
          >
            Close
          </button>

          {analysis && onLaunchMission && (
            <button
              onClick={() => {
                onLaunchMission(analysis.suggestedMissionPrompt || `Execute engineering plan for ${attachment.name}`);
                onClose();
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/25 flex items-center gap-1.5 transition-transform active:scale-95"
            >
              <span className="material-symbols-outlined text-sm">rocket_launch</span>
              <span>Execute from Visual Spec</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
