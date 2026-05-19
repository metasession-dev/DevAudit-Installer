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

export interface PluginContext {
  readonly projectPath: string;
  readonly sdlcConfig: PluginSdlcConfigView;
  readonly logger: PluginLogger;
  readonly apiVersion: '1';
  emit(event: PluginEvent): void;
}

export type LifecycleHook = (ctx: PluginContext) => Promise<void> | void;

export type PluginCommand = (ctx: PluginContext, args: readonly string[]) => Promise<void> | void;

export interface Plugin {
  readonly name: string;
  readonly apiVersion: '1';
  readonly hooks?: Partial<Record<LifecycleHookName, LifecycleHook>>;
  readonly commands?: Readonly<Record<string, PluginCommand>>;
}
