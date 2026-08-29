/**
 * Export Excalidraw scene as PNG + SVG, persist via /api/draw/export,
 * optionally attach to a Design Studio blueprint.
 */

export type DrawPlanExportResult = {
  ok: boolean;
  drawId?: number | string;
  public_url?: string | null;
  svg_public_url?: string | null;
  r2_key?: string | null;
  svg_r2_key?: string | null;
  generation_type?: string;
  blueprint_id?: string | null;
  error?: string;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawApi = any;

export async function exportExcalidrawPlanArtifacts(
  api: ExcalidrawApi,
  opts: {
    title?: string;
    filename?: string;
    blueprintId?: string | null;
    downloadLocal?: boolean;
  } = {},
): Promise<DrawPlanExportResult> {
  if (!api) return { ok: false, error: 'Excalidraw API not ready' };

  const mod = await import('@excalidraw/excalidraw');
  const elements = api.getSceneElements?.() ?? [];
  const appState = api.getAppState?.() ?? {};
  const files = api.getFiles?.() ?? {};
  const exportBase = {
    elements,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
    files,
  };

  const [svgEl, pngBlob] = await Promise.all([
    mod.exportToSvg(exportBase),
    mod.exportToBlob({ ...exportBase, mimeType: 'image/png', quality: 0.92 }),
  ]);

  const svgString = new XMLSerializer().serializeToString(svgEl);
  const canvasData = await blobToDataUrl(pngBlob);
  const scene = {
    type: 'excalidraw',
    version: 2,
    source: 'inneranimalmedia-draw',
    elements,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
    },
    files,
  };

  const title = (opts.title || 'Plan export').trim() || 'Plan export';
  const filename = (opts.filename || title).replace(/[^\w.-]+/g, '_').slice(0, 80);

  if (opts.downloadLocal) {
    const pngUrl = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `${filename}.png`;
    a.click();
    URL.revokeObjectURL(pngUrl);

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const a2 = document.createElement('a');
    a2.href = svgUrl;
    a2.download = `${filename}.svg`;
    a2.click();
    URL.revokeObjectURL(svgUrl);
  }

  const res = await fetch('/api/draw/export', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canvasData,
      svgData: svgString,
      scene,
      title,
      filename,
      destinations: ['r2'],
      ...(opts.blueprintId ? { blueprint_id: String(opts.blueprintId) } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as DrawPlanExportResult & { error?: string };
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return {
    ok: true,
    drawId: data.drawId,
    public_url: data.public_url ?? null,
    svg_public_url: data.svg_public_url ?? null,
    r2_key: data.r2_key ?? null,
    svg_r2_key: data.svg_r2_key ?? null,
    generation_type: data.generation_type,
    blueprint_id: data.blueprint_id ?? opts.blueprintId ?? null,
  };
}
