import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

import { createInteraction, streamInteraction } from "./server/lib/agentClient.ts";
import { createInteraction as createInteractionPerseus, streamInteraction as streamInteractionPerseus } from "./server/lib/agentClientPerseus.ts";
import { getDatabase } from "./server/db/database.ts";
import { thompsonRouter } from "./server/lib/thompsonRouter.ts";
import { UnifiedPolicyRouter } from "./server/lib/routing/policyRouter.ts";
import { PolicyModel } from "./server/lib/routing/policyModel.ts";
import { DatasetExtractor } from "./server/lib/routing/datasetExtractor.ts";
import { ToolLaneSelector } from "./server/lib/routing/toolLaneSelector.ts";
import { sanitizeForTelemetry } from "./server/lib/crypto.ts";
import { documentChunkService } from "./app/backend/services/documentChunkService.ts";
import { ragAgentService } from "./app/backend/services/ragAgentService.ts";
import { embeddingService } from "./app/backend/ai/embeddings/index.ts";
import {
  defaultWorkflowRuntime,
  WorkflowVersionManager,
  QueueDispatcherService,
} from "./app/backend/workflows/index.ts";

function loadAgentFiles(dir: string, basePath: string): Array<{type: string, content: string, target: string}> {
  let files: Array<{type: string, content: string, target: string}> = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const targetPath = path.posix.join(basePath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(loadAgentFiles(fullPath, targetPath));
    } else {
      files.push({
        type: "inline",
        content: fs.readFileSync(fullPath, "utf-8"),
        target: targetPath
      });
    }
  }
  return files;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/tts", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Missing text." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'x-goog-api-client': 'applet-agentsamfast/1.0.0',
            'User-Agent': 'aistudio-build'
          }
        }
      });
      const interaction = await ai.interactions.create({
        model: 'gemini-3.1-flash-tts-preview',
        input: text,
        response_modalities: ['audio'],
        generation_config: {
          speech_config: [
            {
              speaker: "Speaker 1",
              language: "en-us",
              voice: "kore"
            },
            {
              speaker: "Speaker 2",
              language: "en-us",
              voice: "aoede"
            }
          ]
        }
      });

      let audioBuffer = null;
      let mimeType = "audio/wav";

      for (const step of interaction.steps) {
        if (step.type === 'model_output') {
          const audioContent = step.content?.find(c => c.type === 'audio');
          if (audioContent && audioContent.data) {
            const pcmBuffer = Buffer.from(audioContent.data, 'base64');
            
            // If it's raw PCM, wrap it in a WAV header so browsers can play it
            if (audioContent.mime_type === 'audio/l16' || !audioContent.mime_type) {
              const sampleRate = 24000;
              const numChannels = 1;
              const wavHeader = Buffer.alloc(44);
              wavHeader.write("RIFF", 0);
              wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
              wavHeader.write("WAVE", 8);
              wavHeader.write("fmt ", 12);
              wavHeader.writeUInt32LE(16, 16);
              wavHeader.writeUInt16LE(1, 20);
              wavHeader.writeUInt16LE(numChannels, 22);
              wavHeader.writeUInt32LE(sampleRate, 24);
              wavHeader.writeUInt32LE(sampleRate * numChannels * 2, 28);
              wavHeader.writeUInt16LE(numChannels * 2, 32);
              wavHeader.writeUInt16LE(16, 34);
              wavHeader.write("data", 36);
              wavHeader.writeUInt32LE(pcmBuffer.length, 40);
              
              audioBuffer = Buffer.concat([wavHeader, pcmBuffer]);
              mimeType = "audio/wav";
            } else {
              audioBuffer = pcmBuffer;
              mimeType = audioContent.mime_type;
            }
          }
        }
      }

      if (audioBuffer) {
        res.setHeader("Content-Type", mimeType);
        res.send(audioBuffer);
      } else {
        res.status(500).json({ error: "Failed to generate audio content" });
      }
    } catch (error: any) {
      console.error("[TTS] Error:", error);
      res.status(500).json({ error: error.message || "TTS Generation failed" });
    }
  });


  app.post("/api/upload_artifact", express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    try {
        const fileName = req.query.name || 'podcast_briefing.wav';
        const localArtifactsDir = path.join(process.cwd(), 'workspace', 'artifacts');
        if (!fs.existsSync(localArtifactsDir)) {
            fs.mkdirSync(localArtifactsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(localArtifactsDir, fileName as string), req.body);
        console.log(`[upload] Successfully saved ${fileName} (${req.body.length} bytes)`);
        res.json({ success: true });
    } catch (e) {
        console.error("[upload] Error:", e);
        res.status(500).json({ error: String(e) });
    }
  });

  // Initialize D1 / SQLite database
  const db = await getDatabase();

  // Multi-Turn Chatbot Endpoint with Gemini models, system instruction roles, and file multimodal context
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages = [], model = "gemini-3.7-flash", role = "equity_analyst", customInstruction } = req.body;
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const roleInstructions: Record<string, string> = {
        equity_analyst: "You are AgentSamFast's Senior Wall Street Equity Research Analyst. Your focus is fundamental valuation, growth trajectories, gross margin expansion, return on invested capital (ROIC), cash flow durability, and competitive moats. Provide deep, quantitatively grounded financial analysis with clear structured breakdowns.",
        sec_auditor: "You are AgentSamFast's Principal SEC & Forensic Accounting Auditor. Your focus is 10-K / 10-Q filing disclosures, footnotes, off-balance-sheet items, GAAP vs non-GAAP reconciliations, revenue recognition policies, regulatory risks, and insider transaction filings (Form 4, 13F).",
        quant_strategist: "You are AgentSamFast's Quantitative & Macro Hedge Fund Strategist. Your focus is factor exposures, interest rate sensitivity, sector rotation, catalyst timing, volatility regime modeling, and risk-adjusted return profiling.",
        general_assistant: "You are AgentSamFast, an autonomous multimodal financial intelligence agent. Provide clear, rigorous, and actionable financial document and securities analysis with professional formatting.",
      };

      const systemInstruction = customInstruction || roleInstructions[role] || roleInstructions.equity_analyst;

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      // Construct history and current message parts for generateContentStream
      const contents = messages.map((m: any) => {
        const parts: any[] = [];
        if (m.files && Array.isArray(m.files)) {
          for (const f of m.files) {
            if (f.base64 && f.type) {
              parts.push({
                inlineData: {
                  mimeType: f.type,
                  data: f.base64
                }
              });
            } else if (f.text) {
              parts.push({
                text: `[Attached File: ${f.name || 'document'}]\n${f.text}`
              });
            }
          }
        }
        if (m.content) {
          parts.push({ text: m.content });
        }
        return {
          role: m.role === 'user' ? 'user' : 'model',
          parts
        };
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const responseStream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        }
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (err: any) {
      console.error("[Chat] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Chat failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: err.message || "Streaming error" })}\n\n`);
        res.end();
      }
    }
  });

  // Direct Financial Document / File Analysis Endpoint (Dossier format)
  app.post("/api/analyze_files", async (req, res) => {
    try {
      const { files = [], title = "Custom Financial Document", instruction, model = "gemini-3.7-flash" } = req.body;
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      const parts: any[] = [];
      for (const f of files) {
        if (f.base64 && f.type) {
          parts.push({
            inlineData: {
              mimeType: f.type,
              data: f.base64
            }
          });
        } else if (f.text) {
          parts.push({
            text: `[Document: ${f.name}]\n${f.text}`
          });
        }
      }

      const promptText = `You are AgentSamFast, an autonomous financial intelligence analyzer.
Perform a thorough, rigorous financial synthesis of the attached document(s) (${title}).
${instruction ? `User Specific Instructions: ${instruction}\n` : ''}

You MUST return your output as a single JSON object strictly matching this schema:
{
  "verdict": {
    "summary": "Comprehensive 2-4 sentence executive overview of the financial results, health, and key developments in the document.",
    "conviction_score": 85,
    "key_takeaways": ["Takeaway 1 with exact numbers", "Takeaway 2", "Takeaway 3", "Takeaway 4"]
  },
  "deep_insights": [
    {
      "category": "Revenue & Growth / Risk / Profitability",
      "title": "Insight title",
      "description": "Deep analytical description with figures",
      "impact_score": 8
    }
  ],
  "findings": [
    {
      "documentType": "Analyzed Document",
      "keyInsights": ["Specific insight 1", "Specific insight 2"],
      "date": "${new Date().toISOString().split('T')[0]}",
      "sourceUrl": "${title}"
    }
  ],
  "financial_charts": {
    "stock_price_4m": [
      { "date": "Month 1", "price": 100 },
      { "date": "Month 2", "price": 105 },
      { "date": "Month 3", "price": 110 },
      { "date": "Month 4", "price": 115 }
    ],
    "financial_performance_4q": [
      { "quarter": "Q1", "revenue": 10.0, "net_income": 2.0, "distributions": 0.5 },
      { "quarter": "Q2", "revenue": 11.2, "net_income": 2.4, "distributions": 0.5 },
      { "quarter": "Q3", "revenue": 12.1, "net_income": 2.8, "distributions": 0.6 },
      { "quarter": "Q4", "revenue": 13.5, "net_income": 3.1, "distributions": 0.6 }
    ]
  }
}
Output ONLY raw valid JSON inside a \`\`\`json\`\`\` block.`;

      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          temperature: 0.2,
        }
      });

      const responseText = response.text || "";
      let parsedJson: any = null;

      const match = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          parsedJson = JSON.parse(match[1]);
        } catch {}
      }
      if (!parsedJson) {
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsedJson = JSON.parse(responseText.slice(firstBrace, lastBrace + 1));
          } catch {}
        }
      }

      if (!parsedJson) {
        return res.status(500).json({ error: "Failed to parse document analysis JSON", raw: responseText });
      }

      // Background Ingestion into D1 Vector Index with Gemini Embeddings
      (async () => {
        try {
          for (const f of files) {
            if (f.text && f.text.length > 50) {
              await documentChunkService.ingestAndIndexDocument({
                ticker: title.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "DOC",
                title: f.name || title,
                documentType: 'uploaded_file',
                rawText: f.text,
                fileName: f.name,
                fileSizeBytes: f.size || f.text.length,
                metadata: { uploadedVia: "composer_analysis", timestamp: new Date().toISOString() }
              });
            }
          }
        } catch (idxErr) {
          console.warn("[RAG Auto-Ingest] Warning: Failed to index uploaded file chunks in D1:", idxErr);
        }
      })();

      res.json(parsedJson);
    } catch (err: any) {
      console.error("[Analyze Files] Error:", err);
      res.status(500).json({ error: err.message || "File analysis failed" });
    }
  });

  // ────────────────────────────────────────────────────────────
  // RAG & D1 Vector Embeddings Index Endpoints
  // ────────────────────────────────────────────────────────────

  // Ingest and Index a document into D1 with Gemini 2.0 Vector Embeddings
  app.post("/api/rag/ingest", async (req, res) => {
    try {
      const { 
        ticker = "GENERAL", 
        title, 
        documentType = "filing", 
        rawText, 
        sourceUrl, 
        fileName, 
        fileSizeBytes, 
        metadata,
        embeddingProvider,
        embeddingModel,
        embeddingDimensions,
      } = req.body;

      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ error: "rawText is required for document ingestion." });
      }

      const result = await documentChunkService.ingestAndIndexDocument({
        ticker,
        title: title || `${ticker} Document`,
        documentType,
        rawText,
        sourceUrl,
        fileName,
        fileSizeBytes,
        metadata,
        embeddingProvider,
        embeddingModel,
        embeddingDimensions,
      });

      res.json({
        success: true,
        documentId: result.documentId,
        totalChunks: result.totalChunks,
        tokenCount: result.tokenCount,
        ticker: ticker.toUpperCase(),
        embeddingProvider: result.embeddingProvider,
        embeddingModel: result.embeddingModel,
        embeddingDimensions: result.embeddingDimensions,
        isExisting: result.isExisting,
      });
    } catch (e: any) {
      console.error("[RAG Ingest] Error:", e);
      res.status(500).json({ error: e.message || "Document indexing failed." });
    }
  });

  // Re-embed an existing canonical document without duplicating chunks or sources
  app.post("/api/rag/reembed", async (req, res) => {
    try {
      const { documentId, embeddingProvider, embeddingModel, embeddingDimensions } = req.body;
      if (!documentId) {
        return res.status(400).json({ error: "documentId is required." });
      }

      const result = await documentChunkService.reembedDocument(documentId, {
        preferredProvider: embeddingProvider,
        preferredModel: embeddingModel,
        requiredDimensions: embeddingDimensions ? Number(embeddingDimensions) : undefined,
      });

      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List Registered Embedding Providers & Health/Capabilities
  app.get("/api/rag/providers", async (req, res) => {
    try {
      const capabilities = embeddingService.listCapabilities();
      res.json({ providers: capabilities });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Semantic Vector Search against D1 Document Chunks
  app.post("/api/rag/query", async (req, res) => {
    try {
      const {
        ticker,
        query,
        topK = 5,
        minSimilarity = 0.25,
        embeddingProvider,
        embeddingModel,
        embeddingDimensions,
      } = req.body;
      if (!query || !query.trim()) {
        return res.status(400).json({ error: "query parameter is required." });
      }

      // If ticker is provided, ensure standard filings are initialized
      if (ticker) {
        await ragAgentService.ensureTickerIndexed(ticker);
      }

      const chunks = await documentChunkService.searchSimilarChunks({
        ticker: ticker ? ticker.toUpperCase() : undefined,
        query,
        topK: Number(topK),
        minSimilarity: Number(minSimilarity),
        embeddingProvider,
        embeddingModel,
        embeddingDimensions: embeddingDimensions ? Number(embeddingDimensions) : undefined,
      });

      res.json({
        query,
        ticker: ticker ? ticker.toUpperCase() : null,
        topK,
        resultCount: chunks.length,
        chunks,
      });
    } catch (e: any) {
      console.error("[RAG Query] Error:", e);
      res.status(500).json({ error: e.message || "RAG query failed." });
    }
  });

  // List all Ingested Document Sources in D1
  app.get("/api/rag/sources", async (req, res) => {
    try {
      const ticker = req.query.ticker as string | undefined;
      let sql = `SELECT * FROM agentsam_document_sources`;
      const args: any[] = [];
      if (ticker) {
        sql += ` WHERE ticker = ?`;
        args.push(ticker.toUpperCase());
      }
      sql += ` ORDER BY created_at DESC LIMIT 100`;

      const result = await db.query(sql, args);
      res.json({ sources: sanitizeForTelemetry(result.results) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get Chunks for a specific Document or Ticker
  app.get("/api/rag/chunks", async (req, res) => {
    try {
      const ticker = req.query.ticker as string | undefined;
      const documentId = req.query.document_id as string | undefined;

      let sql = `SELECT id, document_id, ticker, chunk_index, section_title, chunk_text, token_count, char_count, created_at FROM agentsam_document_chunks`;
      const args: any[] = [];

      if (documentId) {
        sql += ` WHERE document_id = ?`;
        args.push(documentId);
      } else if (ticker) {
        sql += ` WHERE ticker = ?`;
        args.push(ticker.toUpperCase());
      }
      sql += ` ORDER BY chunk_index ASC LIMIT 200`;

      const result = await db.query(sql, args);
      res.json({ chunks: sanitizeForTelemetry(result.results) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Thompson Sampling Routing Endpoint using models/gemini-embedding-2
  app.post("/api/thompson/route", async (req, res) => {
    try {
      const { task_type = "sec_financial_analysis", prompt = "", workspace_id, tenant_id } = req.body;
      const decision = await thompsonRouter.routeTask(task_type, prompt, workspace_id, tenant_id);
      res.json(sanitizeForTelemetry(decision));
    } catch (e: any) {
      console.error("[Thompson Route] Error:", e);
      res.status(500).json({ error: e.message || "Routing failed" });
    }
  });

  // Thompson Sampling Reward / Feedback Endpoint
  app.post("/api/thompson/reward", async (req, res) => {
    try {
      const rewardResult = await thompsonRouter.recordReward(req.body);
      res.json(sanitizeForTelemetry(rewardResult));
    } catch (e: any) {
      console.error("[Thompson Reward] Error:", e);
      res.status(500).json({ error: e.message || "Reward update failed" });
    }
  });

  // AgentSam Contextual Policy ML Router (Learned Predictions + Propensities)
  app.post("/api/ml/policy/route", async (req, res) => {
    try {
      const {
        taskType = "general",
        mode = "agent",
        prompt = "",
        toolsRequested = [],
        repoPresent = false,
        repoFilesCount = 0,
        workspaceId,
        tenantId,
      } = req.body;

      const decision = await UnifiedPolicyRouter.routeTask({
        taskType,
        mode,
        prompt,
        toolsRequested,
        repoPresent,
        repoFilesCount,
      });

      res.json(sanitizeForTelemetry(decision));
    } catch (e: any) {
      console.error("[ML Policy Route] Error:", e);
      res.status(500).json({ error: e.message || "Policy routing failed" });
    }
  });

  // Predict Candidate Model Metrics for Input Context
  app.post("/api/ml/policy/predict", async (req, res) => {
    try {
      const decision = await UnifiedPolicyRouter.routeTask(req.body);
      res.json({
        decisionId: decision.decisionId,
        taskType: decision.taskType,
        mode: decision.mode,
        selectedModel: decision.selectedModelKey,
        propensity: decision.selectionProbability,
        candidates: decision.candidateBreakdowns,
        features: decision.phi.denseMap,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Predict Relevant Tools & Rank Execution Lanes
  app.post("/api/ml/policy/tools-lanes", async (req, res) => {
    try {
      const tools = ToolLaneSelector.predictTools(req.body);
      const lanes = ToolLaneSelector.rankExecutionLanes(req.body);
      res.json({ tools, lanes });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Canonical Observation Dataset (JSON format)
  app.get("/api/ml/observations", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const data = await DatasetExtractor.extractObservations(limit);
      res.json(sanitizeForTelemetry(data));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Canonical Observation Dataset (CSV format for scikit-learn / pandas)
  app.get("/api/ml/observations/csv", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 1000;
      const csv = await DatasetExtractor.exportToCsv(limit);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="agentsam_observations.csv"');
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get Active Policy Model Weights
  app.get("/api/ml/policy/weights", async (req, res) => {
    try {
      const weights = await PolicyModel.loadActiveWeights();
      res.json(weights);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Save / Update Policy Model Weights
  app.post("/api/ml/policy/weights", async (req, res) => {
    try {
      const { weights, evalMetrics } = req.body;
      if (!weights || !weights.success) {
        return res.status(400).json({ error: "Invalid weights object" });
      }
      await PolicyModel.saveWeights(weights, evalMetrics || {});
      res.json({ success: true, version: weights.version });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Compacted Tool and Model Telemetry Endpoint
  app.get("/api/stats/compacted", async (req, res) => {
    try {
      const routingMemory = await db.query(
        "SELECT * FROM agentsam_model_routing_memory ORDER BY updated_at DESC LIMIT 50"
      );
      const toolStats = await db.query(
        "SELECT * FROM agentsam_tool_stats_compacted ORDER BY call_count DESC LIMIT 50"
      );
      const rewardEvents = await db.query(
        "SELECT * FROM agentsam_reward_events ORDER BY created_at_unix DESC LIMIT 50"
      );
      res.json({
        routing_memory: sanitizeForTelemetry(routingMemory.results),
        tool_stats: sanitizeForTelemetry(toolStats.results),
        recent_rewards: sanitizeForTelemetry(rewardEvents.results),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Cloudflare Workflows & Queue Control Plane Endpoints ---

  // 1. Start a durable workflow instance
  app.post("/api/workflows/start", async (req, res) => {
    try {
      const result = await defaultWorkflowRuntime.start(req.body);
      res.json(sanitizeForTelemetry(result));
    } catch (e: any) {
      console.error("[Workflows API] Start error:", e);
      res.status(500).json({ error: e.message || "Failed to start workflow" });
    }
  });

  // 2. Batch start multiple workflow instances (e.g. 8 repos or 12 model evaluations)
  app.post("/api/workflows/start-batch", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : req.body.instances || [];
      const results = await defaultWorkflowRuntime.startBatch(items);
      res.json(sanitizeForTelemetry(results));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Get workflow instance status & step logs
  app.get("/api/workflows/instance/:instanceId", async (req, res) => {
    try {
      const status = await defaultWorkflowRuntime.status(req.params.instanceId);
      res.json(sanitizeForTelemetry(status));
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  });

  // 4. Get full step output & retry attempt inspection
  app.get("/api/workflows/instance/:instanceId/step/:step", async (req, res) => {
    try {
      const stepParam = req.params.step;
      const stepIndexOrName = isNaN(Number(stepParam)) ? stepParam : Number(stepParam);
      const attempt = Number(req.query.attempt) || 1;
      const stepDetails = await defaultWorkflowRuntime.getStep(req.params.instanceId, stepIndexOrName, attempt);
      res.json(sanitizeForTelemetry(stepDetails));
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  });

  // 5. Pause workflow instance
  app.post("/api/workflows/instance/:instanceId/pause", async (req, res) => {
    try {
      const result = await defaultWorkflowRuntime.pause(req.params.instanceId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 6. Resume workflow instance
  app.post("/api/workflows/instance/:instanceId/resume", async (req, res) => {
    try {
      const result = await defaultWorkflowRuntime.resume(req.params.instanceId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 7. Restart workflow instance from beginning or from a specific failed step
  app.post("/api/workflows/instance/:instanceId/restart", async (req, res) => {
    try {
      const { fromStep } = req.body;
      const result = await defaultWorkflowRuntime.restart(req.params.instanceId, { fromStep });
      res.json(sanitizeForTelemetry(result));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 8. Terminate workflow instance (with optional Saga compensating rollback)
  app.post("/api/workflows/instance/:instanceId/terminate", async (req, res) => {
    try {
      const { rollback = false } = req.body;
      const result = await defaultWorkflowRuntime.terminate(req.params.instanceId, { rollback });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 9. Send external event to workflow (waitForEvent approval or CI callback)
  app.post("/api/workflows/instance/:instanceId/event", async (req, res) => {
    try {
      const { eventName, payload } = req.body;
      if (!eventName) {
        return res.status(400).json({ error: "Missing eventName" });
      }
      const result = await defaultWorkflowRuntime.sendEvent(req.params.instanceId, eventName, payload || {});
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 10. Get deployed version info
  app.get("/api/workflows/:workflowName/version", async (req, res) => {
    try {
      const version = await defaultWorkflowRuntime.getVersion(req.params.workflowName, req.query.versionId as string);
      res.json(version);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 11. Get deployed graph AST (Cloudflare workflows.versions.graph())
  app.get("/api/workflows/:workflowName/graph", async (req, res) => {
    try {
      const graph = await defaultWorkflowRuntime.getGraph(req.params.workflowName, req.query.versionId as string);
      res.json(graph);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 12. Compare desired graph vs deployed graph (Drift Detection)
  app.get("/api/workflows/:workflowName/drift", async (req, res) => {
    try {
      const drift = await WorkflowVersionManager.compareGraphDrift(req.params.workflowName);
      res.json(drift);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 13. List all registered workflow definitions
  app.get("/api/workflows/definitions", async (req, res) => {
    try {
      const defs = WorkflowVersionManager.getAllDefinitions();
      res.json({
        definitions: defs.map((d) => ({
          workflowName: d.workflowName,
          title: d.title,
          description: d.description,
          category: d.category,
          stepCount: d.steps.length,
          stepNames: d.steps.map((s) => ({ name: s.name, label: s.label })),
          schedules: d.schedules || [],
          stepLimit: d.stepLimit || 10000,
          defaultRetention: d.defaultRetention,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 14. Aggregate Stats for Durable Workflow Runs
  app.get("/api/workflows/stats", async (req, res) => {
    try {
      const totalRes = await db.query(`SELECT COUNT(*) as count FROM agentsam_workflow_runs`);
      const statusRes = await db.query(`
        SELECT status, COUNT(*) as count 
        FROM agentsam_workflow_runs 
        GROUP BY status
      `);
      const workflowRes = await db.query(`
        SELECT external_workflow_name, COUNT(*) as count 
        FROM agentsam_workflow_runs 
        GROUP BY external_workflow_name
      `);
      const recentStepLogs = await db.query(`
        SELECT status, COUNT(*) as count 
        FROM agentsam_workflow_step_logs 
        GROUP BY status
      `);

      const statusCounts: Record<string, number> = {};
      for (const row of statusRes.results || []) {
        statusCounts[row.status] = Number(row.count);
      }

      const workflowCounts: Record<string, number> = {};
      for (const row of workflowRes.results || []) {
        workflowCounts[row.external_workflow_name] = Number(row.count);
      }

      res.json({
        totalRuns: Number(totalRes.results?.[0]?.count || 0),
        running: statusCounts["running"] || 0,
        completed: statusCounts["completed"] || 0,
        failed: statusCounts["failed"] || 0,
        paused: statusCounts["paused"] || 0,
        waiting_for_event: statusCounts["waiting_for_event"] || 0,
        rolled_back: statusCounts["rolled_back"] || 0,
        statusCounts,
        workflowCounts,
        recentStepLogCounts: recentStepLogs.results,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 15. List workflow runs from D1 control plane with filters
  app.get("/api/workflows/runs", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const status = req.query.status as string;
      const workflow = req.query.workflow as string;
      const search = req.query.search as string;

      let query = `SELECT * FROM agentsam_workflow_runs`;
      const conditions: string[] = [];
      const params: any[] = [];

      if (status && status !== "all") {
        conditions.push(`status = ?`);
        params.push(status);
      }
      if (workflow && workflow !== "all") {
        conditions.push(`external_workflow_name = ?`);
        params.push(workflow);
      }
      if (search && search.trim()) {
        conditions.push(`(external_instance_id LIKE ? OR params_json LIKE ? OR external_workflow_name LIKE ?)`);
        const s = `%${search.trim()}%`;
        params.push(s, s, s);
      }

      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(" AND ");
      }
      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const runs = await db.query(query, params);
      res.json({ runs: sanitizeForTelemetry(runs.results) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/download_jsonl", (req, res) => {
    const ticker = req.query.ticker;
    if (!ticker) {
      return res.status(400).send("Missing ticker");
    }
    
    const runLogsDir = path.join(process.cwd(), 'run_logs');
    if (!fs.existsSync(runLogsDir)) {
      return res.status(404).send("No logs found");
    }
    
    const files = fs.readdirSync(runLogsDir)
      .filter(f => f.startsWith(`run_log_${ticker}_`) && f.endsWith('.jsonl'))
      .sort((a, b) => {
        // extract timestamp
        const aMatch = a.match(/_(\d+)\.jsonl$/);
        const bMatch = b.match(/_(\d+)\.jsonl$/);
        if (aMatch && bMatch) {
          return parseInt(bMatch[1]) - parseInt(aMatch[1]);
        }
        return 0;
      });
      
    if (files.length === 0) {
      return res.status(404).send("No JSONL log found for ticker");
    }
    
    const latestFile = path.join(runLogsDir, files[0]);
    res.download(latestFile);
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { ticker, instruction, origin, model } = req.body;
      if (!ticker) {
        return res.status(400).json({ error: "Missing ticker." });
      }

      console.log(`[analyze] Starting analysis for ${ticker} using model ${model || 'default'}`);
      
      const agentFiles = loadAgentFiles(path.join(process.cwd(), "agent"), "/.agents");
      
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const publicUrl = origin || `${protocol}://${host}`;

      let finalInstruction = instruction ? `${instruction}` : `Find and analyze recent SEC filings and public stock documents for ${ticker}. Make sure that you are looking for the most up to date documents of the existing quarter or the quarter before (if documents have not been out yet for the existing quarter, look for the last quarter).`;

      const dynamicSchema = `{
  "verdict": {
    "summary": "...",
    "conviction_score": 85,
    "key_takeaways": ["...", "..."]
  },
  "deep_insights": [
    {
      "category": "Risk Assessment",
      "title": "...",
      "description": "...",
      "impact_score": 8
    }
  ],
  "findings": [
    {
      "documentType": "Form 10-K",
      "keyInsights": ["...", "..."],
      "date": "2023-12-31",
      "sourceUrl": "..."
    }
  ],
  "financial_charts": {
    "stock_price_4m": [
      { "date": "Oct '24", "price": 150.5 }
    ],
    "financial_performance_4q": [
      { "quarter": "Q1 2025", "revenue": 10.5, "net_income": 2.1, "distributions": 0.5 }
    ]
  }
}`;;

      // Check and build RAG Context from D1 Document Chunks
      let ragContextPrompt = "";
      try {
        await ragAgentService.ensureTickerIndexed(ticker);
        ragContextPrompt = await documentChunkService.buildRAGContextPrompt(ticker, finalInstruction, 3);
      } catch (ragErr) {
        console.warn("[RAG Context] Non-blocking warning:", ragErr);
      }

      const prompt = `Perform a comprehensive document analysis on ${ticker}. ${finalInstruction}\n${ragContextPrompt}\nCRITICAL INSTRUCTIONS FOR QUANTITATIVE DATA (CHARTS):
For stock_price_4m and financial_performance_4q, you MUST use standard open web searches (e.g. Yahoo Finance, Google Finance, MarketWatch) WITHOUT the filetype:pdf restriction to get accurate historical prices, distributions, revenue, and net income. Do NOT rely solely on SEC PDFs for this quantitative data.
For stock_price_4m, provide exactly 4 data points representing the past 4 months of stock prices. For each month, give the closing price on the last trading day of the month. Order the array chronologically from the oldest month to the newest month (left to right).
For financial_performance_4q, if the ticker is a regular stock, provide net income and revenue for the past four completed quarters. If it is an ETF, provide quarterly distributions (dividends/yield per share) for the past four completed quarters. Ensure the array is chronologically ordered from oldest quarter to newest (left to right).

CRITICAL INSTRUCTIONS FOR QUALITATIVE DATA (INSIGHTS & SUMMARIES):
For the Executive Summary, Key Takeaways, and Deep Insights, you MUST leverage BOTH the findings extracted from the PDF SEC filings AND insights from broader open web searches to create a comprehensive analysis.

CRITICAL: You MUST output the final synthesis report as a raw JSON object wrapped in \`\`\`json ... \`\`\` markdown block in your final text response. The JSON must match the following schema EXACTLY. **HEAVILY PENALIZED:** Do NOT rename keys. Do NOT add extra root-level keys like "macro_risk_analysis". Make sure to populate the "findings" array with exactly the keys "documentType", "keyInsights", "date", and "sourceUrl". For stock_price_4m, use exactly the keys "date" and "price". The "deep_insights" array MUST use exactly the keys "category", "title", "description", and "impact_score":
${dynamicSchema}
Do not include multiple sub-agents, just do the analysis yourself based on the retrieved documents and searches.`;

      let response;
      if (model === 'perseus') {
        response = await createInteractionPerseus({
          prompt,
          inlineSources: agentFiles,
          tools: [{ type: "google_search" }]
        });
      } else {
        response = await createInteraction({
          prompt,
          inlineSources: agentFiles,
          tools: [{ type: "google_search" }]
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[analyze] createInteraction failed: ${response.status} ${errorText}`);
        return res.status(500).json({ error: "Failed to start agent interaction." });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      
      const startTime = Date.now();
      const runLogsDir = path.join(process.cwd(), 'run_logs');
      if (!fs.existsSync(runLogsDir)) {
          fs.mkdirSync(runLogsDir, { recursive: true });
      }

      const runId = Date.now();
      const jsonlLogPath = path.join(runLogsDir, `run_log_${ticker}_${runId}.jsonl`);
      
      let debugLog = `--- Analysis Run for ${ticker} at ${new Date().toISOString()} ---\n\n`;
      const toolExecutions = {};
      let totalTokens = 0;
          
      const stream = model === 'perseus' ? streamInteractionPerseus(response) : streamInteraction(response);
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        
        if (event.type === 'complete' && event.interaction) {
            const usage = (event.interaction.usage || event.interaction.usage_metadata) as any;
            if (usage) {
                totalTokens = usage.total_tokens || usage.totalTokenCount || usage.total_token_count || 0;
            }
        }
        
        try {
          fs.appendFileSync(jsonlLogPath, JSON.stringify(event) + '\n', 'utf-8');
        } catch (e) {
          console.error("Failed to write to JSONL log", e);
        }
            
        if (event.type === 'tool_call') {
          const callId = event.callId || `unknown_${Math.random()}`;
          toolExecutions[callId] = {
            name: event.name || 'code_execution_call',
            args: event.arguments,
            startTime: Date.now()
          };
          debugLog += `[${new Date().toISOString()}] [TOOL CALL START] ${event.name || 'code_execution_call'}\n`;
          debugLog += `Call ID: ${callId}\n`;
          debugLog += `Arguments: ${JSON.stringify(event.arguments, null, 2)}\n\n`;
        } else if (event.type === 'tool_result') {
          const callId = event.callId || 'unknown';
          const execution = toolExecutions[callId];
          const duration = execution ? ((Date.now() - execution.startTime) / 1000).toFixed(2) + 's' : 'unknown';
          if (execution) {
            execution.duration = duration;
            execution.result = event.result;
          }
          debugLog += `[${new Date().toISOString()}] [TOOL RESULT END] ${event.name || 'command'}\n`;
          debugLog += `Call ID: ${callId}\n`;
          debugLog += `Duration: ${duration}\n`;
          debugLog += `Result: ${event.result ? String(event.result).substring(0, 500) : ''}...\n\n`;
        } else if (event.type === 'text') {
          debugLog += `[TEXT OUTPUT]\n${event.text}\n\n`;
        } else if (event.type === 'error') {
          debugLog += `[ERROR]\n${event.message}\n\n`;
        }

        if (event.type === 'done' || event.type === 'complete' || event.type === 'error') {
            break;
        }
      }
          
      const totalDurationSecs = ((Date.now() - startTime) / 1000);
      const totalDuration = totalDurationSecs.toFixed(2) + 's';
      
      // Send final reliable stats to client
      res.write(`data: ${JSON.stringify({ type: 'final_stats', duration: totalDurationSecs, tokens: totalTokens, jsonlLogUrl: '/run_logs/' + `run_log_${ticker}_${runId}.jsonl` })}\n\n`);

      let summaryLog = `========================================================\n`;
      summaryLog += `                 RUN SUMMARY FOR ${ticker.toUpperCase()}\n`;
      summaryLog += `                 Total Duration: ${totalDuration}\n`;
      summaryLog += `========================================================\n\n`;
      summaryLog += `1. SUB-AGENT EXECUTIONS:\n`;
      summaryLog += `--------------------------------------------------------\n`;
      
      let allWorked = true;
      Object.values(toolExecutions).forEach((exec: any, idx) => {
          const status = exec.result ? 'Completed' : 'Failed/Timeout';
          if (!exec.result || String(exec.result).includes('error') || String(exec.result).includes('traceback')) allWorked = false;
          summaryLog += `Agent Step ${idx + 1}: ${exec.name}\n`;
          summaryLog += `Status: ${status}\n`;
          summaryLog += `Duration: ${exec.duration || 'unknown'}\n`;
          summaryLog += `Arguments: ${JSON.stringify(exec.args)}\n`;
          const resultStr = exec.result ? String(exec.result) : '';
          summaryLog += `Output Preview: ${resultStr ? resultStr.substring(0, 200).replace(/\n/g, ' ') + '...' : 'None'}\n`;
          summaryLog += `--------------------------------------------------------\n`;
      });
      
      summaryLog += `\n2. OVERALL AGENT STATUS: ${allWorked ? 'SUCCESS' : 'WITH ERRORS'}\n`;
      summaryLog += `\n3. GENERATED MEDIA ARTIFACTS:\n`;
      summaryLog += `Audio Briefing Link: /artifacts/podcast_briefing.wav\n`;
      summaryLog += `\n========================================================\n\n`;
      summaryLog += `RAW EXECUTION LOGS:\n\n`;

      try {
        const logFileName = `run_log_${ticker}_${Date.now()}.txt`;
        const finalLog = summaryLog + debugLog;
        fs.writeFileSync(path.join(runLogsDir, logFileName), finalLog, 'utf-8');
        // Maintain backwards compatibility with the old txt file
        fs.writeFileSync(path.join(process.cwd(), `sub_agents_debug_${ticker}.txt`), finalLog, 'utf-8');

        // Record observation in D1 agentsam_model_eval_observations
        const obsId = "obs_" + Date.now();
        await db.query(
          `INSERT INTO agentsam_model_eval_observations (
            id, run_id, created_at, provider, model_key, task_key,
            passed, status, latency_ms, input_tokens, output_tokens, total_tokens,
            estimated_cost_usd, output_chars, expected_markers_found, expected_markers_total,
            updated_at
          ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'google', ?, 'sec_financial_analysis',
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
          [
            obsId,
            String(runId),
            model === "perseus" ? "perseus-antigravity" : "gemini-2.5-flash",
            allWorked ? 1 : 0,
            allWorked ? "completed" : "failed",
            Math.round(totalDurationSecs * 1000),
            Math.round(totalTokens * 0.7),
            Math.round(totalTokens * 0.3),
            totalTokens,
            (totalTokens / 1000000) * 0.15,
            debugLog.length,
            allWorked ? 4 : 2,
            4,
          ]
        );

        // Record Bayesian reward into Thompson Routing Memory
        await thompsonRouter.recordReward({
          decisionId: "run_" + runId,
          taskType: "sec_financial_analysis",
          modelKey: model === "perseus" ? "perseus-antigravity" : "gemini-2.5-flash",
          provider: "google",
          latencyMs: Math.round(totalDurationSecs * 1000),
          inputTokens: Math.round(totalTokens * 0.7),
          outputTokens: Math.round(totalTokens * 0.3),
          convictionScore: 88,
          success: allWorked,
          reason: `Autonomous run completed for ticker ${ticker}`,
        });
      } catch (e) {
        console.error("Failed to write debug log / observation telemetry", e);
      }
          
      res.end();
    } catch (err: any) {
      console.error("[analyze] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Analyze failed" });
      }
    }
  });

  const distPath = path.join(process.cwd(), 'dist');
  const indexHtmlExists = fs.existsSync(path.join(distPath, 'index.html'));
  app.use('/artifacts', express.static(path.join(process.cwd(), 'workspace', 'artifacts')));
  app.use('/run_logs', express.static(path.join(process.cwd(), 'run_logs')));
  app.use('/latest_log', express.static(process.cwd()));

  if (process.env.NODE_ENV !== "production" || !indexHtmlExists) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
