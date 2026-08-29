/** Google Workspace + Drive MIME types (Drive API v3). */

export const GOOGLE_APPS_MIME = {
  AUDIO: 'application/vnd.google-apps.audio',
  DOCUMENT: 'application/vnd.google-apps.document',
  DRAWING: 'application/vnd.google-apps.drawing',
  FILE: 'application/vnd.google-apps.file',
  FOLDER: 'application/vnd.google-apps.folder',
  FORM: 'application/vnd.google-apps.form',
  FUSIONTABLE: 'application/vnd.google-apps.fusiontable',
  JAM: 'application/vnd.google-apps.jam',
  MAP: 'application/vnd.google-apps.map',
  PHOTO: 'application/vnd.google-apps.photo',
  PRESENTATION: 'application/vnd.google-apps.presentation',
  SCRIPT: 'application/vnd.google-apps.script',
  SHORTCUT: 'application/vnd.google-apps.shortcut',
  SITE: 'application/vnd.google-apps.site',
  SPREADSHEET: 'application/vnd.google-apps.spreadsheet',
  UNKNOWN: 'application/vnd.google-apps.unknown',
  VID: 'application/vnd.google-apps.vid',
  VIDEO: 'application/vnd.google-apps.video',
  GEM: 'application/vnd.google-gemini.gem',
};

/** Default export MIME per Google Workspace type. */
export const GOOGLE_APPS_EXPORT_DEFAULTS = {
  [GOOGLE_APPS_MIME.DOCUMENT]: 'application/pdf',
  [GOOGLE_APPS_MIME.SPREADSHEET]: 'text/csv',
  [GOOGLE_APPS_MIME.PRESENTATION]: 'application/pdf',
  [GOOGLE_APPS_MIME.DRAWING]: 'application/pdf',
  [GOOGLE_APPS_MIME.FORM]: 'application/pdf',
  [GOOGLE_APPS_MIME.SCRIPT]: 'application/vnd.google-apps.script+json',
  [GOOGLE_APPS_MIME.VID]: 'video/mp4',
  [GOOGLE_APPS_MIME.SITE]: 'text/plain',
  [GOOGLE_APPS_MIME.MAP]: 'application/pdf',
  [GOOGLE_APPS_MIME.JAM]: 'application/pdf',
};

/** Short format aliases accepted by export routes. */
export const EXPORT_FORMAT_ALIASES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  epub: 'application/epub+zip',
  html: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  json: 'application/vnd.google-apps.script+json',
  mp4: 'video/mp4',
};

const EXPORT_EXT = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/epub+zip': 'epub',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'application/vnd.google-apps.script+json': 'json',
  'video/mp4': 'mp4',
};

/** @param {string|null|undefined} mime */
export function isGoogleAppsMime(mime) {
  return String(mime || '').startsWith('application/vnd.google-apps.');
}

/** @param {string|null|undefined} mime */
export function isGoogleAppsExportable(mime) {
  return Object.prototype.hasOwnProperty.call(GOOGLE_APPS_EXPORT_DEFAULTS, String(mime || ''));
}

/**
 * Resolve export MIME for a Google Workspace file.
 * @param {string} sourceMime
 * @param {string|null|undefined} formatAlias
 */
export function resolveGoogleAppsExportMime(sourceMime, formatAlias) {
  if (formatAlias) {
    const alias = String(formatAlias).toLowerCase();
    return EXPORT_FORMAT_ALIASES[alias] || String(formatAlias);
  }
  return GOOGLE_APPS_EXPORT_DEFAULTS[sourceMime] || 'application/pdf';
}

/**
 * Plain-text oriented export MIME for agent fetch / preview extraction.
 * @param {string} sourceMime
 */
export function textExportMimeForFetch(sourceMime) {
  if (sourceMime === GOOGLE_APPS_MIME.SPREADSHEET) return 'text/csv';
  if (sourceMime === GOOGLE_APPS_MIME.DOCUMENT) return 'text/plain';
  if (sourceMime === GOOGLE_APPS_MIME.PRESENTATION) return 'text/plain';
  if (sourceMime === GOOGLE_APPS_MIME.SCRIPT) return 'application/vnd.google-apps.script+json';
  return 'text/plain';
}

/** @param {string} exportMime */
export function extensionForExportMime(exportMime) {
  return EXPORT_EXT[exportMime] || 'bin';
}

/** Human label for Google Workspace MIME types. */
export const GOOGLE_APPS_LABELS = {
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

/** @param {string|null|undefined} mime */
export function googleAppsLabel(mime) {
  return GOOGLE_APPS_LABELS[String(mime || '')] || null;
}
