import * as os from "node:os";
import * as path from "node:path";
import { JsonMcpAdapter } from "./json-mcp-adapter.js";

export interface CursorAdapterOptions {
  projectDir?: string;
  globalConfigPath?: string;
  homeDir?: string;
}

export class CursorAdapter extends JsonMcpAdapter {
  constructor(options: CursorAdapterOptions = {}) {
    const homeDir = options.homeDir ?? os.homedir();
    const projectDir = options.projectDir ?? process.cwd();
    const globalPath =
      options.globalConfigPath ?? path.join(homeDir, ".cursor", "mcp.json");
    super({
      name: "cursor",
      displayName: "Cursor",
      serverKey: "mcpServers",
      locations: [
        { scope: "global", path: globalPath },
        {
          scope: "project",
          path: path.join(projectDir, ".cursor", "mcp.json"),
        },
      ],
      detectionPaths: [globalPath, path.join(homeDir, ".cursor")],
      remoteType: (transport) =>
        transport === "sse" ? "sse" : "streamable-http",
    });
  }
}
