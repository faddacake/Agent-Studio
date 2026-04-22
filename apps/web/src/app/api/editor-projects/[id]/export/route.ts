export const runtime = "nodejs";

/**
 * POST /api/editor-projects/[id]/export
 *
 * Derives the canonical render plan from the saved project, converts it to a
 * validated ExportJobPayload, persists a new export-job record, enqueues the
 * job ID into BullMQ, and returns the accepted response with a real job ID.
 *
 * The DB row is the source of truth — the BullMQ payload carries only the
 * jobId so the worker can look up and claim the full row. If the enqueue step
 * fails the request fails with 500; the persisted row will remain pending but
 * no BullMQ job will exist for it (recoverable via the drain route).
 */

import { NextRequest, NextResponse } from "next/server";
import { getEditorProject } from "@/server/api/editorProjects";
import { createEditorExportJob } from "@/server/api/editorExportJobs";
import { buildRenderPlan } from "@/lib/renderPlan";
import { buildExportPayload } from "@/lib/exportPayload";
import { ExportJobPayloadSchema } from "@aistudio/shared";
import { enqueueExportJob } from "@/lib/queues/exportJobsQueue";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const isPreview = request.nextUrl.searchParams.get("preview") === "true";

  const project = getEditorProject(id);
  if (!project) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (project.scenes.length === 0) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "project has no scenes to export" },
      { status: 422 },
    );
  }

  const plan = buildRenderPlan(project.scenes);
  const payload = buildExportPayload(plan, project.id, project.aspectRatio, {
    isPreview,
    audioTrack: project.audioTrack ?? null,
  });

  // Validate the derived payload against the canonical schema.
  // A parse failure here would indicate a logic bug in the builder.
  const validation = ExportJobPayloadSchema.safeParse(payload);
  if (!validation.success) {
    console.error("[export] payload schema validation failed", validation.error.format());
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "export payload failed schema validation" },
      { status: 500 },
    );
  }

  // Persist the export job row.
  const job = createEditorExportJob({ projectId: project.id, payload: validation.data });

  // Enqueue the job ID into BullMQ. The worker will look up the full row and
  // claim it. If this throws, the row stays pending but no BullMQ job exists.
  try {
    await enqueueExportJob(job.id);
  } catch (err) {
    console.error("[export] failed to enqueue job", job.id, err);
    return NextResponse.json(
      { error: "ENQUEUE_ERROR", message: "export job persisted but could not be enqueued" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      status: "accepted",
      jobId: job.id,
      totalDurationMs: job.totalDurationMs,
      sceneCount: job.sceneCount,
    },
    { status: 202 },
  );
}
