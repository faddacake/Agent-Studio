import sharp from "sharp";
import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@iterastudio/shared";
import { bufferFromInput, writeArtifact } from "./imageUtils.js";

/**
 * Crop local executor.
 *
 * Reads `image_in` (Buffer | ArtifactRef), extracts the rectangle defined
 * by params `x` (left), `y` (top), `width`, `height`, writes the output to
 * `outputDir`, and returns an ArtifactRef as `image_out`.
 *
 * The node definition uses `x`/`y` (canvas convention); sharp uses
 * `left`/`top` — the mapping is applied here.
 *
 * Node type: "crop"
 */
export async function executeCrop(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params, outputDir, runId, nodeId } = context;

  const inputBuf = await bufferFromInput(inputs.image_in, "image_in");
  const left   = Math.round(Number(params.x      ?? 0));
  const top    = Math.round(Number(params.y      ?? 0));
  const width  = Math.round(Number(params.width  ?? 512));
  const height = Math.round(Number(params.height ?? 512));

  const outputBuf = await sharp(inputBuf)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();

  const ref = await writeArtifact({
    buffer:    outputBuf,
    outputDir,
    runId,
    nodeId,
    suffix:    "crop",
    format:    "png",
    width,
    height,
  });

  return {
    outputs:  { image_out: ref },
    cost:     0,
    metadata: {
      width,
      height,
      format:  "png",
      mimeType: ref.mimeType,
      region:  { left, top, width, height },
    },
  };
}
