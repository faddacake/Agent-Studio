/**
 * Data access functions for EditorProject.
 * Called by the /api/editor-projects route handlers.
 * Server-side only — never import from client components.
 */

import { randomUUID } from "node:crypto";
import { getDb, schema } from "@iterastudio/db";
import { desc, eq } from "drizzle-orm";
import type {
  AspectRatio,
  AudioTrack,
  CreateEditorProjectInput,
  EditorProject,
  Scene,
  UpdateEditorProjectInput,
} from "@/lib/editorProjectTypes";

// ── Row parser ──────────────────────────────────────────────────────────────

function parseRow(row: typeof schema.editorProjects.$inferSelect): EditorProject {
  return {
    id: row.id,
    name: row.name,
    aspectRatio: row.aspectRatio as AspectRatio,
    scenes: JSON.parse(row.scenes as string) as Scene[],
    audioTrack: row.audioTrack
      ? (JSON.parse(row.audioTrack as string) as AudioTrack)
      : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function listEditorProjects(): EditorProject[] {
  const rows = getDb()
    .select()
    .from(schema.editorProjects)
    .orderBy(desc(schema.editorProjects.createdAt))
    .all();
  return rows.map(parseRow);
}

export function getEditorProject(id: string): EditorProject | null {
  const row = getDb()
    .select()
    .from(schema.editorProjects)
    .where(eq(schema.editorProjects.id, id))
    .get();
  return row ? parseRow(row) : null;
}

export function createEditorProject(input: CreateEditorProjectInput): EditorProject {
  const id = randomUUID();
  const now = new Date().toISOString();
  const aspectRatio = input.aspectRatio ?? "16:9";
  const scenes = input.scenes ?? [];

  getDb()
    .insert(schema.editorProjects)
    .values({
      id,
      name: input.name.trim(),
      aspectRatio,
      scenes: JSON.stringify(scenes),
      audioTrack: input.audioTrack ? JSON.stringify(input.audioTrack) : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    id,
    name: input.name.trim(),
    aspectRatio,
    scenes,
    audioTrack: input.audioTrack,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateEditorProject(
  id: string,
  input: UpdateEditorProjectInput,
): EditorProject | null {
  const updates: Partial<typeof schema.editorProjects.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.aspectRatio !== undefined) updates.aspectRatio = input.aspectRatio;
  if (input.scenes !== undefined) updates.scenes = JSON.stringify(input.scenes);
  if ("audioTrack" in input) {
    updates.audioTrack = input.audioTrack ? JSON.stringify(input.audioTrack) : null;
  }

  const result = getDb()
    .update(schema.editorProjects)
    .set(updates)
    .where(eq(schema.editorProjects.id, id))
    .run();

  if (result.changes === 0) return null;

  return getEditorProject(id);
}

export function deleteEditorProject(id: string): boolean {
  const result = getDb()
    .delete(schema.editorProjects)
    .where(eq(schema.editorProjects.id, id))
    .run();
  return result.changes > 0;
}
