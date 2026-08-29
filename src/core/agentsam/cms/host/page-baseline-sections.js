/** Default sections scaffolded when creating a page on the platform unified CMS shell. */
export const CMS_PLATFORM_PAGE_BASELINE_SECTIONS = [
  {
    section_type: 'hero',
    section_name: 'hero',
    sort_order: 10,
    section_data: {
      headline: 'Your headline here',
      subheadline: 'Edit this hero in Theme Studio — changes save to draft without redeploying the Worker.',
      cta_label: 'Get started',
      cta_href: '#',
    },
  },
  {
    section_type: 'rich_text',
    section_name: 'body',
    sort_order: 20,
    section_data: {
      body: 'Replace this copy with your story. Typed fields live in D1; assembled HTML is written to R2 on Save/Publish.',
    },
  },
  {
    section_type: 'cta',
    section_name: 'cta',
    sort_order: 90,
    section_data: {
      headline: 'Ready to launch?',
      cta_label: 'Contact us',
      cta_href: '/contact',
    },
  },
];

/** @deprecated use CMS_PLATFORM_PAGE_BASELINE_SECTIONS */
export const IAM_PAGE_BASELINE_SECTIONS = CMS_PLATFORM_PAGE_BASELINE_SECTIONS;
