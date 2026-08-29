/**
 * Google Workspace (Drive + Gmail) auth — Google Identity Services (GIS) token
 * client, NOT Firebase. Same popup-based OAuth UX as the prior Firebase Auth
 * implementation, same exported interface (initAuth/googleSignIn/getAccessToken/
 * logout), so driveService.ts, gmailService.ts, and the workspace UI components
 * need zero changes.
 *
 * GOOGLE_CLIENT_ID below is the same public client ID already used for
 * "Sign in with Google" on inneranimalmedia.com (client IDs are safe to expose
 * by OAuth design). This is an implicit token-grant flow -- no client secret
 * is used or needed here at all.
 */

export interface GoogleUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

// All requested Google Drive scopes
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
];

// All requested Gmail scopes
export const GMAIL_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
];

export const WORKSPACE_SCOPES = Array.from(new Set([...DRIVE_SCOPES, ...GMAIL_SCOPES]));

const GOOGLE_CLIENT_ID = '427617292678-gf3u47lpf876q7miq31hel2ms6tcr2f8.apps.googleusercontent.com';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: any;
  }
}

// Cache the access token AND user in memory ONLY (never in localStorage/sessionStorage) --
// same non-negotiable as the Firebase version.
let cachedAccessToken: string | null = null;
let cachedUser: GoogleUser | null = null;
let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

async function fetchUserInfo(accessToken: string): Promise<GoogleUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Google user info: HTTP ${res.status}`);
  const data = await res.json();
  return {
    uid: data.sub,
    displayName: data.name ?? null,
    email: data.email ?? null,
    photoURL: data.picture ?? null,
  };
}

/**
 * Report current in-memory auth state. GIS has no persistent session listener
 * the way Firebase's onAuthStateChanged does -- state lives in memory only,
 * for the same session, matching the original never-persist contract. Returns
 * a no-op unsubscribe function for interface parity with the prior signature.
 */
export const initAuth = (
  onAuthSuccess?: (user: GoogleUser, token: string) => void,
  onAuthFailure?: () => void,
): (() => void) => {
  if (cachedAccessToken && cachedUser) {
    if (onAuthSuccess) onAuthSuccess(cachedUser, cachedAccessToken);
  } else if (onAuthFailure) {
    onAuthFailure();
  }
  return () => {};
};

/**
 * Trigger Google Sign In with Drive + Gmail scopes via GIS popup.
 */
export const googleSignIn = async (): Promise<{ user: GoogleUser; accessToken: string } | null> => {
  await loadGis();
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: WORKSPACE_SCOPES.join(' '),
      callback: async (response: any) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        try {
          const user = await fetchUserInfo(response.access_token);
          cachedAccessToken = response.access_token;
          cachedUser = user;
          resolve({ user, accessToken: response.access_token });
        } catch (err) {
          reject(err);
        }
      },
      error_callback: (err: any) => {
        reject(new Error(err?.message || 'Google sign-in failed'));
      },
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};

/**
 * Retrieve cached access token in memory.
 */
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

/**
 * Clear cached token and revoke the grant.
 */
export const logout = async (): Promise<void> => {
  if (cachedAccessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(cachedAccessToken, () => {});
  }
  cachedAccessToken = null;
  cachedUser = null;
};
