// Provider ID
export const QWEN_PROVIDER_ID = "qwen-code";

// OAuth Device Flow Endpoints (from qwen-code)
export const QWEN_OAUTH_CONFIG = {
  baseUrl: "https://chat.qwen.ai",
  deviceCodeEndpoint: "https://chat.qwen.ai/api/v1/oauth2/device/code",
  tokenEndpoint: "https://chat.qwen.ai/api/v1/oauth2/token",
  clientId: "f0304373b74a44d2b584a3fb70ca9e56",
  scope: "openid profile email model.completion",
  grantType: "urn:ietf:params:oauth:grant-type:device_code",
} as const;

// Qwen API Configuration
// The resource_url from credentials determines which base URL to use
export const QWEN_API_CONFIG = {
  // Default base URL (can be overridden by resource_url from credentials)
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  // Portal URL (used when resource_url = "portal.qwen.ai")
  portalBaseUrl: "https://portal.qwen.ai/v1",
  // Chat completions endpoint
  chatEndpoint: "/chat/completions",
  // Models endpoint
  modelsEndpoint: "/models",
  // Used by OpenCode to configure the provider
  baseUrl: "https://portal.qwen.ai/v1",
} as const;

// OAuth callback port (for future device flow in plugin)
export const CALLBACK_PORT = 14561;

// Available Qwen models through OAuth (portal.qwen.ai)
// Aligned with qwen-code-0.12.0 official client - only coder-model is exposed
export const QWEN_MODELS = {
  // Active Model (matches qwen-code-0.12.0)
  "coder-model": {
    id: "coder-model",
    name: "Qwen Coder (auto)",
    contextWindow: 1048576,
    maxOutput: 65536,
    description:
      "Auto-routed coding model (Maps to Qwen 3.5 Plus - Hybrid & Vision)",
    reasoning: false,
    capabilities: { vision: true },
    cost: { input: 0, output: 0 },
  },
} as const;

// Official Qwen Code CLI Headers for performance and quota recognition
// User-Agent is generated dynamically based on current platform
import {
  generateUserAgent,
  generateDashScopeUserAgent,
} from "./utils/user-agent.js";

export function getQwenHeaders(): Record<string, string> {
  return {
    "X-DashScope-CacheControl": "enable",
    "X-DashScope-AuthType": "qwen-oauth",
    "X-DashScope-UserAgent": generateDashScopeUserAgent(),
    "User-Agent": generateUserAgent(),
  };
}
