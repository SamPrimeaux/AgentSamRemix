import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  initAuth,
  googleSignIn,
  logout,
} from '../../services/googleAuth';
import {
  listDriveFiles,
  createDriveFolder,
  uploadDriveFile,
  deleteDriveFile,
  readDriveFileContent,
  DriveFileItem,
} from '../../services/driveService';
import { GoogleUser } from '../../services/googleAuth';

interface GoogleDriveWorkspaceProps {
  currentPageHtml?: string;
  currentPageTitle?: string;
  onLoadHtmlToBrowser?: (html: string, title: string) => void;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export const GoogleDriveWorkspace: React.FC<GoogleDriveWorkspaceProps> = ({
  currentPageHtml,
  currentPageTitle,
  onLoadHtmlToBrowser,
}) => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Drive Browser State
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [folderHistory, setFolderHistory] = useState<BreadcrumbItem[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedFile, setSelectedFile] = useState<DriveFileItem | null>(null);
  const [fileContentPreview, setFileContentPreview] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  // Quick Save & Actions
  const [isSavingCurrentPage, setIsSavingCurrentPage] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [deleteTargetFile, setDeleteTargetFile] = useState<DriveFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const currentFolder = folderHistory[folderHistory.length - 1];

  // Auth setup
  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser, authToken) => {
        setUser(authUser);
        setToken(authToken);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (currentPageTitle) {
      const cleanName = currentPageTitle.replace(/[/\\?%*:|"<>]/g, '-').trim();
      setSaveFileName(`${cleanName || 'Generated-Page'}.html`);
    } else {
      setSaveFileName('Generated-Page.html');
    }
  }, [currentPageTitle]);

  const loadFiles = useCallback(async () => {
    if (!token) return;
    setIsLoadingFiles(true);
    try {
      const res = await listDriveFiles({
        folderId: currentFolder.id === 'root' ? undefined : currentFolder.id,
        searchTerm: searchTerm.trim() || undefined,
        mimeTypeFilter: filterType,
      });
      setFiles(res.files);
    } catch (err: any) {
      console.error('Failed to load drive files:', err);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [token, currentFolder.id, searchTerm, filterType]);

  useEffect(() => {
    if (token) {
      loadFiles();
    }
  }, [token, loadFiles]);

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setToken(result.accessToken);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Failed to sign in with Google');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setFiles([]);
    setSelectedFile(null);
    setFileContentPreview(null);
  };

  const handleOpenFolder = (folder: DriveFileItem) => {
    setFolderHistory(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedFile(null);
    setFileContentPreview(null);
  };

  const handleNavigateBreadcrumb = (index: number) => {
    setFolderHistory(prev => prev.slice(0, index + 1));
    setSelectedFile(null);
    setFileContentPreview(null);
  };

  const handleSelectFile = async (file: DriveFileItem) => {
    setSelectedFile(file);
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      setFileContentPreview(null);
      return;
    }

    setIsLoadingContent(true);
    setFileContentPreview(null);
    try {
      const content = await readDriveFileContent(file);
      setFileContentPreview(content);
    } catch {
      setFileContentPreview('Preview not available for this file type.');
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleSavePageToDrive = async () => {
    if (!currentPageHtml || !saveFileName.trim()) return;
    setIsSavingCurrentPage(true);
    setSaveSuccessMsg(null);
    try {
      await uploadDriveFile(
        saveFileName.trim(),
        currentPageHtml,
        'text/html',
        currentFolder.id === 'root' ? undefined : currentFolder.id
      );
      setSaveSuccessMsg(`Saved "${saveFileName}" to ${currentFolder.name}!`);
      loadFiles();
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (err: any) {
      alert(`Error saving to Drive: ${err.message}`);
    } finally {
      setIsSavingCurrentPage(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await createDriveFolder(
        newFolderName.trim(),
        currentFolder.id === 'root' ? undefined : currentFolder.id
      );
      setNewFolderName('');
      setIsCreatingFolder(false);
      loadFiles();
    } catch (err: any) {
      alert(`Error creating folder: ${err.message}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const text = await file.text();
      await uploadDriveFile(
        file.name,
        text,
        file.type || 'text/plain',
        currentFolder.id === 'root' ? undefined : currentFolder.id
      );
      loadFiles();
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmDeleteFile = async () => {
    if (!deleteTargetFile) return;
    setIsDeleting(true);
    try {
      await deleteDriveFile(deleteTargetFile.id);
      setDeleteTargetFile(null);
      if (selectedFile?.id === deleteTargetFile.id) {
        setSelectedFile(null);
        setFileContentPreview(null);
      }
      loadFiles();
    } catch (err: any) {
      alert(`Failed to delete file: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!token || !user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117] p-6">
        <div className="max-w-md w-full bg-[#161b22] border border-[#30363d] rounded-2xl p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 mx-auto bg-blue-500/10 border border-blue-500/30 rounded-2xl flex items-center justify-center text-blue-400">
            <span className="material-symbols-outlined text-4xl">cloud_sync</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Connect Google Drive</h2>
            <p className="text-sm text-gray-400">
              Browse your cloud files, inspect documents, and save AI-generated web apps directly to your Drive.
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-red-950/40 border border-red-800 rounded-lg text-xs text-red-300 flex items-center gap-2 text-left">
              <span className="material-symbols-outlined text-sm">error</span>
              <span>{authError}</span>
            </div>
          )}

          <div className="pt-2 flex justify-center">
            <button
              id="btn-drive-page-signin"
              type="button"
              className="gsi-material-button"
              onClick={handleSignIn}
              disabled={isAuthenticating}
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isAuthenticating ? 'Connecting to Google...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-gray-200 overflow-hidden">
      {/* Top Drive Bar */}
      <header className="h-14 border-b border-[#21262d] bg-[#161b22] px-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <span className="material-symbols-outlined text-lg">folder_shared</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white flex items-center gap-2">
              Google Drive Workspace
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                Live Cloud Sync
              </span>
            </h1>
            <p className="text-[11px] text-gray-400">{user.email}</p>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-xl">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined absolute left-3 text-gray-400 text-sm">search</span>
            <input
              type="text"
              placeholder="Search in Google Drive..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-8 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 text-gray-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCreatingFolder(true)}
            className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-xs text-gray-300 hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">create_new_folder</span>
            <span>New Folder</span>
          </button>

          <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm">
            <span className="material-symbols-outlined text-sm">upload_file</span>
            <span>{isUploading ? 'Uploading...' : 'Upload'}</span>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>

          <button
            onClick={() => loadFiles()}
            className="p-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white transition-colors"
            title="Refresh Files"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
          </button>

          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-xs text-gray-300 hover:text-white flex items-center gap-1.5"
            title="Sign out of Google"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
          </button>
        </div>
      </header>

      {/* Sub-bar: Save Active Page + Breadcrumbs + Filter Chips */}
      <div className="px-4 py-2.5 bg-[#161b22]/70 border-b border-[#21262d] flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs">
          {folderHistory.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && <span className="text-gray-500">/</span>}
              <button
                type="button"
                onClick={() => handleNavigateBreadcrumb(idx)}
                className={`px-2 py-1 rounded hover:bg-[#21262d] transition-colors ${
                  idx === folderHistory.length - 1 ? 'font-semibold text-blue-400' : 'text-gray-400'
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5">
          {[
            { id: 'all', label: 'All' },
            { id: 'folder', label: 'Folders' },
            { id: 'document', label: 'Docs' },
            { id: 'spreadsheet', label: 'Sheets' },
            { id: 'presentation', label: 'Slides' },
            { id: 'image', label: 'Images' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterType === f.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#21262d] text-gray-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inline Create Folder Form */}
      {isCreatingFolder && (
        <form onSubmit={handleCreateFolder} className="px-4 py-2 bg-blue-950/20 border-b border-blue-800/40 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-400 text-sm">create_new_folder</span>
          <input
            type="text"
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="px-3 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
            autoFocus
          />
          <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium">
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreatingFolder(false);
              setNewFolderName('');
            }}
            className="px-2 py-1 bg-[#21262d] text-gray-400 rounded text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Main Split Body: Files List + Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Files Grid / Table */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingFiles ? (
            <div className="h-full flex items-center justify-center text-gray-500 text-xs gap-2">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span>Loading Drive files...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 text-xs space-y-2">
              <span className="material-symbols-outlined text-4xl text-gray-600">folder_open</span>
              <p>No files in this folder</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {files.map((file) => {
                const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                const isSelected = selectedFile?.id === file.id;

                return (
                  <div
                    key={file.id}
                    onClick={() => handleSelectFile(file)}
                    onDoubleClick={() => {
                      if (isFolder) handleOpenFolder(file);
                      else if (file.webViewLink) window.open(file.webViewLink, '_blank');
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-blue-950/30 border-blue-500 shadow-md'
                        : 'bg-[#161b22] border-[#21262d] hover:border-[#30363d] hover:bg-[#1c2128]'
                    }`}
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <div className="w-9 h-9 rounded-lg bg-[#0d1117] flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-xl text-blue-400">
                          {isFolder
                            ? 'folder'
                            : file.mimeType.includes('document') || file.mimeType.includes('text') || file.mimeType.includes('html')
                            ? 'description'
                            : file.mimeType.includes('spreadsheet')
                            ? 'table_chart'
                            : file.mimeType.includes('presentation')
                            ? 'slideshow'
                            : file.mimeType.includes('image')
                            ? 'image'
                            : 'insert_drive_file'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-semibold text-gray-200 truncate" title={file.name}>
                          {file.name}
                        </h4>
                        <p className="text-[10px] text-gray-500">
                          {file.modifiedTime
                            ? new Date(file.modifiedTime).toLocaleDateString()
                            : '-'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-500 pt-2 border-t border-[#21262d]">
                      <span>{isFolder ? 'Folder' : file.size ? `${(parseInt(file.size, 10) / 1024).toFixed(0)} KB` : '--'}</span>
                      <div className="flex items-center gap-1">
                        {isFolder ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFolder(file);
                            }}
                            className="p-1 text-gray-400 hover:text-blue-400"
                            title="Open Folder"
                          >
                            <span className="material-symbols-outlined text-sm">arrow_forward</span>
                          </button>
                        ) : (
                          file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 text-gray-400 hover:text-white"
                              title="Open in Google Drive"
                            >
                              <span className="material-symbols-outlined text-sm">open_in_new</span>
                            </a>
                          )
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTargetFile(file);
                          }}
                          className="p-1 text-gray-400 hover:text-red-400"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Inspector & Preview Pane */}
        {selectedFile && (
          <aside className="w-80 border-l border-[#21262d] bg-[#161b22] p-4 flex flex-col shrink-0 overflow-y-auto">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-400">
                  {selectedFile.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'description'}
                </span>
                <h3 className="text-sm font-semibold text-white truncate" title={selectedFile.name}>
                  {selectedFile.name}
                </h3>
              </div>

              <div className="p-3 bg-[#0d1117] rounded-xl border border-[#21262d] text-xs space-y-1.5 text-gray-400">
                <div className="flex justify-between">
                  <span>Type:</span>
                  <span className="text-gray-200 font-mono text-[10px] truncate max-w-[150px]">
                    {selectedFile.mimeType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Modified:</span>
                  <span className="text-gray-200">
                    {selectedFile.modifiedTime ? new Date(selectedFile.modifiedTime).toLocaleString() : '-'}
                  </span>
                </div>
                {selectedFile.size && (
                  <div className="flex justify-between">
                    <span>Size:</span>
                    <span className="text-gray-200">{(parseInt(selectedFile.size, 10) / 1024).toFixed(1)} KB</span>
                  </div>
                )}
              </div>

              {selectedFile.mimeType !== 'application/vnd.google-apps.folder' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
                    <span>File Preview</span>
                    {onLoadHtmlToBrowser && fileContentPreview && (
                      <button
                        onClick={() => onLoadHtmlToBrowser(fileContentPreview, selectedFile.name.replace(/\.[^/.]+$/, ''))}
                        className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-xs">rocket_launch</span>
                        <span>Open in Browser</span>
                      </button>
                    )}
                  </div>
                  <pre className="p-3 bg-[#0d1117] border border-[#21262d] rounded-xl text-[11px] text-gray-300 max-h-60 overflow-y-auto font-mono whitespace-pre-wrap">
                    {isLoadingContent ? 'Loading file content...' : fileContentPreview || 'No content preview available'}
                  </pre>
                </div>
              )}

              <div className="pt-2 flex flex-col gap-2">
                {selectedFile.webViewLink && (
                  <a
                    href={selectedFile.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold text-center flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    <span>Open in Drive</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTargetFile(selectedFile)}
                  className="w-full py-2 px-3 rounded-lg bg-red-950/60 hover:bg-red-900/80 border border-red-800 text-red-300 text-xs font-semibold text-center flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  <span>Delete File</span>
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Mandatory User Confirmation Dialog for File Deletion */}
      {deleteTargetFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4" role="alertdialog">
          <div className="bg-[#161b22] border border-red-500/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-950 border border-red-800 flex items-center justify-center text-red-400">
                <span className="material-symbols-outlined text-xl">delete_forever</span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Delete from Google Drive?</h3>
                <p className="text-xs text-gray-400">Permanent Action</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed bg-[#0d1117] p-3 rounded-lg border border-[#30363d]">
              Are you sure you want to permanently delete <strong>"{deleteTargetFile.name}"</strong>? This action cannot be undone.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTargetFile(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteFile}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-md flex items-center gap-1.5"
              >
                <span>{isDeleting ? 'Deleting...' : 'Confirm Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
