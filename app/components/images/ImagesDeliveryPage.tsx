import React, { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Copy, Plus } from 'lucide-react';
import type { ImagesOutletContext } from './ImagesShell';
import {
  ImagesToastStack,
  ImagesUsageAccountSidebar,
  useImagesAccountState,
} from './ImagesUsageAccountSidebar';
import { NAMED_VARIANTS } from './imagesRegistry';
import { fetchRealVariantsCatalog, imagesListUrl, useImagesToast, type CfVariantDef } from './imagesApi';

export function ImagesDeliveryPage() {
  const { workspaceId } = useOutletContext<ImagesOutletContext>();
  const { toasts, add: toast } = useImagesToast();
  const { accountHash, setAccountHash, transformed } = useImagesAccountState(workspaceId);
  const [stored, setStored] = useState(0);
  // Real, account-configured variant list — null while loading/unavailable,
  // in which case the static NAMED_VARIANTS guesses are used as a fallback.
  const [realVariants, setRealVariants] = useState<CfVariantDef[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRealVariantsCatalog().then((v) => {
      if (!cancelled) setRealVariants(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (realVariants && realVariants.length) {
      return realVariants.map((v) => ({
        id: v.id,
        label: v.id,
        hint: v.width && v.height ? `${v.width}\u00d7${v.height}` : 'original',
      }));
    }
    return NAMED_VARIANTS.map((v) => ({ id: v.id, label: v.label, hint: v.hint }));
  }, [realVariants]);

  useEffect(() => {
    let cancelled = false;
    fetch(imagesListUrl(workspaceId, 'cf_images', 1, 1), { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (typeof d.total === 'number') setStored(d.total);
        if (d.accountHash) setAccountHash(String(d.accountHash));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, setAccountHash]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Copy failed', 'err');
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '16px 20px 24px' }}>
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--solar-cyan) 35%, var(--border-subtle))',
            background: 'color-mix(in srgb, var(--solar-cyan) 8%, var(--bg-panel))',
            fontSize: 12,
            color: 'var(--text-main)',
            marginBottom: 18,
          }}
        >
          Flexible variants are <strong>ON</strong> for this account path. Named variants below are
          account-level Cloudflare Images definitions; flexible URL options also work on delivery URLs.
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Variants</h2>
          <Link
            to="/dashboard/images/delivery/variant/create"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 8,
              background: 'var(--solar-cyan)',
              color: '#000',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <Plus size={13} />
            Create variant
          </Link>
        </div>

        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            overflow: 'hidden',
            background: 'var(--bg-panel)',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                <th style={th}>Name</th>
                <th style={th}>Size</th>
                <th style={th}>Example path</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const example = accountHash
                  ? `https://imagedelivery.net/${accountHash}/{id}/${v.id}`
                  : `…/imagedelivery.net/{hash}/{id}/${v.id}`;
                return (
                  <tr key={v.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={td}>
                      <span style={{ color: 'var(--solar-cyan)', fontWeight: 500 }}>{v.label}</span>
                    </td>
                    <td style={td}>{v.hint}</td>
                    <td style={{ ...td, maxWidth: 280 }}>
                      <code
                        style={{
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={example}
                      >
                        {example}
                      </code>
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        aria-label={`Copy ${v.id} path`}
                        onClick={() => void copy(example)}
                        style={{
                          display: 'flex',
                          padding: 4,
                          borderRadius: 5,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        <Copy size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 28 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>Responsive flexible URLs</h2>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            CF recommended max widths when you cannot use srcset: desktop 1920, tablet 960, mobile 640.
            Copy flexible options (fit=scale-down + width + optional dpr=2 for retina).
          </p>
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              overflow: 'hidden',
              background: 'var(--bg-panel)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                  <th style={th}>Preset</th>
                  <th style={th}>Options segment</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Desktop max', opts: 'fit=scale-down,width=1920' },
                  { label: 'Tablet max', opts: 'fit=scale-down,width=960' },
                  { label: 'Mobile max', opts: 'fit=scale-down,width=640' },
                  { label: 'Retina thumb', opts: 'width=200,height=200,fit=cover,dpr=2' },
                ].map((row) => {
                  const example = accountHash
                    ? `https://imagedelivery.net/${accountHash}/{id}/${row.opts}`
                    : `…/{id}/${row.opts}`;
                  return (
                    <tr key={row.label} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={td}>{row.label}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                        {row.opts}
                      </td>
                      <td style={td}>
                        <button
                          type="button"
                          aria-label={`Copy ${row.label}`}
                          onClick={() => void copy(example)}
                          style={{
                            display: 'flex',
                            padding: 4,
                            borderRadius: 5,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-elevated)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          <Copy size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        style={{
          borderLeft: '1px solid var(--border-subtle)',
          padding: '16px 14px',
          overflowY: 'auto',
          background: 'var(--bg-panel)',
        }}
      >
        <ImagesUsageAccountSidebar
          workspaceId={workspaceId}
          imagesStored={stored}
          imagesTransformed={transformed}
          accountHash={accountHash}
          onCopy={(msg) => toast(msg)}
        />
      </div>
      <ImagesToastStack toasts={toasts} />
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  fontSize: 11,
};

const td: React.CSSProperties = {
  padding: '10px 14px',
  color: 'var(--text-main)',
  verticalAlign: 'middle',
};

export default ImagesDeliveryPage;
