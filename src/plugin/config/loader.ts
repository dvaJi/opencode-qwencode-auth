import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { QwenConfigSchema, type QwenPluginConfig } from "./schema.js";
import { createDebugLogger } from "../../utils/debug-logger.js";

const debugLogger = createDebugLogger("CONFIG");

function getConfigDir(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "opencode",
    );
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "opencode");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "qwen-auth.json");
}

export async function loadConfig(): Promise<QwenPluginConfig> {
  const configPath = getConfigPath();

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    const validated = QwenConfigSchema.parse(parsed);

    debugLogger.info("Config loaded successfully", {
      path: configPath,
      rotationStrategy: validated.rotation_strategy,
    });

    return validated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      debugLogger.debug("Config file not found, using defaults");
    } else {
      debugLogger.warn("Failed to parse config, using defaults", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return QwenConfigSchema.parse({});
}

export async function saveConfig(config: QwenPluginConfig): Promise<void> {
  const configPath = getConfigPath();
  const dir = dirname(configPath);

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });

  debugLogger.info("Config saved", { path: configPath });
}
