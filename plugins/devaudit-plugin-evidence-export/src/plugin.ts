import type { Plugin } from '@metasession.co/devaudit-plugin-sdk';
import { list } from './commands/list.js';
import { bundle } from './commands/bundle.js';
import { onDoctor } from './hooks/on-doctor.js';

const plugin: Plugin = {
  name: '@metasession.co/devaudit-plugin-evidence-export',
  apiVersion: '1',
  hooks: { onDoctor },
  commands: { list, bundle },
};

export default plugin;
