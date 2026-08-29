import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

function isExternalHref(href: string) {
  try {
    const u = new URL(href, window.location.origin);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        padding: '1px 6px',
        borderRadius: 6,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-main)',
        fontSize: 12,
      }}
    >
      {children}
    </code>
  );
}

function CodeFence({ code, lang }: { code: string; lang?: string }) {
  return (
    <div style={{ margin: '14px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'color-mix(in srgb, var(--bg-panel) 90%, transparent)',
          border: '1px solid var(--border-subtle)',
          borderBottom: 'none',
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        }}
      >
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          code
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{lang || ''}</div>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px 14px',
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
          background: 'var(--bg-code-pre)',
          border: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          fontSize: 12,
          color: 'var(--text-main)',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="learn-markdown" style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: 'wrap',
              properties: {
                style: 'text-decoration:none; color:inherit;',
              },
            },
          ],
        ]}
        components={{
          h1: (props) => <h1 {...props} style={{ margin: '18px 0 10px', fontSize: 20, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.25 }} />,
          h2: (props) => <h2 {...props} style={{ margin: '18px 0 10px', fontSize: 16, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.25 }} />,
          h3: (props) => <h3 {...props} style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.25 }} />,
          h4: (props) => <h4 {...props} style={{ margin: '14px 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.25 }} />,
          p: (props) => <p {...props} style={{ margin: '10px 0' }} />,
          ul: (props) => <ul {...props} style={{ margin: '10px 0 10px 20px', padding: 0 }} />,
          ol: (props) => <ol {...props} style={{ margin: '10px 0 10px 20px', padding: 0 }} />,
          li: (props) => <li {...props} style={{ margin: '6px 0' }} />,
          blockquote: (props) => (
            <blockquote
              {...props}
              style={{
                margin: '12px 0',
                padding: '10px 12px',
                borderLeft: '3px solid var(--solar-cyan)',
                background: 'color-mix(in srgb, var(--bg-panel) 85%, transparent)',
                borderRadius: 8,
                color: 'var(--text-muted)',
              }}
            />
          ),
          a: ({ href, children, ...props }) => {
            const url = String(href || '');
            const external = url ? isExternalHref(url) : false;
            return (
              <a
                {...props}
                href={url}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
                style={{ color: 'var(--solar-cyan)', textDecoration: 'none' }}
              >
                {children}
              </a>
            );
          },
          code: ({ className, children }) => {
            const raw = String(children || '');
            const match = /language-(\w+)/.exec(className || '');
            const lang = match?.[1];
            // react-markdown uses `inline` via prop in some versions; safest detection is newline.
            const isBlock = raw.includes('\n');
            if (!isBlock) return <InlineCode>{children}</InlineCode>;
            return <CodeFence code={raw.replace(/\n$/, '')} lang={lang} />;
          },
          table: (props) => (
            <div style={{ overflowX: 'auto', margin: '12px 0', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              <table {...props} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} />
            </div>
          ),
          thead: (props) => <thead {...props} style={{ background: 'color-mix(in srgb, var(--bg-panel) 90%, transparent)' }} />,
          th: (props) => (
            <th
              {...props}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            />
          ),
          td: (props) => <td {...props} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }} />,
          hr: () => <div style={{ height: 1, background: 'var(--border-subtle)', margin: '16px 0' }} />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

