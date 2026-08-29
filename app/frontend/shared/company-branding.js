/**
 * Auth portal branding from D1 `company` via GET /api/company.
 * Static HTML keeps IAM defaults as fallback when API is unavailable.
 */
(function () {
  var SUBTITLE_PREFIX = {
    signin: 'Sign in to ',
    signup: 'Join ',
  };

  function applyCompany(company) {
    if (!company || !company.name) return;
    var name = company.name;
    var root = document.documentElement;

    if (company.authBgColor) {
      root.style.setProperty('--auth-bg', company.authBgColor);
      document.body.style.backgroundColor = company.authBgColor;
    }

    if (company.logoUrl) {
      document.querySelectorAll('.auth-logo').forEach(function (el) {
        el.src = company.logoUrl;
        el.alt = name;
      });
    }

    if (company.faviconUrl) {
      var link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = company.faviconUrl;
    }

    if (document.title && document.title.indexOf('|') !== -1) {
      document.title = document.title.replace(/\|[^|]+$/, '| ' + name);
    }

    document.querySelectorAll('[data-company-name]').forEach(function (el) {
      el.textContent = name;
    });

    document.querySelectorAll('[data-company-subtitle]').forEach(function (el) {
      var kind = el.getAttribute('data-company-subtitle');
      var prefix = SUBTITLE_PREFIX[kind];
      if (prefix) el.textContent = prefix + name;
    });

    if (company.tagline) {
      document.querySelectorAll('[data-company-tagline]').forEach(function (el) {
        el.textContent = company.tagline;
      });
    }

    if (company.supportEmail) {
      document.querySelectorAll('[data-company-support-email]').forEach(function (el) {
        el.textContent = company.supportEmail;
      });
    }

    var meta = company.meta || {};
    var footer = document.querySelector('footer.auth-min-footer');
    if (footer) {
      if (meta.privacyUrl) {
        var privacy = footer.querySelector('a[href="/privacy"]');
        if (privacy) privacy.href = meta.privacyUrl;
      }
      if (meta.termsUrl) {
        var terms = footer.querySelector('a[href="/terms"]');
        if (terms) terms.href = meta.termsUrl;
      }
      if (meta.contactUrl) {
        var contact = footer.querySelector('a[href="/contact"]');
        if (contact) contact.href = meta.contactUrl;
      }
    }
  }

  fetch('/api/company', { credentials: 'omit' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.ok && d.company) applyCompany(d.company); })
    .catch(function () {});
})();
