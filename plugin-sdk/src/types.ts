import type { LifecycleHookName } from './lifecycle.js';

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface PluginSdlcConfigView {
  readonly project_slug: string;
  readonly stack?: string;
  readonly host?: string;
  readonly node_version?: string | number;
  readonly python_version?: string | number;
  readonly working_directory?: string;
  readonly source_dirs?: string;
  readonly [key: string]: unknown;
}

export interface PluginEvent {
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * The person's own personal access token and portal URL, as the CLI resolves them
 * (`DEVAUDIT_USER_TOKEN`, else the `devaudit auth login` cache). Treat the token
 * as a secret: never log it, print it or write it to disk.
 */
export interface PluginPersonalAuth {
  readonly token: string;
  readonly baseUrl: string;
}

export interface PluginContext {
  readonly projectPath: string;
  readonly sdlcConfig: PluginSdlcConfigView;
  readonly logger: PluginLogger;
  readonly apiVersion: '1';
  emit(event: PluginEvent): void;
  /**
   * Read-only accessor for the CLI-resolved personal auth, or `null` when the person is not
   * logged in. Resolved exactly like `devaudit auth status`. Absent on CLIs older than this
   * accessor: a plugin that must run there falls back to its own environment variable.
   * (devaudit-installer#1100)
   */
  getPersonalAuth?(): Promise<PluginPersonalAuth | null>;
}

export type LifecycleHook = (ctx: PluginContext) => Promise<void> | void;

export type PluginCommand = (ctx: PluginContext, args: readonly string[]) => Promise<void> | void;

export interface Plugin {
  readonly name: string;
  readonly apiVersion: '1';
  readonly hooks?: Partial<Record<LifecycleHookName, LifecycleHook>>;
  readonly commands?: Readonly<Record<string, PluginCommand>>;
}
