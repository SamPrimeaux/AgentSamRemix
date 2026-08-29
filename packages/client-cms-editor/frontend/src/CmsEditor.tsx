"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCmsEditorBlock,
  createCmsEditorPage as createIamPage,
  createCmsEditorSection as createIamSection,
  getCmsEditorAssets as getAssets,
  getCmsEditorBootstrap as getBootstrap,
  getCmsEditorContacts as getContacts,
  getCmsEditorTemplates as getTemplates,
  applyCmsEditorTemplate as applyTemplateApi,
  publishCmsEditorPage as publishIamPage,
  renameCmsEditorSection as renameSection,
  reorderCmsEditorSections as reorderSections,
  saveCmsEditorSection as saveIamSection,
  saveCmsEditorBlock,
  saveCmsEditorPageMeta as savePageMeta,
  saveCmsEditorThemeVars as saveThemeVars,
  setCmsEditorBlockVisibility,
  setCmsEditorSectionVisibility as setSectionVisibility,
} from "../../backend/src/api/client";
import type {
  CmsEditorBlock as BlockData,
  CmsEditorPage as PageData,
  CmsEditorSection as Section,
  CmsEditorSite as Site,
} from "../../backend/src/types";
import { mapCmsEditorPage, mapCmsEditorSection } from "../../backend/src/model";
import {
  CMS_EDITOR_PREVIEW_TYPES,
  cmsEditorSelectionFromPreview,
  normalizeCmsEditorPreviewMessage,
  postCmsEditorPreviewMessage,
} from "../../backend/src/preview/bridge";

type RailMode = "pages" | "sections" | "blocks" | "templates" | "media" | "crm" | "settings";
type InspectorTab = "content" | "style" | "page" | "theme" | "crm";
type Viewport = "phone" | "tablet" | "desktop";
type Toast = { id: number; type: "success" | "warning" | "error" | "info"; message: string; action?: string };

const railItems: { id: RailMode; label: string; icon: string }[] = [
  { id: "pages", label: "Pages", icon: "file" }, { id: "sections", label: "Sections", icon: "layers" },
  { id: "blocks", label: "Blocks", icon: "puzzle" }, { id: "templates", label: "Templates", icon: "grid" },
  { id: "media", label: "Media", icon: "image" }, { id: "crm", label: "CRM", icon: "users" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const iconPaths: Record<string, React.ReactNode> = {
  file: <><path d="M6 2.75h7l5 5v13.5H6z"/><path d="M13 2.75v5h5M9 12h6M9 16h6"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  puzzle: <path d="M19 13h-2.1a2.9 2.9 0 1 0 0-2H15V6h-4V4.1a2.9 2.9 0 1 0-2 0V6H4v5h2.1a2.9 2.9 0 1 1 0 2H4v5h5v2a3 3 0 0 0 6 0v-2h4z"/>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 4 4 3-3 6 5"/></>,
  users: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M18 8a3 3 0 0 1 0 6M22 20v-2a4 4 0 0 0-3-3.87"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1H3v-4h.08A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.05 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.62.75 1 1.52 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>, down: <path d="m6 9 6 6 6-6"/>, more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12"/><circle cx="12" cy="12" r="2.5"/></>, eyeoff: <><path d="m3 3 18 18"/><path d="M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.1 2.8M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6 10 6a10 10 0 0 0 5.4-1.5"/></>,
  phone: <rect x="7" y="2" width="10" height="20" rx="2"/>, tablet: <rect x="5" y="2" width="14" height="20" rx="2"/>, desktop: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  undo: <><path d="m9 7-5 5 5 5"/><path d="M20 17a7 7 0 0 0-7-7H4"/></>, redo: <><path d="m15 7 5 5-5 5"/><path d="M4 17a7 7 0 0 1 7-7h9"/></>,
  external: <><path d="M14 3h7v7M21 3l-10 10"/><path d="M18 13v7H4V6h7"/></>, publish: <><path d="M12 16V3M7 8l5-5 5 5"/><path d="M5 14v7h14v-7"/></>,
  collapse: <><path d="M10 4 4 12l6 8M20 4l-6 8 6 8"/></>, close: <path d="m5 5 14 14M19 5 5 19"/>,
  check: <path d="m4 12 5 5L20 6"/>, warning: <><path d="M12 3 2 21h20z"/><path d="M12 9v5M12 18h.01"/></>, info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>, trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v6h16v-6"/></>, filter: <path d="M3 5h18l-7 8v6l-4 2v-8z"/>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/></>,
  code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></>, menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{iconPaths[name] || iconPaths.info}</svg>;
}

const initialSites: Site[] = [];


function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => { if (typeof window === "undefined") return initial; try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue] as const;
}

function Button({ children, icon, kind = "ghost", onClick, disabled, className = "", title }: any) {
  return <button className={`button ${kind} ${className}`} onClick={onClick} disabled={disabled} title={title}>{icon && <Icon name={icon} />}{children}</button>;
}

function Search({ value, onChange, placeholder = "Search" }: any) {
  return <div className="search"><Icon name="search" size={14}/><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/>{value && <button onClick={() => onChange("")} aria-label="Clear"><Icon name="close" size={12}/></button>}<kbd>⌘F</kbd></div>;
}

function EmptyState({ icon = "search", title, copy, action, onAction }: any) {
  return <div className="empty"><span><Icon name={icon} size={22}/></span><h4>{title}</h4><p>{copy}</p>{action && <Button kind="secondary" onClick={onAction}>{action}</Button>}</div>;
}

function Wireframe({ variant = 0 }: { variant?: number }) {
  return <svg className="wireframe" viewBox="0 0 220 120" aria-hidden><rect x="1" y="1" width="218" height="118" rx="7" fill="#ffffff" stroke="rgba(43,39,31,.14)"/><rect x="15" y="14" width="42" height="5" rx="2" fill="#c7c3b5"/><rect x="155" y="14" width="18" height="4" rx="2" fill="#DCD5C2"/><rect x="179" y="14" width="25" height="4" rx="2" fill="#1e6a6f"/>{variant % 3 === 0 ? <><rect x="15" y="42" width="86" height="8" rx="2" fill="#8a8a95"/><rect x="15" y="56" width="70" height="8" rx="2" fill="#8a8a95"/><rect x="15" y="73" width="75" height="4" rx="2" fill="#DCD5C2"/><rect x="15" y="83" width="44" height="11" rx="3" fill="#1e6a6f"/><rect x="124" y="36" width="80" height="63" rx="5" fill="#E8E2D2"/></> : variant % 3 === 1 ? <><rect x="55" y="40" width="110" height="8" rx="2" fill="#8a8a95"/><rect x="75" y="55" width="70" height="4" rx="2" fill="#DCD5C2"/><rect x="22" y="76" width="52" height="25" rx="4" fill="#E8E2D2"/><rect x="84" y="76" width="52" height="25" rx="4" fill="#E8E2D2"/><rect x="146" y="76" width="52" height="25" rx="4" fill="#E8E2D2"/></> : <><rect x="15" y="37" width="190" height="18" rx="4" fill="#E8E2D2"/><rect x="15" y="64" width="90" height="40" rx="4" fill="#E8E2D2"/><rect x="115" y="64" width="90" height="40" rx="4" fill="#E8E2D2"/></>}</svg>;
}

function Modal({ title, children, onClose, wide = false, focusKey = "open" }: any) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => {
    const el = ref.current?.querySelector("input,button,textarea") as HTMLElement | null;
    el?.focus();
  }, [focusKey]);
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div ref={ref} className={`modal ${wide ? "modal-wide" : ""}`}><header><div><span className="modal-kicker">Studio CMS</span><h2>{title}</h2></div><Button icon="close" onClick={onClose} title="Close"/></header>{children}</div></div>;
}

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return <div className="toast-stack">{toasts.slice(-3).map(t => <div className={`toast ${t.type}`} key={t.id}><span className="toast-icon"><Icon name={t.type === "success" ? "check" : t.type === "warning" ? "warning" : t.type === "error" ? "close" : "info"}/></span><span>{t.message}</span>{t.action && <button>{t.action}</button>}<button className="toast-x" onClick={() => dismiss(t.id)}><Icon name="close" size={12}/></button>{t.type !== "error" && <i/>}</div>)}</div>;
}

export type CmsEditorProps = {
  projectSlug?: string;
  initialPageId?: string | null;
  initialPanel?: "pages" | "sections" | "templates" | "imports" | "theme";
  workspaceId?: string;
  siteCatalog?: Array<{ slug: string; name?: string; domain?: string | null }>;
  onSiteChange?: (slug: string) => void;
};

function exportContactsCsv(contacts: any[]) {
  if (!contacts.length) return;
  const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["name","email","source","date"], ...contacts.map((contact) => [contact.name,contact.email,contact.source,contact.date])];
  const blob = new Blob([rows.map((row) => row.map(quote).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cms-contacts.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function CmsEditor({ projectSlug = "", initialPageId = null, initialPanel = "sections", siteCatalog = [], onSiteChange }: CmsEditorProps) {
  const [sites, setSites] = useState<Site[]>(initialSites);
  const [siteId, setSiteId] = useStored("cms-active-site", projectSlug);
  const site = sites.find((s) => s.id === siteId) || sites.find((s) => s.pages?.length) || sites[0] || null;
  const [pageId, setPageId] = useState(initialPageId || site?.pages?.[0]?.id || "");
  const page = site?.pages?.find((p) => p.id === pageId) || site?.pages?.[0] || null;
  const [selectedId, setSelectedId] = useState(page?.sections?.[1]?.id || page?.sections?.[0]?.id || "");
  const selected = page?.sections?.find((s) => s.id === selectedId) || page?.sections?.[0] || null;
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const selectedBlock = selected?.blocks?.find((block) => block.id === selectedBlockId) || null;
  const [rail, setRail] = useState<RailMode>(initialPanel === "theme" ? "sections" : initialPanel === "imports" ? "templates" : initialPanel);
  const [tab, setTab] = useState<InspectorTab>(initialPanel === "theme" ? "theme" : "content");
  const [sidebarCollapsed, setSidebarCollapsed] = useStored("cms-sidebar-collapsed", false);
  const [inspectorCollapsed, setInspectorCollapsed] = useStored("cms-inspector-collapsed", false);
  const [viewport, setViewport] = useStored<Viewport>("cms-viewport", "desktop");
  const [zoom, setZoom] = useState("Fit");
  const [responsive, setResponsive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [search, setSearch] = useState("");
  const [siteSwitcher, setSiteSwitcher] = useState(false);
  const [publishMenu, setPublishMenu] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [newPage, setNewPage] = useState({ type: "Interior", title: "", slug: "", parent: "None" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<Section[][]>([]);
  const [future, setFuture] = useState<Section[][]>([]);
  const [mediaView, setMediaView] = useState<"grid" | "list">("grid");
  const [mediaFilter, setMediaFilter] = useState("All");
  const [contactId, setContactId] = useState<number | null>(null);
  type TemplateCard = { id: string; name: string; type?: string; category?: string; hasHtml?: boolean };
const FALLBACK_TEMPLATE_CARDS: TemplateCard[] = [
  { id: "tpl_baseline_landing", name: "Landing page", type: "page", category: "Marketing", hasHtml: false },
  { id: "tpl_baseline_about", name: "About page", type: "page", category: "Marketing", hasHtml: false },
  { id: "tpl_baseline_services", name: "Services grid", type: "section", category: "Agency", hasHtml: false },
  { id: "tpl_baseline_contact", name: "Contact split", type: "section", category: "Agency", hasHtml: false },
  { id: "tpl_baseline_hero", name: "Editorial hero", type: "section", category: "Portfolio", hasHtml: false },
];
  const [templateCards, setTemplateCards] = useState<TemplateCard[]>([]);
  const [schemaCatalog, setSchemaCatalog] = useState<{
    protocol_version: number;
    sections: Array<{ key: string; type: string; version: number; label: string; fields?: Record<string, unknown>; allowedBlocks?: string[]; defaults?: Record<string, unknown> }>;
    blocks: Array<{ key: string; type: string; version: number; label: string; fields?: Record<string, unknown> }>;
  }>({ protocol_version: 1, sections: [], blocks: [] });
  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const [theme, setTheme] = useState<Record<string, string>>({ "--brand-primary": "#6358ff", "--brand-secondary": "#1c5e46", "--brand-accent": "#cfef5b", "--color-bg": "#f5f2ea", "--color-surface": "#ffffff", "--color-text": "#101014", "--color-text-muted": "#73737f", "--font-heading": "Inter", "--font-body": "Inter", "--font-mono": "JetBrains Mono", "--font-size-base": "16px", "--radius-md": "12px", "--radius-lg": "22px", "--space-6": "24px", "--section-padding-y": "92px", "--container-max-width": "1200px" });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const themeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSaveReadyRef = useRef(false);

  const toast = useCallback((message: string, type: Toast["type"] = "success", action?: string) => {
    const id = Date.now(); setToasts(v => [...v, { id, message, type, action }]);
    if (type !== "error") setTimeout(() => setToasts(v => v.filter(x => x.id !== id)), type === "warning" ? 5000 : 3000);
  }, []);
  const dismissToast = (id: number) => setToasts(v => v.filter(x => x.id !== id));

  useEffect(() => {
    setSiteId(projectSlug);
  }, [projectSlug, setSiteId]);

  useEffect(() => {
    if (!siteCatalog.length) return;
    setSites((current) => {
      const byId = new Map(current.map((entry) => [entry.id, entry]));
      return siteCatalog.map((entry) => {
        const existing = byId.get(entry.slug);
        const name = entry.name || entry.slug;
        if (existing) {
          return {
            ...existing,
            name: entry.name || existing.name,
            domain: entry.domain || existing.domain,
            initials: existing.initials || name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
          };
        }
        return {
          id: entry.slug,
          name,
          initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
          domain: entry.domain || "",
          edited: "Available",
          color: "#6358ff",
          pages: [],
        };
      });
    });
  }, [siteCatalog, projectSlug]);

  useEffect(() => {
    let cancelled = false;
    setBootstrapLoading(true);
    setBootstrapError(null);
    getBootstrap(projectSlug, initialPageId)
      .then(({ site: loadedSite, themeVars, templates, homePageId, schemas }) => {
        if (cancelled) return;
        setSites((current) => {
          const withoutCurrent = current.filter((entry) => entry.id !== loadedSite.id);
          return [loadedSite, ...withoutCurrent];
        });
        setSiteId(loadedSite.id);
        const targetPage = loadedSite.pages.find((entry) => entry.id === initialPageId)
          || loadedSite.pages.find((entry) => entry.id === homePageId)
          || loadedSite.pages[0];
        if (targetPage) {
          setPageId(targetPage.id);
          setSelectedId(targetPage.sections[0]?.id || "");
        }
        if (Object.keys(themeVars).length) setTheme((current) => ({ ...current, ...themeVars }));
        if (templates.length) {
          const mapped = templates.map((entry: any) => ({ id: String(entry.id || ""), name: String(entry.template_name || entry.iam_label || entry.slug || "Template"), type: String(entry.template_type || "page"), category: String(entry.category || "General"), hasHtml: Boolean(entry.source_html_r2_key || entry.source_html_r2_key) })).filter((entry: TemplateCard) => entry.id);
          setTemplateCards(mapped.length ? mapped : FALLBACK_TEMPLATE_CARDS);
        }
        if (schemas) {
          setSchemaCatalog({
            protocol_version: Number(schemas.protocol_version || 1),
            sections: Array.isArray(schemas.sections) ? schemas.sections : [],
            blocks: Array.isArray(schemas.blocks) ? schemas.blocks : [],
          });
        }
        setBootstrapLoading(false);
        if (initialPanel === "imports") setModal("add-section");
      })
      .catch((error) => {
        if (cancelled) return;
        setBootstrapError(error?.message || "Could not load this CMS site");
        setBootstrapLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectSlug, initialPageId, initialPanel, bootstrapNonce, setSiteId]);

  useEffect(() => {
    if (rail !== "media" || mediaItems.length) return;
    getAssets().then(setMediaItems).catch((error) => toast(error?.message || "Could not load assets", "error"));
  }, [rail, mediaItems.length, toast]);

  useEffect(() => {
    if (rail !== "templates" || templateCards.length) return;
    getTemplates().then((items) => setTemplateCards(items.length ? items : FALLBACK_TEMPLATE_CARDS)).catch(() => setTemplateCards(FALLBACK_TEMPLATE_CARDS));
  }, [rail, templateCards.length]);

  useEffect(() => {
    if ((rail !== "crm" && tab !== "crm") || contacts.length) return;
    getContacts().then(setContacts).catch((error) => toast(error?.message || "Could not load contacts", "error"));
  }, [rail, tab, contacts.length, toast]);

  useEffect(() => {
    if (!pageSaveReadyRef.current) {
      pageSaveReadyRef.current = true;
      return;
    }
    if (bootstrapLoading || !page?.id || String(page.id).startsWith("temp-") || modal === "page") return;
    if (pageSaveTimerRef.current) clearTimeout(pageSaveTimerRef.current);
    pageSaveTimerRef.current = setTimeout(() => {
      savePageMeta(page).catch((error) => toast(error?.message || "Page details could not be saved", "error"));
    }, 700);
    return () => { if (pageSaveTimerRef.current) clearTimeout(pageSaveTimerRef.current); };
  }, [page?.title, page?.slug, page?.type, page?.metaTitle, page?.metaDescription, page?.id, bootstrapLoading, modal, toast]);

  const updatePages = useCallback((fn: (pages: PageData[]) => PageData[]) => {
    setSites((all) => all.map((s) => (s.id === siteId ? { ...s, pages: fn(s.pages) } : s)));
  }, [siteId]);
  const mutateSections = (fn: (items: Section[]) => Section[]) => {
    if (!page) return;
    setHistory((h) => [...h.slice(-19), page.sections.map((s) => ({ ...s, fields: { ...s.fields } }))]);
    setFuture([]);
    updatePages((pages) => pages.map((p) => (p.id === page.id ? { ...p, sections: fn(p.sections) } : p)));
    setDirty(true);
  };
  const updateField = (key: string, value: any) => mutateSections(items => items.map(s => s.id === selected.id ? { ...s, fields: { ...s.fields, [key]: value } } : s));
  const updateCss = (key: string, value: any) => { mutateSections(items => items.map(s => s.id === selected.id ? { ...s, css: { ...(s.css || {}), [key]: value } } : s)); postCmsEditorPreviewMessage(iframeRef.current?.contentWindow, { type: CMS_EDITOR_PREVIEW_TYPES.STYLE, section_id: selected.id, css: { [key]: value } }); };
  const mutateBlocks = (fn: (items: BlockData[]) => BlockData[]) => {
    if (!selected) return;
    mutateSections((items) => items.map((section) => section.id === selected.id ? { ...section, blocks: fn(section.blocks || []) } : section));
  };
  const chooseBlock = (id: string) => { setSelectedBlockId(id); setRail("blocks"); setTab("content"); };
  const updateBlockField = (key: string, value: any) => mutateBlocks((items) => items.map((block) => block.id === selectedBlockId ? { ...block, data: { ...block.data, [key]: value } } : block));
  const addBlock = async () => {
    if (!selected?.id) return;
    setSaving(true);
    try {
      const block = await createCmsEditorBlock(selected.id, "text", { text: "New block" }, (selected.blocks?.length + 1) * 10);
      mutateBlocks((items) => [...items, block]);
      setSelectedBlockId(block.id);
      setRail("blocks");
      setDirty(false);
      toast("Block created");
    } catch (error: any) { toast(error?.message || "Block could not be created", "error"); }
    finally { setSaving(false); }
  };

  const save = useCallback(() => {
    if (!dirty) return;
    setSaving(true);
    const operation = tab === "theme"
      ? saveThemeVars(projectSlug, theme)
      : selectedBlock
        ? saveCmsEditorBlock(selectedBlock)
        : selected?.id
          ? Promise.all([saveIamSection(selected.id, selected.fields, selected.css), renameSection(selected.id, selected.name)])
          : Promise.reject(new Error("Select a section or block to save"));
    operation
      .then(() => { setDirty(false); toast(tab === "theme" ? "Theme saved" : selectedBlock ? "Block saved" : "Section saved"); })
      .catch((error) => toast(error?.message || "Save failed", "error"))
      .finally(() => setSaving(false));
  }, [dirty, selected, selectedBlock, tab, projectSlug, theme, toast]);
  const undo = useCallback(() => { if (!page) return; const prev = history.at(-1); if (!prev) return; setFuture(f => [page.sections, ...f]); setHistory(h => h.slice(0, -1)); updatePages(ps => ps.map(p => p.id === page.id ? { ...p, sections: prev } : p)); toast("Change undone", "info"); }, [history, page, updatePages, toast]);
  const redo = useCallback(() => { if (!page) return; const next = future[0]; if (!next) return; setHistory(h => [...h, page.sections]); setFuture(f => f.slice(1)); updatePages(ps => ps.map(p => p.id === page.id ? { ...p, sections: next } : p)); toast("Change restored", "info"); }, [future, page, updatePages, toast]);

  const chooseSection = (id: string) => { if (dirty && id !== selectedId && !window.confirm("You have unsaved changes. Discard and continue?")) return; setSelectedId(id); setSelectedBlockId(""); setDirty(false); setRail("sections"); setTab("content"); postCmsEditorPreviewMessage(iframeRef.current?.contentWindow, { type: CMS_EDITOR_PREVIEW_TYPES.HIGHLIGHT, section_id: id }); };
  const choosePage = (id: string) => { if (dirty && !window.confirm("You have unsaved changes. Discard and continue?")) return; const p = site.pages.find(x => x.id === id); if (!p) return; setPageId(id); setSelectedId(p.sections[0]?.id); setSelectedBlockId(""); setDirty(false); toast(`Opened ${p.title}`, "info"); };
  const chooseSite = (id: string) => { const s = sites.find(x => x.id === id); if (!s) return; setSiteSwitcher(false); if (onSiteChange) { onSiteChange(id); toast(`Opening ${s.name}`, "info"); return; } setSiteId(id); if (s.pages[0]) { setPageId(s.pages[0].id); setSelectedId(s.pages[0].sections[0]?.id || ""); setSelectedBlockId(""); } toast(`Switched to ${s.name}`, "info"); };

  useEffect(() => { const t = dirty ? setTimeout(() => { save(); toast("Auto-save started", "info"); }, 30000) : undefined; return () => t && clearTimeout(t); }, [dirty, selected?.fields, save, toast]);
  useEffect(() => { const before = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", before); return () => window.removeEventListener("beforeunload", before); }, [dirty]);
  useEffect(() => { const receive = (e: MessageEvent) => {
    const m = normalizeCmsEditorPreviewMessage(e.data);
    if (!m) return;
    const target = cmsEditorSelectionFromPreview(m, page?.id || null);
    if (target?.sectionId) chooseSection(target.sectionId);
    if (m.type === CMS_EDITOR_PREVIEW_TYPES.READY && selectedId) {
      postCmsEditorPreviewMessage(iframeRef.current?.contentWindow, { type: CMS_EDITOR_PREVIEW_TYPES.HIGHLIGHT, section_id: selectedId });
    }
  }; window.addEventListener("message", receive); return () => window.removeEventListener("message", receive); });
  useEffect(() => { const down = (e: KeyboardEvent) => {
    const cmd = e.metaKey || e.ctrlKey; if (cmd && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    if (cmd && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    if (cmd && e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); redo(); }
    if (cmd && e.key.toLowerCase() === "p" && !e.shiftKey) { e.preventDefault(); setPreview(v => !v); }
    if (cmd && e.key.toLowerCase() === "k") { e.preventDefault(); setModal("palette"); }
    if (cmd && e.key === "/") { e.preventDefault(); setModal("shortcuts"); }
    if (cmd && e.shiftKey && e.key === ".") { e.preventDefault(); setSidebarCollapsed(v => !v); }
    if (cmd && e.shiftKey && e.key === ",") { e.preventDefault(); setInspectorCollapsed(v => !v); }
    if (cmd && /^[1-7]$/.test(e.key)) { e.preventDefault(); setRail(railItems[Number(e.key)-1].id); }
    if (e.key === "Escape") { if (preview) setPreview(false); else if (modal) setModal(null); else { setSelectedId(""); postCmsEditorPreviewMessage(iframeRef.current?.contentWindow, { type: CMS_EDITOR_PREVIEW_TYPES.DESELECT }); } }
  }; window.addEventListener("keydown", down); return () => window.removeEventListener("keydown", down); }, [modal, preview, save, undo, redo, setSidebarCollapsed, setInspectorCollapsed]);

  const frameHtml = useMemo(() => {
    if (!page) return "<!doctype html><html><body></body></html>";
    const visible = page.sections.filter(s => s.visible);
    const content = visible.map((s, i) => {
      const f = s.fields; const isNav = s.type === "Navigation"; const isFooter = s.type === "Footer"; const img = f.hero_image_url;
      if (isNav) return `<section data-cms-id="${s.id}" class="nav"><b>${f.brand_name}</b><nav>${(f.nav_links || []).map((x:string) => `<span>${x}</span>`).join("")}</nav><button>${f.nav_cta_label}</button></section>`;
      if (String(s.type).toLowerCase() === "hero") {
        const imgUrl = typeof f.image === "string" ? f.image : (f.image && typeof f.image === "object" ? String((f.image as any).url || (f.image as any).src || "") : img || "");
        const cta = f.primaryCta && typeof f.primaryCta === "object" ? f.primaryCta as any : null;
        const ctaLabel = cta ? String(cta.label || cta.text || "") : String(f.hero_primary_cta || "");
        const heading = String(f.heading || f.hero_title || s.name || "Hero");
        const body = String(f.body || f.hero_body || "");
        const eyebrow = String(f.eyebrow || "");
        return `<section data-cms-id="${s.id}" class="hero" style="background-image:linear-gradient(90deg,rgba(7,7,10,.8),rgba(7,7,10,.15)),url('${imgUrl}')"><div><small>${eyebrow}</small><h1>${heading}</h1><p>${body}</p>${ctaLabel ? `<button>${ctaLabel}</button>` : ""}${f.hero_secondary_cta ? `<a>${f.hero_secondary_cta} →</a>` : ""}</div></section>`;
      }
      if (isFooter) return `<section data-cms-id="${s.id}" class="footer"><b>${f.brand_name || site?.name || "Site"}</b><p>${f.copyright_text || ""}</p><span>${(f.footer_links || []).join(" · ")}</span></section>`;
      return `<section data-cms-id="${s.id}" class="content s${i}" style="background:${s.color}"><small>${f.section_label || s.type}</small><h2>${f.title || f.heading || f.quote || s.name}</h2><p>${f.description || f.body || f.author_name || "Distinctive systems, thoughtfully made."}</p>${f.button_label ? `<button>${f.button_label}</button>` : ""}</section>`;
    }).join("");
    const vars = Object.entries(theme).map(([k,v]) => `${k}:${v}`).join(";");
    return `<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--font-body),Arial;background:#f5f2ea;color:#101014}section{position:relative;transition:.18s;cursor:default}.nav{height:68px;display:flex;align-items:center;padding:0 clamp(24px,6vw,84px);gap:30px;background:#0c0c10;color:white}.nav b{font-size:18px;margin-right:auto}.nav nav{display:flex;gap:22px;font-size:12px;color:#aaa}.nav button,.hero button,.content button{border:0;border-radius:999px;padding:11px 18px;background:var(--brand-primary);color:white}.hero{min-height:620px;background-size:cover;background-position:center;display:flex;align-items:end;padding:clamp(48px,9vw,120px);color:white}.hero>div{max-width:760px}.hero small,.content small{text-transform:uppercase;letter-spacing:.18em;font-size:11px;font-weight:700}.hero h1{font-size:clamp(44px,6.5vw,92px);line-height:.94;letter-spacing:-.055em;margin:20px 0}.hero p{font-size:18px;max-width:580px;line-height:1.6;color:#d8d8de}.hero a{margin-left:18px;font-size:13px}.content{min-height:390px;padding:clamp(60px,9vw,120px);display:flex;flex-direction:column;justify-content:center}.content h2{font-size:clamp(32px,5vw,66px);line-height:1;margin:20px 0;max-width:880px;letter-spacing:-.04em}.content p{max-width:660px;line-height:1.7}.s2,.s5{color:#0d0d10}.footer{min-height:250px;padding:70px;background:#09090b;color:white;display:grid;gap:30px;align-content:center}.cms-highlight{outline:3px solid #4d8dff!important;outline-offset:-3px}.cms-highlight:after{content:attr(data-cms-name);position:absolute;top:5px;left:5px;background:#3b82f6;color:#fff;padding:4px 7px;border-radius:4px;font:11px Arial;z-index:10}</style></head><body>${content}<script>window.parent.postMessage({type:'cms:ready'},'*');document.querySelectorAll('[data-cms-id]').forEach(el=>{el.dataset.cmsName='Section';el.addEventListener('click',e=>{e.stopPropagation();window.parent.postMessage({type:'cms:section-click',sectionId:el.dataset.cmsId},'*')})});addEventListener('message',e=>{const m=e.data;document.querySelectorAll('[data-cms-id]').forEach(x=>x.classList.remove('cms-highlight'));if(m.type==='cms:highlight'){const x=document.querySelector('[data-cms-id="'+m.sectionId+'"]');x&&x.classList.add('cms-highlight')}if(m.type==='cms:scroll-to'){document.querySelector('[data-cms-id="'+m.sectionId+'"]')?.scrollIntoView({behavior:'smooth'})}if(m.type==='cms:theme-vars'){Object.entries(m.vars||{}).forEach(([k,v])=>document.documentElement.style.setProperty(k,v))}if(m.type==='cms:style'){const x=document.querySelector('[data-cms-id="'+m.sectionId+'"]');if(x)Object.assign(x.style,(m.css&&typeof m.css==='object')?m.css:{})}});addEventListener('scroll',()=>window.parent.postMessage({type:'cms:scroll',scrollY:scrollY},'*'))</script></body></html>`;
  }, [page, theme]);

  const filteredPages = page && site ? site.pages.filter(p => p.title.toLowerCase().includes(search.toLowerCase())) : [];
  const filteredSections = page ? page.sections.filter(s => s.name.toLowerCase().includes(search.toLowerCase())) : [];
  const pageWordCount = page ? page.sections.reduce((total, section) => {
    const sectionText = Object.values(section.fields || {}).filter((value) => typeof value === "string").join(" ");
    const blockText = (section.blocks || []).flatMap((block) => Object.values(block.data || {}).filter((value) => typeof value === "string")).join(" ");
    const words = `${sectionText} ${blockText}`.trim().split(/\s+/).filter(Boolean).length;
    return total + words;
  }, 0) : 0;


  const createPage = () => {
    if (saving) return;
    const title = String(newPage.title || "").trim() || "Untitled Page";
    const slug = String(newPage.slug || "").trim() || title;
    setSaving(true);
    createIamPage(projectSlug, { title, slug, type: newPage.type })
      .then((created) => {
        updatePages((items) => [...items, created as PageData]);
        setPageId(created.id);
        setSelectedId("");
        setModal(null);
        setNewPage({ type: "Interior", title: "", slug: "", parent: "None" });
        toast("New page created");
      })
      .catch((error) => {
        const code = String(error?.message || error?.payload?.error || "");
        if (code === "route_exists" || code.includes("route_exists")) {
          toast("That slug is already in use — pick another", "error");
        } else if (code === "slug_required" || code.includes("slug_required")) {
          toast("Add a page title or slug before creating", "error");
        } else {
          toast(code || "Could not create page", "error");
        }
      })
      .finally(() => setSaving(false));
  };
  const addSection = (name: string) => {
    const key = String(name || "").trim();
    const schema = schemaCatalog.sections.find((row) =>
      row.type === key
      || row.type === key.toLowerCase()
      || row.label === key
      || String(row.key || "") === key
    );
    const sectionType = String(schema?.type || key).trim() || "custom";
    const sectionLabel = String(schema?.label || key).trim() || sectionType;
    const fields = schema?.defaults && typeof schema.defaults === "object"
      ? { ...(schema.defaults as Record<string, unknown>) }
      : { eyebrow: sectionLabel, title: `A new ${sectionLabel.toLowerCase()} section`, description: "Select this section to replace the content and shape its presentation." };
    const tempId = `temp-${Date.now()}`;
    const pending: Section = { id: tempId, name: sectionLabel, type: sectionType, zone: "BODY", visible: true, color: "#f1efe7", fields: fields as Section["fields"], blocks: [] };
    mutateSections((items) => [...items, pending]);
    setSelectedId(tempId);
    setModal(null);
    createIamSection(page.id, sectionType, fields as Record<string, any>, (page.sections.length + 1) * 10)
      .then((created) => {
        updatePages((pages) => pages.map((item) => item.id === page.id ? { ...item, sections: item.sections.map((section) => section.id === tempId ? created as Section : section) } : item));
        setSelectedId(created.id);
        setDirty(false);
        toast(`${sectionLabel} added`);
      })
      .catch((error) => {
        updatePages((pages) => pages.map((item) => item.id === page.id ? { ...item, sections: item.sections.filter((section) => section.id !== tempId) } : item));
        toast(error?.message || "Could not add section", "error");
      });
  };

  if (preview) return <div className="preview-mode"><iframe srcDoc={frameHtml}/><div className="preview-toolbar"><Button onClick={() => setPreview(false)}>Exit preview</Button><ViewportSwitcher viewport={viewport} setViewport={setViewport}/><Button icon="external" onClick={() => toast("Preview opened in a new tab", "info")}>Open</Button></div></div>;


  const applyTemplate = async (template: TemplateCard) => {
    if (!template?.id) {
      toast("Template id is missing", "error");
      return;
    }
    setSaving(true);
    try {
      // Client fallback cards are examples only until D1 catalog rows exist.
      if (String(template.id).startsWith("tpl_baseline_")) {
        const slugBase = String(template.name || "template").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "template";
        const created = await createIamPage(projectSlug, {
          title: template.name || "Untitled Page",
          slug: `/${slugBase}`,
          type: String(template.type || "").toLowerCase().includes("section") ? "Landing" : "Landing",
        });
        updatePages((items) => [...items, created as PageData]);
        setPageId(created.id);
        setSelectedId("");
        setModal(null);
        setRail("pages");
        toast(`Started "${template.name}" as a draft page (baseline example)`);
        return;
      }
      const result = await applyTemplateApi(template.id, { pageId: page?.id, projectSlug });
      if (result.mode === "page" && result.page?.id) {
        const created = mapCmsEditorPage(result.page);
        updatePages((items) => [...items, created as PageData]);
        setPageId(created.id);
        setSelectedId("");
        setModal(null);
        toast(`Created page from ${template.name}`);
        return;
      }
      if (result.mode === "section" && result.section) {
        const created = mapCmsEditorSection(result.section);
        if (!page?.id) { toast("Open or create a page before applying a section template", "error"); return; }
        updatePages((pages) => pages.map((item) => item.id === page.id ? { ...item, sections: [...item.sections, created as Section] } : item));
        setSelectedId(created.id);
        setRail("sections");
        setModal(null);
        toast(`Added ${created.name || template.name}`);
        return;
      }
      toast((result as any).error || "Template could not be applied", "error");
    } catch (error: any) {
      toast(error?.message || "Template could not be applied", "error");
    } finally {
      setSaving(false);
    }
  };


  if (bootstrapLoading) {
    return (
      <main className="cms-shell">
        <div className="canvas-stage" style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#F9F7F2", color: "#1a1a1a" }}>
          <div className="canvas-loading"><div className="skeleton-topbar"/><div className="skeleton-hero"/><div className="skeleton-block"/></div>
        </div>
      </main>
    );
  }

  if (bootstrapError || !site) {
    return (
      <main className="cms-shell">
        <div className="canvas-stage" style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#F9F7F2", color: "#1a1a1a" }}>
          <div className="canvas-error">
            <h3>Could not load site</h3>
            <p>{bootstrapError || "CMS site context is missing for this workspace."}</p>
            <Button kind="accent" onClick={() => setBootstrapNonce((value) => value + 1)}>Retry</Button>
          </div>
        </div>
      </main>
    );
  }

  if (!page) {
    return (
      <main className="cms-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="button ghost hub-exit"
              onClick={() => window.parent.postMessage({ type: "iam-studio-cms-navigate", path: "/dashboard/cms" }, window.location.origin)}
              title="Back to CMS overview"
            ><Icon name="collapse" size={14}/> Overview</button>
            <div className="site-trigger-wrap">
              <button className="site-trigger" onClick={() => setSiteSwitcher((v) => !v)}>
                <span className="site-avatar" style={{ background: site.color }}>{site.initials}</span>
                <span><b>{site.name}</b><small>{site.domain}</small></span>
                <Icon name="down" size={13}/>
              </button>
            </div>
          </div>
          <div className="breadcrumb"><span>{site.name}</span><Icon name="chevron" size={11}/><b>No pages yet</b></div>
        </header>
        <div className="workspace">
          <nav className="rail">
            {railItems.map((item, i) => (
              <button key={item.id} className={rail === item.id ? "active" : ""} onClick={() => { setRail(item.id); setSidebarCollapsed(false); }} data-tip={`${item.label}  ⌘${i + 1}`}>
                <Icon name={item.icon}/>
              </button>
            ))}
          </nav>
          <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
            <div className="sidebar-scroll">
              {rail === "templates" ? (
                <TemplatesSidebar items={templateCards} schemas={schemaCatalog} preview={(tpl: TemplateCard) => setModal(`template:${tpl.id}`)} apply={applyTemplate} addSection={(type: string) => addSection(type)}/>
              ) : (
                <div className="sidebar-section">
                  <EmptyState icon="file" title="Create your first page" copy="This site has no CMS pages yet. Create a blank page or apply a template." action="New page" onAction={() => setModal("page")}/>
                  <Button kind="accent" className="wide-action" onClick={() => setRail("templates")}>Browse templates</Button>
                </div>
              )}
            </div>
          </aside>
          <section className="canvas-area">
            <div className="canvas-stage" style={{ display: "grid", placeItems: "center" }}>
              <div className="canvas-error">
                <h3>No pages on {site.name}</h3>
                <p>Start from a blank page or apply a baseline template. Examples beat an empty editor.</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                  <Button kind="accent" onClick={() => setModal("page")}>Create page</Button>
                  <Button onClick={() => setRail("templates")}>Browse templates</Button>
                </div>
              </div>
            </div>
          </section>
        </div>
        <ToastStack toasts={toasts} dismiss={dismissToast}/>
        {modal === "page" && <PageModal data={newPage} setData={setNewPage} close={() => setModal(null)} create={createPage} saving={saving}/>}
        {modal?.startsWith("template:") && (
          <TemplatePreview
            template={templateCards.find((entry) => entry.id === modal.slice(9)) || { id: modal.slice(9), name: modal.slice(9) }}
            close={() => setModal(null)}
            apply={applyTemplate}
          />
        )}
      </main>
    );
  }


  return <main className="cms-shell">
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="button ghost hub-exit"
          onClick={() => window.parent.postMessage({ type: "iam-studio-cms-navigate", path: "/dashboard/cms" }, window.location.origin)}
          title="Back to CMS overview"
        ><Icon name="collapse" size={14}/> Overview</button>
        <div className="site-trigger-wrap"><button className="site-trigger" onClick={() => setSiteSwitcher(v => !v)}><span className="site-avatar" style={{background:site.color}}>{site.initials}</span><span><b>{site.name}</b><small>{site.domain}</small></span><Icon name="down" size={13}/></button>{siteSwitcher && <SiteSwitcher sites={sites} active={site.id} choose={chooseSite} close={() => setSiteSwitcher(false)} newSite={() => { setSiteSwitcher(false); toast("Create sites from the CMS hub", "info"); }}/>}</div>
      </div>
      <div className="breadcrumb"><span>{site.name}</span><Icon name="chevron" size={11}/><b>{page.title}</b>{selected && <><Icon name="chevron" size={11}/><span>{selected.name}</span></>}</div>
      <ViewportSwitcher viewport={viewport} setViewport={setViewport}/>
      <div className="top-actions"><div className="collab"><small>CMS editor</small></div><Button icon="undo" onClick={undo} disabled={!history.length} title="Undo ⌘Z"/><Button icon="redo" onClick={redo} disabled={!future.length} title="Redo ⌘⇧Z"/><Button icon="external" onClick={() => setPreview(true)}>Preview</Button><div className="publish-wrap"><Button icon="publish" kind="accent" onClick={() => setPublishMenu(v => !v)}>Publish <Icon name="down" size={11}/></Button>{publishMenu && <PublishMenu action={(m:string) => { if (m === "Schedule") { setModal("schedule"); } else { setSaving(true); publishIamPage(page.id).then(() => toast("Page published")).catch((error) => toast(error?.message || "Publish failed", "error")).finally(() => setSaving(false)); } setPublishMenu(false); }}/>}</div><button className="user-avatar" onClick={() => toast("Account settings are available from the dashboard", "info")} aria-label="Account"><Icon name="settings" size={14}/></button></div>
      <div className="mobile-top"><Button icon="menu" onClick={() => setSidebarCollapsed(false)}/><b>{page.title}</b><Button kind="accent" onClick={() => setPublishMenu(true)}>Publish</Button></div>
    </header>

    <div className="workspace">
      <nav className="rail">{railItems.map((item, i) => <button key={item.id} className={rail === item.id ? "active" : ""} onClick={() => { setRail(item.id); setSidebarCollapsed(false); }} data-tip={`${item.label}  ⌘${i+1}`}><Icon name={item.icon}/></button>)}<button className="rail-collapse" onClick={() => setSidebarCollapsed(v => !v)} data-tip={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}><Icon name="collapse"/></button></nav>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}><SidebarHeader rail={rail} search={search} setSearch={setSearch} action={() => rail === "pages" ? setModal("page") : rail === "sections" ? setModal("add-section") : rail === "blocks" ? addBlock() : rail === "media" ? setModal("upload") : toast("No create action is available for this panel", "info")}/><div className="sidebar-scroll">
        {rail === "pages" && <PagesSidebar pages={filteredPages} active={page.id} choose={choosePage} create={() => setModal("page")} toast={toast}/>}
        {rail === "sections" && <SectionsSidebar sections={filteredSections} selected={selectedId} choose={chooseSection} mutate={mutateSections} add={() => setModal("add-section")} toast={toast} onReorder={(ordered:Section[]) => reorderSections(page.id, ordered).catch((error) => toast(error?.message || "Reorder failed", "error"))} onVisibility={(section:Section, visible:boolean) => setSectionVisibility(section.id, visible).catch((error) => toast(error?.message || "Visibility update failed", "error"))} onRename={(section:Section, name:string) => renameSection(section.id, name).catch((error) => toast(error?.message || "Rename failed", "error"))}/>}
        {rail === "blocks" && <BlocksSidebar section={selected} selected={selectedBlockId} choose={chooseBlock} add={addBlock} onVisibility={(block:BlockData, visible:boolean) => { mutateBlocks((items) => items.map((item) => item.id === block.id ? { ...item, visible } : item)); setCmsEditorBlockVisibility(block.id, visible).catch((error) => toast(error?.message || "Block visibility update failed", "error")); }}/>}
        {rail === "templates" && <TemplatesSidebar items={templateCards} schemas={schemaCatalog} preview={(tpl: TemplateCard) => { setModal(`template:${tpl.id}`); }} apply={applyTemplate} addSection={(type: string) => addSection(type)}/>}
        {rail === "media" && <MediaSidebar view={mediaView} setView={setMediaView} filter={mediaFilter} setFilter={setMediaFilter} items={mediaItems} upload={() => setModal("upload")} toast={toast}/>}
        {rail === "crm" && <CrmSidebar contacts={contacts} search={search} select={setContactId} exportCsv={() => exportContactsCsv(contacts)}/>}
        {rail === "settings" && <SettingsSidebar site={site} toast={toast}/>}
      </div></aside>

      <section className="canvas-area">
        <div className="canvas-ruler"><span>0</span><i/><span>{viewport === "phone" ? "375" : viewport === "tablet" ? "768" : "1440"} px</span><i/><span>{viewport === "phone" ? "375" : viewport === "tablet" ? "768" : "1440"}</span></div>
        <div className="canvas-stage">
          {bootstrapLoading && <div className="canvas-loading"><div className="skeleton-topbar"/><div className="skeleton-hero"/><div className="skeleton-block"/></div>}
          {bootstrapError && !bootstrapLoading && <div className="canvas-error"><h3>Could not load site</h3><p>{bootstrapError}</p><Button kind="accent" onClick={() => setBootstrapNonce((value) => value + 1)}>Retry</Button></div>}
          <div className="section-markers">{page.sections.map((s,i) => <button key={s.id} className={s.id===selectedId ? "active" : ""} onClick={() => { chooseSection(s.id); postCmsEditorPreviewMessage(iframeRef.current?.contentWindow, { type: CMS_EDITOR_PREVIEW_TYPES.SCROLL_TO, section_id: s.id }); }}><span>{i+1}</span><b>{s.name}</b></button>)}</div>
          {responsive ? <div className="responsive-three">{(["phone","tablet","desktop"] as Viewport[]).map(v => <div key={v}><label><Icon name={v}/> {v}</label><iframe srcDoc={frameHtml}/></div>)}</div> : <div className={`device-frame ${viewport}`} style={{transform:`scale(${zoom === "50%" ? .5 : zoom === "75%" ? .75 : 1})`}}><div className="loading-line"/><iframe ref={iframeRef} title={`${page.title} preview`} srcDoc={frameHtml}/></div>}
        </div>
        <footer className="canvas-footer"><div><button className={`toggle ${responsive ? "on" : ""}`} onClick={() => setResponsive(v => !v)}><span/></button><span>Responsive preview</span></div><div className="canvas-metrics"><span>{pageWordCount} words</span><span>{dirty ? "Unsaved changes" : "Saved state"}</span></div><div className="zoom"><button onClick={() => setZoom("50%")} className={zoom==="50%"?"active":""}>50</button><button onClick={() => setZoom("75%")} className={zoom==="75%"?"active":""}>75</button><button onClick={() => setZoom("100%")} className={zoom==="100%"?"active":""}>100</button><button onClick={() => setZoom("Fit")} className={zoom==="Fit"?"active":""}>Fit</button></div></footer>
        <button className="mobile-fab" onClick={() => setModal("add-section")}><Icon name="plus"/></button>
      </section>

      <aside className={`inspector ${inspectorCollapsed ? "collapsed" : ""}`}>
        <div className="inspector-tabs">{(["content","style","page","theme","crm"] as InspectorTab[]).map(t => <button key={t} className={tab===t?"active":""} onClick={() => setTab(t)}>{t}</button>)}</div>
        {selected && <div className="selected-head"><div><input value={selectedBlock ? selectedBlock.type : selected.name} onChange={e => selectedBlock ? undefined : mutateSections(items => items.map(s => s.id===selected.id?{...s,name:e.target.value}:s))} readOnly={!!selectedBlock}/><span>{selectedBlock ? `Block · ${selected.name}` : selected.type}</span></div><Button disabled={!dirty} onClick={() => { setDirty(false); toast("Local changes reverted", "info"); }}>Revert</Button><Button kind="accent" disabled={!dirty || saving} onClick={save}>{saving ? <span className="spinner"/> : "Save"}</Button></div>}
        <div className="inspector-scroll">{tab === "content" && selectedBlock ? <BlockInspector block={selectedBlock} update={updateBlockField} toast={toast}/> : tab === "content" && selected && <ContentInspector section={selected} schemas={schemaCatalog.sections} update={updateField} toast={toast}/>} {tab === "style" && selected && <StyleInspector section={selected} update={updateCss}/>} {tab === "page" && <PageInspector page={page} site={site} updatePages={updatePages} history={() => setModal("history")} toast={toast}/>} {tab === "theme" && <ThemeInspector vars={theme} update={(k:string,v:string) => { const next={...theme,[k]:v}; setTheme(next); postCmsEditorPreviewMessage(iframeRef.current?.contentWindow, { type: CMS_EDITOR_PREVIEW_TYPES.THEME_VARS, vars: next }); setDirty(true); if(themeSaveTimerRef.current)clearTimeout(themeSaveTimerRef.current); themeSaveTimerRef.current=setTimeout(()=>saveThemeVars(projectSlug,next).then(()=>{setDirty(false);toast("Theme saved","info")}).catch((error)=>toast(error?.message||"Theme save failed","error")),500); }} toast={toast}/>} {tab === "crm" && <InspectorCrm contacts={contacts} viewAll={() => setRail("crm")} select={setContactId}/>}</div>
      </aside>
    </div>

    <footer className="statusbar"><div><i/> Connected</div><span>{dirty ? "Unsaved changes" : saving ? "Saving…" : "Saved"}</span><span>{page.slug}</span><span>{page.sections.length} sections · {page.sections.reduce((total, section) => total + (section.blocks?.length || 0), 0)} blocks</span><button onClick={() => setModal("shortcuts")}>Shortcuts <kbd>⌘/</kbd></button></footer>
    <nav className="mobile-tabs">{railItems.slice(0,5).map(i => <button key={i.id} className={rail===i.id?"active":""} onClick={() => setRail(i.id)}><Icon name={i.icon}/><span>{i.label}</span></button>)}</nav>
    <ToastStack toasts={toasts} dismiss={dismissToast}/>

    {modal === "add-section" && (initialPanel === "imports" ? <ImportSectionModal close={() => setModal(null)} add={addSection}/> : <AddSectionModal close={() => setModal(null)} add={addSection} schemas={schemaCatalog.sections}/>)}
    {modal === "page" && <PageModal data={newPage} setData={setNewPage} close={() => setModal(null)} create={createPage} saving={saving}/>}
    {modal === "upload" && <UploadModal close={() => setModal(null)}/>}
    {modal === "schedule" && <ScheduleModal close={() => setModal(null)}/>}
    {modal === "shortcuts" && <ShortcutsModal close={() => setModal(null)}/>}
    {modal === "palette" && <CommandPalette close={() => setModal(null)} pages={site.pages} sections={page.sections} action={(type:string,id?:string) => { setModal(null); if(type==="page"&&id)choosePage(id); else if(type==="section"&&id)chooseSection(id); else if(type==="publish")setPublishMenu(true); else if(type==="add")setModal("add-section"); else if(type==="media")setRail("media"); }}/>}
    {modal === "history" && <HistoryModal close={() => setModal(null)} restore={() => { setModal(null); toast("Revision restored", "info"); }}/>}
    {modal?.startsWith("template:") && <TemplatePreview template={templateCards.find((entry) => entry.id === modal.slice(9)) || { id: modal.slice(9), name: modal.slice(9) }} close={() => setModal(null)} apply={applyTemplate}/>}
    {contactId !== null && <ContactDrawer contact={contacts[contactId]} close={() => setContactId(null)} toast={toast}/>}
  </main>;
}

function ViewportSwitcher({ viewport, setViewport }: any) { return <div className="viewport-switcher">{(["phone","tablet","desktop"] as Viewport[]).map(v => <button key={v} className={viewport===v?"active":""} onClick={() => setViewport(v)} title={`${v} viewport`}><Icon name={v}/></button>)}</div>; }

function SiteSwitcher({ sites, active, choose, close, newSite }: any) { const [q,setQ]=useState(""); return <div className="popover site-switcher"><div className="popover-title"><b>Switch site</b><Button icon="close" onClick={close}/></div><Search value={q} onChange={setQ} placeholder="Search client sites"/><div>{sites.filter((s:Site)=>s.name.toLowerCase().includes(q.toLowerCase())).map((s:Site)=><button className="site-option" key={s.id} onClick={()=>choose(s.id)}><span className="site-avatar" style={{background:s.color}}>{s.initials}</span><span><b>{s.name}</b><small>{s.domain} · {s.edited}</small></span>{s.id===active&&<Icon name="check"/>}</button>)}</div><Button icon="plus" kind="secondary" onClick={newSite}>New site</Button></div>; }
function PublishMenu({ action }: any) { const items=[{name:"Publish Page",copy:"Publish the current page through the canonical lifecycle",icon:"publish"},{name:"Schedule",copy:"Scheduling is not connected yet",icon:"settings"}]; return <div className="popover publish-menu">{items.map((item)=><button key={item.name} onClick={()=>action(item.name)}><span><Icon name={item.icon}/></span><div><b>{item.name}</b><small>{item.copy}</small></div></button>)}</div>; }
function SidebarHeader({ rail, search, setSearch, action }: any) { return <header className="sidebar-head"><div><span className="eyebrow">Workspace</span><h2>{rail[0].toUpperCase()+rail.slice(1)}</h2></div><Button icon="plus" kind="secondary" onClick={action} title={`Add ${rail}`}/><Search value={search} onChange={setSearch} placeholder={`Search ${rail}`}/></header>; }

function PagesSidebar({ pages, active, choose, create, toast }: any) { return <div className="sidebar-section"><div className="group-title"><span>Top-level pages</span><b>{pages.filter((p:PageData)=>!p.parent).length}</b></div>{!pages.length?<EmptyState icon="file" title="No pages found" copy="Try another search or create a new page." action="New page" onAction={create}/>:pages.map((p:PageData)=><div className={`page-row ${active===p.id?"selected":""}`} key={p.id} onClick={()=>choose(p.id)}><i className={`status ${p.status}`}/><span><b>{p.title}</b><small>{p.slug}</small></span><button onClick={e=>{e.stopPropagation();toast("Page actions are not connected yet","info")}}><Icon name="more"/></button></div>)}<div className="group-title"><span>Nested</span><b>{pages.filter((p:PageData)=>p.parent).length}</b></div>{pages.filter((p:PageData)=>p.parent).map((p:PageData)=><div className="page-row nested" key={`nested-${p.id}`}><Icon name="chevron" size={12}/><span><b>{p.title}</b><small>{p.slug}</small></span></div>)}</div>; }
function SectionsSidebar({ sections, selected, choose, mutate, add, toast, onReorder, onVisibility, onRename }: any) { const [open,setOpen]=useState<Record<string,boolean>>({HEADER:true,BODY:true,FOOTER:true,TEMPLATE:true}); const drag=useRef<string|null>(null); return <div className="sidebar-section">{["HEADER","BODY","FOOTER","TEMPLATE"].map(zone=>{const items=sections.filter((s:Section)=>s.zone===zone);return <div key={zone} className="zone"><button className="group-title zone-title" onClick={()=>setOpen({...open,[zone]:!open[zone]})}><Icon name={open[zone]?"down":"chevron"} size={12}/><span>{zone}</span><b>{items.length}</b></button>{open[zone]&&items.map((s:Section)=><div key={s.id} draggable onDragStart={()=>drag.current=s.id} onDragOver={e=>e.preventDefault()} onDrop={()=>{const from=sections.findIndex((x:Section)=>x.id===drag.current),to=sections.findIndex((x:Section)=>x.id===s.id);if(from<0||to<0)return;const copy=[...sections];const [m]=copy.splice(from,1);copy.splice(to,0,m);mutate(()=>copy);onReorder(copy);toast("Section order updated","info")}} className={`section-row ${selected===s.id?"selected":""}`} onClick={()=>choose(s.id)}><span className="drag">⠿</span><i className="swatch" style={{background:s.color}}/><span onDoubleClick={e=>{e.stopPropagation();(e.currentTarget as HTMLElement).contentEditable="true";e.currentTarget.focus()}} onBlur={e=>{(e.currentTarget as HTMLElement).contentEditable="false";const name=(e.currentTarget.childNodes[0]?.textContent||s.name).trim();mutate((list:Section[])=>list.map(x=>x.id===s.id?{...x,name}:x));onRename(s,name)}}>{s.name}<small>{s.zone}</small></span><button onClick={e=>{e.stopPropagation();const visible=!s.visible;mutate((list:Section[])=>list.map(x=>x.id===s.id?{...x,visible}:x));onVisibility(s,visible)}}><Icon name={s.visible?"eye":"eyeoff"} size={14}/></button></div>)}</div>})}<Button icon="plus" kind="accent" className="wide-action" onClick={add}>Add section</Button></div>; }

function BlocksSidebar({ section, selected, choose, add, onVisibility }: any) {
  const blocks: BlockData[] = section?.blocks || [];
  return <div className="sidebar-section"><div className="group-title"><span>{section ? `${section.name} blocks` : "Blocks"}</span><b>{blocks.length}</b></div>{!section ? <EmptyState icon="puzzle" title="Select a section" copy="Choose a section to inspect its blocks."/> : !blocks.length ? <EmptyState icon="puzzle" title="No blocks yet" copy="This section has no canonical blocks." action="Add block" onAction={add}/> : blocks.map((block) => <button className={`page-row ${selected===block.id?"selected":""}`} key={block.id} onClick={() => choose(block.id)}><i className={`status ${block.visible?"live":"draft"}`}/><span><b>{block.type}</b><small>{block.id}</small></span><button onClick={(event) => { event.stopPropagation(); onVisibility(block, !block.visible); }} title={block.visible?"Hide block":"Show block"}><Icon name={block.visible?"eye":"eyeoff"}/></button></button>)}{section && <Button icon="plus" className="wide-action" onClick={add}>Add block</Button>}</div>;
}
function TemplatesSidebar({ items, schemas, preview, apply, addSection }: any) {
  const [tab, setTab] = useState<"Models" | "Pages" | "Sections">("Models");
  const [industry, setIndustry] = useState("All");
  const sectionSchemas = schemas?.sections || [];
  const blockSchemas = schemas?.blocks || [];
  const list = (items || []).filter((row: any) => {
    const type = String(row.type || "").toLowerCase();
    if (tab === "Pages" && type.includes("section")) return false;
    if (tab === "Sections" && type.includes("page")) return false;
    if (industry !== "All" && row.category && row.category !== industry) return false;
    return true;
  });
  return (
    <div className="sidebar-section">
      <div className="segmented">
        <button className={tab === "Models" ? "active" : ""} onClick={() => setTab("Models")}>Content models</button>
        <button className={tab === "Pages" ? "active" : ""} onClick={() => setTab("Pages")}>Full pages</button>
        <button className={tab === "Sections" ? "active" : ""} onClick={() => setTab("Sections")}>Sections</button>
      </div>
      {tab === "Models" ? (
        <>
          <div className="panel-note" style={{ margin: "8px 0 12px" }}>
            <Icon name="info"/>
            <p>Registry section/block schemas — one definition for editor fields, preview, and publish.</p>
          </div>
          <div className="group-title"><span>Sections</span><b>{sectionSchemas.length}</b></div>
          {!sectionSchemas.length ? (
            <EmptyState icon="layers" title="No schemas yet" copy="Bootstrap did not return registry schemas. Check /api/cms/bootstrap schemas payload."/>
          ) : sectionSchemas.map((schema: any) => (
            <article key={schema.key || schema.type} className="page-row" style={{ alignItems: "flex-start", cursor: "default" }}>
              <span>
                <b>{schema.label || schema.type}</b>
                <small>{schema.key || schema.type} · {Object.keys(schema.fields || {}).length} fields{(schema.allowedBlocks || []).length ? ` · blocks: ${(schema.allowedBlocks || []).join(", ")}` : ""}</small>
              </span>
              <Button kind="accent" onClick={() => addSection?.(schema.type || schema.label)}>Add</Button>
            </article>
          ))}
          <div className="group-title"><span>Blocks</span><b>{blockSchemas.length}</b></div>
          {blockSchemas.map((schema: any) => (
            <div className="page-row nested" key={schema.key || schema.type}>
              <span><b>{schema.label || schema.type}</b><small>{schema.key || schema.type}</small></span>
            </div>
          ))}
        </>
      ) : (
        <>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option>All industries</option>
            {["Agency", "Restaurant", "Nonprofit", "Portfolio", "Ecommerce", "SaaS"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <div className="template-grid">
            {list.map((tpl: any, i: number) => (
              <article key={tpl.id || tpl.name}>
                <Wireframe variant={i} />
                <b>{tpl.name}</b>
                <small>{tpl.category || ["Agency", "Portfolio", "Editorial"][i % 3]}{tpl.hasHtml ? " · HTML" : ""}</small>
                <div>
                  <Button onClick={() => preview(tpl)}>Preview</Button>
                  <Button kind="accent" onClick={() => apply(tpl)}>Apply</Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MediaSidebar({ view,setView,filter,setFilter,items,upload,toast }: any) { return <div className="sidebar-section"><button className="mini-dropzone" onClick={upload}><Icon name="upload"/><span><b>Upload media</b><small>Drop files or browse</small></span></button><div className="media-controls"><div className="filter-tabs">{["All","Image","Video","Document","Font"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div><div><button className={view==="grid"?"active":""} onClick={()=>setView("grid")}><Icon name="grid"/></button><button className={view==="list"?"active":""} onClick={()=>setView("list")}><Icon name="layers"/></button></div></div><div className={`media-grid ${view}`}>{items.filter((x:any)=>filter==="All"||x.type===filter).map((x:any)=><article key={x.id}><div className="media-thumb" style={{background:x.color}}>{x.type==="Image"?<Icon name="image" size={24}/>:<Icon name="file" size={24}/>}<input type="checkbox"/><button onClick={()=>{const url=x.previewUrl||"";if(url){navigator.clipboard?.writeText(url);toast("Media URL copied")}else toast("This asset has no public URL","info")}}><Icon name="copy"/></button></div><span><b>{x.name}</b><small>{x.size}</small></span></article>)}</div><div className="storage"><div><span>Storage</span><b>Usage unavailable</b></div></div></div>; }
function CrmSidebar({ contacts,search,select,exportCsv }: any) { const list=contacts.filter((x:any)=>(x.name+x.email).toLowerCase().includes(search.toLowerCase())); return <div className="sidebar-section"><div className="crm-stats"><div><b>{contacts.length}</b><span>Loaded contacts</span></div></div><div className="filter-row"><Button icon="filter">Source</Button><Button icon="publish" onClick={exportCsv}>Export CSV</Button></div>{!list.length ? <EmptyState icon="users" title="No contacts" copy="No matching contacts are available."/> : list.map((c:any)=><button className="contact-row" key={c.id} onClick={()=>select(c.id)}><span className="contact-avatar">{c.name.split(" ").map((x:string)=>x[0]).join("")}</span><span><b>{c.name}</b><small>{c.email}</small><em>{c.source}</em></span><time>{c.date}</time></button>)}</div>; }
function SettingsSidebar({ site }: any) { return <div className="sidebar-section settings-form"><div className="panel-note"><Icon name="info"/><p>Site provisioning and integration settings are managed from the CMS hub. This editor only shows the resolved site identity.</p></div><SectionLabel title="Site details"/><Field label="Site name"><input value={site.name} readOnly/></Field><Field label="Site slug"><input value={site.id} readOnly/></Field><Field label="Custom domain"><input value={site.domain || "Not configured"} readOnly/></Field></div>; }

function SectionLabel({title}:any){return <div className="section-label"><span>{title}</span><i/></div>}
function Field({label,raw,children}:any){return <label className="field"><span>{label}{raw&&<i title={raw}>?</i>}</span>{children}</label>}
function ToggleRow({label,copy,value,set}:any){return <div className="toggle-row"><span><b>{label}</b><small>{copy}</small></span><button className={`toggle ${value?"on":""}`} onClick={()=>set(!value)}><span/></button></div>}

function BlockInspector({ block, update, toast }: any) { return <div className="panel-form"><div className="panel-note"><Icon name="info"/><p>Editing canonical <b>{block.type}</b> block data.</p></div>{Object.entries(block.data || {}).map(([key,value]) => { const label=key.replace(/_/g," ").replace(/\b\w/g,x=>x.toUpperCase()); if(typeof value==="boolean")return <Field key={key} label={label}><ToggleRow label={value?"Enabled":"Disabled"} copy="Boolean field" value={value} set={(v:boolean)=>update(key,v)}/></Field>; if(typeof value==="number")return <Field key={key} label={label}><input type="number" value={value} onChange={e=>update(key,Number(e.target.value))}/></Field>; if(typeof value==="object")return <Field key={key} label={label}><textarea className="code-area" rows={6} value={JSON.stringify(value,null,2)} onChange={e=>{try{update(key,JSON.parse(e.target.value))}catch{}}} onBlur={e=>{try{JSON.parse(e.target.value)}catch{toast("This block field contains invalid JSON","error")}}}/></Field>; return <Field key={key} label={label}><input value={String(value??"")} onChange={e=>update(key,e.target.value)}/></Field>; })}{!Object.keys(block.data || {}).length && <EmptyState icon="puzzle" title="Empty block" copy="This block has no editable data fields yet."/>}</div>; }
function ContentInspector({ section, schemas, update, toast }: any) {
  const [raw, setRaw] = useState(false);
  const [rich, setRich] = useState<string>("");
  const schema = (schemas || []).find((row: any) => row.type === section.type || row.type === String(section.type || "").toLowerCase() || row.label === section.name);
  const fieldDefs = schema?.fields && typeof schema.fields === "object" ? schema.fields as Record<string, any> : null;
  const entries = fieldDefs
    ? Object.keys(fieldDefs).map((key) => [key, section.fields?.[key] ?? schema?.defaults?.[key] ?? ""] as const)
    : Object.entries(section.fields || {});
  return <div className="panel-form"><div className="panel-note"><Icon name="info"/><p>{schema ? <>Fields from registry schema <b>{schema.type}</b> (v{schema.version}).</> : <>Fields are mapped to <b>{section.name}</b>.</>} Changes preview instantly and save as structured content.</p></div>{entries.map(([key, value]) => {
    const def = fieldDefs?.[key];
    const label = (def?.label as string) || key.replace(/_/g, " ").replace(/\b\w/g, (x: string) => x.toUpperCase());
    const kind = String(def?.type || "").toLowerCase();
    if (typeof value === "boolean" || kind === "boolean") return <Field key={key} label={label} raw={key}><ToggleRow label={value ? "Enabled" : "Disabled"} copy="Boolean field" value={!!value} set={(v: boolean) => update(key, v)}/></Field>;
    if (kind === "link" || (value && typeof value === "object" && !Array.isArray(value) && ("href" in (value as any) || "label" in (value as any)))) {
      const link = (value && typeof value === "object" ? value : { label: "", href: String(value || "") }) as any;
      return <Field key={key} label={label} raw={key}><div className="two-fields"><input placeholder="Label" value={String(link.label || "")} onChange={(e) => update(key, { ...link, label: e.target.value })}/><input placeholder="https://" value={String(link.href || "")} onChange={(e) => update(key, { ...link, href: e.target.value })}/></div></Field>;
    }
    if (kind === "asset" || key.includes("image")) {
      const url = typeof value === "string" ? value : value && typeof value === "object" ? String((value as any).url || (value as any).src || "") : "";
      return <Field key={key} label={label} raw={key}><div className="image-field"><img src={url || undefined} alt=""/><div><input value={url} onChange={(e) => update(key, kind === "asset" ? { url: e.target.value } : e.target.value)}/><span><Button icon="image" onClick={() => toast("Use the Media panel to inspect available assets", "info")}>Media</Button></span></div></div></Field>;
    }
    if (Array.isArray(value)) return <ListField key={key} label={label} raw={key} value={value} update={(v: any) => update(key, v)}/>;
    if (kind === "richtext" || key === "body" || key === "description" || key.includes("body") || key.includes("quote")) return <Field key={key} label={label} raw={key}><div className="rich-editor"><div className="rich-tools">{["B","I","Link","• List","H2"].map((x) => <button key={x} onMouseDown={(e) => { e.preventDefault(); document.execCommand(x === "B" ? "bold" : x === "I" ? "italic" : x === "H2" ? "formatBlock" : x === "• List" ? "insertUnorderedList" : "createLink", false, x === "Link" ? "https://" : "h2"); }}>{x}</button>)}</div><div contentEditable suppressContentEditableWarning onInput={(e) => { setRich(e.currentTarget.innerHTML); update(key, e.currentTarget.innerHTML); }} dangerouslySetInnerHTML={{ __html: rich || String(value || "") }}/></div></Field>;
    if (typeof value === "number" || kind === "number") return <Field key={key} label={label} raw={key}><input type="number" value={Number(value || 0)} onChange={(e) => update(key, Number(e.target.value))}/></Field>;
    if (value && typeof value === "object") return <Field key={key} label={label} raw={key}><textarea className="code-area" rows={6} value={JSON.stringify(value, null, 2)} onChange={(e) => { try { update(key, JSON.parse(e.target.value)); } catch {} }} onBlur={(e) => { try { JSON.parse(e.target.value); } catch { toast("This field contains invalid JSON", "error"); } }}/></Field>;
    return <Field key={key} label={label} raw={key}>{String(value ?? "").length > 70 ? <textarea rows={4} value={String(value ?? "")} onChange={(e) => update(key, e.target.value)}/> : <input value={String(value ?? "")} onChange={(e) => update(key, e.target.value)}/>}</Field>;
  })}<button className="disclosure" onClick={() => setRaw((v) => !v)}><Icon name={raw ? "down" : "chevron"}/><span>Raw fields JSON</span></button>{raw && <div className="raw-json"><button onClick={() => { navigator.clipboard?.writeText(JSON.stringify(section.fields, null, 2)); toast("Fields JSON copied"); }}><Icon name="copy"/></button><pre>{JSON.stringify(section.fields, null, 2)}</pre></div>}</div>;
}

function ListField({label,raw,value,update}:any){const drag=useRef<number|null>(null);return <Field label={label} raw={raw}><div className="list-field">{value.map((v:any,i:number)=><div key={i} draggable onDragStart={()=>drag.current=i} onDragOver={e=>e.preventDefault()} onDrop={()=>{const a=[...value];const [m]=a.splice(drag.current!,1);a.splice(i,0,m);update(a)}}><span>⠿</span><input value={String(v)} onChange={e=>{const a=[...value];a[i]=e.target.value;update(a)}}/><button onClick={()=>update(value.filter((_:any,x:number)=>x!==i))}><Icon name="close"/></button></div>)}<Button icon="plus" onClick={()=>update([...value,""])}>Add item</Button></div></Field>}

function StyleInspector({ section, update }: any) { const css=section.css||{}; const [linked,setLinked]=useState(true); const [bg,setBg]=useState("Color"); const [display,setDisplay]=useState("block"); return <div className="panel-form"><SectionLabel title="Spacing"/><div className="box-control"><div className="box-grid">{["Top","Right","Bottom","Left"].map((x,i)=><Field key={x} label={x}><input type="number" value={parseInt(css[`padding${x}`]||"24")} onChange={e=>{const v=e.target.value+"px";if(linked)["Top","Right","Bottom","Left"].forEach(y=>update(`padding${y}`,v));else update(`padding${x}`,v)}}/></Field>)}</div><button className={linked?"active":""} onClick={()=>setLinked(v=>!v)}><Icon name="link"/></button></div><SectionLabel title="Background"/><Field label="Type"><select value={bg} onChange={e=>setBg(e.target.value)}>{["None","Color","Gradient","Image","Video"].map(x=><option key={x}>{x}</option>)}</select></Field>{bg==="Color"&&<Field label="Background color"><div className="color-input"><input type="color" value={css.backgroundColor||section.color} onChange={e=>update("backgroundColor",e.target.value)}/><input value={css.backgroundColor||section.color} onChange={e=>update("backgroundColor",e.target.value)}/></div></Field>}{bg==="Gradient"&&<><div className="gradient-preview"/><div className="two-fields"><input type="color" defaultValue="#6358ff"/><input type="color" defaultValue="#cfef5b"/></div><Field label="Angle"><input type="range" min="0" max="360" defaultValue="135"/></Field></>}<SectionLabel title="Typography"/><Field label="Font family"><select onChange={e=>update("fontFamily",e.target.value)}>{["Inter","Manrope","DM Sans","Space Grotesk","Playfair Display","JetBrains Mono"].map(x=><option key={x}>{x}</option>)}</select></Field><div className="two-fields"><Field label="Size"><input type="number" defaultValue="16" onChange={e=>update("fontSize",e.target.value+"px")}/></Field><Field label="Weight"><select onChange={e=>update("fontWeight",e.target.value)}>{[400,500,600,700,800].map(x=><option key={x}>{x}</option>)}</select></Field></div><Field label="Alignment"><div className="button-group">{["left","center","right","justify"].map(x=><button key={x} onClick={()=>update("textAlign",x)}>{x[0].toUpperCase()}</button>)}</div></Field><SectionLabel title="Border & shadow"/><div className="two-fields"><Field label="Width"><input type="number" defaultValue="0" onChange={e=>update("borderWidth",e.target.value+"px")}/></Field><Field label="Style"><select onChange={e=>update("borderStyle",e.target.value)}>{["none","solid","dashed","dotted"].map(x=><option key={x}>{x}</option>)}</select></Field></div><Field label="Radius"><input type="range" min="0" max="64" defaultValue="0" onChange={e=>update("borderRadius",e.target.value+"px")}/></Field><div className="shadow-builder"><b>Shadow 1</b><div className="four-fields">{["X","Y","Blur","Spread"].map((x,i)=><Field key={x} label={x}><input type="number" defaultValue={[0,12,32,0][i]}/></Field>)}</div><ToggleRow label="Inset" copy="Draw inside the element" value={false} set={()=>{}}/></div><SectionLabel title="Layout"/><Field label="Display"><select value={display} onChange={e=>{setDisplay(e.target.value);update("display",e.target.value)}}>{["block","flex","grid"].map(x=><option key={x}>{x}</option>)}</select></Field>{display==="flex"&&<><Field label="Direction"><div className="button-group">{["row","column"].map(x=><button key={x} onClick={()=>update("flexDirection",x)}>{x}</button>)}</div></Field><Field label="Align"><select onChange={e=>update("alignItems",e.target.value)}>{["stretch","start","center","end"].map(x=><option key={x}>{x}</option>)}</select></Field></>}{display==="grid"&&<div className="two-fields"><Field label="Columns"><input type="number" defaultValue="3"/></Field><Field label="Gap"><input type="number" defaultValue="24"/></Field></div>}<SectionLabel title="Effects & motion"/><Field label="Opacity"><div className="range-input"><input type="range" min="0" max="100" defaultValue="100" onChange={e=>update("opacity",Number(e.target.value)/100)}/><output>100%</output></div></Field><Field label="Transition"><select>{["None","Fade in","Slide up","Slide left","Zoom in"].map(x=><option key={x}>{x}</option>)}</select></Field></div>; }

function PageInspector({ page,site,updatePages,history,toast }: any){const update=(k:string,v:any)=>updatePages((ps:PageData[])=>ps.map(p=>p.id===page.id?{...p,[k]:v}:p));return <div className="panel-form"><SectionLabel title="Page details"/><Field label="Page title"><input value={page.title} onChange={e=>update("title",e.target.value)}/></Field><Field label="Slug"><div className="input-action"><input value={page.slug} onChange={e=>update("slug",e.target.value.toLowerCase().replace(/\s+/g,"-"))}/><button onClick={()=>{navigator.clipboard?.writeText(`https://${site.domain}${page.slug}`);toast("Page URL copied")}}><Icon name="copy"/></button></div><small className="url-preview">https://{site.domain}{page.slug}</small></Field><SectionLabel title="Search & sharing"/><Field label="Meta title"><input value={page.metaTitle} onChange={e=>update("metaTitle",e.target.value)}/><CharCount value={page.metaTitle} max={60}/></Field><Field label="Meta description"><textarea rows={4} value={page.metaDescription} onChange={e=>update("metaDescription",e.target.value)}/><CharCount value={page.metaDescription} max={160}/></Field><Field label="Open Graph image"><button className="og-preview"><div><Icon name="image" size={22}/><span>Choose social image</span></div></button></Field><Field label="Canonical URL"><input placeholder={`https://${site.domain}${page.slug}`}/></Field><div className="check-row"><label><input type="checkbox" defaultChecked/> Index</label><label><input type="checkbox" defaultChecked/> Follow</label></div><SectionLabel title="Publishing"/><div className="publish-status"><span className={`status ${page.status}`}/><span><b>{page.status==="live"?"Published":"Draft"}</b><small>{page.status==="live"?"Published timestamp available from revision history":"Not currently published"}</small></span></div><Field label="Page type"><select value={page.type} onChange={e=>update("type",e.target.value)}>{["Home","Interior","Landing","Blog post","Product"].map(x=><option key={x}>{x}</option>)}</select></Field><div className="page-metrics"><div><b>{page.sections.reduce((total: number, section: Section) => total + Object.values(section.fields || {}).filter((value) => typeof value === "string").join(" ").trim().split(/\s+/).filter(Boolean).length, 0)}</b><span>Words</span></div><div><b>{page.sections.length}</b><span>Sections</span></div><div><b>{page.sections.reduce((total: number, section: Section) => total + (section.blocks?.length || 0), 0)}</b><span>Blocks</span></div></div><Button icon="layers" className="wide-action" onClick={history}>View page history</Button></div>}
function CharCount({value,max}:any){const n=value.length;return <small className={`char-count ${n>max+10?"bad":n>max?"warn":"good"}`}>{n} / {max}</small>}

function ThemeInspector({vars,update,toast}:any){const [open,setOpen]=useState<Record<string,boolean>>({Brand:true,Typography:true,Colors:false,Spacing:false,Radius:false,Shadows:false,Motion:false,Layout:false});const groups:any={Brand:["--brand-primary","--brand-secondary","--brand-accent"],Typography:["--font-heading","--font-body","--font-mono","--font-size-base"],Colors:["--color-bg","--color-surface","--color-text","--color-text-muted"],Spacing:["--space-6","--section-padding-y"],Radius:["--radius-md","--radius-lg"],Shadows:["--shadow-sm","--shadow-md"],Motion:["--duration-fast","--duration-normal"],Layout:["--container-max-width"]};return <div className="panel-form"><div className="theme-actions"><Button onClick={()=>toast("Theme reset is not connected yet","info")}>Reset all</Button><Button icon="publish" onClick={()=>{const blob=new Blob([JSON.stringify(vars,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="theme.json";a.click()}}>Export</Button><Button icon="copy" onClick={()=>{navigator.clipboard?.writeText(`:root {\n${Object.entries(vars).map(([k,v])=>`  ${k}: ${v};`).join("\n")}\n}`);toast("CSS variables copied")}}>CSS</Button></div><div className="theme-preview"><span style={{background:vars["--brand-primary"]}}/><div><b>Live brand preview</b><small>Buttons, links, highlights and focus states</small></div><button style={{background:vars["--brand-primary"]}}>Action</button></div>{Object.entries(groups).map(([g,keys]:any)=><div className="theme-group" key={g}><button className="theme-group-head" onClick={()=>setOpen({...open,[g]:!open[g]})}><Icon name={open[g]?"down":"chevron"}/><span>{g}</span><small>{keys.length}</small><em onClick={e=>{e.stopPropagation();toast(`${g} reset is not connected yet`,"info")}}>Reset</em></button>{open[g]&&<div className="theme-group-body">{keys.map((k:string)=>{const val=vars[k]||({"--shadow-sm":"0 2px 8px rgba(0,0,0,.08)","--shadow-md":"0 12px 32px rgba(0,0,0,.12)","--duration-fast":"120ms","--duration-normal":"200ms"} as any)[k]||"16px";const color=k.includes("brand")||k.includes("color");return <Field key={k} label={k.replace("--","").replace(/-/g," ")} raw={k}><div className={color?"color-input":"input-action"}>{color&&<input type="color" value={val} onChange={e=>update(k,e.target.value)}/>}<input value={val} onChange={e=>update(k,e.target.value)}/><button onClick={()=>{navigator.clipboard?.writeText(val);toast("Variable copied")}}><Icon name="copy"/></button></div></Field>})}</div>}</div>)}</div>}

function InspectorCrm({contacts,viewAll,select}:any){return <div className="panel-form"><div className="crm-page-stats"><div><b>{contacts.length}</b><span>Loaded contacts</span></div></div><div className="list-head"><b>Recent contacts</b><button onClick={viewAll}>View all</button></div>{!contacts.length ? <EmptyState icon="users" title="No CRM data" copy="No contact records are loaded for this site."/> : contacts.slice(0,6).map((c:any)=><button className="mini-contact" key={c.id} onClick={()=>select(c.id)}><span>{c.name.split(" ").map((x:string)=>x[0]).join("")}</span><div><b>{c.name}</b><small>{c.email}</small></div><time>{c.date}</time></button>)}</div>}
function ImportSectionModal({close,add}:any){const [mode,setMode]=useState<"URL"|"HTML">("URL");return <Modal title="Import content" onClose={close} wide><div className="modal-toolbar"><div className="segmented"><button className={mode==="URL"?"active":""} onClick={()=>setMode("URL")}>Import from URL</button><button className={mode==="HTML"?"active":""} onClick={()=>setMode("HTML")}>Paste HTML</button></div></div>{mode==="URL"?<div className="import-pane"><Icon name="external" size={28}/><h3>Import a section from a URL</h3><p>Bring public content into the CMS import workflow and create an editable section.</p><div className="input-action"><input autoFocus placeholder="https://example.com/page"/><Button kind="accent" onClick={()=>add("Imported Section")}>Import</Button></div></div>:<div className="import-pane"><Icon name="code" size={28}/><h3>Paste custom HTML</h3><p>Scripts are removed before the section is created.</p><textarea autoFocus rows={12} placeholder={'<section class="custom">\n  <h2>Your section</h2>\n</section>'}/><Button kind="accent" onClick={()=>add("Custom HTML")}>Add custom section</Button></div>}</Modal>}
function AddSectionModal({close,add,schemas}:any){const [cat,setCat]=useState("All");const [q,setQ]=useState("");const [tab,setTab]=useState("Library");const cats=["All","Hero","Navigation","Feature","Testimonial","CTA","Gallery","Pricing","FAQ","Contact","Footer","Custom"];const registryCards=(schemas||[]).map((s:any)=>s.label||s.type).filter(Boolean);const cards=registryCards.length?registryCards:["Editorial Hero","Immersive Hero","Minimal Nav","Split Feature","Numbered Services","Quote Spotlight","Project Gallery","Pricing Matrix","FAQ Stack","Contact Split","Bold CTA","Utility Footer"];return <Modal title="Add a section" onClose={close} wide><div className="modal-toolbar"><div className="segmented"><button className={tab==="Library"?"active":""} onClick={()=>setTab("Library")}>Section library</button><button className={tab==="URL"?"active":""} onClick={()=>setTab("URL")}>Import from URL</button><button className={tab==="HTML"?"active":""} onClick={()=>setTab("HTML")}>Paste HTML</button></div><Search value={q} onChange={setQ} placeholder="Search section templates"/></div>{tab==="Library"?<div className="add-section-layout"><nav>{cats.map(x=><button className={cat===x?"active":""} key={x} onClick={()=>setCat(x)}>{x}<span>{x==="All"?cards.length:Math.floor(Math.random()*5)+1}</span></button>)}</nav><div className="section-card-grid">{cards.filter((x:string)=>x.toLowerCase().includes(q.toLowerCase())).map((x:string,i:number)=><article key={x}><Wireframe variant={i}/><div><b>{x}</b><span>{cats[1+(i%(cats.length-1))]}</span></div><Button kind="accent" icon="plus" onClick={()=>add(x)}>Add</Button></article>)}</div></div>:tab==="URL"?<div className="import-pane"><Icon name="external" size={28}/><h3>Import a section from a URL</h3><p>We will fetch the public page, isolate a region, sanitize the markup, and create an editable custom section.</p><div className="input-action"><input autoFocus placeholder="https://example.com/page"/><Button kind="accent" onClick={()=>add("Imported Section")}>Import</Button></div></div>:<div className="import-pane"><Icon name="code" size={28}/><h3>Paste custom HTML</h3><p>Scripts are removed before the section is added. You can refine HTML and styles in the inspector.</p><textarea autoFocus rows={12} placeholder={'<section class="custom">\n  <h2>Your section</h2>\n</section>'}/><Button kind="accent" onClick={()=>add("Custom HTML")}>Add custom section</Button></div>}</Modal>}

function slugFromPageTitle(title: string) {
  const base = String(title || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base ? `/${base}` : "/untitled";
}

function PageModal({ data, setData, close, create, saving }: any) {
  const [slugEdited, setSlugEdited] = useState(false);
  return (
    <Modal title="Create a new page" onClose={close} wide focusKey="create-page">
      <div className="wizard-body">
        <div className="panel-note" style={{ marginBottom: 16 }}>
          <Icon name="info"/>
          <p>Enter a title — slug updates automatically unless you edit it. New pages start as drafts with default sections from the platform starter.</p>
        </div>
        <div className="details-form">
          <Field label="Page title">
            <input
              autoFocus
              value={data.title}
              onChange={(e) => {
                const title = e.target.value;
                setData((prev: typeof data) => ({
                  ...prev,
                  title,
                  slug: slugEdited ? prev.slug : slugFromPageTitle(title),
                }));
              }}
            />
          </Field>
          <Field label="Slug">
            <input
              value={data.slug}
              onChange={(e) => {
                setSlugEdited(true);
                setData({ ...data, slug: e.target.value });
              }}
            />
          </Field>
          <Field label="Page type">
            <select value={data.type} onChange={(e) => setData({ ...data, type: e.target.value })}>
              {["Interior", "Home", "Landing", "Blog", "Product"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <footer className="modal-footer">
        <Button onClick={close}>Cancel</Button>
        <div>
          <Button kind="accent" disabled={saving || !String(data.title || "").trim()} onClick={create}>
            {saving ? "Creating…" : "Create page"}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}

function UploadModal({close}:any){return <Modal title="Upload media" onClose={close}><EmptyState icon="upload" title="Media upload is not connected yet" copy="The canonical Assets API currently provides the media library read path. Upload transport will be enabled only when a real asset registration/upload capability is connected."/><footer className="modal-footer"><Button onClick={close}>Close</Button></footer></Modal>}
function ScheduleModal({close}:any){return <Modal title="Schedule publishing" onClose={close}><EmptyState icon="info" title="Scheduling is not connected yet" copy="Immediate publishing uses the canonical lifecycle pipeline. A scheduling endpoint has not been connected to this editor, so no date or time will be fabricated here."/><footer className="modal-footer"><Button onClick={close}>Close</Button></footer></Modal>}
function ShortcutsModal({close}:any){const rows=[["Save active section","⌘ S"],["Undo / Redo","⌘ Z / ⌘ ⇧ Z"],["Toggle preview mode","⌘ P"],["Command palette","⌘ K"],["Publish page","⌘ ⇧ P"],["Collapse sidebar","⌘ ⇧ ."],["Collapse inspector","⌘ ⇧ ,"],["Switch workspace mode","⌘ 1–7"],["Move selected section","⌘ ↑ / ⌘ ↓"],["Close / deselect","Esc"],["Focus sidebar search","⌘ F"],["Open shortcuts","⌘ /"]];return <Modal title="Keyboard shortcuts" onClose={close}><div className="shortcut-list">{rows.map(([x,k])=><div key={x}><span>{x}</span><kbd>{k}</kbd></div>)}</div></Modal>}
function CommandPalette({close,pages,sections,action}:any){const [q,setQ]=useState("");const items=[...pages.map((p:PageData)=>({type:"page",id:p.id,name:p.title,desc:`Open ${p.slug}`,icon:"file"})),...sections.map((s:Section)=>({type:"section",id:s.id,name:s.name,desc:s.type,icon:"layers"})),{type:"publish",name:"Publish current page",desc:"Send pending changes live",icon:"publish"},{type:"add",name:"Add a section",desc:"Browse the section library",icon:"plus"},{type:"media",name:"Open media library",desc:"Browse assets and uploads",icon:"image"}].filter(x=>(x.name+x.desc).toLowerCase().includes(q.toLowerCase()));return <div className="palette-backdrop"><div className="command-palette"><div className="palette-search"><Icon name="search" size={20}/><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pages, sections, and actions…"/><kbd>ESC</kbd></div><div className="palette-results"><span>Results</span>{items.map((x:any,i)=><button className={i===0?"active":""} key={`${x.type}-${x.id||x.name}`} onClick={()=>action(x.type,x.id)}><i><Icon name={x.icon}/></i><span><b>{x.name}</b><small>{x.desc}</small></span>{x.type==="page"&&<em>Page</em>}{x.type==="section"&&<em>Section</em>}</button>)}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span></footer></div></div>}
function HistoryModal({close}:any){return <Modal title="Page history" onClose={close}><EmptyState icon="layers" title="Revision history" copy="Revision history is available through the CMS lifecycle API and will be loaded here when this panel opens."/></Modal>}
function TemplatePreview({ template, close, apply }: any) {
  const name = template?.name || "Template";
  return (
    <Modal title={name} onClose={close} wide>
      <EmptyState
        icon="grid"
        title={name}
        copy={template?.hasHtml ? "Apply creates a new draft page from this template HTML." : "This catalog entry may lack source HTML; apply will fail loud if R2 source is missing."}
      />
      <footer className="modal-footer">
        <Button onClick={close}>Close</Button>
        <Button kind="accent" onClick={() => apply(template)} disabled={!template?.id}>Apply template</Button>
      </footer>
    </Modal>
  );
}

function ContactDrawer({contact,close}:any){return <div className="drawer-backdrop" onClick={close}><aside className="contact-drawer" onClick={e=>e.stopPropagation()}><header><div className="contact-avatar large">{contact.name.split(" ").map((x:string)=>x[0]).join("")}</div><div><span>CRM contact</span><h2>{contact.name}</h2><p>{contact.email}</p></div><Button icon="close" onClick={close}/></header><div className="drawer-body"><SectionLabel title="Details"/><dl><dt>Email</dt><dd>{contact.email || "—"}</dd><dt>Source</dt><dd>{contact.source || "—"}</dd><dt>Date</dt><dd>{contact.date || "—"}</dd></dl><div className="panel-note"><Icon name="info"/><p>Notes, activity, phone details, and contact mutations are shown only when those fields are supplied by the CRM API.</p></div></div></aside></div>}