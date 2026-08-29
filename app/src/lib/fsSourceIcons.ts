/** File source rail icons — `public/icons/fs-sources/` → R2 `/static/dashboard/app/icons/fs-sources/`. */
export type FsSourceIconId = 'local' | 'r2' | 'github' | 'drive' | 'container';

const FS_SOURCES_DIR = `${import.meta.env.BASE_URL}icons/fs-sources/`;

export const FS_SOURCE_ICON_META: Record<
  FsSourceIconId,
  { src: string; label: string; title: string }
> = {
  local: {
    src: `${FS_SOURCES_DIR}local.svg`,
    label: 'Local',
    title: 'Local folder (native File System Access)',
  },
  r2: {
    src: `${FS_SOURCES_DIR}r2.svg`,
    label: 'R2',
    title: 'Cloudflare R2 object storage',
  },
  github: {
    src: `${FS_SOURCES_DIR}github.svg`,
    label: 'GitHub',
    title: 'GitHub repositories (workspace pin expands when linked)',
  },
  drive: {
    src: `${FS_SOURCES_DIR}googledrive.svg`,
    label: 'Drive',
    title: 'Google Drive',
  },
  container: {
    src: `${FS_SOURCES_DIR}container.svg`,
    label: 'Sandbox',
    title: 'CF container sandbox workspace',
  },
};

/** Default display size for the source rail (CSS px). */
export const FS_SOURCE_ICON_PX = 20;
