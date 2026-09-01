import React from 'react';
import { AppSidebar, AppSidebarProps } from './navigation/AppSidebar';
import { useSidebar } from './navigation/Sidebar';

export interface SidebarDrawerProps extends AppSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

/**
 * SidebarDrawer remastered wrapper: integrates with the composable Sidebar system
 * while retaining backwards compatibility with all existing props.
 */
export const SidebarDrawer: React.FC<SidebarDrawerProps> = (props) => {
  return <AppSidebar {...props} />;
};

export { AppSidebar };
