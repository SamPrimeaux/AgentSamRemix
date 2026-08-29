import React from 'react';
import { IAMUser } from '../../sdk/types';
import { WorkbenchViewTab } from '../WorkbenchApp';

interface MobileNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: WorkbenchViewTab;
  onSelectTab: (tab: WorkbenchViewTab) => void;
  user: IAMUser;
  onLogout: () => void;
  selectedRepo: string;
  isDarkTheme?: boolean;
  onToggleTheme?: () => void;
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  user,
  onLogout,
  selectedRepo,
  isDarkTheme = true,
  onToggleTheme,
}) => {
  if (!isOpen) return null;

  const navItems: { id: WorkbenchViewTab; label: string; icon: string; badge?: string }[] = [
    { id: 'mission', label: 'Mission & Timeline', icon: 'rocket_launch', badge: 'Active' },
    { id: 'repository', label: 'Repo Intelligence', icon: 'travel_explore' },
    { id: 'code', label: 'Code Workspace', icon: 'code' },
    { id: 'browser', label: 'Browser Verifier', icon: 'devices' },
    { id: 'self_hosting', label: 'Self-Hosting Studio', icon: 'hub' },
    { id: 'receipts', label: 'Receipts & Ledger', icon: 'fact_check' },
    { id: 'settings', label: 'Settings & Security', icon: 'settings' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer Container */}
      <div
        className={`relative w-4/5 max-w-xs h-full flex flex-col z-10 shadow-2xl transition-transform animate-in slide-in-from-left duration-200 ${
          isDarkTheme ? 'bg-[#0f1117] text-zinc-100 border-r border-zinc-800' : 'bg-white text-zinc-900 border-r border-zinc-200'
        }`}
      >
        {/* Drawer Header with Brand & User */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkTheme ? 'border-zinc-800 bg-zinc-950/40' : 'border-zinc-100 bg-zinc-50'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center text-white font-bold text-sm shadow-md">
              S
            </div>
            <div>
              <h2 className="font-bold text-sm tracking-tight leading-none">Agent Sam</h2>
              <span className="text-[10px] text-emerald-500 font-medium">● Connected to SDK</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg ${isDarkTheme ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* User Card */}
        <div className={`p-3.5 mx-3 mt-3 rounded-2xl border ${isDarkTheme ? 'bg-zinc-900/80 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
          <div className="flex items-center gap-2.5">
            <img
              src={user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}
              alt={user.name}
              className="w-9 h-9 rounded-full object-cover border border-zinc-700/40"
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold truncate leading-tight">{user.name}</p>
              <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-bold uppercase">
              {user.role}
            </span>
          </div>
          <div className="mt-2.5 pt-2 border-t border-zinc-800/40 flex items-center justify-between text-[11px] text-zinc-400">
            <span className="truncate font-mono text-[10px]">{selectedRepo}</span>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="p-3 flex-1 overflow-y-auto space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-3 py-1">
            Workbench Navigation
          </p>
          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? isDarkTheme
                      ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                      : 'bg-sky-50 text-sky-600 border border-sky-200'
                    : isDarkTheme
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className={`p-3 border-t space-y-2 ${isDarkTheme ? 'border-zinc-800 bg-zinc-950/40' : 'border-zinc-100 bg-zinc-50'}`}>
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium border ${
                isDarkTheme ? 'border-zinc-800 hover:bg-zinc-800 text-zinc-300' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">
                  {isDarkTheme ? 'light_mode' : 'dark_mode'}
                </span>
                <span>{isDarkTheme ? 'Switch to Light Spec' : 'Switch to Dark Spec'}</span>
              </div>
              <span className="text-[10px] text-zinc-500">Screenshot Match</span>
            </button>
          )}

          <button
            onClick={() => {
              onLogout();
              onClose();
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors`}
          >
            <span className="material-symbols-outlined text-base">logout</span>
            <span>Sign Out Operator</span>
          </button>
        </div>
      </div>
    </div>
  );
};
