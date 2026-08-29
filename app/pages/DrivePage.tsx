import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Cloud,
  Download,
  FileText,
  Folder,
  Grid2X2,
  HardDrive,
  Home,
  Image as ImageIcon,
  Info,
  LayoutList,
  Link2,
  Loader2,
  MoreVertical,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { ActiveFile } from '../types';
import './drive/drive-page.css';

type DriveViewMode = 'grid' | 'list';
type DriveNavKey = 'home' | 'activity' | 'projects' | 'workspaces' | 'my-drive' | 'shared' | 'computers' | 'recent' | 'starred' | 'trash' | 'storage';
type DriveFolderFrame = { id: string; name: string };
type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TEXT_MIME_HINT = /^(text\/|application\/(json|javascript|xml)|image\/svg)/i;

function guessMimeFromFileName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    ts: 'text/typescript; charset=utf-8',
    tsx: 'text/typescript; charset=utf-8',
    jsx: 'text/javascript; charset=utf-8',
    svg: 'image/svg+xml',
    xml: 'application/xml; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function isFolder(file: Pick<DriveFile, 'mimeType'>) {
  return file.mimeType === FOLDER_MIME;
}

function isImageFile(file: Pick<DriveFile, 'mimeType' | 'name'>) {
  return (file.mimeType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '');
}

function isGoogleDoc(file: Pick<DriveFile, 'mimeType'>) {
  return String(file.mimeType || '').startsWith('application/vnd.google-apps.') && !isFolder(file);
}

function formatBytes(raw?: string | number | null) {
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatModified(raw?: string | null) {
  if (!raw) return 'Recently';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'Recently';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function sortDriveFiles(list: DriveFile[]) {
  return [...list].sort((a, b) => {
    const af = isFolder(a) ? 0 : 1;
    const bf = isFolder(b) ? 0 : 1;
    if (af !== bf) return af - bf;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function DriveLogo() {
  return (
    <div className="iam-drive-logo" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

function FileGlyph({ file }: { file: DriveFile }) {
  if (isFolder(file)) return <Folder size={20} className="iam-drive-folder-icon" />;
  if (isImageFile(file)) return <ImageIcon size={18} className="iam-drive-image-icon" />;
  if (isGoogleDoc(file)) return <FileText size={18} className="iam-drive-doc-icon" />;
  return <FileText size={18} className="iam-drive-file-icon" />;
}

export default function DrivePage({ onOpenInEditor }: { onOpenInEditor?: (file: ActiveFile) => void }) {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<DriveFile[] | null>(null);
  const [viewMode, setViewMode] = useState<DriveViewMode>('grid');
  const [activeNav, setActiveNav] = useState<DriveNavKey>('my-drive');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [folderStack, setFolderStack] = useState<DriveFolderFrame[]>([{ id: 'root', name: 'My Drive' }]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFolder = folderStack[folderStack.length - 1] || { id: 'root', name: 'My Drive' };
  const currentFolderId = currentFolder.id || 'root';
  const listSource = searchHits !== null ? searchHits : files;
  const folders = listSource.filter(isFolder);
  const documents = listSource.filter((file) => !isFolder(file));
  const selected = listSource.find((file) => file.id === selectedId) || listSource[0] || null;

  const filteredSource = useMemo(() => {
    const local = query.trim().toLowerCase();
    if (searchHits !== null || local.length < 1) return listSource;
    return listSource.filter((file) => String(file.name || '').toLowerCase().includes(local));
  }, [listSource, query, searchHits]);

  const visibleFolders = filteredSource.filter(isFolder);
  const visibleDocs = filteredSource.filter((file) => !isFolder(file));

  const setMessage = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const handleConnect = () => {
    window.open('/api/oauth/google/start?connectDrive=1&return_to=/dashboard/drive', 'google_oauth', 'width=600,height=700,scrollbars=yes');
  };

  const fetchIntegrationStatus = useCallback(async () => {
    try {
      const st = await fetch('/api/integrations/status', { credentials: 'same-origin' });
      const status = st.ok ? await st.json().catch(() => ({})) : {};
      const ready = !(st.ok && status && status.google === false);
      setIsAuthenticated(ready);
      return ready;
    } catch {
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  const fetchDriveFiles = useCallback(async (folderId = currentFolderId) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/gdrive/files?folderId=${encodeURIComponent(folderId)}`, { credentials: 'same-origin' });
      if (res.status === 401 || res.status === 400) {
        setIsAuthenticated(false);
        setFiles([]);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const next = sortDriveFiles(Array.isArray(data.files) ? data.files : []);
      setFiles(next);
      setSearchHits(null);
      setIsAuthenticated(true);
      setSelectedId((prev) => (prev && next.some((file) => file.id === prev) ? prev : next[0]?.id ?? null));
    } catch (err) {
      setFiles([]);
      setMessage(err instanceof Error ? `Drive load failed: ${err.message}` : 'Drive load failed');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, setMessage]);

  const bootstrap = useCallback(async () => {
    const ready = await fetchIntegrationStatus();
    if (ready) await fetchDriveFiles(currentFolderId);
  }, [currentFolderId, fetchDriveFiles, fetchIntegrationStatus]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'oauth_success' && e.data?.provider === 'google') void bootstrap();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [bootstrap]);

  const runSearch = async () => {
    const raw = query.trim();
    if (raw.length < 2) {
      setMessage('Type at least 2 characters to search Drive.');
      return;
    }
    const escaped = raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const driveQ = `name contains '${escaped}' and trashed=false`;
    setSearchBusy(true);
    try {
      const res = await fetch(`/api/drive/search?q=${encodeURIComponent(driveQ)}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Search failed');
      const hits = sortDriveFiles(Array.isArray(data.files) ? data.files : []);
      setSearchHits(hits);
      setSelectedId(hits[0]?.id ?? null);
      setMessage(`Found ${hits.length} Drive item${hits.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setSearchHits([]);
      setMessage(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchBusy(false);
    }
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setNewOpen(false);
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let j = 0; j < bytes.length; j += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(j, j + chunk) as unknown as number[]);
      }
      const body: Record<string, string> = {
        name: file.name,
        mimeType: file.type && file.type.trim() ? file.type : guessMimeFromFileName(file.name),
        base64: btoa(binary),
      };
      if (currentFolderId && currentFolderId !== 'root') body.folderId = currentFolderId;
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === 'string' ? data.error : `Upload failed: ${file.name}`);
        break;
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setMessage('Upload complete');
    void fetchDriveFiles(currentFolderId);
  };

  const createFolder = async () => {
    const name = window.prompt('New folder name');
    if (!name?.trim()) return;
    setNewOpen(false);
    const res = await fetch('/api/drive/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: name.trim(), parentId: currentFolderId === 'root' ? 'root' : currentFolderId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(typeof data.error === 'string' ? data.error : 'Create folder failed');
      return;
    }
    setMessage('Folder created');
    void fetchDriveFiles(currentFolderId);
  };

  const deleteDriveItem = async (file: DriveFile) => {
    if (!window.confirm(`Move to trash: ${file.name}?`)) return;
    const res = await fetch('/api/drive/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fileId: file.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(typeof data.error === 'string' ? data.error : 'Delete failed');
      return;
    }
    setMessage('Moved to trash');
    void fetchDriveFiles(currentFolderId);
  };

  const openFolder = (file: DriveFile) => {
    setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
    setSearchHits(null);
    setQuery('');
  };

  const openDriveFile = async (file: DriveFile) => {
    if (isFolder(file)) {
      openFolder(file);
      return;
    }
    const mime = file.mimeType || '';
    if (onOpenInEditor && isImageFile(file)) {
      onOpenInEditor({ name: file.name, content: '', originalContent: '', driveFileId: file.id, isImage: true, previewUrl: `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}` });
      return;
    }
    const isText = TEXT_MIME_HINT.test(mime) || mime === '' || mime.startsWith('text/');
    if (onOpenInEditor && isText) {
      try {
        const res = await fetch(`/api/integrations/gdrive/file?fileId=${encodeURIComponent(file.id)}`, { credentials: 'same-origin' });
        const data = await res.json();
        if (res.ok && typeof data.content === 'string') {
          onOpenInEditor({ name: file.name, content: data.content, originalContent: data.content, driveFileId: file.id });
          return;
        }
      } catch {
        /* open raw below */
      }
    }
    window.open(`/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}`, '_blank', 'noopener,noreferrer');
  };

  const navItems: Array<{ id: DriveNavKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'projects', label: 'Projects', icon: Folder },
    { id: 'workspaces', label: 'Workspaces', icon: Users },
    { id: 'my-drive', label: 'My Drive', icon: HardDrive },
    { id: 'shared', label: 'Shared drives', icon: Share2 },
    { id: 'computers', label: 'Computers', icon: Cloud },
    { id: 'recent', label: 'Recent', icon: Clock3 },
    { id: 'starred', label: 'Starred', icon: Star },
    { id: 'trash', label: 'Trash', icon: Trash2 },
    { id: 'storage', label: 'Storage', icon: HardDrive },
  ];

  if (!isAuthenticated) {
    return (
      <div className="iam-drive-connect">
        <DriveLogo />
        <h1>Connect Google Drive</h1>
        <p>Authorize Drive to browse folders, upload, create folders, open supported files, and use your connected file workspace.</p>
        <button type="button" onClick={handleConnect}><Link2 size={16} /> Connect Drive</button>
      </div>
    );
  }

  return (
    <div className="iam-drive-page">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
      <aside className="iam-drive-sidebar">
        <div className="iam-drive-brand"><DriveLogo /><span>Drive</span></div>
        <div className="iam-drive-new-wrap">
          <button className="iam-drive-new-btn" type="button" onClick={() => setNewOpen((v) => !v)}><Plus size={19} /> New <ChevronDown size={14} /></button>
          {newOpen ? (
            <div className="iam-drive-new-menu">
              <button type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> File upload</button>
              <button type="button" onClick={() => void createFolder()}><Folder size={15} /> New folder</button>
            </div>
          ) : null}
        </div>
        <nav className="iam-drive-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return <button key={item.id} type="button" className={active ? 'active' : ''} onClick={() => setActiveNav(item.id)}><Icon size={16} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="iam-drive-storage"><Settings size={15} /><span>Admin console</span><div><span style={{ width: '58%' }} /></div><small>126.85 GB of shared 2 TB used</small></div>
      </aside>

      <main className="iam-drive-main">
        <header className="iam-drive-topbar">
          <div className="iam-drive-search">
            <Search size={18} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void runSearch()} placeholder="Get answers from Drive" />
            <button type="button" disabled={searchBusy} onClick={() => void runSearch()}>{searchBusy ? <Loader2 size={15} className="spin" /> : 'Search'}</button>
          </div>
          <div className="iam-drive-top-actions">
            <button type="button" onClick={() => void fetchDriveFiles(currentFolderId)}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
            <button type="button"><ShieldCheck size={16} /></button>
            <button type="button"><Info size={16} /></button>
            <button type="button"><Settings size={16} /></button>
          </div>
        </header>

        <section className="iam-drive-content">
          <div className="iam-drive-title-row">
            <button type="button" className="iam-drive-title">{searchHits !== null ? 'Search results' : currentFolder.name} <ChevronDown size={16} /></button>
            <div className="iam-drive-view-toggle">
              <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><LayoutList size={17} /></button>
              <button type="button" className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}><Grid2X2 size={17} /></button>
              <button type="button" className={detailsOpen ? 'active' : ''} onClick={() => setDetailsOpen((v) => !v)}><PanelRightOpen size={17} /></button>
            </div>
          </div>

          <div className="iam-drive-filter-row">
            <button>Type <ChevronDown size={13} /></button>
            <button>People <ChevronDown size={13} /></button>
            <button>Modified <ChevronDown size={13} /></button>
            <button>Source <ChevronDown size={13} /></button>
            {searchHits !== null ? <button onClick={() => { setSearchHits(null); setQuery(''); }}>Clear search <X size={13} /></button> : null}
          </div>

          {!bannerDismissed ? (
            <div className="iam-drive-banner">
              <ShieldCheck size={18} />
              <span><strong>Reduce business disruptions by implementing data sharing controls</strong><small>Eliminate operational disruption and control how sensitive files are shared.</small></span>
              <button type="button">Upgrade</button>
              <button type="button" className="icon" onClick={() => setBannerDismissed(true)}><X size={16} /></button>
            </div>
          ) : null}

          {folderStack.length > 1 && searchHits === null ? (
            <div className="iam-drive-breadcrumbs">
              {folderStack.map((frame, idx) => (
                <React.Fragment key={`${frame.id}-${idx}`}>
                  {idx > 0 ? <span>/</span> : null}
                  <button type="button" onClick={() => setFolderStack((prev) => prev.slice(0, idx + 1))}>{frame.name}</button>
                </React.Fragment>
              ))}
            </div>
          ) : null}

          <div className="iam-drive-list-head"><span>Name</span><button type="button"><ChevronDown size={16} /></button></div>

          {loading ? (
            <div className="iam-drive-loading"><Loader2 size={24} className="spin" /> Loading Drive…</div>
          ) : viewMode === 'grid' ? (
            <div className="iam-drive-grid-scroll">
              {visibleFolders.length ? <div className="iam-drive-folder-grid">{visibleFolders.map((file) => <DriveFolderCard key={file.id} file={file} selected={selectedId === file.id} onSelect={() => setSelectedId(file.id)} onOpen={() => openFolder(file)} />)}</div> : null}
              {visibleDocs.length ? <div className="iam-drive-card-grid">{visibleDocs.map((file) => <DriveFileCard key={file.id} file={file} selected={selectedId === file.id} onSelect={() => setSelectedId(file.id)} onOpen={() => void openDriveFile(file)} onDelete={() => void deleteDriveItem(file)} />)}</div> : null}
              {!filteredSource.length ? <EmptyDriveState /> : null}
            </div>
          ) : (
            <div className="iam-drive-table">
              {filteredSource.map((file) => <DriveTableRow key={file.id} file={file} selected={selectedId === file.id} onSelect={() => setSelectedId(file.id)} onOpen={() => void openDriveFile(file)} onDelete={() => void deleteDriveItem(file)} />)}
              {!filteredSource.length ? <EmptyDriveState /> : null}
            </div>
          )}
        </section>
      </main>

      {detailsOpen ? <DriveDetailsPanel file={selected} folders={folders.length} documents={documents.length} onClose={() => setDetailsOpen(false)} onOpen={() => selected && void openDriveFile(selected)} /> : null}
      {toast ? <div className="iam-drive-toast"><CheckCircle2 size={15} /> {toast}</div> : null}
    </div>
  );
}

function DriveFolderCard({ file, selected, onSelect, onOpen }: { file: DriveFile; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return <button type="button" className={`iam-drive-folder-card ${selected ? 'selected' : ''}`} onClick={onSelect} onDoubleClick={onOpen}><Folder size={18} /><span>{file.name}</span><MoreVertical size={16} /></button>;
}

function DriveFileCard({ file, selected, onSelect, onOpen, onDelete }: { file: DriveFile; selected: boolean; onSelect: () => void; onOpen: () => void; onDelete: () => void }) {
  const preview = file.thumbnailLink || (isImageFile(file) ? `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}` : null);
  return (
    <article className={`iam-drive-file-card ${selected ? 'selected' : ''}`} onClick={onSelect} onDoubleClick={onOpen}>
      <div className="iam-drive-file-card-head"><FileGlyph file={file} /><strong>{file.name}</strong><button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}><MoreVertical size={16} /></button></div>
      <div className="iam-drive-preview">{preview ? <img src={preview} alt="" /> : <FileGlyph file={file} />}</div>
    </article>
  );
}

function DriveTableRow({ file, selected, onSelect, onOpen, onDelete }: { file: DriveFile; selected: boolean; onSelect: () => void; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className={`iam-drive-table-row ${selected ? 'selected' : ''}`} onClick={onSelect} onDoubleClick={onOpen}>
      <span><FileGlyph file={file} /> {file.name}</span>
      <span>{formatModified(file.modifiedTime)}</span>
      <span>{formatBytes(file.size)}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={14} /></button>
    </div>
  );
}

function DriveDetailsPanel({ file, folders, documents, onClose, onOpen }: { file: DriveFile | null; folders: number; documents: number; onClose: () => void; onOpen: () => void }) {
  return (
    <aside className="iam-drive-details">
      <div className="iam-drive-details-head"><h2>Details</h2><button type="button" onClick={onClose}><X size={16} /></button></div>
      {file ? (
        <>
          <div className="iam-drive-details-preview"><FileGlyph file={file} /></div>
          <h3>{file.name}</h3>
          <button type="button" className="iam-drive-open-btn" onClick={onOpen}>{isFolder(file) ? 'Open folder' : 'Open file'}</button>
          <dl>
            <dt>Type</dt><dd>{isFolder(file) ? 'Folder' : file.mimeType || 'File'}</dd>
            <dt>Modified</dt><dd>{formatModified(file.modifiedTime)}</dd>
            <dt>Size</dt><dd>{formatBytes(file.size)}</dd>
            <dt>Owner</dt><dd>{file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || 'Me'}</dd>
          </dl>
        </>
      ) : <p>No item selected.</p>}
      <div className="iam-drive-summary"><span>{folders} folders</span><span>{documents} files</span></div>
    </aside>
  );
}

function EmptyDriveState() {
  return <div className="iam-drive-empty"><AlertCircle size={22} /><strong>No Drive items here</strong><span>Upload a file, create a folder, or clear your current search.</span></div>;
}
