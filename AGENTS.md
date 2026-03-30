# Agent Guidance

This plugin provides OAuth authentication for Qwen Code models in OpenCode.

## Authentication Flow

1. When no credentials exist, the plugin initiates OAuth Device Flow
2. User authenticates via browser at `chat.qwen.ai`
3. Tokens are stored securely and automatically refreshed

## Account Management

- Credentials stored in: `~/.config/opencode/qwen-accounts.json`
- Configuration stored in: `~/.config/opencode/qwen-auth.json`
- Each account gets ~2000 requests/day

## Rate Limiting

The plugin handles rate limits automatically:
- Parses `retry-after-ms` and `x-error-code` headers
- Implements exponential backoff
- Switches to healthy accounts when rate-limited

## Debugging

Enable debug logging:
```bash
OPENCODE_QWEN_DEBUG=1 opencode ...
```

Or set `quiet_mode: false` in config.
