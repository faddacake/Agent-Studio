import sharp from "sharp";
import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@iterastudio/shared";
import { bufferFromInput, writeArtifact } from "./imageUtils.js";

const VALID_FIT = ["cover", "contain", "fill", "inside", "outside"] as const;
type SharpFit = (typeof VALID_FIT)[number];

/**
 * Resize local executor.
 *
 * Reads `image_in` (Buffer | ArtifactRef), resizes to `width` × `height`
 * using the specified `fit` mode, writes the output to `outputDir`, and
 * returns an ArtifactRef as `image_out`.
 *
 * Node type: "resize"
 */
export async function executeResize(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params, outputDir, runId, nodeId } = context;

  const inputBuf = await bufferFromInput(inputs.image_in, "image_in");
  const width    = Math.round(Number(params.width  ?? 1024));
  const height   = Math.round(Number(params.height ?? 1024));
  const fitParam = (params.fit as string) ?? "cover";
  const fit: SharpFit = VALID_FIT.includes(fitParam as SharpFit)
    ? (fitParam as SharpFit)
    : "cover";

  const outputBuf = await sharp(inputBuf)
    .resize(width, height, { fit })
    .png()
    .toBuffer();

  const ref = await writeArtifact({
    buffer:    outputBuf,
    outputDir,
    runId,
    nodeId,
    suffix:    "resize",
    format:    "png",
    width,
    height,
  });

  return {
    outputs:  { image_out: ref },
    cost:     0,
    metadata: { width, height, format: "png", mimeType: ref.mimeType, fit },
  };
}
