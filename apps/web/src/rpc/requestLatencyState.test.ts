import { WS_METHODS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { subscribeSlowRpcAckRequests, trackRpcRequestSent } from "./requestLatencyState";

it("warns about user requests but not agent waits relayed to another environment", () => {
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  vi.useFakeTimers();
  const seen: string[][] = [];
  const unsubscribe = subscribeSlowRpcAckRequests((requests) =>
    seen.push(requests.map((request) => request.tag)),
  );
  try {
    trackRpcRequestSent("relay-call", WS_METHODS.peerOrchestrationCall);
    trackRpcRequestSent("relay-thread", WS_METHODS.peerThreadsRequest);
    trackRpcRequestSent("user", WS_METHODS.serverGetConfig);
    vi.advanceTimersByTime(60_000);
    expect(seen.at(-1)).toEqual([WS_METHODS.serverGetConfig]);
  } finally {
    unsubscribe();
  }
});
