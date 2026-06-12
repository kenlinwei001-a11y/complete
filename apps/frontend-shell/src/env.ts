export const env = {
  datacoreUrl: (import.meta.env.VITE_DATACORE_URL as string | undefined) ?? "",
  agentcoreUrl: (import.meta.env.VITE_AGENTCORE_URL as string | undefined) ?? "",
  mock: import.meta.env.VITE_MOCK === "1",
};
