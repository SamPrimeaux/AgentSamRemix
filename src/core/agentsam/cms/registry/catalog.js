/**
 * Built-in portable CMS content models (proof set for CMS v1 registry).
 *
 * Criterion: define once → editor / Agent Sam / API consume the same schema.
 * Host identity (IAM domains, buckets, customers) must never appear here.
 */

import { registerCmsBlock } from './blocks.js';
import { registerCmsSection } from './sections.js';

let seeded = false;

/** Idempotent seed of the portable proof catalog. */
export function ensureCmsBuiltinCatalog() {
  if (seeded) return;
  seeded = true;

  registerCmsBlock({
    type: 'button',
    version: 1,
    label: 'Button',
    fields: {
      label: { type: 'text', required: true },
      href: { type: 'link', required: true },
      style: { type: 'select' },
    },
    defaults: { label: 'Learn more', href: '#', style: 'primary' },
  });

  registerCmsBlock({
    type: 'badge',
    version: 1,
    label: 'Badge',
    fields: {
      text: { type: 'text', required: true },
      tone: { type: 'select' },
    },
    defaults: { text: 'New', tone: 'neutral' },
  });

  registerCmsBlock({
    type: 'feature-item',
    version: 1,
    label: 'Feature item',
    fields: {
      title: { type: 'text', required: true },
      body: { type: 'textarea' },
      icon: { type: 'asset' },
    },
    defaults: { title: 'Feature', body: '' },
  });

  registerCmsSection({
    type: 'hero',
    version: 1,
    label: 'Hero',
    fields: {
      eyebrow: { type: 'text' },
      heading: { type: 'text', required: true },
      body: { type: 'richtext' },
      image: { type: 'asset' },
      primaryCta: { type: 'link' },
    },
    allowedBlocks: ['button', 'badge'],
    defaults: {
      eyebrow: '',
      heading: 'Headline',
      body: '',
      image: null,
      primaryCta: { label: 'Get started', href: '#' },
    },
    capabilities: { editable: true, reorderable: true, duplicable: true },
  });

  registerCmsSection({
    type: 'rich-text',
    version: 1,
    label: 'Rich text',
    fields: {
      heading: { type: 'text' },
      body: { type: 'richtext', required: true },
    },
    allowedBlocks: [],
    defaults: { heading: '', body: '' },
  });

  registerCmsSection({
    type: 'image',
    version: 1,
    label: 'Image',
    fields: {
      asset: { type: 'asset', required: true },
      alt: { type: 'text', required: true },
      caption: { type: 'textarea' },
    },
    allowedBlocks: [],
    defaults: { asset: null, alt: '', caption: '' },
  });

  registerCmsSection({
    type: 'cta',
    version: 1,
    label: 'Call to action',
    fields: {
      heading: { type: 'text', required: true },
      body: { type: 'textarea' },
      primaryCta: { type: 'link', required: true },
      secondaryCta: { type: 'link' },
    },
    allowedBlocks: ['button'],
    defaults: {
      heading: 'Ready to start?',
      body: '',
      primaryCta: { label: 'Contact us', href: '/contact' },
      secondaryCta: null,
    },
  });

  registerCmsSection({
    type: 'features',
    version: 1,
    label: 'Features',
    fields: {
      heading: { type: 'text', required: true },
      intro: { type: 'textarea' },
      columns: { type: 'number' },
    },
    allowedBlocks: ['feature-item', 'badge'],
    defaults: { heading: 'Features', intro: '', columns: 3 },
  });

  registerCmsSection({
    type: 'services-grid',
    version: 1,
    label: 'Services grid',
    fields: {
      heading: { type: 'text', required: true },
      intro: { type: 'textarea' },
      columns: { type: 'number' },
    },
    allowedBlocks: ['feature-item', 'badge', 'button'],
    defaults: {
      heading: 'Services',
      intro: 'What we deliver for your brand and operations.',
      columns: 3,
    },
  });
}