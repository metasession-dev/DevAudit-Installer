#!/usr/bin/env node
import('../dist/index.js').catch((err) => {
  console.error('devaudit: failed to load — did you run `npm run build`?');
  console.error(err);
  process.exit(1);
});
