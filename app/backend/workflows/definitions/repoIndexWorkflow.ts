import { DurableWorkflowDefinition } from "../types.ts";
import { WorkflowVersionManager } from "../runtime/cloudflare/versions.ts";
import { getDatabase } from "../../legacy/agentsamfast/database.ts";
import { RepoHistorianEngine } from "../../legacy/agentsamfast/repoHistorian.ts";

export interface RepoIndexParams {
  repoName: string;
  commitSha?: string;
  files?: Array<{ path: string; content: string; language?: string }>;
  workspaceId?: string;
}

export const repoIndexWorkflow: DurableWorkflowDefinition<RepoIndexParams, any> = {
  workflowName: "repo-index-pipeline",
  title: "Durable Codebase Indexing & Velocity Analysis",
  description: "Analyzes codebase structure, churn, hotspots, and fans out chunk embeddings via Cloudflare Queue",
  category: "knowledge",
  schedules: [{ cron: "0 2 * * *", name: "nightly-repo-health" }],
  defaultRetention: {
    successRetentionDays: 7,
    errorRetentionDays: 30,
  },
  steps: [
    {
      name: "compute_repo_intelligence",
      label: "Compute Codebase Metrics, Velocity & Hotspots",
      handler: async (ctx, params: RepoIndexParams) => {
        const snapshot = await RepoHistorianEngine.captureSnapshot(params.repoName);

        return {
          repoName: params.repoName,
          snapshotId: snapshot.id,
          totalFiles: snapshot.fileCount,
          totalCodeLines: snapshot.codeLines,
          velocityScore: snapshot.activityRatio,
          hotspotCount: snapshot.hotspotCount,
          files: params.files || [],
        };
      },
    },
    {
      name: "fanout_embeddings_queue",
      label: "Fan-Out Code Chunk Vectors to Cloudflare Queue",
      handler: async (ctx, state: any) => {
        const files: Array<{ path: string; content: string }> = state.files || [];
        let chunkCount = 0;

        for (const file of files) {
          // Simple code file chunking
          const lines = file.content.split("\n");
          const chunkSize = 50;
          for (let i = 0; i < lines.length; i += chunkSize) {
            const chunkText = lines.slice(i, i + chunkSize).join("\n");
            chunkCount++;
            await ctx.sendQueueMessage("MY_QUEUE", "code_chunk_vectorize", {
              repoName: state.repoName,
              filePath: file.path,
              chunkIndex: i / chunkSize,
              chunkText,
              snapshotId: state.snapshotId,
            });
          }
        }

        return {
          ...state,
          dispatchedChunkCount: chunkCount,
          queueName: "MY_QUEUE",
        };
      },
    },
    {
      name: "finalize_index_manifest",
      label: "Finalize Index Manifest & Verification",
      handler: async (ctx, state: any) => {
        const db = await getDatabase();
        await db.query(
          `INSERT OR REPLACE INTO agentsam_knowledge_runs (
            id, target_type, target_key, status
          ) VALUES (?, 'repo', ?, 'completed')`,
          [`krun_${state.snapshotId}`, state.repoName]
        );

        return {
          repoName: state.repoName,
          snapshotId: state.snapshotId,
          totalFiles: state.totalFiles,
          dispatchedChunkCount: state.dispatchedChunkCount,
          status: "indexed_and_queued",
          indexedAt: new Date().toISOString(),
        };
      },
    },
  ],
};

WorkflowVersionManager.registerDefinition(repoIndexWorkflow);
