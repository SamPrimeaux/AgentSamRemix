/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentSvgSketchPreview } from './AgentSvgSketchPreview';

function isExternalHref(href: string) {
  try {
    const u = new URL(href, window.location.origin);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

const mdWrapClass =
  'max-w-full min-w-0 ' +
  '[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_h1]:text-[1.0625rem] [&_h1]:font-bold [&_h1]:text-[var(--text-heading)] [&_h1]:mt-3 [&_h1]:mb-1.5 ' +
  '[&_h2]:text-[0.9375rem] [&_h2]:font-semibold [&_h2]:text-[var(--text-heading)] [&_h2]:mt-3 [&_h2]:mb-1 ' +
  '[&_h3]:text-[0.875rem] [&_h3]:font-semibold [&_h3]:text-[var(--text-heading)] [&_h3]:mt-2.5 [&_h3]:mb-1 ' +
  '[&_h4]:text-[0.8125rem] [&_h4]:font-semibold [&_h4]:text-[var(--text-heading)] [&_h4]:mt-2 [&_h4]:mb-0.5 ' +
  '[&_ul]:my-1.5 [&_ul]:pl-4 [&_ul]:list-disc ' +
  '[&_ol]:my-1.5 [&_ol]:pl-4 [&_ol]:list-decimal ' +
  '[&_li]:my-0.5 ' +
  '[&_hr]:my-3 [&_hr]:border-[var(--dashboard-border)] ' +
  '[&_a]:text-[var(--solar-cyan)] [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_strong]:font-semibold [&_strong]:text-[var(--dashboard-text)] ' +
  '[&_em]:italic [&_em]:text-[var(--dashboard-muted)] ' +
  '[&_code]:text-[0.75rem] [&_code]:font-mono [&_code]:bg-[color-mix(in_srgb,var(--solar-cyan)_14%,var(--dashboard-panel))] [&_code]:text-[var(--dashboard-text)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-[color-mix(in_srgb,var(--dashboard-border)_55%,transparent)] [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_code]:whitespace-normal ' +
  '[&_pre]:my-2 [&_pre]:p-3 [&_pre]:bg-[var(--scene-bg)] [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[var(--dashboard-border)] [&_pre]:overflow-x-auto [&_pre]:text-[0.75rem] [&_pre]:font-mono [&_pre]:text-[var(--solar-cyan)] ' +
  '[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--dashboard-border)] [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-[var(--dashboard-muted)] ' +
  '[&_table]:text-[0.75rem] [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto ' +
  '[&_th]:border [&_th]:border-[var(--dashboard-border)] [&_th]:px-2 [&_th]:py-1 [&_th]:bg-[var(--dashboard-panel)] [&_th]:text-left [&_th]:whitespace-nowrap ' +
  '[&_td]:border [&_td]:border-[var(--dashboard-border)] [&_td]:px-2 [&_td]:py-1 ';

export type AgentChatMarkdownProps = {
  source: string;
  /** Assistant images: click opens full size (new tab by default). */
  onImageClick?: (src: string) => void;
};

export function AgentChatMarkdown({ source, onImageClick }: AgentChatMarkdownProps) {
  const s = String(source ?? '');
  if (!s.trim()) return null;
  return (
    <div className={mdWrapClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...rest }) {
            const h = typeof href === 'string' ? href : '';
            const ext = h && isExternalHref(h);
            return (
              <a
                href={h || undefined}
                {...rest}
                {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {children}
              </a>
            );
          },
          img({ src, alt, title }) {
            const u = typeof src === 'string' ? src : '';
            return (
              <button
                type="button"
                className="my-2 block max-w-full rounded-lg border border-[var(--dashboard-border)] overflow-hidden bg-[var(--scene-bg)] p-0 cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--solar-cyan)]/40"
                title={(typeof alt === 'string' && alt.trim() ? alt : title) || 'Open image'}
                onClick={() => {
                  if (!u) return;
                  if (onImageClick) onImageClick(u);
                  else window.open(u, '_blank', 'noopener,noreferrer');
                }}
              >
                <img
                  src={u || undefined}
                  alt={typeof alt === 'string' ? alt : ''}
                  className="max-h-48 w-auto max-w-full object-contain block mx-auto"
                  loading="lazy"
                />
              </button>
            );
          },
          code({ className, children, ...rest }) {
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          pre({ children, ...rest }) {
            if (React.isValidElement(children)) {
              const props = children.props as { className?: string; children?: React.ReactNode };
              const lang = String(props.className || '')
                .replace(/^language-/, '')
                .trim()
                .toLowerCase();
              const text = String(props.children ?? '').replace(/\n$/, '');
              if (lang === 'svg' && /<svg[\s>]/i.test(text)) {
                return <AgentSvgSketchPreview source={text} title="Sketch preview" />;
              }
            }
            return <pre {...rest}>{children}</pre>;
          },
        }}
      >
        {s}
      </ReactMarkdown>
    </div>
  );
}
