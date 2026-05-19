export const LIFECYCLE_HOOK_NAMES = [
  'beforeInstall',
  'afterInstall',
  'beforeUpdate',
  'afterUpdate',
  'beforePush',
  'afterPush',
  'beforeSync',
  'afterSync',
  'onDoctor',
] as const;

export type LifecycleHookName = (typeof LIFECYCLE_HOOK_NAMES)[number];

export function isLifecycleHookName(value: unknown): value is LifecycleHookName {
  return typeof value === 'string' && (LIFECYCLE_HOOK_NAMES as readonly string[]).includes(value);
}
