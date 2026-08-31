import type { ComponentType, ReactNode } from 'react';
import { Sidebar } from '@cloudflare/kumo/components/sidebar';

export type AppSidebarItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  badge?: string;
};

export type AppSidebarGroup = {
  id: string;
  label?: string;
  items: AppSidebarItem[];
};

export type AppSidebarProps = {
  groups: AppSidebarGroup[];
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  resizable?: boolean;
  peekable?: boolean;
  className?: string;
};

export function AppSidebar({
  groups,
  header,
  footer,
  children,
  defaultOpen = true,
  resizable = true,
  peekable = true,
  className = '',
}: AppSidebarProps) {
  return (
    <Sidebar.Provider
      defaultOpen={defaultOpen}
      collapsible="icon"
      resizable={resizable}
      defaultWidth={240}
      minWidth={196}
      maxWidth={360}
      peekable={peekable}
      mobileBreakpoint={760}
      className={`min-h-0 ${className}`.trim()}
    >
      <Sidebar fullScreenOnMobile>
        {header ? <Sidebar.Header>{header}</Sidebar.Header> : null}
        <Sidebar.Content>
          {groups.map((group) => (
            <Sidebar.Group key={group.id}>
              {group.label ? <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel> : null}
              <Sidebar.Menu>
                {group.items.map((item) => (
                  <Sidebar.MenuButton
                    key={item.id}
                    icon={item.icon}
                    href={item.href}
                    active={item.active}
                    tooltip={item.label}
                    onClick={item.onClick}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? <Sidebar.MenuBadge>{item.badge}</Sidebar.MenuBadge> : null}
                  </Sidebar.MenuButton>
                ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          ))}
        </Sidebar.Content>
        <Sidebar.Footer>
          {footer}
          <Sidebar.Trigger />
        </Sidebar.Footer>
        {resizable ? <Sidebar.ResizeHandle /> : null}
      </Sidebar>
      {children}
    </Sidebar.Provider>
  );
}
