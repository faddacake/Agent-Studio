/**
 * portCompatibility — lightweight port-matching helper for the Inspector's
 * "Use in Canvas" auto-connect feature.
 *
 * Deliberately thin: delegates the compatibility matrix to the canonical
 * PORT_COMPATIBILITY table from /shared so there is one source of
 * truth for what connects to what.
 */
import { PORT_COMPATIBILITY } from "@iterastudio/shared";
import type { Port } from "@iterastudio/shared";

/**
 * Given the output port type of the node being inserted and the list of
 * input ports on the target node, returns the ID of the one unambiguously
 * compatible input port, or `null` if the match is ambiguous or absent.
 *
 * Rules:
 *   0 compatible ports → null (no edge)
 *   1 compatible port  → return its id (safe to auto-connect)
 *   2+ compatible ports → null (ambiguous; let the user wire manually)
 *
 * This keeps auto-connect conservative: it only fires when there is
 * exactly one valid destination.
 */
export function findCompatibleInputPort(
  sourcePortType: string,
  targetInputPorts: Port[],
): string | null {
  const compat = PORT_COMPATIBILITY[sourcePortType];
  if (!compat) return null;

  const compatible = targetInputPorts.filter((p) => compat[p.type] === true);
  if (compatible.length !== 1) return null;

  return compatible[0]!.id;
}
