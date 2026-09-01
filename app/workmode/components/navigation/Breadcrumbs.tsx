import React, { useState } from 'react';
import { ChevronRight, Copy, Check, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  size?: 'sm' | 'base';
  children: React.ReactNode;
  className?: string;
}

export interface BreadcrumbsLinkProps {
  href?: string;
  icon?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export interface BreadcrumbsSeparatorProps {
  children?: React.ReactNode;
  className?: string;
}

export interface BreadcrumbsCurrentProps {
  icon?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

export interface BreadcrumbsClipboardProps {
  text: string;
  label?: string;
  className?: string;
}

export function Breadcrumbs({
  size = 'sm',
  children,
  className,
  ...props
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb navigation"
      className={cn(
        "flex items-center min-w-0 font-medium select-none overflow-x-auto no-scrollbar",
        size === 'sm' ? "text-xs gap-1.5" : "text-sm gap-2",
        className
      )}
      {...props}
    >
      <ol className="flex items-center gap-1.5 min-w-0 list-none m-0 p-0">
        {children}
      </ol>
    </nav>
  );
}

export function BreadcrumbsLink({
  href,
  icon,
  onClick,
  children,
  className,
  title,
}: BreadcrumbsLinkProps) {
  const content = (
    <>
      {icon && <span className="shrink-0 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">{icon}</span>}
      <span className="truncate max-w-[120px] sm:max-w-[180px]">{children}</span>
    </>
  );

  if (href) {
    return (
      <li className="flex items-center shrink-0">
        <a
          href={href}
          onClick={onClick}
          title={title}
          className={cn(
            "group inline-flex items-center gap-1.5 py-1 px-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors duration-150 font-medium",
            className
          )}
        >
          {content}
        </a>
      </li>
    );
  }

  return (
    <li className="flex items-center shrink-0">
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          "group inline-flex items-center gap-1.5 py-1 px-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors duration-150 font-medium text-left",
          className
        )}
      >
        {content}
      </button>
    </li>
  );
}

export function BreadcrumbsSeparator({
  children,
  className,
}: BreadcrumbsSeparatorProps) {
  return (
    <li aria-hidden="true" className={cn("shrink-0 text-zinc-300 dark:text-zinc-600 flex items-center justify-center select-none", className)}>
      {children || <ChevronRight size={13} strokeWidth={2} />}
    </li>
  );
}

export function BreadcrumbsCurrent({
  icon,
  loading = false,
  children,
  className,
}: BreadcrumbsCurrentProps) {
  return (
    <li aria-current="page" className="flex items-center shrink-0 min-w-0">
      <div
        className={cn(
          "inline-flex items-center gap-1.5 py-1 px-2 rounded-md font-semibold text-zinc-900 dark:text-zinc-100 bg-zinc-100/80 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 shadow-2xs truncate max-w-[160px] sm:max-w-[240px]",
          className
        )}
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin text-emerald-500 shrink-0" />
        ) : (
          icon && <span className="shrink-0 text-emerald-600 dark:text-emerald-400">{icon}</span>
        )}
        <span className="truncate">{children}</span>
      </div>
    </li>
  );
}

export function BreadcrumbsClipboard({
  text,
  label = 'Copy',
  className,
}: BreadcrumbsClipboardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy "${text}"`}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-md border transition-all duration-150",
        copied
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700",
        className
      )}
    >
      {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

// Attach subcomponents for compound usage: <Breadcrumbs.Link />, <Breadcrumbs.Separator />, etc.
Breadcrumbs.Link = BreadcrumbsLink;
Breadcrumbs.Separator = BreadcrumbsSeparator;
Breadcrumbs.Current = BreadcrumbsCurrent;
Breadcrumbs.Clipboard = BreadcrumbsClipboard;
