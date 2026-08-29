import React, { useMemo, useState } from 'react';
import type { WorkspaceId } from './cadStudioTypes';
import { buildDockDomains, type DockAction, type DockDomainId } from './toolDockRegistry';
import { dispatchCadChat } from './dispatchCadChat';
import { CAD_OPERATORS } from './operators';

export type CreativeToolDockProps = {
  workspace: WorkspaceId;
  activeTool: string;
  activeDomain: DockDomainId | null;
  onDomainChange: (domain: DockDomainId | null) => void;
  onToolChange: (toolId: string) => void;
  onLocalAction: (actionId: string) => void;
  onOpenOperator: (operatorId?: string, prompt?: string) => void;
  selectedObjectId?: string | null;
  sceneId?: string | null;
  placement?: 'bottom' | 'side';
  sheetHeight?: number;
  onSheetResizePointerDown?: (e: React.PointerEvent) => void;
};

export function CreativeToolDock({
  workspace,
  activeTool,
  activeDomain,
  onDomainChange,
  onToolChange,
  onLocalAction,
  onOpenOperator,
  placement = 'bottom',
  sheetHeight,
  onSheetResizePointerDown,
}: CreativeToolDockProps) {
  const domains = useMemo(() => buildDockDomains(workspace), [workspace]);
  const [pinned, setPinned] = useState(false);
  const openDomain = domains.find((d) => d.id === activeDomain) ?? null;

  const handleAction = (action: DockAction) => {
    if (action.kind === 'local') {
      if (['select', 'move', 'rotate', 'scale'].includes(action.id)) {
        onToolChange(action.id);
        return;
      }
      onLocalAction(action.id);
      return;
    }
    if (action.kind === 'panel') {
      onLocalAction(action.id);
      return;
    }
    if (action.kind === 'operator' && action.operatorId) {
      onOpenOperator(action.operatorId, `Apply ${action.label} in ${workspace} workspace.`);
    }
  };

  const wrapClass = `cad-dock-wrap cad-dock-wrap--${placement}${openDomain ? ' cad-dock-wrap--open' : ''}`;

  return (
    <div className={wrapClass} aria-label="Creative tool dock">
      {openDomain ? (
        <div
          className="cad-dock__sheet"
          role="region"
          aria-label={`${openDomain.label} tools`}
          style={sheetHeight != null ? { height: sheetHeight, maxHeight: sheetHeight } : undefined}
        >
          {onSheetResizePointerDown ? (
            <div
              className="cad-resize-handle cad-resize-handle--horizontal"
              onPointerDown={onSheetResizePointerDown}
              title="Drag to resize tool drawer"
            />
          ) : null}
          <div className="cad-dock__sheet-head">
            <span>{openDomain.label}</span>
            <button
              type="button"
              className="cad-studio__btn"
              onClick={() => {
                onDomainChange(null);
                setPinned(false);
              }}
            >
              Close
            </button>
          </div>
          <div className="cad-dock__sheet-body">
            {openDomain.sections.map((section) => (
              <div key={section.title} className="cad-dock__section">
                <div className="cad-dock__section-title">{section.title}</div>
                <div className="cad-dock__actions cad-dock__actions--grid">
                  {section.actions.map((action) => {
                    const Icon = action.icon;
                    const isActive = activeTool === action.id;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={`cad-dock__action${isActive ? ' active' : ''}`}
                        onClick={() => handleAction(action)}
                        disabled={action.id === 'none'}
                        title={action.label}
                      >
                        <Icon size={14} strokeWidth={1.75} />
                        <span>{action.label}</span>
                        {action.shortcut ? <span className="cad-dock__shortcut">{action.shortcut}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="cad-dock__bar" role="toolbar" aria-label="Tool domains">
        {domains.map((domain) => {
          const Icon = domain.icon;
          const active = activeDomain === domain.id;
          return (
            <button
              key={domain.id}
              type="button"
              className={`cad-dock__bar-btn${active ? ' active' : ''}`}
              title={domain.label}
              aria-pressed={active}
              onClick={() => {
                if (active && !pinned) {
                  onDomainChange(null);
                } else {
                  onDomainChange(domain.id);
                  setPinned(true);
                }
              }}
            >
              <Icon size={16} strokeWidth={1.75} />
              <span className="cad-dock__bar-label">{domain.label}</span>
            </button>
          );
        })}
        {activeTool ? (
          <span className="cad-dock__active-pill">
            Tool: <strong>{activeTool}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function openOperatorDraft(
  operatorId: string,
  opts: {
    prompt?: string;
    workspace?: string;
    selectedObjectId?: string | null;
    sceneId?: string | null;
    send?: boolean;
  },
): void {
  const operator = CAD_OPERATORS.find((c) => c.id === operatorId);
  dispatchCadChat({
    operator,
    operatorId,
    prompt: opts.prompt,
    workspace: opts.workspace,
    selectedObjectId: opts.selectedObjectId,
    sceneId: opts.sceneId,
    send: opts.send ?? false,
  });
}
