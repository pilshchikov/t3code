import type { ManagedPolicySummary } from "@t3tools/contracts";
import {
  nodeProcessRuntimeAttributes,
  processServiceInstanceId,
} from "@t3tools/shared/observability";
import * as RelayTracing from "@t3tools/shared/relayTracing";

// Runtime credentials, environment and policy cannot enable network tracing in this fork.
export const allowedFor = (
  _env: Readonly<Record<string, string | undefined>>,
  _policy: ManagedPolicySummary | undefined,
) => false;

const relayLayer = (resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">) =>
  RelayTracing.layer(null, { ...resource, serviceInstanceId: processServiceInstanceId() });

export const layerHeadlessRelayClient = relayLayer({
  serviceName: "t3code-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "headless-cli",
});

export const layerServerRelayBroker = relayLayer({
  serviceName: "t3code-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "environment-server",
  component: "relay-broker",
});
