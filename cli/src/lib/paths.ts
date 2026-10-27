import envPaths from 'env-paths';
import { join } from 'node:path';

const paths = envPaths('devaudit', { suffix: '' });

export const CONFIG_DIR = paths.config;
export const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
// DEVAUDIT_VIEWER_KEYS_FILE exists so tests never touch the real config folder.
export const VIEWER_KEYS_FILE = process.env['DEVAUDIT_VIEWER_KEYS_FILE'] ?? join(CONFIG_DIR, 'viewer-keys.json');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const PLUGINS_DIR = join(CONFIG_DIR, 'plugins');
