export type UploadedImageItem = {
  url?: string;
  public_url?: string;
  thumbnail_url?: string;
};

export async function uploadDashboardImage(
  file: File,
  workspaceId?: string | null,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('alt_text', file.name);
  const qs = workspaceId?.trim()
    ? `?workspace_id=${encodeURIComponent(workspaceId.trim())}`
    : '';
  const res = await fetch(`/api/images/upload${qs}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    item?: UploadedImageItem;
    image?: UploadedImageItem;
  };
  if (!res.ok) return { ok: false, error: j.error || `Upload failed (${res.status})` };
  const item = j.item || j.image;
  const url = item?.url || item?.public_url || item?.thumbnail_url;
  if (!url) return { ok: false, error: 'Upload succeeded but no image URL returned' };
  return { ok: true, url };
}
