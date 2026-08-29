import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
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

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPageHtml?: string;
  currentPageTitle?: string;
  onLoadHtmlToBrowser?: (html: string, title: string) => void;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
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

  // Modals & Action States
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

  // Initialize auth state
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

  // Update default save filename when title changes
  useEffect(() => {
    if (currentPageTitle) {
      const cleanName = currentPageTitle.replace(/[/\\?%*:|"<>]/g, '-').trim();
      setSaveFileName(`${cleanName || 'Generated-Page'}.html`);
    } else {
      setSaveFileName('Generated-Page.html');
    }
  }, [currentPageTitle]);

  // Load files when folder, search, or filter changes
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
    if (isOpen && token) {
      loadFiles();
    }
  }, [isOpen, token, loadFiles]);

  // Handle Google Sign In
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
      console.error('Sign in failed:', err);
      setAuthError(err.message || 'Failed to sign in with Google');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Handle Sign Out
  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setFiles([]);
    setSelectedFile(null);
    setFileContentPreview(null);
  };

  // Navigate into folder
  const handleOpenFolder = (folder: DriveFileItem) => {
    setFolderHistory(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedFile(null);
    setFileContentPreview(null);
  };

  // Breadcrumb jump
  const handleNavigateBreadcrumb = (index: number) => {
    setFolderHistory(prev => prev.slice(0, index + 1));
    setSelectedFile(null);
    setFileContentPreview(null);
  };

  // Inspect or Preview File
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
    } catch (err) {
      setFileContentPreview('Preview not available for this file type.');
    } finally {
      setIsLoadingContent(false);
    }
  };

  // Save current active page to Google Drive
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

  // Create folder
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

  // File Upload via file input
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

  // Delete File with Confirmation
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

  // Load previewed HTML into Flash-Lite browser
  const handleLoadIntoBrowser = (file: DriveFileItem, content: string | null) => {
    if (!content || !onLoadHtmlToBrowser) return;
    onLoadHtmlToBrowser(content, file.name.replace(/\.[^/.]+$/, ''));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="drive-modal-backdrop" id="google-drive-modal-backdrop">
      <div className="drive-modal-container" id="google-drive-modal-container">
        {/* Modal Header */}
        <div className="drive-modal-header">
          <div className="drive-header-title-group">
            <div className="drive-brand-icon">
              <svg width="24" height="24" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
              </svg>
            </div>
            <div>
              <h2 className="drive-header-title">Google Drive Workspace</h2>
              <p className="drive-header-subtitle">Browse, save AI websites, and manage your Google Drive files</p>
            </div>
          </div>

          {/* User Profile / Status */}
          <div className="drive-header-user-group">
            {user ? (
              <div className="drive-user-pill">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || 'User'} className="drive-user-avatar" />
                ) : (
                  <div className="drive-user-avatar-fallback">{user.email?.[0]?.toUpperCase() || 'U'}</div>
                )}
                <div className="drive-user-info">
                  <span className="drive-user-name">{user.displayName || user.email?.split('@')[0]}</span>
                  <span className="drive-user-email">{user.email}</span>
                </div>
                <button
                  type="button"
                  className="drive-signout-btn"
                  onClick={handleSignOut}
                  title="Sign out of Google"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
                </button>
              </div>
            ) : null}

            <button
              type="button"
              className="drive-modal-close-btn"
              onClick={onClose}
              title="Close modal"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* Modal Content */}
        {!user || !token ? (
          /* Unauthenticated State */
          <div className="drive-auth-hero" id="drive-auth-hero">
            <div className="drive-auth-card">
              <div className="drive-auth-icon-cluster">
                <svg width="48" height="48" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                  <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                  <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                  <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                  <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                </svg>
              </div>
              <h3 className="drive-auth-title">Connect your Google Drive</h3>
              <p className="drive-auth-desc">
                Sign in to view files, browse documents, and save AI-generated web applications directly to your Google Drive.
              </p>

              {authError && (
                <div className="drive-auth-error">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>error</span>
                  <span>{authError}</span>
                </div>
              )}

              {/* Official Google GSI Sign In Button */}
              <button
                id="btn-google-drive-signin"
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
        ) : (
          /* Authenticated Explorer Dashboard */
          <div className="drive-explorer-body">
            {/* Quick Actions Bar (Save page to Drive, New Folder, Upload) */}
            <div className="drive-actions-toolbar">
              {currentPageHtml && (
                <div className="drive-save-page-strip">
                  <span className="material-symbols-outlined" style={{ color: '#8ab4f8', fontSize: '20px' }}>
                    cloud_upload
                  </span>
                  <div className="drive-save-input-group">
                    <span className="drive-save-label">Save Current Website:</span>
                    <input
                      type="text"
                      className="drive-save-input"
                      value={saveFileName}
                      onChange={(e) => setSaveFileName(e.target.value)}
                      placeholder="filename.html"
                    />
                  </div>
                  <button
                    id="btn-drive-save-current-page"
                    type="button"
                    className="drive-btn-primary"
                    onClick={handleSavePageToDrive}
                    disabled={isSavingCurrentPage}
                  >
                    {isSavingCurrentPage ? 'Saving...' : 'Save to Drive'}
                  </button>
                  {saveSuccessMsg && (
                    <span className="drive-success-badge">{saveSuccessMsg}</span>
                  )}
                </div>
              )}

              <div className="drive-top-buttons-row">
                {/* Search Bar */}
                <div className="drive-search-wrapper">
                  <span className="material-symbols-outlined drive-search-icon">search</span>
                  <input
                    type="text"
                    className="drive-search-input"
                    placeholder="Search in Google Drive..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      className="drive-search-clear"
                      onClick={() => setSearchTerm('')}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                    </button>
                  )}
                </div>

                {/* New Folder & Upload Triggers */}
                <div className="drive-btn-group">
                  <button
                    type="button"
                    className="drive-btn-secondary"
                    onClick={() => setIsCreatingFolder(true)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>create_new_folder</span>
                    <span>New Folder</span>
                  </button>

                  <label className="drive-btn-secondary" style={{ cursor: 'pointer' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
                    <span>{isUploading ? 'Uploading...' : 'Upload File'}</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                  </label>

                  <button
                    type="button"
                    className="drive-btn-secondary"
                    onClick={loadFiles}
                    title="Refresh files"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>refresh</span>
                  </button>
                </div>
              </div>

              {/* Breadcrumbs & Category Filter Chips */}
              <div className="drive-nav-filter-strip">
                {/* Breadcrumbs */}
                <div className="drive-breadcrumbs">
                  {folderHistory.map((crumb, idx) => (
                    <React.Fragment key={crumb.id}>
                      {idx > 0 && <span className="drive-crumb-sep">/</span>}
                      <button
                        type="button"
                        className={`drive-crumb-btn ${idx === folderHistory.length - 1 ? 'active' : ''}`}
                        onClick={() => handleNavigateBreadcrumb(idx)}
                      >
                        {idx === 0 && <span className="material-symbols-outlined" style={{ fontSize: '16px', marginRight: '4px' }}>folder_shared</span>}
                        {crumb.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>

                {/* Filter Chips */}
                <div className="drive-filter-chips">
                  {[
                    { id: 'all', label: 'All Files' },
                    { id: 'folder', label: 'Folders' },
                    { id: 'document', label: 'Docs & Text' },
                    { id: 'spreadsheet', label: 'Sheets' },
                    { id: 'presentation', label: 'Slides' },
                    { id: 'image', label: 'Images' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={`drive-filter-chip ${filterType === filter.id ? 'active' : ''}`}
                      onClick={() => setFilterType(filter.id)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Folder creation inline form */}
            {isCreatingFolder && (
              <form onSubmit={handleCreateFolder} className="drive-inline-create-folder">
                <span className="material-symbols-outlined" style={{ color: '#8ab4f8' }}>folder</span>
                <input
                  type="text"
                  className="drive-folder-input"
                  placeholder="New folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="drive-btn-primary">Create</button>
                <button
                  type="button"
                  className="drive-btn-secondary"
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setNewFolderName('');
                  }}
                >
                  Cancel
                </button>
              </form>
            )}

            {/* Split View: File Grid/List + Preview Inspector */}
            <div className="drive-split-view">
              {/* Files Table / Grid */}
              <div className="drive-file-list-pane">
                {isLoadingFiles ? (
                  <div className="drive-loading-state">
                    <div className="drive-spinner" />
                    <span>Loading Google Drive files...</span>
                  </div>
                ) : files.length === 0 ? (
                  <div className="drive-empty-state">
                    <span className="material-symbols-outlined" style={{ fontSize: '42px', color: '#5f6368' }}>
                      folder_open
                    </span>
                    <p>No files found in this folder</p>
                  </div>
                ) : (
                  <div className="drive-files-table-container">
                    <table className="drive-files-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Modified</th>
                          <th>Size</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((file) => {
                          const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                          const isSelected = selectedFile?.id === file.id;

                          return (
                            <tr
                              key={file.id}
                              className={`drive-file-row ${isSelected ? 'selected' : ''}`}
                              onClick={() => handleSelectFile(file)}
                              onDoubleClick={() => {
                                if (isFolder) {
                                  handleOpenFolder(file);
                                } else if (file.webViewLink) {
                                  window.open(file.webViewLink, '_blank');
                                }
                              }}
                            >
                              <td className="drive-file-name-cell">
                                <span className="material-symbols-outlined drive-file-icon">
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
                                <span className="drive-file-title" title={file.name}>{file.name}</span>
                              </td>
                              <td className="drive-file-modified-cell">
                                {file.modifiedTime
                                  ? new Date(file.modifiedTime).toLocaleDateString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    })
                                  : '-'}
                              </td>
                              <td className="drive-file-size-cell">
                                {isFolder
                                  ? '--'
                                  : file.size
                                  ? `${(parseInt(file.size, 10) / 1024).toFixed(1)} KB`
                                  : '--'}
                              </td>
                              <td className="drive-file-actions-cell" onClick={(e) => e.stopPropagation()}>
                                {isFolder ? (
                                  <button
                                    type="button"
                                    className="drive-row-action-btn"
                                    onClick={() => handleOpenFolder(file)}
                                    title="Open folder"
                                  >
                                    <span className="material-symbols-outlined">folder_open</span>
                                  </button>
                                ) : (
                                  file.webViewLink && (
                                    <a
                                      href={file.webViewLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="drive-row-action-btn"
                                      title="Open in Google Drive"
                                    >
                                      <span className="material-symbols-outlined">open_in_new</span>
                                    </a>
                                  )
                                )}
                                <button
                                  type="button"
                                  className="drive-row-action-btn delete-btn"
                                  onClick={() => setDeleteTargetFile(file)}
                                  title="Delete from Drive"
                                >
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Inspector / Preview Pane */}
              <div className="drive-preview-pane">
                {selectedFile ? (
                  <div className="drive-inspector-card">
                    <div className="drive-inspector-header">
                      <span className="material-symbols-outlined" style={{ fontSize: '28px', color: '#8ab4f8' }}>
                        {selectedFile.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'description'}
                      </span>
                      <div className="drive-inspector-title-group">
                        <h4 className="drive-inspector-name" title={selectedFile.name}>{selectedFile.name}</h4>
                        <span className="drive-inspector-mime">{selectedFile.mimeType}</span>
                      </div>
                    </div>

                    <div className="drive-inspector-meta">
                      <div className="drive-meta-item">
                        <span className="drive-meta-label">Modified:</span>
                        <span>{selectedFile.modifiedTime ? new Date(selectedFile.modifiedTime).toLocaleString() : '-'}</span>
                      </div>
                      {selectedFile.size && (
                        <div className="drive-meta-item">
                          <span className="drive-meta-label">Size:</span>
                          <span>{(parseInt(selectedFile.size, 10) / 1024).toFixed(1)} KB</span>
                        </div>
                      )}
                      {selectedFile.owners?.[0] && (
                        <div className="drive-meta-item">
                          <span className="drive-meta-label">Owner:</span>
                          <span>{selectedFile.owners[0].displayName || selectedFile.owners[0].emailAddress}</span>
                        </div>
                      )}
                    </div>

                    {/* Preview Box */}
                    {selectedFile.mimeType !== 'application/vnd.google-apps.folder' && (
                      <div className="drive-preview-box">
                        <div className="drive-preview-title-bar">
                          <span>File Content Preview</span>
                          {onLoadHtmlToBrowser && fileContentPreview && (
                            <button
                              type="button"
                              className="drive-load-into-app-btn"
                              onClick={() => handleLoadIntoBrowser(selectedFile, fileContentPreview)}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>rocket_launch</span>
                              <span>Open in Browser</span>
                            </button>
                          )}
                        </div>
                        {isLoadingContent ? (
                          <div className="drive-preview-loading">Loading content...</div>
                        ) : (
                          <pre className="drive-preview-code">
                            {fileContentPreview || 'No content preview available'}
                          </pre>
                        )}
                      </div>
                    )}

                    <div className="drive-inspector-actions">
                      {selectedFile.webViewLink && (
                        <a
                          href={selectedFile.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="drive-btn-primary"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_new</span>
                          <span>Open in Google</span>
                        </a>
                      )}
                      <button
                        type="button"
                        className="drive-btn-danger"
                        onClick={() => setDeleteTargetFile(selectedFile)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="drive-inspector-placeholder">
                    <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#5f6368' }}>
                      info
                    </span>
                    <p>Select a file to view details and live preview</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Mandatory User Confirmation Dialog for Destructive Operations */}
        {deleteTargetFile && (
          <div className="drive-dialog-backdrop" role="alertdialog" aria-modal="true">
            <div className="drive-dialog-card">
              <div className="drive-dialog-icon">
                <span className="material-symbols-outlined" style={{ color: '#ea4335', fontSize: '32px' }}>
                  warning
                </span>
              </div>
              <h3 className="drive-dialog-title">Delete from Google Drive?</h3>
              <p className="drive-dialog-desc">
                Are you sure you want to permanently delete <strong>"{deleteTargetFile.name}"</strong> from your Google Drive? This action cannot be undone.
              </p>
              <div className="drive-dialog-btn-row">
                <button
                  type="button"
                  className="drive-btn-secondary"
                  onClick={() => setDeleteTargetFile(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete-drive-file"
                  type="button"
                  className="drive-btn-danger-solid"
                  onClick={confirmDeleteFile}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
