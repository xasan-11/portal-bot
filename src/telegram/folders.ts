import { Api } from "teleproto";
import { ensureConnected } from "./client";
import { withRetry } from "./retry";

/**
 * Auto-maintains a Telegram chat folder ("Offer") containing every owner
 * currently offered on, per https://core.telegram.org/api/folders —
 * `messages.getDialogFilters` to read, `messages.updateDialogFilter` to
 * write (a full-replace API: there's no incremental add/remove peer method,
 * so every call reads the current filter, edits its peer list, and writes
 * the whole thing back).
 */
const OFFER_FOLDER_TITLE = "Offer";

function peerMatches(inputPeer: Api.TypeInputPeer, ownerId: string): boolean {
  if (inputPeer instanceof Api.InputPeerUser) return String(inputPeer.userId) === ownerId;
  if (inputPeer instanceof Api.InputPeerChannel) return String(inputPeer.channelId) === ownerId;
  if (inputPeer instanceof Api.InputPeerChat) return String(inputPeer.chatId) === ownerId;
  return false;
}

function nextFolderId(filters: Api.TypeDialogFilter[]): number {
  let maxId = 1; // 0 is the implicit "All Chats" folder — custom folders start at 2
  for (const f of filters) {
    if ("id" in f && typeof f.id === "number" && f.id > maxId) maxId = f.id;
  }
  return maxId + 1;
}

async function findOfferFolder(tenantId: string): Promise<{ filter: Api.DialogFilter; all: Api.TypeDialogFilter[] } | null> {
  const client = await ensureConnected(tenantId);
  const result = await withRetry(() => client.invoke(new Api.messages.GetDialogFilters()), {
    label: "messages.getDialogFilters",
  });
  if (!(result instanceof Api.messages.DialogFilters)) return null;

  const filter = result.filters.find(
    (f): f is Api.DialogFilter => f instanceof Api.DialogFilter && f.title.text === OFFER_FOLDER_TITLE
  );
  return { filter: filter as Api.DialogFilter, all: result.filters };
}

/** Best-effort: folder bookkeeping must never block or fail the actual offer flow. */
export async function addOwnerToOfferFolder(tenantId: string, ownerPeer: Api.TypePeer, ownerId: string): Promise<void> {
  try {
    const client = await ensureConnected(tenantId);
    const inputPeer = await client.getInputEntity(ownerPeer);

    const found = await findOfferFolder(tenantId);
    if (!found) return;
    const { filter: existing, all } = found;

    if (existing) {
      if (existing.includePeers.some((p) => peerMatches(p, ownerId))) return; // already in
      const updated = new Api.DialogFilter({
        ...existing.originalArgs,
        includePeers: [...existing.includePeers, inputPeer],
      });
      await withRetry(
        () => client.invoke(new Api.messages.UpdateDialogFilter({ id: existing.id, filter: updated })),
        { label: "messages.updateDialogFilter (add owner)" }
      );
    } else {
      const id = nextFolderId(all);
      const filter = new Api.DialogFilter({
        id,
        title: new Api.TextWithEntities({ text: OFFER_FOLDER_TITLE, entities: [] }),
        pinnedPeers: [],
        includePeers: [inputPeer],
        excludePeers: [],
      });
      await withRetry(() => client.invoke(new Api.messages.UpdateDialogFilter({ id, filter })), {
        label: "messages.updateDialogFilter (create Offer folder)",
      });
    }
  } catch (err) {
    console.error(`[folders] failed to add owner ${ownerId} to "${OFFER_FOLDER_TITLE}" folder:`, err);
  }
}

export async function removeOwnerFromOfferFolder(tenantId: string, ownerId: string): Promise<void> {
  try {
    const client = await ensureConnected(tenantId);
    const found = await findOfferFolder(tenantId);
    if (!found?.filter) return;
    const existing = found.filter;

    const nextIncludePeers = existing.includePeers.filter((p) => !peerMatches(p, ownerId));
    if (nextIncludePeers.length === existing.includePeers.length) return; // wasn't in there

    if (nextIncludePeers.length === 0) {
      // A filter can't have an empty include list (FILTER_INCLUDE_EMPTY) — delete it instead.
      await withRetry(() => client.invoke(new Api.messages.UpdateDialogFilter({ id: existing.id })), {
        label: "messages.updateDialogFilter (delete empty Offer folder)",
      });
      return;
    }

    const updated = new Api.DialogFilter({
      ...existing.originalArgs,
      includePeers: nextIncludePeers,
      pinnedPeers: existing.pinnedPeers.filter((p) => !peerMatches(p, ownerId)),
    });
    await withRetry(
      () => client.invoke(new Api.messages.UpdateDialogFilter({ id: existing.id, filter: updated })),
      { label: "messages.updateDialogFilter (remove owner)" }
    );
  } catch (err) {
    console.error(`[folders] failed to remove owner ${ownerId} from "${OFFER_FOLDER_TITLE}" folder:`, err);
  }
}
