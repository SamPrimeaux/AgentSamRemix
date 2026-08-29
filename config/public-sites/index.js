/**
 * Declarative public-site registry.
 *
 * Add a website here with its source root, runtime storage, shell parts, and
 * route data. The backend public-site machinery must not branch on site names.
 */

export const PUBLIC_SITE_MANIFESTS = Object.freeze([
  Object.freeze({
    siteId: 'inneranimalmedia',
    hosts: Object.freeze(['inneranimalmedia.com', 'www.inneranimalmedia.com']),
    canonicalOrigin: 'https://inneranimalmedia.com',
    sourceRoot: 'app/frontend/public',
    publishIgnore: Object.freeze(['README.md']),
    storage: Object.freeze({
      binding: 'ASSETS',
      bucket: 'inneranimalmedia',
      publishedRoot: '',
      manifestKey: 'manifests/public-site.json',
    }),
    shell: Object.freeze({
      draftMode: 'sibling-directory',
      parts: Object.freeze([
        Object.freeze({
          id: 'header',
          label: 'Site header',
          source: 'components/iam-header.html',
          publishedKey: 'components/iam-header.html',
          slot: 'prepend',
        }),
        Object.freeze({
          id: 'footer',
          label: 'Site footer',
          source: 'components/iam-footer.html',
          publishedKey: 'components/iam-footer.html',
          slot: 'append',
        }),
      ]),
    }),
    navigation: Object.freeze({
      selectors: Object.freeze({
        headerNavClass: 'iam-nav',
        sidenavClass: 'iam-sidenav',
        footerCompanyLabel: 'Company',
        footerProductsLabel: 'Products',
      }),
      header: Object.freeze([
        Object.freeze({ route: '/', label: 'Home', dataNav: 'home' }),
        Object.freeze({ route: '/work', label: 'Work', dataNav: 'work' }),
        Object.freeze({ route: '/about', label: 'About', dataNav: 'about' }),
        Object.freeze({ route: '/services', label: 'Services', dataNav: 'services' }),
        Object.freeze({ route: '/contact', label: 'Contact', dataNav: 'contact' }),
      ]),
      footer: Object.freeze({
        company: Object.freeze([
          Object.freeze({ route: '/work', label: 'Work', dataNav: 'work' }),
          Object.freeze({ route: '/about', label: 'About', dataNav: 'about' }),
          Object.freeze({ route: '/services', label: 'Services', dataNav: 'services' }),
          Object.freeze({ route: '/contact', label: 'Contact', dataNav: 'contact' }),
        ]),
        products: Object.freeze([
          Object.freeze({ route: '/agentsam', label: 'Agent Sam', dataNav: 'agentsam' }),
          Object.freeze({ route: '/games', label: 'Games', dataNav: 'games' }),
          Object.freeze({ route: '/pricing', label: 'Pricing', dataNav: 'pricing' }),
        ]),
      }),
      signupHref: '/auth/signup',
    }),
    sitemap: Object.freeze({
      lastModified: '2026-05-28',
      entries: Object.freeze([
        Object.freeze({ route: '/', priority: '1.0', changefreq: 'weekly' }),
        Object.freeze({ route: '/work', priority: '0.8', changefreq: 'monthly' }),
        Object.freeze({ route: '/about', priority: '0.8', changefreq: 'monthly' }),
        Object.freeze({ route: '/services', priority: '0.9', changefreq: 'monthly' }),
        Object.freeze({ route: '/contact', priority: '0.8', changefreq: 'monthly' }),
        Object.freeze({ route: '/pricing', priority: '0.8', changefreq: 'monthly' }),
        Object.freeze({ route: '/games', priority: '0.6', changefreq: 'monthly' }),
        Object.freeze({ route: '/auth/login', priority: '0.5', changefreq: 'yearly' }),
        Object.freeze({ route: '/auth/signup', priority: '0.5', changefreq: 'yearly' }),
        Object.freeze({ route: '/auth/reset', priority: '0.4', changefreq: 'yearly' }),
        Object.freeze({ route: '/privacy', priority: '0.3', changefreq: 'yearly' }),
        Object.freeze({ route: '/terms', priority: '0.3', changefreq: 'yearly' }),
        Object.freeze({ route: '/sitemap', priority: '0.4', changefreq: 'monthly' }),
      ]),
    }),
  }),
]);
