/**
 * Shared activity-rail destinations (desktop rail + mobile drawer).
 */
import type { ComponentType, FC } from 'react';
import {
  BarChart2,
  Bot,
  Camera,
  ChartColumnIncreasing,
  Database,
  GraduationCap,
  Home,
  Image,
  Library,
  Mail,
  Network,
  Palette,
  Rocket,
  Settings,
  Wrench,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AGENT_HOME_PATH,
  isAgentShellPath,
} from '../../lib/agentRoutes';

export type ActivityRailItemProps = {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  expanded: boolean;
  active: boolean;
  onClick: () => void;
};

export const ActivityRailItem: FC<ActivityRailItemProps> = ({
  icon: Icon,
  label,
  expanded,
  active,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={`relative flex w-full min-h-[40px] shrink-0 items-center rounded-lg transition-colors ${
      expanded ? 'gap-2.5 px-2 justify-start' : 'justify-center px-0'
    } ${active ? 'text-main' : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/60'}`}
  >
    {active ? (
      <div
        className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-md bg-[var(--solar-cyan)]"
        aria-hidden
      />
    ) : null}
    <Icon size={expanded ? 20 : 18} strokeWidth={1} className="shrink-0" />
    {expanded ? (
      <span className="min-w-0 truncate text-left text-[12px] font-medium leading-tight">{label}</span>
    ) : null}
  </button>
);

type DashboardActivityNavProps = {
  expanded: boolean;
  settingsIntegrationsActive: boolean;
  onItemActivate?: () => void;
};

export function DashboardActivityNav({
  expanded,
  settingsIntegrationsActive,
  onItemActivate,
}: DashboardActivityNavProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const go = (path: string) => {
    navigate(path);
    onItemActivate?.();
  };

  return (
    <>
      <ActivityRailItem
        icon={Bot}
        label="Agent"
        expanded={expanded}
        active={isAgentShellPath(location.pathname)}
        onClick={() => go(AGENT_HOME_PATH)}
      />
      <ActivityRailItem
        icon={Home}
        label="Overview"
        expanded={expanded}
        active={location.pathname === '/dashboard/overview'}
        onClick={() => go('/dashboard/overview')}
      />
      <ActivityRailItem
        icon={BarChart2}
        label="Finance"
        expanded={expanded}
        active={location.pathname === '/dashboard/finance'}
        onClick={() => go('/dashboard/finance')}
      />
      <ActivityRailItem
        icon={Library}
        label="Library"
        expanded={expanded}
        active={location.pathname === '/dashboard/library'}
        onClick={() => go('/dashboard/library')}
      />
      <ActivityRailItem
        icon={ChartColumnIncreasing}
        label="Analytics"
        expanded={expanded}
        active={location.pathname.startsWith('/dashboard/analytics')}
        onClick={() => go('/dashboard/analytics')}
      />
      <ActivityRailItem
        icon={Network}
        label="Workflows"
        expanded={expanded}
        active={location.pathname === '/dashboard/workflows'}
        onClick={() => go('/dashboard/workflows')}
      />
      <ActivityRailItem
        icon={Rocket}
        label="Launch Desk"
        expanded={expanded}
        active={location.pathname === '/dashboard/launch-desk'}
        onClick={() => go('/dashboard/launch-desk')}
      />
      <ActivityRailItem
        icon={GraduationCap}
        label="Learn"
        expanded={expanded}
        active={location.pathname === '/dashboard/learn'}
        onClick={() => go('/dashboard/learn')}
      />
      <ActivityRailItem
        icon={Palette}
        label="Design Studio"
        expanded={expanded}
        active={location.pathname === '/dashboard/designstudio'}
        onClick={() => go('/dashboard/designstudio')}
      />
      <ActivityRailItem
        icon={Wrench}
        label="Integrations"
        expanded={expanded}
        active={settingsIntegrationsActive}
        onClick={() => go('/dashboard/settings/integrations')}
      />
      <ActivityRailItem
        icon={Database}
        label="D1 Explorer"
        expanded={expanded}
        active={location.pathname.startsWith('/dashboard/database')}
        onClick={() => go('/dashboard/database')}
      />
      <ActivityRailItem
        icon={Camera}
        label="Meet"
        expanded={expanded}
        active={location.pathname === '/dashboard/meet'}
        onClick={() => go('/dashboard/meet')}
      />
      <ActivityRailItem
        icon={Image}
        label="Images"
        expanded={expanded}
        active={location.pathname === '/dashboard/images' || location.pathname.startsWith('/dashboard/images/')}
        onClick={() => go('/dashboard/images/storage')}
      />
      <ActivityRailItem
        icon={Mail}
        label="Mail"
        expanded={expanded}
        active={location.pathname === '/dashboard/mail'}
        onClick={() => go('/dashboard/mail')}
      />
      <ActivityRailItem
        icon={Settings}
        label="Settings"
        expanded={expanded}
        active={location.pathname.startsWith('/dashboard/settings')}
        onClick={() => go('/dashboard/settings/general')}
      />
    </>
  );
}
