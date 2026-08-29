/**
 * Agent Sam SDK - Repository Intelligence & Graph Analysis
 * @package @inneranimalmedia/agentsam-sdk/repository
 */

import { RepositoryIntelligenceReport, GodFileCandidate, DuplicateAuthoritySignal } from './types';

// Mock repository data fixtures for realistic standalone analysis
export const REPOSITORY_FIXTURES: Record<string, Partial<RepositoryIntelligenceReport>> = {
  'SamPrimeaux/inneranimalmedia': {
    repoName: 'SamPrimeaux/inneranimalmedia',
    branch: 'main',
    commitHash: '7bfa92e1',
    summary: {
      totalFiles: 342,
      totalLoc: 48920,
      totalLanguages: 5,
      testCoverageRatio: 0.78,
      healthScore: 84,
    },
    languageDistribution: {
      TypeScript: { files: 245, loc: 36400, percentage: 74.4 },
      TSX: { files: 68, loc: 9200, percentage: 18.8 },
      CSS: { files: 12, loc: 2100, percentage: 4.3 },
      JSON: { files: 14, loc: 1100, percentage: 2.2 },
      Shell: { files: 3, loc: 120, percentage: 0.3 },
    },
    godFileCandidates: [
      {
        path: 'src/legacy/authManager.ts',
        reason: 'Manages cookies, token exchange, role validation, and direct DB access in one 1,420 LOC file.',
        loc: 1420,
        incomingReferences: 34,
        distinctResponsibilities: ['Cookie parsing', 'JWT signing', 'RBAC policy', 'DB User queries'],
      },
      {
        path: 'packages/core/src/router.ts',
        reason: 'Handles 42 distinct API paths, middleware chains, and SSR stream piping.',
        loc: 980,
        incomingReferences: 28,
        distinctResponsibilities: ['Route table', 'Rate limiting', 'Telemetry logging', 'Stream error fallback'],
      },
    ],
    duplicateAuthoritySignals: [
      {
        domain: 'Authentication & Session Authority',
        description: 'Duplicate auth check logic found in both `src/legacy/authManager.ts` and `@inneranimalmedia/agentsam-sdk/identity`.',
        filesInvolved: ['src/legacy/authManager.ts', 'packages/server/authMiddleware.ts', 'sdk/identity.ts'],
        recommendation: 'Deprecate `src/legacy/authManager.ts` and standardize all token and session evaluation on SDK Worker router.',
      },
      {
        domain: 'Tool Execution Authority',
        description: 'Shell commands executed via both local child_process in server and Cloudflare Computer isolate.',
        filesInvolved: ['backend/runners/execHost.ts', 'sdk/environments/cloudflareComputer.ts'],
        recommendation: 'Route all execution through the unified ExecutionEnvironment contract.',
      },
    ],
    largeFiles: [
      { path: 'src/legacy/authManager.ts', loc: 1420, sizeKb: 48.2 },
      { path: 'packages/ui/src/ChatComposer.tsx', loc: 940, sizeKb: 32.6 },
      { path: 'packages/core/src/router.ts', loc: 980, sizeKb: 34.1 },
      { path: 'packages/runtime/src/engine.ts', loc: 810, sizeKb: 27.5 },
    ],
    hotFilesByGitChurn: [
      { path: 'packages/ui/src/ChatComposer.tsx', commitsInLast30Days: 24, churnScore: 92 },
      { path: 'src/legacy/authManager.ts', commitsInLast30Days: 18, churnScore: 84 },
      { path: 'wrangler.jsonc', commitsInLast30Days: 15, churnScore: 76 },
      { path: 'packages/core/src/config.ts', commitsInLast30Days: 11, churnScore: 62 },
    ],
    staleFiles: [
      { path: 'src/legacy/oldStorageAdapter.ts', daysSinceLastTouch: 210 },
      { path: 'scripts/deploy-staging-old.sh', daysSinceLastTouch: 180 },
    ],
    directoryDensity: [
      { directory: 'packages/ui/src', fileCount: 48, averageLoc: 165 },
      { directory: 'packages/core/src', fileCount: 32, averageLoc: 210 },
      { directory: 'src/legacy', fileCount: 14, averageLoc: 420 },
      { directory: 'sdk', fileCount: 22, averageLoc: 180 },
    ],
    dependencyPressure: {
      directDependencies: 18,
      devDependencies: 24,
      vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 },
      circularDependencies: [
        ['packages/core/src/context.ts', 'packages/core/src/state.ts', 'packages/core/src/context.ts'],
      ],
    },
    workspaceTopology: {
      isMonorepo: true,
      packages: [
        { name: '@inneranimalmedia/core', path: 'packages/core', loc: 12400 },
        { name: '@inneranimalmedia/ui', path: 'packages/ui', loc: 16200 },
        { name: '@inneranimalmedia/agentsam-sdk', path: 'sdk', loc: 14800 },
        { name: 'workbench-app', path: '.', loc: 5520 },
      ],
    },
  },
  'SamPrimeaux/agentsam-sdk': {
    repoName: 'SamPrimeaux/agentsam-sdk',
    branch: 'main',
    commitHash: '4a19dc02',
    summary: {
      totalFiles: 48,
      totalLoc: 14800,
      totalLanguages: 2,
      testCoverageRatio: 0.94,
      healthScore: 96,
    },
    languageDistribution: {
      TypeScript: { files: 42, loc: 13900, percentage: 93.9 },
      JSON: { files: 6, loc: 900, percentage: 6.1 },
    },
    godFileCandidates: [],
    duplicateAuthoritySignals: [],
    largeFiles: [
      { path: 'src/repository/inspector.ts', loc: 680, sizeKb: 22.4 },
      { path: 'src/identity/service.ts', loc: 590, sizeKb: 19.8 },
    ],
    hotFilesByGitChurn: [
      { path: 'src/repository/inspector.ts', commitsInLast30Days: 14, churnScore: 78 },
      { path: 'src/identity/service.ts', commitsInLast30Days: 9, churnScore: 54 },
    ],
    staleFiles: [],
    directoryDensity: [
      { directory: 'src/identity', fileCount: 8, averageLoc: 190 },
      { directory: 'src/repository', fileCount: 12, averageLoc: 220 },
      { directory: 'src/environments', fileCount: 10, averageLoc: 175 },
      { directory: 'src/tools', fileCount: 12, averageLoc: 160 },
    ],
    dependencyPressure: {
      directDependencies: 4,
      devDependencies: 8,
      vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 },
      circularDependencies: [],
    },
    workspaceTopology: {
      isMonorepo: false,
      packages: [{ name: '@inneranimalmedia/agentsam-sdk', path: '.', loc: 14800 }],
    },
  },
};

export class RepositoryIntelligence {
  async inspect(repoName: string = 'SamPrimeaux/inneranimalmedia'): Promise<RepositoryIntelligenceReport> {
    // Check if we have server endpoint or use fixture fallback
    try {
      const res = await fetch('/api/repository/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}

    const fixture = REPOSITORY_FIXTURES[repoName] || REPOSITORY_FIXTURES['SamPrimeaux/inneranimalmedia'];
    return {
      repoName,
      branch: fixture.branch || 'main',
      commitHash: fixture.commitHash || '8f12a4b0',
      generatedAt: Date.now(),
      summary: fixture.summary || {
        totalFiles: 120,
        totalLoc: 18400,
        totalLanguages: 3,
        testCoverageRatio: 0.85,
        healthScore: 90,
      },
      languageDistribution: fixture.languageDistribution || {},
      largeFiles: fixture.largeFiles || [],
      hotFilesByGitChurn: fixture.hotFilesByGitChurn || [],
      staleFiles: fixture.staleFiles || [],
      godFileCandidates: fixture.godFileCandidates || [],
      duplicateAuthoritySignals: fixture.duplicateAuthoritySignals || [],
      directoryDensity: fixture.directoryDensity || [],
      dependencyPressure: fixture.dependencyPressure || {
        directDependencies: 10,
        devDependencies: 12,
        vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 },
        circularDependencies: [],
      },
      workspaceTopology: fixture.workspaceTopology || {
        isMonorepo: false,
        packages: [{ name: repoName, path: '.', loc: 18400 }],
      },
    };
  }

  async getFileTree(repoName: string = 'SamPrimeaux/inneranimalmedia'): Promise<string[]> {
    if (repoName === 'SamPrimeaux/agentsam-sdk') {
      return [
        'package.json',
        'tsconfig.json',
        'README.md',
        'src/index.ts',
        'src/types.ts',
        'src/identity/index.ts',
        'src/identity/service.ts',
        'src/identity/d1Adapter.ts',
        'src/repository/index.ts',
        'src/repository/inspector.ts',
        'src/repository/churn.ts',
        'src/environments/index.ts',
        'src/environments/cloudflareComputer.ts',
        'src/environments/antigravity.ts',
        'src/tools/index.ts',
        'src/tools/registry.ts',
        'src/tools/filesystem.ts',
        'src/tools/terminal.ts',
        'tests/identity.test.ts',
        'tests/repository.test.ts',
        'tests/mission.test.ts',
      ];
    }

    return [
      'package.json',
      'tsconfig.json',
      'wrangler.jsonc',
      'README.md',
      'packages/ui/src/ChatComposer.tsx',
      'packages/ui/src/ChatComposer.css',
      'packages/ui/src/index.ts',
      'packages/ui/tests/ChatComposer.test.tsx',
      'packages/core/src/index.ts',
      'packages/core/src/router.ts',
      'packages/core/src/config.ts',
      'packages/runtime/src/engine.ts',
      'packages/runtime/src/sandbox.ts',
      'src/legacy/authManager.ts',
      'src/legacy/oldStorageAdapter.ts',
      'sdk/index.ts',
      'sdk/types.ts',
      'sdk/identity.ts',
      'sdk/repository.ts',
      'sdk/mission.ts',
    ];
  }
}
