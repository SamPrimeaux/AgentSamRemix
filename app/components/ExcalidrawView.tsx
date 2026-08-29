import React, { useEffect, useRef, useState } from 'react';

const EXCALIDRAW_STYLES_ID = 'iam-excalidraw-stylesheet';
/** Build output when vite emits assets/vendor-excalidraw.css (fallback link injection). */
const EXCALIDRAW_CSS_HREF = `${import.meta.env.BASE_URL}assets/vendor-excalidraw.css`;

/** Load Excalidraw CSS before mount — unstyled SVG toolbar icons break without it. */
async function loadExcalidrawStyles(): Promise<void> {
    if (typeof document === 'undefined') return;
    try {
        await import('@excalidraw/excalidraw/index.css');
        return;
    } catch {
        /* chunk import failed — try deployed asset or link fallback */
    }
    if (document.getElementById(EXCALIDRAW_STYLES_ID)) return;
    await new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.id = EXCALIDRAW_STYLES_ID;
        link.rel = 'stylesheet';
        link.href = EXCALIDRAW_CSS_HREF;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('Excalidraw stylesheet failed to load'));
        document.head.appendChild(link);
    });
}

/** Scene elements — deep paths under @excalidraw/excalidraw are not resolved by this project's tsc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawLibraryItem = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawImperativeAPI = any;

const DEBOUNCE_MS = 800;

function getIamWorkspaceId(): string {
    if (typeof window === 'undefined') return 'global';
    const w = (window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__;
    return typeof w === 'string' && w.trim() ? w.trim() : 'global';
}

export type ExcalidrawViewProps = {
    libraryItems?: readonly ExcalidrawLibraryItem[];
    clearOnMount?: boolean;
};

export const ExcalidrawView: React.FC<ExcalidrawViewProps> = ({
    libraryItems = [],
    clearOnMount = false,
}) => {
    const [ExcalidrawComp, setExcalidrawComp] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
    const [initialElements, setInitialElements] = useState<readonly ExcalidrawElement[]>([]);
    const [initialDataLoaded, setInitialDataLoaded] = useState(false);
    const [stylesReady, setStylesReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await loadExcalidrawStyles();
                if (cancelled) return;
                setStylesReady(true);
                const m = await import('@excalidraw/excalidraw');
                if (!cancelled) {
                    setExcalidrawComp(() => m.Excalidraw as React.ComponentType<Record<string, unknown>>);
                }
            } catch (e) {
                if (!cancelled) {
                    setLoadError(e instanceof Error ? e.message : 'Failed to load Draw canvas');
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);
    const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const isLocalChangeRef = useRef(false);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const artifactLoadedRef = useRef(false);
    const clearOnMountRef = useRef(clearOnMount);
    clearOnMountRef.current = clearOnMount;

    const applyLibraries = (api: ExcalidrawImperativeAPI, items: readonly ExcalidrawLibraryItem[]) => {
        if (!items.length || typeof api.updateLibrary !== 'function') return;
        void api.updateLibrary({
            libraryItems: [...items],
            merge: true,
            openLibraryMenu: false,
            defaultStatus: 'published',
        });
    };

    const appliedLibraryCountRef = useRef(0);

    // Load persisted canvas when mount or IAM workspace id changes (via event from App.tsx).
    useEffect(() => {
        const load = () => {
            if (artifactLoadedRef.current) { setInitialDataLoaded(true); return; }
            if (clearOnMountRef.current) {
                setInitialElements([]);
                setInitialDataLoaded(true);
                return;
            }
            const ws = getIamWorkspaceId();
            fetch(`/api/collab/canvas/state?workspace_id=${encodeURIComponent(ws)}`, { credentials: 'same-origin' })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (data?.canvasElements && Array.isArray(data.canvasElements) && data.canvasElements.length > 0) {
                        setInitialElements(data.canvasElements as readonly ExcalidrawElement[]);
                    }
                })
                .catch(() => {})
                .finally(() => setInitialDataLoaded(true));
        };
        load();
        window.addEventListener('iam_workspace_id', load);
        return () => window.removeEventListener('iam_workspace_id', load);
    }, []);

    // Hydrate shape libraries when API + items are ready.
    useEffect(() => {
        const api = excalidrawApiRef.current;
        if (!api || !libraryItems.length) return;
        if (appliedLibraryCountRef.current === libraryItems.length) return;
        applyLibraries(api, libraryItems);
        appliedLibraryCountRef.current = libraryItems.length;
    }, [libraryItems]);

    // Listen for server-pushed plan maps / artifacts (fetch JSON → updateScene)
    useEffect(() => {
        const onLoad = (e: Event) => {
            const det =
                (e as CustomEvent<{
                    load_url?: string | null;
                    artifact_id?: string | null;
                    replace_workspace?: boolean;
                }>).detail || {};
            let url = typeof det.load_url === 'string' ? det.load_url.trim() : '';
            if (!url && typeof det.artifact_id === 'string' && det.artifact_id.trim()) {
                url = `/api/artifacts/${encodeURIComponent(det.artifact_id.trim())}/content`;
            }
            if (!url) return;

            const tryApply = () => {
                const api = excalidrawApiRef.current;
                if (!api) {
                    window.setTimeout(tryApply, 100);
                    return;
                }
                void fetch(url, { credentials: 'same-origin' })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((scene) => {
                        if (!scene || !Array.isArray(scene.elements)) return;
                        setInitialElements(scene.elements);
                        api.updateScene({
                            elements: scene.elements,
                            ...(scene.appState && typeof scene.appState === 'object' ? { appState: scene.appState } : {}),
                        });
                    })
                    .catch(() => {});
            };
            artifactLoadedRef.current = true;
            tryApply();
        };
        window.addEventListener('iam:excalidraw_load_document', onLoad as EventListener);
        return () => window.removeEventListener('iam:excalidraw_load_document', onLoad as EventListener);
    }, []);

    // Listen for agent-driven tool calls (excalidraw_open, excalidraw_add_elements, excalidraw_clear, excalidraw_export)
    useEffect(() => {
        const handler = (e: Event) => {
            const { action, params } = (e as CustomEvent).detail || {};
            const api = excalidrawApiRef.current;
            if (!api) return;
            if (action === 'open' || action === 'clear') {
                api.updateScene({ elements: [] });
            } else if (action === 'add_elements' && Array.isArray(params?.elements)) {
                const existing = api.getSceneElements();
                api.updateScene({ elements: [...existing, ...params.elements] });
            } else if (action === 'export' || action === 'export_plan') {
                void import('../lib/drawPlanExport').then(({ exportExcalidrawPlanArtifacts }) => {
                    const blueprintId =
                        typeof params?.blueprint_id === 'string'
                            ? params.blueprint_id
                            : typeof params?.blueprintId === 'string'
                              ? params.blueprintId
                              : null;
                    return exportExcalidrawPlanArtifacts(api, {
                        title: typeof params?.title === 'string' ? params.title : 'Plan export',
                        filename: typeof params?.filename === 'string' ? params.filename : undefined,
                        blueprintId,
                        downloadLocal: action === 'export' || params?.downloadLocal === true,
                    }).then((result) => {
                        window.dispatchEvent(
                            new CustomEvent('iam:draw_plan_exported', { detail: result }),
                        );
                    });
                });
            } else if (action === 'load_library' && params?.slug) {
                void fetch('/api/draw/library', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slug: params.slug }),
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        const items = Array.isArray(data?.libraryItems) ? data.libraryItems : [];
                        if (items.length) applyLibraries(api, items);
                    })
                    .catch(() => {});
            }
        };
        window.addEventListener('iam:excalidraw_action', handler);
        return () => window.removeEventListener('iam:excalidraw_action', handler);
    }, []);

    // Listen for canvas_update broadcast from other clients via App.tsx WebSocket
    useEffect(() => {
        const handler = (e: Event) => {
            if (isLocalChangeRef.current) return;
            const elements = (e as CustomEvent).detail as ExcalidrawElement[];
            if (Array.isArray(elements) && excalidrawApiRef.current) {
                excalidrawApiRef.current.updateScene({ elements });
            }
        };
        window.addEventListener('iam:canvas_update', handler);
        return () => window.removeEventListener('iam:canvas_update', handler);
    }, []);

    const handleChange = (elements: readonly ExcalidrawElement[]) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(async () => {
            isLocalChangeRef.current = true;
            try {
                const ws = getIamWorkspaceId();
                await fetch(`/api/collab/canvas/elements?workspace_id=${encodeURIComponent(ws)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ elements }),
                });
            } catch (_) {}
            isLocalChangeRef.current = false;
        }, DEBOUNCE_MS);
    };

    if (loadError) {
        return (
            <div className="flex-1 flex items-center justify-center text-sm text-amber-400/90 px-6 text-center">
                {loadError}
            </div>
        );
    }

    if (!initialDataLoaded || !stylesReady || !ExcalidrawComp) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
                Loading canvas…
            </div>
        );
    }

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
            }}
        >
            <div
                style={{
                    flex: 1,
                    overflow: 'hidden',
                    position: 'relative',
                    minHeight: 0,
                }}
            >
                <ExcalidrawComp
                    theme="dark"
                    excalidrawAPI={(api) => {
                        excalidrawApiRef.current = api;
                        if (api && libraryItems.length && appliedLibraryCountRef.current !== libraryItems.length) {
                            applyLibraries(api, libraryItems);
                            appliedLibraryCountRef.current = libraryItems.length;
                        }
                    }}
                    initialData={{
                        elements: clearOnMount ? [] : initialElements,
                        libraryItems: libraryItems.length ? [...libraryItems] : undefined,
                    }}
                    onChange={(elements) => handleChange(elements)}
                    UIOptions={{
                        canvasActions: {
                            changeViewBackgroundColor: true,
                            export: { saveFileToDisk: true },
                            loadScene: true,
                        },
                    }}
                />
            </div>
        </div>
    );
};
