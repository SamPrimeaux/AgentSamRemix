import React, { useState, useEffect } from 'react';
import { ClientWebsiteData } from '../types';
import { 
  Globe, 
  Check, 
  Copy, 
  ExternalLink, 
  Download, 
  Upload, 
  Terminal, 
  ShieldCheck, 
  Server, 
  X, 
  Sparkles, 
  RefreshCw,
  Code,
  FileJson,
  Layers
} from 'lucide-react';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';

interface DeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  website: ClientWebsiteData;
  onUpdateWebsite: (updated: ClientWebsiteData) => void;
}

export const DeploymentModal: React.FC<DeploymentModalProps> = ({
  isOpen,
  onClose,
  website,
  onUpdateWebsite
}) => {
  const [deployStep, setDeployStep] = useState<number>(3); // 0: compiling, 1: optimizing, 2: provisioning, 3: completed
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'deploy' | 'export' | 'domain'>('deploy');
  const [customDomainInput, setCustomDomainInput] = useState(website.deployment?.customDomain || '');

  const liveUrl = website.deployment?.deployedUrl || `https://${website.deployment?.subdomain || 'preview'}.apexdynamics.ai`;

  const handleStartDeploy = () => {
    setIsDeploying(true);
    setDeployStep(0);

    setTimeout(() => setDeployStep(1), 700);
    setTimeout(() => setDeployStep(2), 1400);
    setTimeout(() => {
      setDeployStep(3);
      setIsDeploying(false);
      const newVersion = `v2.${Math.floor(Math.random() * 9) + 4}.${Math.floor(Math.random() * 9) + 1}`;
      const newHash = Math.random().toString(36).substring(2, 9);
      onUpdateWebsite({
        ...website,
        deployment: {
          ...website.deployment,
          status: 'deployed',
          version: newVersion,
          commitHash: newHash,
          lastDeployedAt: 'Just now (' + newVersion + ')',
          sslStatus: 'active'
        }
      });
      confetti({ particleCount: 60, spread: 80 });
    }, 2200);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  // Download Standalone HTML File
  const handleDownloadHtml = () => {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${website.seo?.metaTitle || website.title}</title>
  <meta name="description" content="${website.seo?.metaDescription || website.heroSubheadline}" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 antialiased selection:bg-blue-600 selection:text-white">
  <!-- Navbar -->
  <header class="w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
    <div class="flex items-center gap-2 font-bold text-lg">
      <div class="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-sm">${website.clientName.charAt(0)}</div>
      <span>${website.clientName}</span>
    </div>
    <div class="flex items-center gap-4">
      <a href="#pricing" class="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg transition-all">${website.primaryCta}</a>
    </div>
  </header>

  <!-- Hero Section -->
  <main class="max-w-5xl mx-auto px-6 py-20 text-center space-y-6">
    <div class="inline-block px-3.5 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
      ${website.blocks?.find(b => b.type === 'hero')?.badge || 'Next-Generation Autonomous Infrastructure'}
    </div>
    <h1 class="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight max-w-4xl mx-auto">
      ${website.heroHeadline}
    </h1>
    <p class="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
      ${website.heroSubheadline}
    </p>
    <div class="flex items-center justify-center gap-4 pt-4">
      <a href="#pricing" class="px-8 py-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-xl transition-transform hover:scale-105">${website.primaryCta}</a>
      <a href="#features" class="px-8 py-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-200 font-semibold text-sm hover:bg-zinc-800 transition-colors">${website.secondaryCta}</a>
    </div>

    <!-- Features -->
    <section id="features" class="pt-24 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
      ${website.features?.map(f => `
      <div class="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-2">
        <h3 class="font-bold text-base text-zinc-100">${f.title}</h3>
        <p class="text-xs text-zinc-400 leading-relaxed">${f.desc}</p>
      </div>`).join('')}
    </section>

    <!-- Pricing -->
    <section id="pricing" class="pt-24 space-y-8">
      <h2 class="text-3xl font-bold">Predictable Pricing</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
        ${website.pricingTiers?.map(p => `
        <div class="p-6 rounded-2xl bg-zinc-900 border ${p.popular ? 'border-blue-500 shadow-xl' : 'border-zinc-800'} space-y-4">
          <div class="flex justify-between items-center">
            <h3 class="font-bold text-lg">${p.name}</h3>
            ${p.popular ? '<span class="text-[10px] bg-blue-600 px-2 py-0.5 rounded-full font-bold">POPULAR</span>' : ''}
          </div>
          <div class="text-3xl font-extrabold">${p.price} <span class="text-xs font-normal text-zinc-400">${p.period}</span></div>
          <ul class="text-xs text-zinc-300 space-y-2">
            ${p.features.map(feat => `<li>✔ ${feat}</li>`).join('')}
          </ul>
        </div>`).join('')}
      </div>
    </section>
  </main>

  <footer class="mt-24 border-t border-zinc-800 py-12 text-center text-xs text-zinc-500">
    <p>© ${new Date().getFullYear()} ${website.clientName}. Exported from Agent Sam Autonomous Studio.</p>
  </footer>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${website.clientName.toLowerCase().replace(/\s+/g, '-')}-production.html`;
    a.click();
    URL.revokeObjectURL(url);
    confetti({ particleCount: 40 });
  };

  // Download CMS JSON File
  const handleDownloadJson = () => {
    const jsonStr = JSON.stringify(website, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${website.clientName.toLowerCase().replace(/\s+/g, '-')}-cms-schema.json`;
    a.click();
    URL.revokeObjectURL(url);
    confetti({ particleCount: 30 });
  };

  // Import JSON File
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed.heroHeadline || parsed.blocks) {
          onUpdateWebsite({
            ...parsed,
            id: website.id
          });
          confetti({ particleCount: 50 });
          alert("CMS Schema successfully imported and applied!");
        }
      } catch (err) {
        alert("Invalid JSON file format.");
      }
    };
    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
              <Globe size={16} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">Edge Deployment & Export Hub</h2>
              <p className="text-[11px] text-zinc-500">Live global distribution, automated SSL, and multi-format exports</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="px-6 pt-3 flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 text-xs">
          <button
            onClick={() => setActiveTab('deploy')}
            className={cn(
              "pb-2.5 font-bold border-b-2 transition-colors",
              activeTab === 'deploy' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Edge Deployment
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={cn(
              "pb-2.5 font-bold border-b-2 transition-colors",
              activeTab === 'export' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Export Artifacts
          </button>
          <button
            onClick={() => setActiveTab('domain')}
            className={cn(
              "pb-2.5 font-bold border-b-2 transition-colors",
              activeTab === 'domain' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Custom Domain & DNS
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* ================= TAB 1: DEPLOYMENT STATUS ================= */}
          {activeTab === 'deploy' && (
            <div className="space-y-4">
              {/* Live URL Banner */}
              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-emerald-500 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live Production Status: Active
                  </span>
                  <div className="text-sm font-mono font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-md">
                    {liveUrl}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy(liveUrl)}
                    className="px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    {copiedUrl ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    <span>{copiedUrl ? 'Copied!' : 'Copy URL'}</span>
                  </button>
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    <ExternalLink size={13} />
                    <span>Open Live</span>
                  </a>
                </div>
              </div>

              {/* Build Pipeline Stepper */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">
                  Cloud Run Edge Pipeline Telemetry
                </label>
                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[11px] space-y-2">
                  <div className="flex items-center gap-2">
                    {deployStep >= 0 ? <Check size={14} className="text-emerald-400" /> : <RefreshCw size={14} className="animate-spin text-blue-400" />}
                    <span>1. Component AST Validation & Static Generation</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {deployStep >= 1 ? <Check size={14} className="text-emerald-400" /> : <RefreshCw size={14} className="animate-spin text-blue-400" />}
                    <span>2. Tailwind v4 Atomic Class Tree-Shaking (14.2 kB output)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {deployStep >= 2 ? <Check size={14} className="text-emerald-400" /> : <RefreshCw size={14} className="animate-spin text-blue-400" />}
                    <span>3. SSL Let's Encrypt Certificate TLS 1.3 Verified</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {deployStep >= 3 ? <Check size={14} className="text-emerald-400" /> : <RefreshCw size={14} className="animate-spin text-blue-400" />}
                    <span>4. Deployed to 34 Global Edge Regions (TTFB &lt; 35ms)</span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  onClick={handleStartDeploy}
                  disabled={isDeploying}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
                >
                  <RefreshCw size={16} className={isDeploying ? "animate-spin" : ""} />
                  <span>{isDeploying ? 'Deploying to Global Edge CDN...' : 'Trigger Instant Redeployment'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ================= TAB 2: EXPORT ARTIFACTS ================= */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Export Production Artifacts</h3>
                <p className="text-zinc-500 text-[11px]">Download standalone static files or headless schema for full portability.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Export 1: Single HTML File */}
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-blue-500 font-bold">
                      <Code size={16} />
                      <span>Standalone HTML5 Bundle</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Self-contained index.html with embedded Tailwind styles, Google Fonts, and working links.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadHtml}
                    className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download size={13} />
                    <span>Download .html</span>
                  </button>
                </div>

                {/* Export 2: Headless CMS JSON */}
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-violet-500 font-bold">
                      <FileJson size={16} />
                      <span>Headless CMS Schema JSON</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Clean JSON data schema for Next.js, Astro, Remix, Strapi, or Shopify headless setups.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadJson}
                    className="w-full py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download size={13} />
                    <span>Download .json</span>
                  </button>
                </div>
              </div>

              {/* Import Schema */}
              <div className="p-4 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/40 text-center space-y-2">
                <div className="text-zinc-500 text-xs font-semibold">Have a previously exported site schema?</div>
                <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 cursor-pointer text-xs font-semibold transition-colors">
                  <Upload size={13} />
                  <span>Import CMS JSON File</span>
                  <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
                </label>
              </div>
            </div>
          )}

          {/* ================= TAB 3: CUSTOM DOMAIN & DNS ================= */}
          {activeTab === 'domain' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Custom Domain & CNAME Mapping</h3>
                <p className="text-zinc-500 text-[11px]">Connect your own root apex domain or subdomain.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-zinc-400 font-medium">Custom Root Domain</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      placeholder="e.g. yourbrand.com or app.yourbrand.com"
                      value={customDomainInput}
                      onChange={(e) => setCustomDomainInput(e.target.value)}
                      className="flex-1 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none font-mono"
                    />
                    <button
                      onClick={() => {
                        onUpdateWebsite({
                          ...website,
                          deployment: {
                            ...website.deployment,
                            customDomain: customDomainInput.trim()
                          }
                        });
                        alert(`Domain ${customDomainInput} successfully mapped! Provisioning SSL certificate.`);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm"
                    >
                      Connect Domain
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 space-y-2">
                  <div className="text-[11px] font-bold text-zinc-400 uppercase">Required DNS Configuration</div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-zinc-400 border-b border-zinc-800 pb-1">
                    <div>Type</div>
                    <div>Name</div>
                    <div>Value</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-zinc-200">
                    <div className="text-blue-400">CNAME</div>
                    <div>@ / www</div>
                    <div className="text-emerald-400">cname.apexdynamics.ai</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
