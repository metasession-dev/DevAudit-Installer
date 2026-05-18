import envPaths from 'env-paths';
import { join } from 'node:path';

const paths = envPaths('devaudit', { suffix: '' });

export const CONFIG_DIR = paths.config;
export const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
