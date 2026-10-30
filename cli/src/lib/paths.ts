import envPaths from 'env-paths';
import { homedir } from 'node:os';
import { join } from 'node:path';

const paths = envPaths('devaudit', { suffix: '' });

// Per-user files are overridable so tests never touch the real ones (DevAudit-Installer#1116 R32):
//   DEVAUDIT_CONFIG_DIR  replaces the config folder (auth.json, config.json, plugins/, viewer-keys.json)
//   DEVAUDIT_CACHE_DIR   replaces the cache folder (the scan cache)
//   DEVAUDIT_CLAUDE_HOME replaces the home folder where `.claude/settings.json` lives
export const CONFIG_DIR = process.env['DEVAUDIT_CONFIG_DIR'] ?? paths.config;
export const CACHE_DIR = process.env['DEVAUDIT_CACHE_DIR'] ?? paths.cache;
export const CLAUDE_HOME = process.env['DEVAUDIT_CLAUDE_HOME'] ?? homedir();
export const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
// DEVAUDIT_VIEWER_KEYS_FILE exists so tests never touch the real config folder.
export const VIEWER_KEYS_FILE = process.env['DEVAUDIT_VIEWER_KEYS_FILE'] ?? join(CONFIG_DIR, 'viewer-keys.json');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const PLUGINS_DIR = join(CONFIG_DIR, 'plugins');
