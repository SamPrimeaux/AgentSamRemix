import type { ReactNode } from 'react';
import { CommandPalette } from '@cloudflare/kumo/components/command-palette';

export type CommandPaletteEntry = {
  id: string;
  title: string;
  description?: string;
  breadcrumbs?: string[];
  icon?: ReactNode;
  disabled?: boolean;
  data?: unknown;
};

export type CommandPaletteGroup = {
  id: string;
  label: string;
  items: CommandPaletteEntry[];
};

export type CommandPaletteShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  groups: CommandPaletteGroup[];
  onSelect: (entry: CommandPaletteEntry, options?: { newTab?: boolean }) => void;
  loading?: boolean;
  placeholder?: string;
  leading?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  emptyMessage?: string;
};

export function CommandPaletteShell({
  open,
  onOpenChange,
  query,
  onQueryChange,
  groups,
  onSelect,
  loading = false,
  placeholder = 'Search or run a command…',
  leading,
  toolbar,
  footer,
  emptyMessage = 'No results found',
}: CommandPaletteShellProps) {
  const selectable = (rows: CommandPaletteGroup[]) => rows.flatMap((group) => group.items).filter((item) => !item.disabled);

  return (
    <CommandPalette.Root<CommandPaletteGroup, CommandPaletteEntry>
      open={open}
      onOpenChange={onOpenChange}
      items={groups}
      value={query}
      onValueChange={onQueryChange}
      itemToStringValue={(group) => group.label}
      filter={() => true}
      getSelectableItems={selectable}
      onSelect={(item, options) => onSelect(item, options)}
    >
      <CommandPalette.Input
        placeholder={placeholder}
        leading={leading}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
      />
      {toolbar ? <div className="border-b border-kumo-line px-3 py-2">{toolbar}</div> : null}
      <CommandPalette.List>
        {loading ? (
          <CommandPalette.Loading />
        ) : (
          <>
            <CommandPalette.Results>
              {(group: CommandPaletteGroup) => (
                <CommandPalette.Group key={group.id} items={group.items}>
                  <CommandPalette.GroupLabel>{group.label}</CommandPalette.GroupLabel>
                  <CommandPalette.Items>
                    {(item: CommandPaletteEntry) => (
                      <CommandPalette.ResultItem
                        key={item.id}
                        value={item}
                        title={item.title}
                        description={item.description}
                        breadcrumbs={item.breadcrumbs}
                        icon={item.icon}
                        nonInteractive={item.disabled}
                        onClick={(event) => onSelect(item, { newTab: event.metaKey || event.ctrlKey })}
                      />
                    )}
                  </CommandPalette.Items>
                </CommandPalette.Group>
              )}
            </CommandPalette.Results>
            <CommandPalette.Empty>{emptyMessage}</CommandPalette.Empty>
          </>
        )}
      </CommandPalette.List>
      <CommandPalette.Footer>
        {footer ?? (
          <>
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </>
        )}
      </CommandPalette.Footer>
    </CommandPalette.Root>
  );
}
