import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  initAuth,
  googleSignIn,
  logout,
} from '../../services/googleAuth';
import {
  listGmailMessages,
  getGmailMessage,
  listGmailLabels,
  sendGmailMessage,
  createGmailDraft,
  modifyGmailMessage,
  trashGmailMessage,
  deleteGmailMessage,
  getGmailProfile,
  GmailMessage,
  GmailLabel,
  GmailProfile,
} from '../../services/gmailService';
import { GoogleUser } from '../../services/googleAuth';

interface GmailWorkspaceProps {
  onOpenBrowser?: () => void;
}

export const GmailWorkspace: React.FC<GmailWorkspaceProps> = ({ onOpenBrowser }) => {
  // Auth state
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profile, setProfile] = useState<GmailProfile | null>(null);

  // Mailbox state
  const [activeFolder, setActiveFolder] = useState<string>('INBOX');
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Compose State
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [aiDraftPrompt, setAiDraftPrompt] = useState('');

  // AI Summary & Smart Reply State
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [smartReplies, setSmartReplies] = useState<string[]>([]);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);

  // Mandatory User Confirmation Dialog States
  const [pendingConfirmAction, setPendingConfirmAction] = useState<{
    type: 'send' | 'trash' | 'delete';
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);

  // Initialize auth
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

  // Fetch profile and labels on login
  useEffect(() => {
    if (token) {
      getGmailProfile()
        .then(setProfile)
        .catch(err => console.warn('Could not load Gmail profile:', err));

      listGmailLabels()
        .then(lbls => {
          setLabels(lbls);
          const inbox = lbls.find(l => l.id === 'INBOX');
          if (inbox && inbox.messagesUnread !== undefined) {
            setUnreadCount(inbox.messagesUnread);
          }
        })
        .catch(err => console.warn('Could not load labels:', err));
    }
  }, [token]);

  // Load message list for current folder / search
  const loadMessages = useCallback(async (pageToken?: string) => {
    if (!token) return;
    setIsLoadingMessages(true);
    try {
      const labelIds = activeFolder === 'ALL' ? undefined : [activeFolder];
      const res = await listGmailMessages({
        maxResults: 20,
        q: searchQuery.trim() || undefined,
        labelIds,
        pageToken,
      });

      setNextPageToken(res.nextPageToken);

      // Fetch message summaries in parallel
      const detailedMessages = await Promise.all(
        res.messages.map(async (m) => {
          try {
            return await getGmailMessage(m.id);
          } catch {
            return null;
          }
        })
      );

      const validMessages = detailedMessages.filter(Boolean) as GmailMessage[];
      setMessages(validMessages);

      if (validMessages.length > 0 && !selectedMessage) {
        setSelectedMessage(validMessages[0]);
      } else if (validMessages.length === 0) {
        setSelectedMessage(null);
      }
    } catch (err: any) {
      console.error('Failed to load Gmail messages:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [token, activeFolder, searchQuery]);

  useEffect(() => {
    if (token) {
      loadMessages();
    }
  }, [token, activeFolder, loadMessages]);

  // Handle select message
  const handleSelectMessage = async (msg: GmailMessage) => {
    setSelectedMessage(msg);
    setAiSummary(null);
    setSmartReplies([]);

    // If unread, mark as read
    if (msg.isUnread) {
      try {
        await modifyGmailMessage(msg.id, { removeLabelIds: ['UNREAD'] });
        setMessages(prev =>
          prev.map(m => (m.id === msg.id ? { ...m, isUnread: false } : m))
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.warn('Failed to mark message read:', err);
      }
    }
  };

  // Toggle star
  const handleToggleStar = async (msg: GmailMessage, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStarred = !msg.isStarred;
    try {
      await modifyGmailMessage(msg.id, {
        addLabelIds: newStarred ? ['STARRED'] : undefined,
        removeLabelIds: !newStarred ? ['STARRED'] : undefined,
      });
      setMessages(prev =>
        prev.map(m => (m.id === msg.id ? { ...m, isStarred: newStarred } : m))
      );
      if (selectedMessage?.id === msg.id) {
        setSelectedMessage(prev => (prev ? { ...prev, isStarred: newStarred } : null));
      }
    } catch (err) {
      console.error('Failed to toggle star:', err);
    }
  };

  // Google Sign In
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
      setAuthError(err.message || 'Google sign-in failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Sign Out
  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setMessages([]);
    setSelectedMessage(null);
  };

  // Prepare Send Email (Mandatory Confirmation)
  const promptSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeTo.trim()) {
      alert('Please enter at least one recipient email.');
      return;
    }

    setPendingConfirmAction({
      type: 'send',
      title: 'Send Email via Gmail?',
      message: `Are you sure you want to send this email to "${composeTo}" with subject "${composeSubject || '(No Subject)'}"?`,
      action: async () => {
        setIsSending(true);
        try {
          await sendGmailMessage({
            to: composeTo,
            cc: composeCc || undefined,
            subject: composeSubject,
            body: composeBody,
          });
          setIsComposing(false);
          setComposeTo('');
          setComposeCc('');
          setComposeSubject('');
          setComposeBody('');
          loadMessages();
        } catch (err: any) {
          alert(`Failed to send email: ${err.message}`);
        } finally {
          setIsSending(false);
          setPendingConfirmAction(null);
        }
      },
    });
  };

  // Prepare Move to Trash (Mandatory Confirmation)
  const promptTrashMessage = (msg: GmailMessage) => {
    setPendingConfirmAction({
      type: 'trash',
      title: 'Move Email to Trash?',
      message: `Are you sure you want to move the email "${msg.subject}" to Trash?`,
      action: async () => {
        try {
          await trashGmailMessage(msg.id);
          setMessages(prev => prev.filter(m => m.id !== msg.id));
          if (selectedMessage?.id === msg.id) {
            setSelectedMessage(null);
          }
        } catch (err: any) {
          alert(`Failed to move to trash: ${err.message}`);
        } finally {
          setPendingConfirmAction(null);
        }
      },
    });
  };

  // Reply trigger
  const handleReplyToMessage = (msg: GmailMessage) => {
    const sender = msg.from || '';
    const cleanSender = sender.includes('<')
      ? sender.split('<')[1].replace('>', '').trim()
      : sender.trim();

    setComposeTo(cleanSender);
    setComposeSubject(msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || ''}`);
    setComposeBody(`\n\n--- On ${msg.date || 'prior date'}, ${msg.from} wrote:\n> ${msg.snippet}`);
    setIsComposing(true);
  };

  // Gemini AI Draft Assistant
  const handleGenerateAiDraft = async () => {
    if (!aiDraftPrompt.trim()) return;
    setIsAiDrafting(true);
    try {
      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Draft a professional and clear email body based on the following instruction:\n"${aiDraftPrompt}". Output only the email text, no markdown meta tags.`,
          systemInstruction: 'You are an executive communication assistant drafting polished, helpful emails.',
        }),
      });
      const data = await res.json();
      if (data.text) {
        setComposeBody(data.text);
        setAiDraftPrompt('');
      }
    } catch (err) {
      console.warn('AI draft failed:', err);
    } finally {
      setIsAiDrafting(false);
    }
  };

  // Gemini AI Summarize Email
  const handleSummarizeEmail = async () => {
    if (!selectedMessage) return;
    setIsSummarizing(true);
    try {
      const content = selectedMessage.bodyPlain || selectedMessage.snippet;
      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Summarize the key points, action items, and urgency of the following email concisely in 3 bullet points:\n\nSubject: ${selectedMessage.subject}\nFrom: ${selectedMessage.from}\nBody: ${content}`,
          systemInstruction: 'You are an AI email briefing assistant. Provide fast, ultra-concise summaries.',
        }),
      });
      const data = await res.json();
      if (data.text) {
        setAiSummary(data.text);
      }
    } catch (err) {
      console.warn('AI summary failed:', err);
    } finally {
      setIsSummarizing(false);
    }
  };

  // Gemini AI Smart Replies
  const handleGenerateSmartReplies = async () => {
    if (!selectedMessage) return;
    setIsGeneratingReplies(true);
    try {
      const content = selectedMessage.bodyPlain || selectedMessage.snippet;
      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Based on this email, provide 3 short, realistic 1-sentence reply options (e.g. affirmative, clarifying, polite decline):\n\nSubject: ${selectedMessage.subject}\nFrom: ${selectedMessage.from}\nBody: ${content}\n\nReturn ONLY a JSON array of 3 strings: ["Reply 1", "Reply 2", "Reply 3"]`,
          systemInstruction: 'Respond only with a raw JSON array of 3 smart reply strings.',
        }),
      });
      const data = await res.json();
      try {
        const cleaned = data.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) setSmartReplies(parsed);
      } catch {
        setSmartReplies([
          'Thanks for the update! Looks good to me.',
          'Could you clarify the timeline on this?',
          'Received, I will review and follow up shortly.',
        ]);
      }
    } catch (err) {
      console.warn('Smart replies error:', err);
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  // Unauthenticated Hero
  if (!token || !user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117] p-6">
        <div className="max-w-md w-full bg-[#161b22] border border-[#30363d] rounded-2xl p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 mx-auto bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center text-red-400">
            <span className="material-symbols-outlined text-4xl">mail</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Connect Your Gmail</h2>
            <p className="text-sm text-gray-400">
              Read messages, compose emails with Gemini AI drafting, manage labels, and search your inbox directly in Flash-Lite.
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
              id="btn-gmail-signin"
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
                  {isAuthenticating ? 'Authenticating with Google...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          </div>

          <div className="text-[11px] text-gray-500">
            Encrypted in-memory OAuth tokens. Google Workspace compliant.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-gray-200 overflow-hidden select-none">
      {/* Top Gmail App Bar */}
      <header className="h-14 border-b border-[#21262d] bg-[#161b22] px-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-400">
            <span className="material-symbols-outlined text-lg">mail</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white flex items-center gap-2">
              Gmail Workspace
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800">
                Official API
              </span>
            </h1>
            <p className="text-[11px] text-gray-400">
              {profile?.emailAddress || user.email}
            </p>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadMessages();
            }}
            className="relative flex items-center"
          >
            <span className="material-symbols-outlined absolute left-3 text-gray-400 text-sm">search</span>
            <input
              type="text"
              placeholder="Search mail (e.g. from:support, is:unread, has:attachment)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-8 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-400 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  loadMessages();
                }}
                className="absolute right-2.5 text-gray-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </form>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadMessages()}
            className="p-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white transition-colors"
            title="Refresh Inbox"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
          </button>

          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-xs text-gray-300 hover:text-white flex items-center gap-1.5 transition-colors"
            title="Sign out of Google"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main 3-Column Email Shell Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar (Folders & Compose) */}
        <aside className="w-56 border-r border-[#21262d] bg-[#161b22]/70 p-3 flex flex-col gap-2 shrink-0">
          {/* Compose Button */}
          <button
            onClick={() => setIsComposing(true)}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg transition-all"
          >
            <span className="material-symbols-outlined text-base">edit</span>
            <span>Compose</span>
          </button>

          {/* Folder Navigation List */}
          <nav className="mt-2 space-y-1 overflow-y-auto flex-1">
            {[
              { id: 'INBOX', label: 'Inbox', icon: 'inbox', badge: unreadCount },
              { id: 'STARRED', label: 'Starred', icon: 'star' },
              { id: 'SENT', label: 'Sent', icon: 'send' },
              { id: 'DRAFT', label: 'Drafts', icon: 'drafts' },
              { id: 'TRASH', label: 'Trash', icon: 'delete' },
              { id: 'SPAM', label: 'Spam', icon: 'report' },
              { id: 'ALL', label: 'All Mail', icon: 'mark_as_unread' },
            ].map((folder) => {
              const isActive = activeFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  onClick={() => {
                    setActiveFolder(folder.id);
                    setSelectedMessage(null);
                  }}
                  className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                    isActive
                      ? 'bg-red-500/15 text-red-400 font-semibold border border-red-500/30'
                      : 'text-gray-400 hover:bg-[#21262d] hover:text-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className="material-symbols-outlined text-base">{folder.icon}</span>
                    <span className="truncate">{folder.label}</span>
                  </div>
                  {folder.badge && folder.badge > 0 ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white">
                      {folder.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Quick Storage/Profile pill */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-[#21262d] text-[11px] text-gray-400 space-y-1">
            <div className="flex justify-between items-center text-gray-300 font-medium">
              <span>Gmail Status</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div>{profile?.messagesTotal ? `${profile.messagesTotal.toLocaleString()} total messages` : 'Synced with Google'}</div>
          </div>
        </aside>

        {/* Middle Column: Messages List */}
        <section className="w-80 md:w-96 border-r border-[#21262d] bg-[#0d1117] flex flex-col shrink-0">
          <div className="p-3 border-b border-[#21262d] flex items-center justify-between text-xs text-gray-400">
            <span className="font-semibold text-white uppercase tracking-wider text-[11px]">
              {activeFolder}
            </span>
            <span>{messages.length} messages</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#21262d]">
            {isLoadingMessages ? (
              <div className="p-8 text-center text-gray-500 text-xs space-y-2">
                <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p>Loading emails...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-xs space-y-2">
                <span className="material-symbols-outlined text-3xl text-gray-600">inbox</span>
                <p>No messages found in this view</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isSelected = selectedMessage?.id === msg.id;
                return (
                  <div
                    key={msg.id}
                    onClick={() => handleSelectMessage(msg)}
                    className={`p-3 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-red-950/25 border-l-4 border-l-red-500'
                        : msg.isUnread
                        ? 'bg-[#161b22]/90 hover:bg-[#1f242c]'
                        : 'hover:bg-[#161b22]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 truncate">
                        <button
                          type="button"
                          onClick={(e) => handleToggleStar(msg, e)}
                          className={`text-sm ${msg.isStarred ? 'text-amber-400' : 'text-gray-600 hover:text-gray-400'}`}
                        >
                          <span className="material-symbols-outlined text-sm">
                            {msg.isStarred ? 'star' : 'star_border'}
                          </span>
                        </button>
                        <span
                          className={`truncate text-xs ${
                            msg.isUnread ? 'font-bold text-white' : 'text-gray-300 font-medium'
                          }`}
                        >
                          {msg.from?.split('<')[0]?.replace(/"/g, '') || msg.from}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {msg.date ? new Date(msg.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                      </span>
                    </div>

                    <div className={`text-xs truncate mb-1 ${msg.isUnread ? 'font-semibold text-gray-100' : 'text-gray-400'}`}>
                      {msg.subject || '(No Subject)'}
                    </div>

                    <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">
                      {msg.snippet}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Message Reading Pane & Gemini AI Copilot */}
        <main className="flex-1 flex flex-col bg-[#161b22] overflow-hidden">
          {selectedMessage ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Message Header & Action Toolbar */}
              <div className="p-4 border-b border-[#21262d] bg-[#161b22] flex items-center justify-between gap-4 shrink-0">
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-white truncate">
                    {selectedMessage.subject || '(No Subject)'}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                    <span className="font-medium text-gray-300">{selectedMessage.from}</span>
                    <span>•</span>
                    <span>To: {selectedMessage.to || 'me'}</span>
                    <span>•</span>
                    <span>{selectedMessage.date}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleReplyToMessage(selectedMessage)}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <span className="material-symbols-outlined text-sm">reply</span>
                    <span>Reply</span>
                  </button>

                  <button
                    onClick={() => promptTrashMessage(selectedMessage)}
                    className="p-1.5 rounded-lg bg-[#21262d] hover:bg-red-950/60 hover:text-red-400 text-gray-400 transition-colors"
                    title="Move to Trash"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              </div>

              {/* Gemini AI Briefing Strip */}
              <div className="px-4 py-2.5 bg-[#0d1117] border-b border-[#21262d] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sky-400 text-base">auto_awesome</span>
                  <span className="text-xs font-semibold text-gray-200">Gemini Email Intelligence</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSummarizeEmail}
                    disabled={isSummarizing}
                    className="px-2.5 py-1 rounded bg-sky-950 border border-sky-800/60 text-sky-300 hover:bg-sky-900/60 text-xs font-medium flex items-center gap-1 transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs">summarize</span>
                    <span>{isSummarizing ? 'Summarizing...' : 'Summarize Email'}</span>
                  </button>

                  <button
                    onClick={handleGenerateSmartReplies}
                    disabled={isGeneratingReplies}
                    className="px-2.5 py-1 rounded bg-purple-950 border border-purple-800/60 text-purple-300 hover:bg-purple-900/60 text-xs font-medium flex items-center gap-1 transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs">quickreply</span>
                    <span>{isGeneratingReplies ? 'Generating...' : 'Smart Replies'}</span>
                  </button>
                </div>
              </div>

              {/* Display AI Summary if generated */}
              {aiSummary && (
                <div className="mx-4 mt-3 p-3 bg-sky-950/30 border border-sky-800/60 rounded-xl text-xs text-sky-200 space-y-1.5 shrink-0">
                  <div className="font-semibold flex items-center gap-1.5 text-sky-300">
                    <span className="material-symbols-outlined text-sm">psychology</span>
                    <span>Executive Summary:</span>
                  </div>
                  <div className="whitespace-pre-line leading-relaxed text-sky-100">{aiSummary}</div>
                </div>
              )}

              {/* Display Smart Replies chips if generated */}
              {smartReplies.length > 0 && (
                <div className="mx-4 mt-3 flex flex-wrap gap-2 shrink-0">
                  {smartReplies.map((reply, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        handleReplyToMessage(selectedMessage);
                        setComposeBody(reply);
                      }}
                      className="px-3 py-1.5 bg-purple-950/40 border border-purple-800/60 hover:bg-purple-900/60 text-purple-200 rounded-lg text-xs text-left transition-all hover:scale-[1.01]"
                    >
                      💬 "{reply}"
                    </button>
                  ))}
                </div>
              )}

              {/* Message Body Content */}
              <div className="flex-1 p-6 overflow-y-auto">
                {selectedMessage.bodyHtml ? (
                  <div
                    className="prose prose-invert max-w-none text-xs text-gray-200 bg-white/5 p-4 rounded-xl border border-[#21262d]"
                    dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-200 leading-relaxed bg-[#0d1117] p-4 rounded-xl border border-[#21262d]">
                    {selectedMessage.bodyPlain || selectedMessage.snippet}
                  </pre>
                )}

                {/* Attachments Section */}
                {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                  <div className="mt-6 border-t border-[#21262d] pt-4">
                    <div className="text-xs font-semibold text-gray-400 mb-2">Attachments ({selectedMessage.attachments.length})</div>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedMessage.attachments.map((att) => (
                        <div
                          key={att.attachmentId}
                          className="p-2.5 rounded-lg bg-[#0d1117] border border-[#21262d] flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="material-symbols-outlined text-gray-400">attachment</span>
                            <span className="truncate text-gray-200">{att.filename}</span>
                          </div>
                          <span className="text-[10px] text-gray-500">{(att.size / 1024).toFixed(0)} KB</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
              <div className="text-center space-y-2">
                <span className="material-symbols-outlined text-4xl text-gray-600">mark_email_read</span>
                <p>Select an email from the left to read and interact</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating / In-Page Compose Modal */}
      {isComposing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-3 border-b border-[#30363d] bg-[#1c2128] flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="material-symbols-outlined text-red-400">mail</span>
                <span>New Message</span>
              </div>
              <button
                onClick={() => setIsComposing(false)}
                className="text-gray-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={promptSendEmail} className="p-5 space-y-3 flex-1 flex flex-col overflow-y-auto">
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="To (e.g. colleague@company.com)"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-400"
                  required
                />

                <input
                  type="text"
                  placeholder="Subject"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-400 font-medium"
                />
              </div>

              {/* AI Draft Helper Box */}
              <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs text-sky-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                    <span>Gemini AI Drafting Assistant</span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Write a friendly follow-up requesting a project update..."
                    value={aiDraftPrompt}
                    onChange={(e) => setAiDraftPrompt(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={handleGenerateAiDraft}
                    disabled={isAiDrafting || !aiDraftPrompt.trim()}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <span>{isAiDrafting ? 'Drafting...' : 'Generate'}</span>
                  </button>
                </div>
              </div>

              {/* Body Textarea */}
              <textarea
                placeholder="Compose your email here..."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={10}
                className="flex-1 w-full p-3 bg-[#0d1117] border border-[#30363d] rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-400 resize-none font-sans leading-relaxed"
                required
              />

              <div className="flex items-center justify-between pt-2 border-t border-[#30363d]">
                <span className="text-[11px] text-gray-400">Requires explicit confirmation before sending.</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsComposing(false)}
                    className="px-4 py-2 rounded-xl text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1.5 shadow-lg transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">send</span>
                    <span>Send Message</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mandatory User Confirmation Dialog */}
      {pendingConfirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4" role="alertdialog">
          <div className="bg-[#161b22] border border-red-500/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-950 border border-red-800 flex items-center justify-center text-red-400">
                <span className="material-symbols-outlined text-xl">
                  {pendingConfirmAction.type === 'send' ? 'send' : 'warning'}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{pendingConfirmAction.title}</h3>
                <p className="text-xs text-gray-400">Google Workspace Security Action</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed bg-[#0d1117] p-3 rounded-lg border border-[#30363d]">
              {pendingConfirmAction.message}
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingConfirmAction(null)}
                disabled={isSending}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => pendingConfirmAction.action()}
                disabled={isSending}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-md flex items-center gap-1.5"
              >
                <span>{isSending ? 'Executing...' : 'Confirm Action'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
