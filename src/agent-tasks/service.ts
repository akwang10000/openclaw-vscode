import * as vscode from "vscode";
import type { GatewayClient } from "../gateway-client";
import { logError, logWarn } from "../logger";
import { CodexTaskProvider } from "./codex-provider";
import { AgentOrchestrator } from "./orchestrator";
import type { AgentTaskEvent } from "./types";
import { activityStore } from "../activity-store";

let orchestrator: AgentOrchestrator | null = null;

export async function initializeAgentOrchestrator(
  context: vscode.ExtensionContext,
  getClient: () => GatewayClient | null
): Promise<AgentOrchestrator> {
  const storagePath = context.globalStorageUri.fsPath;
  const providerStoragePath = vscode.Uri.joinPath(context.globalStorageUri, "providers").fsPath;
  const cfg = vscode.workspace.getConfiguration("openclaw");

  orchestrator = new AgentOrchestrator({
    storagePath,
    taskHistoryLimit: cfg.get<number>("agent.taskHistoryLimit", 50),
    providers: {
      codex: new CodexTaskProvider(providerStoragePath),
    },
    emitGatewayEvent: async (event: AgentTaskEvent) => {
      const client = getClient();
      if (!client || client.state !== "connected") {
        logWarn(`Skipping gateway event ${event.type}: client not connected`);
        return;
      }
      await client.emitNodeEvent(event.type, {
        ...event,
        displayName: vscode.workspace.getConfiguration("openclaw").get<string>("displayName", "VS Code"),
      });
    },
    onSnapshotChange: (snapshot) => {
      activityStore.upsertTask(snapshot.taskId, {
        provider: snapshot.provider,
        status: snapshot.status,
        prompt: snapshot.prompt,
        turn: snapshot.turn,
        latestOutput: snapshot.latestOutput,
        latestProgress: snapshot.latestProgress,
        decisionRequest: snapshot.decisionRequest,
        resultText: snapshot.resultText,
        error: snapshot.lastError,
        updatedAt: snapshot.updatedAt,
        createdAt: snapshot.createdAt,
      });
    },
    onError: (message) => logError(message),
    onWarn: (message) => logWarn(message),
  });

  await orchestrator.initialize();
  return orchestrator;
}

export function getAgentOrchestrator(): AgentOrchestrator {
  if (!orchestrator) {
    throw new Error("Agent orchestrator is not initialized");
  }
  return orchestrator;
}

export function disposeAgentOrchestrator(): void {
  orchestrator?.dispose();
  orchestrator = null;
}
