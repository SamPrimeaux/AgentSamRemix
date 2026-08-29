import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Mail, UserPlus, X } from 'lucide-react';
import './ProjectShareModal.css';
import {
  fetchProjectCollaborators,
  inviteProjectCollaborator,
  removeProjectCollaborator,
  shareProject,
  type ProjectCollaborator,
} from '../../client-api/projects';

export type ProjectShareTarget = {
  id: string;
  name: string;
};

type Props = {
  project: ProjectShareTarget | null;
  onClose: () => void;
  onToast: (msg: string) => void;
};

export function ProjectShareModal({ project, onClose, onToast }: Props) {
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [collaborators, setCollaborators] = useState<ProjectCollaborator[]>([]);
  const [loadingCollab, setLoadingCollab] = useState(false);

  const loadCollaborators = useCallback(async () => {
    if (!project?.id) return;
    setLoadingCollab(true);
    try {
      const res = await fetchProjectCollaborators(project.id);
      if (res.ok) setCollaborators(res.collaborators);
    } finally {
      setLoadingCollab(false);
    }
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    const url = `${window.location.origin}/dashboard/projects/${encodeURIComponent(project.id)}`;
    setShareUrl(url);
    setCopied(false);
    setEmailInput('');
    setMessage('');
    void loadCollaborators();
  }, [project, loadCollaborators]);

  if (!project) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      onToast('Link copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast(shareUrl);
    }
  };

  const sendInvite = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes('@') || busy) return;
    setBusy(true);
    try {
      const res = await shareProject(project.id, { email, message, role });
      if (!res.ok) {
        onToast(res.error || 'Share failed');
        return;
      }
      if (res.email_errors?.length) {
        onToast(`Invited with warnings: ${res.email_errors.map((e) => e.email).join(', ')}`);
      } else {
        onToast(`Invitation sent to ${email}`);
      }
      setEmailInput('');
      setCollaborators(res.collaborators ?? []);
    } finally {
      setBusy(false);
    }
  };

  const addCollaboratorOnly = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes('@') || busy) return;
    setBusy(true);
    try {
      const res = await inviteProjectCollaborator(project.id, { email, role });
      if (!res.ok) {
        onToast(res.error || 'Could not add collaborator');
        return;
      }
      setEmailInput('');
      await loadCollaborators();
      onToast(`${email} added as ${role}`);
    } finally {
      setBusy(false);
    }
  };

  const removeCollab = async (c: ProjectCollaborator) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await removeProjectCollaborator(project.id, c.id);
      if (res.ok) {
        setCollaborators((prev) => prev.filter((x) => x.id !== c.id));
        onToast(`Removed ${c.email}`);
      } else {
        onToast(res.error || 'Remove failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proj-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="proj-modal proj-share-modal"
        role="dialog"
        aria-labelledby="proj-share-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="proj-share-header">
          <h2 id="proj-share-title" className="proj-modal-title">Share project</h2>
          <button type="button" className="proj-panel-close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="proj-modal-body">
          <strong>{project.name}</strong>
        </p>

        <label className="proj-share-label">Project link</label>
        <div className="proj-share-link-row">
          <input className="proj-create-input" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          <button type="button" className="proj-btn proj-btn--primary" onClick={() => void copyLink()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <label className="proj-share-label">Invite by email</label>
        <div className="proj-share-invite-row">
          <input
            type="email"
            className="proj-create-input"
            placeholder="teammate@company.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendInvite();
            }}
          />
          <select
            className="proj-sort-select"
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
            aria-label="Collaborator role"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <textarea
          className="proj-create-input proj-share-message"
          rows={3}
          placeholder="Optional message for the invite email…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="proj-create-actions">
          <button type="button" className="proj-btn proj-btn--primary" disabled={busy || !emailInput.trim()} onClick={() => void sendInvite()}>
            <Mail size={14} />
            {busy ? 'Sending…' : 'Send invite'}
          </button>
          <button type="button" className="proj-btn" disabled={busy || !emailInput.trim()} onClick={() => void addCollaboratorOnly()}>
            <UserPlus size={14} />
            Add without email
          </button>
        </div>

        <label className="proj-share-label">Collaborators</label>
        {loadingCollab ? (
          <p className="proj-modal-hint">Loading…</p>
        ) : collaborators.length === 0 ? (
          <p className="proj-modal-hint">No collaborators yet — invite teammates to collaborate on this build.</p>
        ) : (
          <ul className="proj-share-collab-list">
            {collaborators.map((c) => (
              <li key={c.id} className="proj-share-collab-item">
                <span>
                  {c.email}
                  <span className="proj-share-role">{c.role}</span>
                </span>
                <button type="button" className="proj-btn proj-btn--danger proj-share-remove" disabled={busy} onClick={() => void removeCollab(c)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
