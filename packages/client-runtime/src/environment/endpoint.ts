import { environmentGatewayPath } from "@t3tools/shared/environmentGateway";
export * from "@t3tools/shared/advertisedEndpoint";

export const environmentEndpointUrl = (httpBaseUrl: string, pathname: string): string => {
  const url = new URL(httpBaseUrl);
  url.pathname = environmentGatewayPath(httpBaseUrl) + pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
};
