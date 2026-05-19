import { describe, it, expect } from 'vitest';
import { LIFECYCLE_HOOK_NAMES, isLifecycleHookName } from '../src/lifecycle.js';

describe('lifecycle hooks', () => {
  it('exports the canonical set of hook names', () => {
    expect(LIFECYCLE_HOOK_NAMES).toContain('beforeInstall');
    expect(LIFECYCLE_HOOK_NAMES).toContain('afterUpdate');
    expect(LIFECYCLE_HOOK_NAMES).toContain('onDoctor');
    expect(LIFECYCLE_HOOK_NAMES.length).toBeGreaterThan(0);
  });
  it('classifier returns true for known names and false for the rest', () => {
    expect(isLifecycleHookName('beforeInstall')).toBe(true);
    expect(isLifecycleHookName('afterPush')).toBe(true);
    expect(isLifecycleHookName('madeUpHookName')).toBe(false);
    expect(isLifecycleHookName(42)).toBe(false);
    expect(isLifecycleHookName(undefined)).toBe(false);
  });
});
