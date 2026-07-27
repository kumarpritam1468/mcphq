export const CORE_NAME = "mcphq";

export {
  ClaudeCodeAdapter,
  type ClaudeCodeAdapterOptions,
} from "./adapters/claude-code.js";
export {
  type AdapterContext,
  getAdapters,
  getDetectedAdapters,
} from "./adapters/index.js";
export type {
  ChangeAction,
  ClientAdapter,
  ConfigLocation,
  ReadResult,
  ServerChange,
  WriteOptions,
  WriteResult,
} from "./adapters/types.js";
export {
  type ConfigFile,
  configFileSchema,
  type McpServer,
  SCOPES,
  type Scope,
  type ServerEntry,
  serverEntrySchema,
  serverNameSchema,
  TRANSPORTS,
  type Transport,
  toCanonical,
} from "./canonical.js";
export {
  CONFIG_FILE_NAME,
  ConfigError,
  defaultConfig,
  findProjectConfig,
  globalConfigDir,
  globalConfigPath,
  type LoadedConfig,
  loadConfig,
  loadConfigFile,
  parseConfig,
  resolveConfigPath,
  writeConfigFile,
} from "./config.js";
export {
  BACKUP_SUFFIX,
  backupFile,
  readJsonFile,
  writeJsonFileSafe,
} from "./fs-safe.js";
