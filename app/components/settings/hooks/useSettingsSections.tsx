import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Cpu,
  Layers,
  Wrench,
  Cloud,
  Zap,
  GitBranch,
  Filter,
  Plug,
  Network,
  Palette,
  Database,
  Key,
  BarChart2,
  Bell,
  BookOpen,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { NavSectionItem } from '../types';
import { BREAKPOINTS } from '../../../lib/breakpoints';

export type RulesSkillsTabId = 'skills' | 'subagents' | 'commands' | 'rules';
export type ModelsTabId = 'models' | 'routing';

const NAV_COLLAPSED_WIDTH = 52;
const NAV_EXPANDED_MIN = 168;
const NAV_EXPANDED_MAX = 208;

export function useSettingsSections(activeSection: string) {
  const navRef = useRef<HTMLDivElement>(null);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('settings_nav_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [navWidthExpanded, setNavWidthExpanded] = useState(() => {
    try {
      const v = localStorage.getItem('settings_nav_width');
      const n = v ? Number.parseInt(v, 10) : 200;
      const parsed = Number.isFinite(n) ? n : 200;
      return Math.min(NAV_EXPANDED_MAX, Math.max(NAV_EXPANDED_MIN, parsed));
    } catch {
      return 200;
    }
  });
  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : navWidthExpanded;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= BREAKPOINTS.PHONE_MAX : false,
  );
  const [rulesSkillsTab, setRulesSkillsTab] = useState<RulesSkillsTabId>('rules');
  const [modelsTab, setModelsTab] = useState<ModelsTabId>('models');

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= BREAKPOINTS.PHONE_MAX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleNavCollapsed = () => {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('settings_nav_collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const onNavDragStart = (e: React.MouseEvent) => {
    if (navCollapsed) return;
    const startX = e.clientX;
    const startW = navWidthExpanded;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(
        NAV_EXPANDED_MIN,
        Math.min(NAV_EXPANDED_MAX, startW + ev.clientX - startX),
      );
      setNavWidthExpanded(w);
      try {
        localStorage.setItem('settings_nav_width', String(w));
      } catch {
        /* ignore */
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const menu = useMemo<NavSectionItem[]>(
    () => [
      { id: 'General', icon: <Settings2 size={14} /> },
      { id: 'Agents', icon: <Bot size={14} /> },
      { id: 'AI Models', icon: <Cpu size={14} /> },
      { id: 'Tools & MCP', icon: <Layers size={14} /> },
      { id: 'Rules & Skills', icon: <Wrench size={14} /> },
      { id: 'Workspace', icon: <Cloud size={14} /> },
      { id: 'Brand & Design', icon: <Sparkles size={14} /> },
      { id: 'Hooks', icon: <Zap size={14} /> },
      { id: 'GitHub', icon: <GitBranch size={14} /> },
      { id: 'Index Rules', icon: <Filter size={14} /> },
      { id: 'Integrations', icon: <Plug size={14} /> },
      { id: 'CI/CD', icon: <Zap size={14} /> },
      { id: 'Network', icon: <Network size={14} /> },
      { id: 'Themes', icon: <Palette size={14} /> },
      { id: 'Storage', icon: <Database size={14} /> },
      { id: 'Keys & Secrets', icon: <Key size={14} /> },
      { id: 'Plan & Usage', icon: <BarChart2 size={14} /> },
      { id: 'Notifications', icon: <Bell size={14} /> },
      { id: 'Docs', icon: <BookOpen size={14} /> },
    ],
    [],
  );

  return {
    activeSection,
    navRef,
    navWidth,
    navCollapsed,
    toggleNavCollapsed,
    onNavDragStart,
    isMobile,
    rulesSkillsTab,
    setRulesSkillsTab,
    modelsTab,
    setModelsTab,
    menu,
  };
}
