import type { NodeExecutionContext, NodeExecutionResult } from "@iterastudio/shared";

/**
 * Local executor for the "prompt-template" node type.
 *
 * Substitutes {{variable}} placeholders in the template string with values
 * from the `variables` input (a JSON object). Unknown placeholders are left
 * as-is. Returns the rendered string on the `text_out` port.
 */
export async function executePromptTemplate(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  const template = (context.params.template as string | undefined) ?? "";
  const variables = (context.inputs.variables as Record<string, unknown> | undefined) ?? {};

  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = variables[key];
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
  });

  return {
    outputs: { text_out: rendered },
    cost: 0,
  };
}
