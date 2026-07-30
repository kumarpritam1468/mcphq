import * as os from "node:os";
import * as path from "node:path";
import { JsonMcpAdapter } from "./json-mcp-adapter.js";

export interface VsCodeAdapterOptions {
  projectDir?: string;
  globalConfigPath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export class VsCodeAdapter extends JsonMcpAdapter {
  constructor(options: VsCodeAdapterOptions = {}) {
    const homeDir = options.homeDir ?? os.homedir();
    const projectDir = options.projectDir ?? process.cwd();
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const userDir = vsCodeUserDir(homeDir, platform, env);
    const globalPath =
      options.globalConfigPath ?? path.join(userDir, "mcp.json");
    super({
      name: "vscode",
      displayName: "VS Code",
      serverKey: "servers",
      locations: [
        { scope: "global", path: globalPath },
        {
          scope: "project",
          path: path.join(projectDir, ".vscode", "mcp.json"),
        },
      ],
      detectionPaths: [globalPath, userDir],
      remoteType: (transport) => transport,
    });
  }
}

export function vsCodeUserDir(
  homeDir: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Code", "User");
  }
  if (platform === "win32") {
    return path.join(
      env.APPDATA ?? path.join(homeDir, "AppData", "Roaming"),
      "Code",
      "User",
    );
  }
  return path.join(
    env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config"),
    "Code",
    "User",
  );
}
