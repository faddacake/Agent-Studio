/**
 * Re-export resolveProviderKey from @aistudio/db.
 *
 * The canonical implementation lives in the db package so it can be
 * shared by both the web server and the BullMQ worker without either
 * importing the other.
 */
export { resolveProviderKey } from "@aistudio/db";
