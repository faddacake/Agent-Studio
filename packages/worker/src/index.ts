import { Worker, Queue } from "bullmq";
import { getDb, closeDb, checkpoint } from "@iterastudio/db";
import { processNodeJob, type NodeJobData, type NodeJobResult } from "./nodeJobProcessor.js";
import { processExportJob, type ExportJobProcessorData } from "./exportJobProcessor.js";
import { startScheduler } from "./scheduler.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisConnection = { url: REDIS_URL };

// --- Queues (also used by the API server to enqueue jobs) ---

export const predictionsQueue = new Queue("predictions", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const downloadsQueue = new Queue("downloads", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const exportJobsQueue = new Queue("export-jobs", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// --- Workers (only run in the worker process) ---

async function processPredictionJob(job: { id?: string; data: Record<string, unknown> }): Promise<NodeJobResult> {
  console.log(`[worker] Processing prediction job ${job.id}`);

  // Ensure DB is connected
  getDb();

  const jobData = job.data as unknown as NodeJobData;
  const result = await processNodeJob(jobData);

  if (result.status === "failed") {
    console.error(`[worker] Node ${result.nodeId} failed: ${result.error}`);
  } else {
    console.log(`[worker] Node ${result.nodeId} completed (cost: $${result.cost?.toFixed(4) ?? "0"})`);
  }

  return result;
}

async function processDownloadJob(job: { id?: string; data: Record<string, unknown> }) {
  console.log(`[worker] Processing download job ${job.id}`, job.data);
  // Download worker implementation will stream assets to disk
  // For now, return success
  return { status: "completed" };
}

async function processExportJobBullMQ(job: { id?: string; data: Record<string, unknown> }) {
  console.log(`[worker] Processing export job ${job.id}`);
  getDb();
  const data = job.data as unknown as ExportJobProcessorData;
  const result = processExportJob(data);
  console.log(`[worker] Export job ${result.jobId} → ${result.status}`);
  return result;
}

function startWorkers() {
  const concurrency = parseInt(process.env.MAX_CONCURRENT_NODES || "5");

  const predictionWorker = new Worker("predictions", processPredictionJob, {
    connection: redisConnection,
    concurrency,
  });

  const downloadWorker = new Worker("downloads", processDownloadJob, {
    connection: redisConnection,
    concurrency: 10,
  });

  const exportWorker = new Worker("export-jobs", processExportJobBullMQ, {
    connection: redisConnection,
    concurrency: 1,
  });

  predictionWorker.on("completed", (job) => {
    console.log(`[worker] Prediction job ${job.id} completed`);
  });

  predictionWorker.on("failed", (job, err) => {
    console.error(`[worker] Prediction job ${job?.id} failed:`, err.message);
  });

  downloadWorker.on("completed", (job) => {
    console.log(`[worker] Download job ${job.id} completed`);
  });

  downloadWorker.on("failed", (job, err) => {
    console.error(`[worker] Download job ${job?.id} failed:`, err.message);
  });

  exportWorker.on("completed", (job) => {
    console.log(`[worker] Export job ${job.id} completed`);
  });

  exportWorker.on("failed", (job, err) => {
    console.error(`[worker] Export job ${job?.id} failed:`, err.message);
  });

  console.log(`[worker] Workers started (predictions concurrency=${concurrency}, downloads concurrency=10, export concurrency=1)`);

  // ── Workflow schedule runner ──────────────────────────────────────────────
  // Reads workflow_schedule:* entries from the settings table every minute
  // and POSTs to /api/workflows/:id/runs for each enabled, matching schedule.
  startScheduler();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[worker] Shutting down...");
    await predictionWorker.close();
    await downloadWorker.close();
    await exportWorker.close();
    await predictionsQueue.close();
    await downloadsQueue.close();
    await exportJobsQueue.close();
    checkpoint();
    closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Only start workers when this file is the entry point (not when imported for queue access)
const isMainModule = process.argv[1]?.endsWith("worker/src/index.ts") ||
  process.argv[1]?.endsWith("worker/dist/index.js");

if (isMainModule) {
  console.log("[worker] Starting as standalone worker process...");
  startWorkers();
}

export { startWorkers, processNodeJob, processExportJob };
export type { NodeJobData, NodeJobResult, ExportJobProcessorData };
