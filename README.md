# opencode-qwencode-auth

OpenCode plugin for Qwen Code OAuth authentication. Provides free access to Qwen Coder models through the official OAuth flow.

## Features

- **OAuth Device Flow** - Secure authentication via browser
- **Multi-Account Support** - Use multiple Qwen accounts for higher rate limits
- **Smart Rotation** - Automatic account rotation with health-based selection
- **Rate Limit Handling** - Automatic retry with exponential backoff
- **Token Refresh** - Automatic token refresh before expiration

## Installation

### From Git Repository (Recommended)

Add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-qwencode-auth@git+https://github.com/dvaJi/opencode-qwencode-auth.git"]
}
```

OpenCode will automatically install and load the plugin at startup.

### From npm

```json
{
  "plugin": ["opencode-qwencode-auth"]
}
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/dvaJi/opencode-qwencode-auth.git
cd opencode-qwencode-auth

# Install dependencies
bun install
```

## Limits & Quotas

- **Rate Limit:** 60 requests per minute
- **Daily Quota:** ~2000 requests per day (reset at midnight UTC)

> **Note:** These limits are set by the Qwen OAuth API and may change.

## Authentication

The plugin uses Qwen OAuth (free tier). When you first use it with OpenCode, you'll be prompted to authenticate via browser.

### Usage

```bash
# Authenticate
opencode auth login

# Use the model
opencode --provider qwen-code --model coder-model
```

### Manual Authentication

If the automatic flow doesn't work (e.g., in containers), you can use the CLI helper:

```bash
bun run src/cli.ts
```

## Configuration

Configuration is stored in `~/.config/opencode/qwen-auth.json` (Linux/macOS) or `%APPDATA%/opencode/qwen-auth.json` (Windows).

### Configuration Options

```json
{
  "rotation_strategy": "round-robin",
  "proactive_refresh": true,
  "refresh_window_seconds": 300,
  "max_rate_limit_wait_seconds": 300,
  "quiet_mode": false,
  "pid_offset_enabled": false,
  "health_score": {
    "initial": 70,
    "min_usable": 50,
    "success_reward": 1,
    "failure_penalty": 20,
    "recovery_rate_per_hour": 2
  },
  "token_bucket": {
    "max_tokens": 50,
    "regeneration_rate_per_minute": 6
  }
}
```

### Rotation Strategies

| Strategy | Description |
|----------|-------------|
| `round-robin` | Simple sequential selection |
| `sequential` | Use first available, skip rate-limited |
| `hybrid` | Health score + token bucket + freshness (recommended) |

### Configuration Options Detail

| Option | Default | Description |
|--------|---------|-------------|
| `rotation_strategy` | `round-robin` | Account selection strategy |
| `proactive_refresh` | `true` | Refresh tokens before expiration |
| `refresh_window_seconds` | `300` | Seconds before expiry to refresh |
| `max_rate_limit_wait_seconds` | `300` | Max wait time for rate-limited accounts |
| `quiet_mode` | `false` | Disable debug logging |
| `pid_offset_enabled` | `false` | Distribute accounts across processes |

## Multi-Account Support

Qwen OAuth has ~2000 requests/day limit. To increase capacity, add multiple accounts:

1. Authenticate with the first account through OpenCode
2. The credentials are stored in `~/.config/opencode/qwen-accounts.json`
3. Repeat authentication to add more accounts

The plugin will automatically distribute requests across accounts using the configured rotation strategy.

## Troubleshooting

### "Invalid access token" or "Token expired"

The plugin usually handles refresh automatically. If you see this error immediately:

1. **Re-authenticate:** Run `opencode auth login` again.
2. **Clear cache:** Delete the credentials file and login again:

```bash
rm ~/.config/opencode/qwen-accounts.json
opencode auth login
```

### Rate limit exceeded (429 errors)

If you hit the rate limits:

- **Rate limit (60/min):** Wait a few minutes before trying again
- **Daily quota (~2000/day):** Wait until midnight UTC for the quota to reset

### Enable Debug Logs

If something isn't working, you can see detailed logs:

```bash
OPENCODE_QWEN_DEBUG=1 opencode
```

## Development

### Running Tests

```bash
bun test
```

### Project Structure

```
src/
├── plugin/
│   ├── account.ts      # Multi-account management
│   ├── rotation.ts     # Health score & token bucket
│   ├── config/        # Configuration loading
│   └── request-queue.ts # Rate limiting
├── qwen/
│   └── oauth.ts       # OAuth device flow
├── constants.ts       # Configuration constants
├── errors.ts         # Error types
└── plugin.ts         # Main plugin entry
```

## Credits

- [Qwen Code](https://github.com/QwenLM/qwen-code) - Official OAuth implementation
- [foxswat/opencode-qwen-auth](https://github.com/foxswat/opencode-qwen-auth) - Reference implementation
