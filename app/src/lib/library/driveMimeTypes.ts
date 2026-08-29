/** Google Workspace MIME types — mirrors src/integrations/drive-mime.js for the Library UI. */

export const GOOGLE_APPS_MIME = {
  DOCUMENT: 'application/vnd.google-apps.document',
  SPREADSHEET: 'application/vnd.google-apps.spreadsheet',
  PRESENTATION: 'application/vnd.google-apps.presentation',
  DRAWING: 'application/vnd.google-apps.drawing',
  FORM: 'application/vnd.google-apps.form',
  FOLDER: 'application/vnd.google-apps.folder',
  SHORTCUT: 'application/vnd.google-apps.shortcut',
  SCRIPT: 'application/vnd.google-apps.script',
  SITE: 'application/vnd.google-apps.site',
  MAP: 'application/vnd.google-apps.map',
  JAM: 'application/vnd.google-apps.jam',
  VID: 'application/vnd.google-apps.vid',
} as const;

export const GOOGLE_APPS_LABELS: Record<string, string> = {
  [GOOGLE_APPS_MIME.DOCUMENT]: 'Google Doc',
  [GOOGLE_APPS_MIME.SPREADSHEET]: 'Google Sheet',
  [GOOGLE_APPS_MIME.PRESENTATION]: 'Google Slides',
  [GOOGLE_APPS_MIME.DRAWING]: 'Google Drawing',
  [GOOGLE_APPS_MIME.FORM]: 'Google Form',
  [GOOGLE_APPS_MIME.FOLDER]: 'Folder',
  [GOOGLE_APPS_MIME.SHORTCUT]: 'Shortcut',
  [GOOGLE_APPS_MIME.SCRIPT]: 'Apps Script',
  [GOOGLE_APPS_MIME.SITE]: 'Google Site',
  [GOOGLE_APPS_MIME.MAP]: 'Google My Map',
  [GOOGLE_APPS_MIME.JAM]: 'Jamboard',
  [GOOGLE_APPS_MIME.VID]: 'Google Vids',
};

/** Default download format per Google Workspace type (Drive export API). */
export const GOOGLE_APPS_EXPORT_FORMAT: Record<string, string> = {
  [GOOGLE_APPS_MIME.DOCUMENT]: 'pdf',
  [GOOGLE_APPS_MIME.SPREADSHEET]: 'csv',
  [GOOGLE_APPS_MIME.PRESENTATION]: 'pdf',
  [GOOGLE_APPS_MIME.DRAWING]: 'pdf',
  [GOOGLE_APPS_MIME.FORM]: 'pdf',
  [GOOGLE_APPS_MIME.SCRIPT]: 'json',
  [GOOGLE_APPS_MIME.VID]: 'mp4',
  [GOOGLE_APPS_MIME.SITE]: 'txt',
  [GOOGLE_APPS_MIME.MAP]: 'pdf',
  [GOOGLE_APPS_MIME.JAM]: 'pdf',
};

export function isGoogleAppsMime(mime?: string | null): boolean {
  return String(mime || '').startsWith('application/vnd.google-apps.');
}

export function googleAppsLabel(mime?: string | null): string | null {
  return GOOGLE_APPS_LABELS[String(mime || '')] || null;
}

export function defaultExportFormat(mime?: string | null): string | null {
  return GOOGLE_APPS_EXPORT_FORMAT[String(mime || '')] || null;
}

export function driveExportUrl(fileId: string, format?: string): string {
  const qs = new URLSearchParams({ fileId });
  if (format) qs.set('format', format);
  return `/api/integrations/gdrive/export?${qs.toString()}`;
}
