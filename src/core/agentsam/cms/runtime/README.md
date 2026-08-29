# CMS runtime boundary

`runtime/` owns portable runtime/site descriptors and inventory normalization. It does not decide which Cloudflare Worker, D1 database, R2 bucket, KV namespace, domain, or provider a CMS site uses.

Authoritative host data is supplied by the host adapter and normalized into `buildCmsRuntimeDescriptor()`.

The retired `cms-site-spine.js` hardcoded customer map is no longer authoritative. Its compatibility functions now build descriptors from supplied site configuration only.
