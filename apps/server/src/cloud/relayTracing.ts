import * as RelayTracing from "@t3tools/shared/relayTracing";

// Fork policy: runtime credentials and embedded cloud tokens cannot enable export.
export const layerHeadlessRelayClient = RelayTracing.layer(null, {
  serviceName: "t3code-server",
  runtime: "node",
  client: "headless-cli",
});

export const layerServerRelayBroker = RelayTracing.layer(null, {
  serviceName: "t3code-server",
  runtime: "node",
  client: "environment-server",
  component: "relay-broker",
});
