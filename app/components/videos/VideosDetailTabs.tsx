import React, { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ImageTagPicker, type ResourceTagGroup } from '../images/ImageTagPicker';
import { imagesResourceTagsCatalogUrl } from '../images/imagesApi';
import type { VideosDetailOutletContext } from './VideosDetailShell';
import { StreamPlayerEmbed } from './StreamPlayerEmbed';
import { patchStreamVideo, streamJsonGet, streamJsonMutate } from './videosApi';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 6,
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-app)',
  color: 'var(--text-main)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-main)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  maxWidth: 640,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export function VideosSettingsTab() {
  const { uid, video, reload, toast } = useOutletContext<VideosDetailOutletContext>();
  const [name, setName] = useState(video.name || '');
  const [signed, setSigned] = useState(!!video.require_signed_urls);
  const [origins, setOrigins] = useState((video.allowed_origins || []).join('\n'));
  const [thumbPct, setThumbPct] = useState(
    video.thumbnail_timestamp_pct != null ? String(video.thumbnail_timestamp_pct) : '',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(video.name || '');
    setSigned(!!video.require_signed_urls);
    setOrigins((video.allowed_origins || []).join('\n'));
    setThumbPct(
      video.thumbnail_timestamp_pct != null ? String(video.thumbnail_timestamp_pct) : '',
    );
  }, [video]);

  const reset = () => {
    setName(video.name || '');
    setSigned(!!video.require_signed_urls);
    setOrigins((video.allowed_origins || []).join('\n'));
    setThumbPct(
      video.thumbnail_timestamp_pct != null ? String(video.thumbnail_timestamp_pct) : '',
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const allowed = origins
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await patchStreamVideo(uid, {
        name: name.trim(),
        require_signed_urls: signed,
        allowed_origins: allowed,
        thumbnail_timestamp_pct: thumbPct.trim() === '' ? undefined : Number(thumbPct),
      });
      if (!res.ok) {
        toast(res.error || 'Save failed', 'err');
        return;
      }
      toast('Settings saved');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={panelStyle}>
      <Field label="Require signed URLs">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
          Enabled
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
          When enabled, unsigned iframe/watch URLs will not play (expected CF behavior).
        </div>
      </Field>
      <Field label="Allowed origins (one per line or comma-separated)">
        <textarea
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          rows={4}
          style={{ ...inputStyle, maxWidth: 560 }}
        />
      </Field>
      <Field label="Video name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Thumbnail timestamp %">
        <input
          value={thumbPct}
          onChange={(e) => setThumbPct(e.target.value)}
          placeholder="0–1"
          style={inputStyle}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', maxWidth: 480 }}>
        <button type="button" disabled={busy} onClick={reset} style={btnStyle}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          style={{ ...btnStyle, background: 'var(--solar-cyan)', color: '#000', border: 'none' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function VideosDownloadsTab() {
  const { uid, toast } = useOutletContext<VideosDetailOutletContext>();
  const [data, setData] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    const res = await streamJsonGet(uid, 'downloads');
    if (!res.ok) setError(res.data?.error || `HTTP ${res.status}`);
    setData(res.data?.downloads ?? res.data);
    setBusy(false);
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const enable = async () => {
    setBusy(true);
    const res = await streamJsonMutate(uid, 'downloads', 'POST');
    if (!res.ok) toast(res.data?.error || 'Enable failed', 'err');
    else {
      toast('Downloads enabled');
      await load();
    }
    setBusy(false);
  };

  const disable = async () => {
    if (!confirm('Disable downloads for this video?')) return;
    setBusy(true);
    const res = await streamJsonMutate(uid, 'downloads', 'DELETE');
    if (!res.ok) toast(res.data?.error || 'Disable failed', 'err');
    else {
      toast('Downloads disabled');
      await load();
    }
    setBusy(false);
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void enable()} style={btnStyle}>
          Enable MP4 download
        </button>
        <button type="button" disabled={busy} onClick={() => void disable()} style={btnStyle}>
          Disable downloads
        </button>
        <button type="button" disabled={busy} onClick={() => void load()} style={btnStyle}>
          Refresh
        </button>
      </div>
      {error ? <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div> : null}
      <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

export function VideosCaptionsTab() {
  const { uid, toast } = useOutletContext<VideosDetailOutletContext>();
  const [captions, setCaptions] = useState<unknown>(null);
  const [language, setLanguage] = useState('en');
  const [vtt, setVtt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    const res = await streamJsonGet(uid, 'captions');
    if (!res.ok) setError(res.data?.error || `HTTP ${res.status}`);
    setCaptions(res.data?.captions ?? res.data);
    setBusy(false);
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (!language.trim() || !vtt.trim()) {
      toast('language and VTT required', 'err');
      return;
    }
    setBusy(true);
    const res = await streamJsonMutate(uid, 'captions', 'POST', {
      language: language.trim(),
      vtt,
    });
    if (!res.ok) toast(res.data?.error || 'Caption upload failed', 'err');
    else {
      toast('Caption saved');
      setVtt('');
      await load();
    }
    setBusy(false);
  };

  const remove = async (lang: string) => {
    if (!confirm(`Delete caption "${lang}"?`)) return;
    setBusy(true);
    const res = await streamJsonMutate(uid, `captions/${encodeURIComponent(lang)}`, 'DELETE');
    if (!res.ok) toast(res.data?.error || 'Delete failed', 'err');
    else {
      toast('Caption deleted');
      await load();
    }
    setBusy(false);
  };

  const list = Array.isArray(captions) ? captions : [];

  return (
    <div style={panelStyle}>
      {error ? <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div> : null}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Existing captions</div>
      {list.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {list.map((c: { language?: string; label?: string }, i: number) => {
            const lang = String(c.language || c.label || i);
            return (
              <li key={lang} style={{ marginBottom: 6 }}>
                {lang}{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(lang)}
                  style={{ ...btnStyle, padding: '2px 8px', fontSize: 11 }}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No captions yet.</div>
      )}
      <Field label="Language code">
        <input value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="VTT content">
        <textarea
          value={vtt}
          onChange={(e) => setVtt(e.target.value)}
          rows={8}
          style={{ ...inputStyle, maxWidth: 640, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
        />
      </Field>
      <button type="button" disabled={busy} onClick={() => void upload()} style={btnStyle}>
        Upload caption
      </button>
    </div>
  );
}

export function VideosEmbedTab() {
  const { uid, video, toast, reload } = useOutletContext<VideosDetailOutletContext>();
  const [snippet, setSnippet] = useState('');
  const [iframeUrl, setIframeUrl] = useState(video.iframe_url || '');
  const [controls, setControls] = useState(true);
  const [autoplay, setAutoplay] = useState(false);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await streamJsonGet(uid, 'embed');
    if (!res.ok) {
      toast(res.data?.error || 'Embed load failed', 'err');
      return;
    }
    const emb = res.data?.embed || {};
    setSnippet(String(res.data?.iframe_snippet || ''));
    setIframeUrl(String(res.data?.iframe_url || video.iframe_url || ''));
    setControls(emb.controls !== false);
    setAutoplay(!!emb.autoplay);
    setLoop(!!emb.loop);
    setMuted(!!emb.muted);
  }, [uid, toast, video.iframe_url]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    const res = await streamJsonMutate(uid, 'embed', 'PATCH', {
      controls,
      autoplay,
      loop,
      muted,
    });
    if (!res.ok) toast(res.data?.error || 'Save failed', 'err');
    else {
      toast('Embed saved');
      await load();
      await reload();
    }
    setBusy(false);
  };

  return (
    <div style={panelStyle}>
      <div
        style={{
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
          background: '#000',
          maxWidth: 560,
        }}
      >
        <StreamPlayerEmbed
          src={uid}
          customerSubdomain={video.customer_subdomain}
          requireSignedUrls={!!video.require_signed_urls}
          controls={controls}
          autoplay={autoplay}
          loop={loop}
          muted={muted}
          poster={video.thumbnail || undefined}
          title={video.name || uid}
        />
      </div>
      <Field label="Iframe URL">
        <input value={iframeUrl} readOnly style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
        {(
          [
            ['Controls', controls, setControls],
            ['Autoplay', autoplay, setAutoplay],
            ['Loop', loop, setLoop],
            ['Muted', muted, setMuted],
          ] as const
        ).map(([label, val, set]) => (
          <label key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => void save()} style={btnStyle}>
        Save embed
      </button>
      <Field label="Iframe snippet">
        <textarea
          value={snippet}
          readOnly
          rows={5}
          style={{ ...inputStyle, maxWidth: 720, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
        />
      </Field>
      <button
        type="button"
        style={btnStyle}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(snippet || iframeUrl);
            toast('Copied');
          } catch {
            toast('Copy failed', 'err');
          }
        }}
      >
        Copy snippet
      </button>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
        Preview uses <code>@cloudflare/stream-react</code> with your customer code. Snippet below
        remains the classic iframe embed for sites that are not React.
      </p>
    </div>
  );
}

export function VideosJsonTab() {
  const { uid, toast } = useOutletContext<VideosDetailOutletContext>();
  const [curl, setCurl] = useState('');
  const [body, setBody] = useState<unknown>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await streamJsonGet(uid, 'json');
      if (cancelled) return;
      if (!res.ok) {
        setError(res.data?.error || `HTTP ${res.status}`);
        return;
      }
      setCurl(String(res.data?.curl || ''));
      setBody(res.data?.response ?? res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return (
    <div style={{ ...panelStyle, maxWidth: 900 }}>
      {error ? <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div> : null}
      <Field label="curl example">
        <textarea
          value={curl}
          readOnly
          rows={3}
          style={{ ...inputStyle, maxWidth: 900, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
        />
      </Field>
      <button
        type="button"
        style={btnStyle}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(curl);
            toast('curl copied');
          } catch {
            toast('Copy failed', 'err');
          }
        }}
      >
        Copy curl
      </button>
      <Field label="Live API response">
        <pre style={{ ...preStyle, maxWidth: 900 }}>{JSON.stringify(body, null, 2)}</pre>
      </Field>
    </div>
  );
}

export function VideosPublicDetailsTab() {
  const { uid, video, toast, reload } = useOutletContext<VideosDetailOutletContext>();
  const pd = (video.public_details || {}) as Record<string, unknown>;
  const [title, setTitle] = useState(String(pd.title || ''));
  const [logo, setLogo] = useState(String(pd.logo || ''));
  const [channel, setChannel] = useState(String(pd.channel_link || ''));
  const [share, setShare] = useState(pd.share !== false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = (video.public_details || {}) as Record<string, unknown>;
    setTitle(String(next.title || ''));
    setLogo(String(next.logo || ''));
    setChannel(String(next.channel_link || ''));
    setShare(next.share !== false);
  }, [video]);

  const save = async () => {
    setBusy(true);
    const res = await streamJsonMutate(uid, 'public-details', 'PATCH', {
      title,
      logo,
      channel_link: channel,
      share,
    });
    if (!res.ok) toast(res.data?.error || 'Save failed', 'err');
    else {
      toast('Public details saved');
      await reload();
    }
    setBusy(false);
  };

  return (
    <div style={panelStyle}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
        Watch-page branding fields. Unlike Tags, these are <strong>not</strong> Cloudflare Resource
        Tagging — Stream has no dedicated public-details REST API, so values persist in{' '}
        <code>meta.iam_public_details</code>.
      </p>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Logo URL">
        <input value={logo} onChange={(e) => setLogo(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Channel link">
        <input value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle} />
      </Field>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Allow sharing
      </label>
      <button type="button" disabled={busy} onClick={() => void save()} style={btnStyle}>
        Save public details
      </button>
    </div>
  );
}

export function VideosTagsTab() {
  const { uid, video, toast, reload } = useOutletContext<VideosDetailOutletContext>();
  const [resourceTags, setResourceTags] = useState<Record<string, string>>(
    video.resource_tags || {},
  );
  const [groups, setGroups] = useState<ResourceTagGroup[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResourceTags(video.resource_tags || {});
  }, [video]);

  useEffect(() => {
    let cancelled = false;
    fetch(imagesResourceTagsCatalogUrl(), { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.groups) return;
        const next: ResourceTagGroup[] = Object.entries(d.groups as Record<string, string[]>).map(
          ([key, values]) => ({ key, values: Array.isArray(values) ? values : [] }),
        );
        setGroups(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: Record<string, string>) => {
    setResourceTags(next);
    setBusy(true);
    const res = await streamJsonMutate(uid, 'tags', 'PATCH', { resource_tags: next });
    if (!res.ok) toast(res.data?.error || 'Save failed', 'err');
    else {
      toast('Tags saved to Cloudflare Resource Tagging');
      await reload();
    }
    setBusy(false);
  };

  return (
    <div style={panelStyle}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
        Cloudflare Resource Tagging (<code>resource_type=stream_video</code>) — same account-level
        tag system as Hosted Images (<code>resource_type=image</code>).
      </p>
      {video.resource_tags_error ? (
        <div style={{ color: '#f87171', fontSize: 12 }}>{video.resource_tags_error}</div>
      ) : null}
      <ImageTagPicker
        resourceTags={resourceTags}
        groups={groups}
        onChange={(next) => {
          if (busy) return;
          void save(next);
        }}
      />
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  fontSize: 11,
  overflow: 'auto',
  maxHeight: 420,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
