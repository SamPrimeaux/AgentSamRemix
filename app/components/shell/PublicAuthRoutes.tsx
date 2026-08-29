import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthSignInPage } from '../auth/AuthSignInPage';
import { AuthSignUpPage } from '../auth/AuthSignUpPage';
import { AuthForgotPage } from '../auth/AuthForgotPage';
import { AuthResetPage } from '../auth/AuthResetPage';
import AuthOAuthConsentPage from '../auth/AuthOAuthConsentPage';
import MountIamMcpConsent from '../auth/MountIamMcpConsent';
import { OnboardingPage } from '../onboarding/OnboardingPage';

/** Non-dashboard auth/onboarding routes (Wave 2 host peel). */
export function PublicAuthRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/auth/login" element={<AuthSignInPage />} />
      <Route path="/auth/signup" element={<AuthSignUpPage />} />
      <Route path="/forgot-password" element={<AuthForgotPage />} />
      <Route path="/reset-password" element={<AuthResetPage />} />
      <Route path="/api/auth/oauth/consent" element={<AuthOAuthConsentPage />} />
      <Route path="/oauth/mcp/consent" element={<MountIamMcpConsent />} />
      <Route path="*" element={<Navigate to="/auth/login" replace />} />
    </Routes>
  );
}
