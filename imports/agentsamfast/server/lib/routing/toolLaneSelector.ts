import { TaskContextInput } from "./featureVector.ts";

export interface ToolPrediction {
  toolKey: string;
  category: string;
  pNeeded: number; // 0.0 to 1.0
  recommendedOrder: number;
}

export interface ExecutionLaneRanking {
  laneKey: string;
  displayName: string;
  pSuccess: number;
  expectedStartupLatencyMs: number;
  expectedExecutionLatencyMs: number;
  securityAllowed: boolean;
  score: number;
}

export class ToolLaneSelector {
  /**
   * Predicts which tools are relevant for a given context and ranks them.
   */
  static predictTools(context: TaskContextInput): ToolPrediction[] {
    const prompt = (context.prompt || "").toLowerCase();
    const task = (context.taskType || "").toLowerCase();
    const repoPresent = Boolean(context.repoPresent || (context.repoFilesCount && context.repoFilesCount > 0));

    const toolsCatalog = [
      { toolKey: "codebase_retrieve", category: "codebase", baseP: 0.1 },
      { toolKey: "fs_search", category: "filesystem", baseP: 0.1 },
      { toolKey: "fs_read", category: "filesystem", baseP: 0.1 },
      { toolKey: "fs_write", category: "filesystem", baseP: 0.05 },
      { toolKey: "terminal_local", category: "execution", baseP: 0.05 },
      { toolKey: "d1_query", category: "database", baseP: 0.05 },
      { toolKey: "dossier_sec_fetch", category: "financial", baseP: 0.05 },
      { toolKey: "browser_inspect", category: "web", baseP: 0.02 },
      { toolKey: "image_generation", category: "media", baseP: 0.01 },
    ];

    const predictions: ToolPrediction[] = toolsCatalog.map(tool => {
      let p = tool.baseP;

      if (tool.toolKey === "codebase_retrieve" || tool.toolKey === "fs_search" || tool.toolKey === "fs_read") {
        if (repoPresent || task.includes("code") || prompt.includes("file") || prompt.includes("code") || prompt.includes("auth")) {
          p += 0.8;
        }
      }

      if (tool.toolKey === "fs_write") {
        if (prompt.includes("fix") || prompt.includes("create") || prompt.includes("update") || prompt.includes("edit") || prompt.includes("implement")) {
          p += 0.75;
        }
      }

      if (tool.toolKey === "terminal_local") {
        if (prompt.includes("test") || prompt.includes("build") || prompt.includes("run") || prompt.includes("compile") || prompt.includes("npm")) {
          p += 0.7;
        }
      }

      if (tool.toolKey === "dossier_sec_fetch" || tool.toolKey === "d1_query") {
        if (task.includes("dossier") || task.includes("financial") || prompt.includes("10-k") || prompt.includes("10-q") || prompt.includes("sec") || prompt.includes("stock")) {
          p += 0.85;
        }
      }

      if (tool.toolKey === "browser_inspect") {
        if (prompt.includes("scrape") || prompt.includes("ui") || prompt.includes("web") || prompt.includes("page")) {
          p += 0.65;
        }
      }

      if (tool.toolKey === "image_generation") {
        if (prompt.includes("generate image") || prompt.includes("icon") || prompt.includes("illustration")) {
          p += 0.9;
        }
      }

      return {
        toolKey: tool.toolKey,
        category: tool.category,
        pNeeded: Math.max(0.01, Math.min(0.99, Math.round(p * 100) / 100)),
        recommendedOrder: 0,
      };
    });

    predictions.sort((a, b) => b.pNeeded - a.pNeeded);
    predictions.forEach((p, idx) => {
      p.recommendedOrder = idx + 1;
    });

    return predictions;
  }

  /**
   * Ranks allowed execution lanes based on security policy and learned latency/success parameters.
   */
  static rankExecutionLanes(context: TaskContextInput, requiresElevatedPrivilege = false): ExecutionLaneRanking[] {
    const lanes = [
      {
        laneKey: "local_mac",
        displayName: "Local Runtime / Host Container",
        baseSuccess: 0.94,
        startupMs: 50,
        execMs: 320,
        securityAllowed: true,
      },
      {
        laneKey: "gcp_vm",
        displayName: "Cloud Run / GCP Accelerated Node",
        baseSuccess: 0.96,
        startupMs: 400,
        execMs: 180,
        securityAllowed: true,
      },
      {
        laneKey: "sandbox_isolated",
        displayName: "Sandboxed MicroVM / E2B Isolated Container",
        baseSuccess: 0.92,
        startupMs: 1200,
        execMs: 350,
        securityAllowed: true,
      },
    ];

    return lanes
      .map(lane => {
        // Enforce strict security policy gates
        if (requiresElevatedPrivilege && lane.laneKey === "sandbox_isolated") {
          lane.securityAllowed = false;
        }

        const score = lane.securityAllowed
          ? lane.baseSuccess * 0.6 + (1 - lane.startupMs / 2000) * 0.2 + (1 - lane.execMs / 1000) * 0.2
          : 0.0;

        return {
          laneKey: lane.laneKey,
          displayName: lane.displayName,
          pSuccess: lane.baseSuccess,
          expectedStartupLatencyMs: lane.startupMs,
          expectedExecutionLatencyMs: lane.execMs,
          securityAllowed: lane.securityAllowed,
          score: Math.round(score * 1000) / 1000,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}
