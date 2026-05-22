import sharp from "sharp";
import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@iterastudio/shared";
import { bufferFromInput, writeArtifact } from "./imageUtils.js";

const VALID_FORMATS = ["jpeg", "png", "webp"] as const;
type OutputFormat = (typeof VALID_FORMATS)[number];

/**
 * Format-convert local executor.
 *
 * Reads `image_in` (Buffer | ArtifactRef), converts to the requested
 * `format` (jpeg | png | webp) at the given `quality` (1–100,
 * JPEG/WebP only), writes to `outputDir`, and returns an ArtifactRef
 * as `image_out`.
 *
 * Node type: "format-convert"
 */
export async function executeFormatConvert(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params, outputDir, runId, nodeId } = context;

  const inputBuf   = await bufferFromInput(inputs.image_in, "image_in");
  const formatParam = (params.format as string) ?? "png";
  const format: OutputFormat = VALID_FORMATS.includes(formatParam as OutputFormat)
    ? (formatParam as OutputFormat)
    : "png";
  const quality = params.quality !== undefined
    ? Math.min(100, Math.max(1, Math.round(Number(params.quality))))
    : 90;

  let pipeline = sharp(inputBuf);
  switch (format) {
    case "jpeg": pipeline = pipeline.jpeg({ quality }); break;
    case "png":  pipeline = pipeline.png();             break;
    case "webp": pipeline = pipeline.webp({ quality }); break;
  }

  const outputBuf = await pipeline.toBuffer();
  const meta      = await sharp(outputBuf).metadata();

  const ref = await writeArtifact({
    buffer:    outputBuf,
    outputDir,
    runId,
    nodeId,
    suffix:    "format-convert",
    format,
    width:     meta.width,
    height:    meta.height,
  });

  return {
    outputs:  { image_out: ref },
    cost:     0,
    metadata: {
      width:    meta.width,
      height:   meta.height,
      format,
      mimeType: ref.mimeType,
    },
  };
}
