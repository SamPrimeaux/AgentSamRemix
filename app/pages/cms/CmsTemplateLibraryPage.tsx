import React, { useMemo, useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import {
  AppBanner,
  AppPageHeader,
  FeatureGrid,
  SiteCta,
  SiteFooter,
  SiteHeader,
  SiteHero,
  componentRegistry,
  componentsForTemplate,
  templateRegistry,
  cmsThemes,
} from '@iam/cms-template-library';
import {
  ArrowUpRight,
  CheckCircle,
  Code,
  Globe,
  Package,
  Palette,
  SquaresFour,
} from '@phosphor-icons/react';

type LibraryView = 'overview' | 'templates' | 'components' | 'themes';

type CmsTemplateLibraryPageProps = {
  initialView?: LibraryView;
};

const viewTabs = [
  { label: 'Overview', value: 'overview' },
  { label: 'Templates', value: 'templates' },
  { label: 'Components', value: 'components' },
  { label: 'Themes', value: 'themes' },
];

function metricCard(label: string, value: string, detail: string, Icon: typeof Package) {
  return (
    <div className="rounded-xl border border-kumo-line bg-kumo-base p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-kumo-subtle">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-kumo-strong">{value}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-kumo-tint text-kumo-subtle">
          <Icon size={17} weight="regular" />
        </div>
      </div>
      <div className="mt-3 text-xs leading-5 text-kumo-subtle">{detail}</div>
    </div>
  );
}

function LocalBusinessPreview() {
  const actionClass =
    'inline-flex min-h-10 items-center justify-center rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white';
  const secondaryClass =
    'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-neutral-900';

  return (
    <div className="overflow-hidden rounded-2xl border border-kumo-line bg-white shadow-sm">
      <SiteHeader
        brand={<div className="text-sm font-semibold tracking-[-0.02em] text-neutral-950">Northline Studio</div>}
        nav={[
          { label: 'Work', href: '#work' },
          { label: 'Services', href: '#services' },
          { label: 'About', href: '#about' },
        ]}
        action={<a href="#contact" className={secondaryClass}>Contact</a>}
      />
      <SiteHero
        eyebrow="Independent creative studio"
        title={<>Websites that feel considered, not assembled.</>}
        description="A reusable site system gives the agent strong components, while the customer still gets their own brand, content, and visual identity."
        primaryAction={<a href="#contact" className={actionClass}>Start a project</a>}
        secondaryAction={<a href="#work" className={secondaryClass}>View work</a>}
      />
      <div className="px-5 pb-12 sm:px-8">
        <FeatureGrid
          columns={3}
          items={[
            { id: 'strategy', eyebrow: '01', title: 'Strategy', description: 'Clear information architecture and conversion paths.' },
            { id: 'design', eyebrow: '02', title: 'Design', description: 'A distinct system built from reusable, adaptable blocks.' },
            { id: 'launch', eyebrow: '03', title: 'Launch', description: 'Cloudflare delivery, analytics, forms, and CMS publishing.' },
          ]}
        />
      </div>
      <SiteCta
        eyebrow="Ready when you are"
        title="A clean starting point, not a cookie-cutter ending."
        description="Agent Sam can select the structure, then tailor design and content to the customer."
        action={<a href="#contact" className="inline-flex min-h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-neutral-950">Get started</a>}
      />
      <SiteFooter
        brand={<div className="text-sm font-semibold text-neutral-950">Northline Studio</div>}
        description="A lightweight example composed from IAM public-site blocks."
        columns={[
          { title: 'Company', links: [{ label: 'About', href: '#about' }, { label: 'Contact', href: '#contact' }] },
          { title: 'Work', links: [{ label: 'Projects', href: '#work' }, { label: 'Services', href: '#services' }] },
        ]}
        legal={<span>© 2026 Northline Studio</span>}
      />
    </div>
  );
}

export default function CmsTemplateLibraryPage({ initialView = 'overview' }: CmsTemplateLibraryPageProps) {
  const [view, setView] = useState<LibraryView>(initialView);
  const [selectedTemplateId, setSelectedTemplateId] = useState('site.local-business');
  const [layer, setLayer] = useState<'all' | 'app' | 'site'>('all');

  const selectedTemplate = useMemo(
    () => templateRegistry.find((template) => template.id === selectedTemplateId) ?? templateRegistry[0],
    [selectedTemplateId],
  );
  const selectedComponents = useMemo(
    () => (selectedTemplate ? componentsForTemplate(selectedTemplate.id) : []),
    [selectedTemplate],
  );
  const visibleComponents = useMemo(
    () => componentRegistry.filter((component) => layer === 'all' || component.layer === layer),
    [layer],
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-kumo-elevated text-kumo-default">
      <AppPageHeader
        eyebrow="Agent Sam · CMS"
        title="Template library"
        description="Reusable application and public-site building blocks for Agent Sam customer builds. Kumo handles the generic application primitives; IAM owns the composition, themes, registry, and customer experience."
        tabs={viewTabs}
        selectedTab={view}
        onTabChange={(next) => setView(next as LibraryView)}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<ArrowUpRight size={14} />}
            onClick={() => setView('templates')}
          >
            Browse templates
          </Button>
        }
      />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-7">
        <AppBanner
          variant="secondary"
          description="The reusable UI library is active on this branch. CMS publishing/editor APIs remain intentionally separate, so adopting these components does not recreate the old hidden workspace-context coupling."
        />

        {view === 'overview' ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricCard('Components', String(componentRegistry.length), 'Application and public-site blocks registered for agent use.', SquaresFour)}
              {metricCard('Templates', String(templateRegistry.length), 'Composable recipes instead of one-off generated page shells.', Package)}
              {metricCard('Themes', String(cmsThemes.length), 'Portable design tokens that can grow independently of content.', Palette)}
              {metricCard('Layers', '2', 'Application UI and public-site UI stay deliberately separate.', Code)}
            </section>

            <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-kumo-line bg-kumo-base p-4 sm:p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-kumo-subtle">How it works</div>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-kumo-strong">Known inventory first.</h2>
                <p className="mt-2 text-sm leading-6 text-kumo-subtle">
                  Agent Sam can query a registry, choose a template, resolve its component IDs, apply a theme, and then customize the result instead of inventing a new UI stack from scratch.
                </p>
                <div className="mt-5 space-y-3">
                  {[
                    ['1', 'Select a template', 'Local business, agency, CMS admin, and future vertical recipes.'],
                    ['2', 'Resolve registered blocks', 'Every block has a stable ID, layer, tags, dependencies, and import path.'],
                    ['3', 'Customize the customer result', 'Brand, content, layout, integrations, and publishing remain customer-specific.'],
                  ].map(([number, title, detail]) => (
                    <div key={number} className="flex gap-3 rounded-xl bg-kumo-tint p-3">
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-kumo-base text-[11px] font-semibold text-kumo-subtle">{number}</div>
                      <div>
                        <div className="text-sm font-medium text-kumo-strong">{title}</div>
                        <div className="mt-0.5 text-xs leading-5 text-kumo-subtle">{detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <LocalBusinessPreview />
            </section>
          </>
        ) : null}

        {view === 'templates' ? (
          <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-2">
              {templateRegistry.map((template) => {
                const active = template.id === selectedTemplate?.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={`w-full rounded-xl border p-4 text-left transition-all ${
                      active
                        ? 'border-kumo-brand/35 bg-kumo-base shadow-sm'
                        : 'border-kumo-line bg-kumo-base hover:-translate-y-px hover:border-kumo-interact'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-kumo-strong">{template.name}</div>
                      <span className="rounded-full bg-kumo-tint px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-kumo-subtle">{template.layer}</span>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-kumo-subtle">{template.description}</div>
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-kumo-subtle">
                      <CheckCircle size={13} weight="fill" className="text-kumo-brand" />
                      {template.componentIds.length} registered blocks
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 space-y-4">
              <div className="rounded-xl border border-kumo-line bg-kumo-base p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-kumo-subtle">Selected template</div>
                    <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-kumo-strong">{selectedTemplate?.name}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-kumo-subtle">{selectedTemplate?.description}</p>
                  </div>
                  <div className="rounded-lg bg-kumo-tint px-3 py-2 font-mono text-[11px] text-kumo-subtle">{selectedTemplate?.id}</div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {selectedComponents.map((component) => (
                    <div key={component.id} className="rounded-lg border border-kumo-line p-3">
                      <div className="text-sm font-medium text-kumo-strong">{component.name}</div>
                      <div className="mt-1 font-mono text-[10px] text-kumo-subtle">{component.id}</div>
                    </div>
                  ))}
                </div>
              </div>
              {selectedTemplate?.layer === 'site' ? <LocalBusinessPreview /> : (
                <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-kumo-line bg-kumo-base px-6 text-center">
                  <div className="max-w-md">
                    <Code size={24} className="mx-auto text-kumo-inactive" />
                    <div className="mt-3 text-base font-semibold text-kumo-strong">Application shell recipe</div>
                    <div className="mt-1 text-sm leading-6 text-kumo-subtle">This recipe composes Kumo-backed admin primitives without forcing the same dashboard dependency graph into customer public sites.</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {view === 'components' ? (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.035em] text-kumo-strong">Component inventory</h2>
                <p className="mt-1 text-sm text-kumo-subtle">Stable IDs make these discoverable by Agent Sam and future CMS tooling.</p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-kumo-line bg-kumo-base p-1">
                {(['all', 'app', 'site'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLayer(value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${layer === value ? 'bg-kumo-tint text-kumo-strong' : 'text-kumo-subtle hover:text-kumo-default'}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleComponents.map((component) => (
                <article key={component.id} className="rounded-xl border border-kumo-line bg-kumo-base p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-kumo-strong">{component.name}</div>
                    <span className="rounded-full bg-kumo-tint px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-kumo-subtle">{component.layer}</span>
                  </div>
                  <p className="mt-2 min-h-12 text-xs leading-5 text-kumo-subtle">{component.description}</p>
                  <div className="mt-3 font-mono text-[10px] text-kumo-subtle">{component.id}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {component.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-md border border-kumo-line px-1.5 py-0.5 text-[10px] text-kumo-subtle">{tag}</span>)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {view === 'themes' ? (
          <section className="grid gap-4 md:grid-cols-2">
            {cmsThemes.map((theme) => (
              <article key={theme.id} className="overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base">
                <div className="grid h-36 grid-cols-5">
                  {Object.values(theme.colors).slice(0, 5).map((color, index) => <div key={`${theme.id}:${index}`} style={{ background: String(color) }} />)}
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2">
                    <Palette size={16} className="text-kumo-subtle" />
                    <h2 className="text-lg font-semibold text-kumo-strong">{theme.label}</h2>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-kumo-subtle">{theme.id}</div>
                  <p className="mt-3 text-sm leading-6 text-kumo-subtle">Portable tokens for color, typography, radius, and elevation. Themes can change without changing content or template structure.</p>
                </div>
              </article>
            ))}
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-kumo-line bg-kumo-base px-6 text-center">
              <div className="max-w-sm">
                <Globe size={24} className="mx-auto text-kumo-inactive" />
                <div className="mt-3 text-base font-semibold text-kumo-strong">Customer themes stay open-ended.</div>
                <div className="mt-1 text-sm leading-6 text-kumo-subtle">The registry gives Agent Sam a baseline without restricting future customer-specific art direction.</div>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
