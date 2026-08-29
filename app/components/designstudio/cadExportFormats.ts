/** Parse CAD job model_formats and build download links for export UI. */

export type CadExportLink = { format: string; label: string; url: string };

const FORMAT_LABELS: Record<string, string> = {
  glb: 'GLB',
  stl: 'STL',
  obj: 'OBJ',
  ply: 'PLY',
  fbx: 'FBX',
  usdz: 'USDZ',
  '3mf': '3MF',
  mtl: 'MTL',
};

const EXPORT_ORDER = ['stl', '3mf', 'obj', 'ply', 'glb', 'fbx', 'usdz', 'mtl'];

export function parseModelFormats(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return parseModelFormats(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (Array.isArray(raw)) return {};
  if (typeof raw === 'object') {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        out[key] = value;
      }
    }
    return out;
  }
  return {};
}

export function cadExportLinks(
  modelFormats: unknown,
  fallbackGlb?: string | null,
): CadExportLink[] {
  const formats = parseModelFormats(modelFormats);
  const links: CadExportLink[] = [];
  const seen = new Set<string>();

  for (const fmt of EXPORT_ORDER) {
    const url = formats[fmt];
    if (!url || seen.has(fmt)) continue;
    seen.add(fmt);
    links.push({
      format: fmt,
      label: FORMAT_LABELS[fmt] || fmt.toUpperCase(),
      url,
    });
  }

  for (const [fmt, url] of Object.entries(formats)) {
    if (seen.has(fmt)) continue;
    links.push({
      format: fmt,
      label: FORMAT_LABELS[fmt] || fmt.replace(/_/g, ' '),
      url,
    });
    seen.add(fmt);
  }

  if (fallbackGlb && !formats.glb) {
    links.push({ format: 'glb', label: 'GLB', url: fallbackGlb });
  }

  return links;
}

export function downloadCadAsset(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.target = '_blank';
  a.click();
}
