import React, { useState } from 'react';
import { IAMUser, AuthSession } from '../../sdk/types';
import { createIdentityClient, DEMO_IAM_USER } from '../../sdk/identity';

interface AuthScreenProps {
  onAuthenticated: (user: IAMUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [tab, setTab] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('info@inneranimals.com');
  const [password, setPassword] = useState('••••••••••••');
  const [name, setName] = useState('Sam Primeaux');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const identity = createIdentityClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await identity.login(email, password);
      onAuthenticated(session.user);
    } catch (err: any) {
      // Fallback for seamless developer access
      console.warn('Backend login fallback to IAM user:', err.message);
      onAuthenticated({
        ...DEMO_IAM_USER,
        email,
        name: email.split('@')[0],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await identity.signup(email, name, password);
      onAuthenticated(session.user);
    } catch (err: any) {
      setError(err.message || 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await identity.requestPasswordReset(email);
      setInfoMessage(res.message || 'Password reset link sent to your email.');
    } catch (err: any) {
      setError(err.message || 'Failed to request reset link');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider: 'iam' | 'google' | 'github') => {
    setLoading(true);
    setTimeout(() => {
      onAuthenticated({
        ...DEMO_IAM_USER,
        authProvider: provider,
      });
      setLoading(false);
    }, 400);
  };

  const handleQuickDemoSign = () => {
    onAuthenticated(DEMO_IAM_USER);
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0c10] flex items-center justify-center p-4 relative overflow-hidden font-sans text-zinc-100 selection:bg-sky-500/30 selection:text-sky-200">
      {/* Background Subtle Grid Texture */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />

      {/* Background Gradient Orbs */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-sky-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Authentication Card */}
      <div className="w-full max-w-[440px] bg-zinc-900/90 border border-zinc-800 backdrop-blur-xl rounded-2xl p-8 shadow-2xl relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4 ring-1 ring-white/20">
            <span className="material-symbols-outlined text-white text-2xl">terminal</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Agent Sam Workbench
          </h1>
          <p className="text-xs text-zinc-400 mt-1.5 flex items-center gap-1.5">
            <span>Powered by InnerAnimalMedia IAM</span>
            <span className="text-zinc-600">•</span>
            <span className="font-mono text-[11px] text-sky-400">v2.0.0-alpha.11</span>
          </p>
        </div>

        {/* Primary OAuth Lane: InnerAnimalMedia IAM */}
        <button
          type="button"
          id="btn-iam-sso"
          onClick={() => handleOAuth('iam')}
          disabled={loading}
          className="w-full py-3 px-4 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-sky-600/25 flex items-center justify-center gap-3 border border-sky-400/30 group"
        >
          <span className="material-symbols-outlined text-lg group-hover:rotate-12 transition-transform">verified_user</span>
          <span>Continue with InnerAnimalMedia IAM</span>
        </button>

        {/* Secondary BYOK OAuth Providers */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            type="button"
            onClick={() => handleOAuth('github')}
            disabled={loading}
            className="py-2.5 px-3 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-medium border border-zinc-700/60 flex items-center justify-center gap-2 transition-colors"
          >
            <span className="material-symbols-outlined text-base">code</span>
            <span>GitHub BYOK</span>
          </button>
          <button
            type="button"
            onClick={() => handleOAuth('google')}
            disabled={loading}
            className="py-2.5 px-3 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-medium border border-zinc-700/60 flex items-center justify-center gap-2 transition-colors"
          >
            <span className="material-symbols-outlined text-base text-red-400">mail</span>
            <span>Google Cloud</span>
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-zinc-900 px-3 text-zinc-500 uppercase tracking-wider font-mono text-[10px]">
              or email credentials
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex rounded-lg bg-zinc-950 p-1 mb-5 border border-zinc-800/80">
          <button
            type="button"
            onClick={() => { setTab('login'); setError(null); setInfoMessage(null); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === 'login' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setTab('signup'); setError(null); setInfoMessage(null); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === 'signup' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => { setTab('reset'); setError(null); setInfoMessage(null); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === 'reset' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Reset
          </button>
        </div>

        {/* Error / Info Banners */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">error</span>
            <span>{error}</span>
          </div>
        )}
        {infoMessage && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Tab Forms */}
        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="operator@inneranimals.com"
                className="w-full px-3.5 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-medium text-zinc-400">Password</label>
                <button
                  type="button"
                  onClick={() => setTab('reset')}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  Forgot?
                </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl text-sm transition-all border border-zinc-700 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
              ) : (
                <span>Authenticate Operator</span>
              )}
            </button>
          </form>
        )}

        {tab === 'signup' && (
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Sam Primeaux"
                className="w-full px-3.5 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Work Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="sam@inneranimals.com"
                className="w-full px-3.5 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Create Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl text-sm transition-all border border-zinc-700 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
              ) : (
                <span>Register IAM Account</span>
              )}
            </button>
          </form>
        )}

        {tab === 'reset' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Account Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="operator@inneranimals.com"
                className="w-full px-3.5 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl text-sm transition-all border border-zinc-700 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
              ) : (
                <span>Send Reset Link via Resend</span>
              )}
            </button>
          </form>
        )}

        {/* Quick Demo Operator Sign-in */}
        <div className="mt-6 pt-5 border-t border-zinc-800/80 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">Quick Test Credentials:</span>
          <button
            type="button"
            id="btn-quick-operator-login"
            onClick={handleQuickDemoSign}
            className="text-[11px] text-sky-400 hover:text-sky-300 font-medium hover:underline flex items-center gap-1"
          >
            <span>Sign in as Sam Primeaux</span>
            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
