import React from 'react';
import { AppIcon, type AppIconStatus } from '../../ui/AppIcon';

export type IntegrationIconTileProps = {
  title: string;
  iconSlug?: string;
  imageUrl?: string | null;
  subtitle?: string;
  status?: AppIconStatus | null;
  disabled?: boolean;
  onClick?: () => void;
};

export function IntegrationIconTile({
  title,
  iconSlug,
  imageUrl,
  subtitle,
  status,
  disabled,
  onClick,
}: IntegrationIconTileProps) {
  return (
    <AppIcon
      title={title}
      iconSlug={iconSlug}
      imageUrl={imageUrl}
      size="lg"
      subtitle={subtitle}
      status={status}
      disabled={disabled}
      onPress={onClick}
    />
  );
}
