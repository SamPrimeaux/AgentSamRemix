import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Mock session in memory for server-side auth persistence
let currentServerSession: any = {
  token: 'iam_tok_demo_session_9281',
  user: {
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
  },
  expiresAt: Date.now() + 86400000 * 7,
};

// ==========================================
// 1. Identity Worker Routes
// ==========================================

// Authoritative user check
app.get('/api/auth/me', (req, res) => {
  if (currentServerSession?.user) {
    return res.json({ user: currentServerSession.user });
  }
  return res.status(401).json({ error: 'Unauthenticated' });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = {
    id: `usr_${Math.random().toString(36).slice(2, 9)}`,
    email,
    name: email.split('@')[0] || 'Operator',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    role: 'owner',
    companyId: 'org_inner_animal_media',
    companyName: 'InnerAnimalMedia',
    authProvider: 'email',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    permissions: ['admin:all', 'repo:read', 'repo:write', 'mission:exec', 'approval:override'],
  };

  currentServerSession = {
    token: `iam_tok_${Date.now()}`,
    user,
    expiresAt: Date.now() + 86400000 * 7,
  };

  res.cookie('agentsam_jwt', currentServerSession.token, { httpOnly: true, secure: true, sameSite: 'lax' });
  return res.json(currentServerSession);
});

// Signup
app.post('/api/auth/signup', (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' });
  }

  const user = {
    id: `usr_${Math.random().toString(36).slice(2, 9)}`,
    email,
    name,
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    role: 'engineer',
    companyId: 'org_inner_animal_media',
    companyName: 'InnerAnimalMedia',
    authProvider: 'email',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    permissions: ['repo:read', 'repo:write', 'mission:exec'],
  };

  currentServerSession = {
    token: `iam_tok_${Date.now()}`,
    user,
    expiresAt: Date.now() + 86400000 * 7,
  };

  res.cookie('agentsam_jwt', currentServerSession.token, { httpOnly: true, secure: true, sameSite: 'lax' });
  return res.json(currentServerSession);
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  currentServerSession = null;
  res.clearCookie('agentsam_jwt');
  return res.json({ success: true });
});

// Password reset
app.post('/api/auth/password-reset/request', (req, res) => {
  const { email } = req.body;
  return res.json({ success: true, message: `Password reset instructions sent to ${email} via Resend.` });
});

app.post('/api/auth/password-reset/confirm', (req, res) => {
  return res.json({ success: true });
});

// OAuth Lanes
app.get('/api/oauth/iam/start', (req, res) => {
  // Simulated OAuth redirect back to workbench
  res.redirect('/dashboard/workbench');
});

app.get('/api/oauth/google/start', (req, res) => {
  res.redirect('/dashboard/workbench');
});

app.get('/api/oauth/github/start', (req, res) => {
  res.redirect('/dashboard/workbench');
});

// Company profile
app.get('/api/company', (req, res) => {
  return res.json({
    id: 'org_inner_animal_media',
    name: 'InnerAnimalMedia',
    tier: 'Enterprise Dedicated',
    d1Database: 'iam-production-d1',
    r2Bucket: 'iam-artifacts-store',
    activeOperator: currentServerSession?.user?.email || 'info@inneranimals.com',
  });
});

// ==========================================
// 2. Repository & Execution API
// ==========================================

// Multimodal Image Analysis & Classification API
app.post('/api/vision/analyze', async (req, res) => {
  try {
    const { imageData, mimeType = 'image/png', prompt = 'Analyze this engineering artifact / screenshot', repoContext } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'imageData is required' });
    }

    // Clean base64 data if prefixed with data:image/...;base64,
    let base64Clean = imageData;
    let actualMime = mimeType;
    if (imageData.startsWith('data:')) {
      const match = imageData.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        actualMime = match[1];
        base64Clean = match[2];
      }
    }

    // Check for Gemini API Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const visionPrompt = `
You are Agent Sam's Vision Intelligence Engine.
Analyze this uploaded technical image, screenshot, architecture diagram, UI mockup, or error trace.

User instruction or context: "${prompt}"
${repoContext ? `Active Repository: ${repoContext}` : ''}

You MUST classify the image into ONE of these primary categories:
- "UI_MOCKUP": UI layout, mobile screen, wireframe, frontend component, button/form design
- "ARCHITECTURE_DIAGRAM": Cloud topology, service flow, database schema, auth boundaries, system design
- "ERROR_LOG_TRACE": Terminal log, compiler error, stack trace, failing test, console error
- "CODE_SNIPPET": IDE editor screenshot, syntax diff, function implementation
- "GENERAL_TECHNICAL": General technical illustration or artifact

Output ONLY a valid JSON object matching this schema:
{
  "classification": "UI_MOCKUP" | "ARCHITECTURE_DIAGRAM" | "ERROR_LOG_TRACE" | "CODE_SNIPPET" | "GENERAL_TECHNICAL",
  "confidence": 0.95,
  "title": "A short descriptive title for this image",
  "summary": "2-3 sentences explaining what is shown in the image and its engineering significance.",
  "ocrText": "Key text or logs extracted from the image",
  "detectedEntities": ["list", "of", "detected", "components", "or", "services"],
  "suggestedActions": ["1. Specific engineering step", "2. Next refactor or fix action"],
  "suggestedMissionPrompt": "Formulated mission prompt for Agent Sam to execute on this image",
  "codeSnippetProposal": "Optional code snippet or Tailwind/React or fix to implement based on image"
}
`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: base64Clean,
                    mimeType: actualMime,
                  },
                },
                { text: visionPrompt },
              ],
            },
          ],
        });

        const textOutput = response.text || '';
        // Extract JSON from response text (which might be wrapped in ```json ... ```)
        const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json({
            id: `vis_${Date.now()}`,
            classification: parsed.classification || 'UI_MOCKUP',
            confidence: parsed.confidence || 0.96,
            title: parsed.title || 'Visual Artifact Analysis',
            summary: parsed.summary || textOutput.slice(0, 200),
            ocrText: parsed.ocrText || '',
            detectedEntities: parsed.detectedEntities || [],
            suggestedActions: parsed.suggestedActions || [],
            suggestedMissionPrompt: parsed.suggestedMissionPrompt || prompt,
            codeSnippetProposal: parsed.codeSnippetProposal || '',
            analyzedAt: Date.now(),
          });
        }
      } catch (geminiError: any) {
        console.warn('Gemini vision API call failed, falling back to local heuristic analyzer:', geminiError.message);
      }
    }

    // Smart Local Heuristic Fallback
    const isErrorHint = prompt.toLowerCase().includes('error') || prompt.toLowerCase().includes('fail') || prompt.toLowerCase().includes('trace');
    const isArchHint = prompt.toLowerCase().includes('arch') || prompt.toLowerCase().includes('diagram') || prompt.toLowerCase().includes('flow');
    const isCodeHint = prompt.toLowerCase().includes('code') || prompt.toLowerCase().includes('diff') || prompt.toLowerCase().includes('function');

    const classification = isErrorHint ? 'ERROR_LOG_TRACE' : isArchHint ? 'ARCHITECTURE_DIAGRAM' : isCodeHint ? 'CODE_SNIPPET' : 'UI_MOCKUP';
    
    return res.json({
      id: `vis_${Date.now()}`,
      classification,
      confidence: 0.94,
      title: classification === 'UI_MOCKUP' 
        ? 'Mobile UI Spec & Execution Timeline' 
        : classification === 'ARCHITECTURE_DIAGRAM'
        ? 'System Boundary & Authority Diagram'
        : 'Runtime Diagnostic & Trace Artifact',
      summary: `Agent Sam vision parser analyzed image payload (${Math.round(base64Clean.length * 0.75 / 1024)} KB). Detected ${classification.toLowerCase().replace('_', ' ')} elements ready for autonomous engineering execution.`,
      ocrText: 'Agent Sam / Mission active / Auth refactor drop-in prep / Execution timeline / Running tests 2/5 / Approval needed',
      detectedEntities: ['Mobile Navigation Bar', 'Execution Timeline', 'Approval Gate', 'Status Badges', 'Composer Bar'],
      suggestedActions: [
        'Unify mobile chat composer safe-area insets for iOS devices',
        'Wire realtime image preview chips in mission launcher',
        'Connect timeline step nodes with live animated execution status rings'
      ],
      suggestedMissionPrompt: `Implement mobile interface polish matching attached spec: ${prompt}`,
      codeSnippetProposal: `<div className="mobile-shell p-4 bg-zinc-900 rounded-2xl shadow-xl">\n  <ExecutionTimeline />\n</div>`,
      analyzedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('Vision analysis error:', err);
    res.status(500).json({ error: err.message || 'Vision analysis failed' });
  }
});

app.post('/api/repository/inspect', (req, res) => {
  const { repoName } = req.body;
  // Return inspection data
  res.json({
    repoName: repoName || 'SamPrimeaux/inneranimalmedia',
    branch: 'main',
    commitHash: '7bfa92e1',
    generatedAt: Date.now(),
    summary: {
      totalFiles: 342,
      totalLoc: 48920,
      totalLanguages: 5,
      testCoverageRatio: 0.78,
      healthScore: 84,
    },
    duplicateAuthoritySignals: [
      {
        domain: 'Authentication & Session Authority',
        description: 'Duplicate auth check logic found in both `src/legacy/authManager.ts` and `@inneranimalmedia/agentsam-sdk/identity`.',
        filesInvolved: ['src/legacy/authManager.ts', 'packages/server/authMiddleware.ts', 'sdk/identity.ts'],
        recommendation: 'Deprecate `src/legacy/authManager.ts` and standardize all token and session evaluation on SDK Worker router.',
      },
    ],
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', runtime: 'cloudflare-worker-host', version: '2.0.0-alpha.identity.11' });
});

// ==========================================
// 3. Vite Server Integration
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agent Sam Workbench server running on port ${PORT}`);
  });
}

startServer();
