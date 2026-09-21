import { Api } from "teleproto";
import { ensureConnected } from "./client";
import { withRetry } from "./retry";

/**
 * Current Stars balance via the official `payments.getStarsStatus`
 * (https://core.telegram.org/method/payments.getStarsStatus), queried
 * against your own account (`InputPeerSelf`). Returns null if the balance
 * can't be read — callers should treat that as "unknown, stay paused"
 * rather than assuming funds are available.
 */
export async function getStarsBalance(tenantId: string): Promise<number | null> {
  try {
    const client = await ensureConnected(tenantId);
    const result = await withRetry(
      () =>
        client.invoke(
          new Api.payments.GetStarsStatus({ peer: new Api.InputPeerSelf() })
        ),
      { label: "payments.getStarsStatus" }
    );
    return Number(result.balance.amount);
  } catch (err) {
    console.error("[balance] failed to fetch Stars balance:", err);
    return null;
  }
}
