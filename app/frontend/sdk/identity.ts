/**
 * Agent Sam SDK - Identity & Session Management
 * @package @inneranimalmedia/agentsam-sdk/identity
 */

import { IAMUser, AuthSession } from './types';

// Default mock/demo identity user for seamless local development
export const DEMO_IAM_USER: IAMUser = {
  id: 'usr_iam_sam_primeaux_01',
  email: 'info@inneranimals.com',
  name: 'Sam Primeaux',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
  role: 'owner',
  companyId: 'org_inner_animal_media',
  companyName: 'InnerAnimalMedia',
  authProvider: 'iam',
  createdAt: '2025-01-01T00:00:00.000Z',
  lastActiveAt: new Date().toISOString(),
  permissions: ['admin:all', 'repo:read', 'repo:write', 'mission:exec', 'approval:override', 'billing:manage'],
};

export interface IdentityClient {
  getCurrentUser(): Promise<IAMUser | null>;
  login(email: string, password?: string): Promise<AuthSession>;
  signup(email: string, name: string, password?: string): Promise<AuthSession>;
  logout(): Promise<void>;
  requestPasswordReset(email: string): Promise<{ success: boolean; message: string }>;
  confirmPasswordReset(token: string, newPassword: string): Promise<{ success: boolean }>;
  getOAuthUrl(provider: 'iam' | 'google' | 'github'): string;
}

/**
 * Creates the browser-side canonical Identity Client
 */
export function createIdentityClient(): IdentityClient {
  return {
    async getCurrentUser(): Promise<IAMUser | null> {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin',
        });
        if (!res.ok) {
          // Check localStorage fallback for quick session cache
          const localCached = localStorage.getItem('agentsam_session');
          if (localCached) {
            const parsed = JSON.parse(localCached);
            if (parsed?.user) return parsed.user;
          }
          return null;
        }
        const data = await res.json();
        if (data?.user) {
          localStorage.setItem('agentsam_session', JSON.stringify({ user: data.user }));
          return data.user;
        }
        return null;
      } catch (err) {
        console.warn('Identity client check failed, checking fallback cache:', err);
        const localCached = localStorage.getItem('agentsam_session');
        if (localCached) {
          try {
            return JSON.parse(localCached)?.user || null;
          } catch {}
        }
        return null;
      }
    },

    async login(email: string, password?: string): Promise<AuthSession> {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to authenticate');
      }

      const session: AuthSession = await res.json();
      localStorage.setItem('agentsam_session', JSON.stringify(session));
      return session;
    },

    async signup(email: string, name: string, password?: string): Promise<AuthSession> {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to create account');
      }

      const session: AuthSession = await res.json();
      localStorage.setItem('agentsam_session', JSON.stringify(session));
      return session;
    },

    async logout(): Promise<void> {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        localStorage.removeItem('agentsam_session');
      }
    },

    async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return await res.json();
    },

    async confirmPasswordReset(token: string, newPassword: string): Promise<{ success: boolean }> {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      return await res.json();
    },

    getOAuthUrl(provider: 'iam' | 'google' | 'github'): string {
      return `/api/oauth/${provider}/start`;
    },
  };
}
