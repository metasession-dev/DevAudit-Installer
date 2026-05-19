import type { Plugin, PluginManifest } from '@metasession/devaudit-plugin-sdk';

export interface LoadedPlugin {
  readonly dir: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly manifest: PluginManifest;
  readonly plugin: Plugin;
}

export interface PluginLoadFailure {
  readonly dir: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly loaded: readonly LoadedPlugin[];
  readonly failures: readonly PluginLoadFailure[];
}
