import { describe, it, expect } from 'vitest';
import { mongoUriEnvNames } from '../src/update/ci-templates.js';

// devaudit-installer#1042 — the MongoDB dynamic-port step used to export one
// consumer's variable name to every consumer; it now exports the consumer's own.

type Cfg = Parameters<typeof mongoUriEnvNames>[0];
const cfg = (extra: Record<string, unknown>): Cfg => ({ project_slug: 'example-app', ...extra }) as unknown as Cfg;

describe('mongoUriEnvNames', () => {
  it('falls back to MONGODB_URI when the config declares no local MongoDB URI', () => {
    expect(mongoUriEnvNames(cfg({}))).toEqual(['MONGODB_URI']);
    expect(mongoUriEnvNames(cfg({ app_env: { MONGODB_URI: 'mongodb+srv://prod.example' } }))).toEqual(['MONGODB_URI']);
  });

  it("exports every *_URI the consumer points at a local MongoDB, in any env block, sorted and de-duplicated", () => {
    expect(
      mongoUriEnvNames(
        cfg({
          build_env: { MONGODB_EXAMPLE_APP_URI: 'mongodb://localhost:27017' },
          e2e_env: { MONGODB_URI: 'mongodb://localhost:27017', OTHER: 'x' },
          database_env: { MONGODB_EXAMPLE_APP_URI: 'mongodb://localhost:27017/db' },
          app_env: { NOT_A_URI_KEY: 'mongodb://localhost:27017' },
        }),
      ),
    ).toEqual(['MONGODB_EXAMPLE_APP_URI', 'MONGODB_URI']);
  });
});
