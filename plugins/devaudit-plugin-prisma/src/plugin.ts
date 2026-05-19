import type { Plugin } from '@metasession.co/devaudit-plugin-sdk';
import { migrateStatus } from './commands/migrate-status.js';
import { pending } from './commands/pending.js';
import { afterUpdate } from './hooks/after-update.js';
import { onDoctor } from './hooks/on-doctor.js';

const plugin: Plugin = {
  name: '@metasession.co/devaudit-plugin-prisma',
  apiVersion: '1',
  hooks: {
    afterUpdate,
    onDoctor,
  },
  commands: {
    'migrate-status': migrateStatus,
    pending,
  },
};

export default plugin;
