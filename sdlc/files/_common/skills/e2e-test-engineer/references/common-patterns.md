# Common framework × component-library patterns

Known gotchas that bite Playwright role-based and text-based locators when the
SUT uses shadcn/ui, Radix UI, Next.js, or similar component libraries. Each
entry: the **symptom** an operator hits, the **cause** (why the obvious locator
misses), the **locator that works**.

These are the patterns the e2e-test-engineer skill has tripped over in real
release-suite triage cycles. The list is intentionally short — only patterns
that have produced an actual failed-locator triage at least once. Add to this
file when a new framework × library combination produces a recurrent miss.

## shadcn `CardTitle` is a `<div>`, not a heading

**Symptom.** `await page.getByRole('heading', { name: /Units of Measurement/i })`
returns zero matches even though the card visibly shows that title.

**Cause.** shadcn/ui's `CardTitle` component renders as a styled `<div>`, not
`<h1..h6>`. There is no heading role to match.

**Locator that works.**

```ts
// Prefer a data-testid on the card.
await page.getByTestId('card-units-of-measurement').getByText('Units of Measurement');
// Or scope by exact text inside the card's title slot.
await page.locator('[data-slot="card-title"]', { hasText: 'Units of Measurement' });
```

If the project owns the card markup, the cheap fix is to wrap the title text
in a real `<h2>` (or pass `as="h2"`) so role-based locators keep working.

## Radix `<Select>` renders two `role="combobox"` nodes

**Symptom.** `page.getByRole('combobox').nth(2).click()` collapses onto the
wrong target when a sibling field is added or reordered.

**Cause.** Radix's `<Select>` renders the visible trigger **and** a hidden
accessibility companion — both report `role="combobox"`. A form with N selects
has 2N matching nodes, and positional `.nth()` indices shift unpredictably as
fields are added.

**Locator that works.**

```ts
// Anchor by the associated label, not by position.
await page.getByLabel('Payment method').click();
// Or by a data-testid on the trigger:
await page.getByTestId('select-payment-method').click();
```

Avoid `.nth(N)` on any role that a Radix primitive renders twice (`combobox`,
`listbox`, `dialog` in some variants).

## Next.js `<Link>` clicks don't trigger network requests

**Symptom.** `await page.waitForLoadState('networkidle')` returns immediately
after `await link.click()`, before the URL has actually changed; the next
assertion runs against the previous page's DOM.

**Cause.** Next.js's `<Link>` performs client-side route transitions via the
App Router — no network round-trip, so `networkidle` was already idle.

**Locator that works.**

```ts
await Promise.all([
  page.waitForURL(/\/inventory\/snapshots/),
  page.getByRole('link', { name: 'View snapshots' }).click(),
]);
// Or, after the click:
await page.waitForURL(/\/inventory\/snapshots/);
```

`waitForURL` is the right primitive for any client-side navigation (Next.js,
React Router, Vue Router, SvelteKit). `networkidle` is for full-page loads.

## Button-with-Badge in `CardTitle` breaks `getByText(…, { exact: true })`

**Symptom.** `await page.getByText('Filter Tabs', { exact: true })` returns
zero matches on a card whose title visibly reads "Filter Tabs".

**Cause.** The title slot contains `<icon> Filter Tabs <Badge>1</Badge>` — the
badge's text content concatenates into the parent's text, so the exact match
is against `"Filter Tabs1"`, not `"Filter Tabs"`.

**Locator that works.**

```ts
// Drop exact: when the title has decorative siblings.
await page.getByText('Filter Tabs');
// Or scope by the specific text node.
await page.locator('[data-slot="card-title"]').filter({ hasText: 'Filter Tabs' });
```

The same pattern bites any title slot that mixes a text label with a
count-badge, status pill, or icon-with-tooltip sibling. Default to `exact: false`
for component-library titles, and use `getByTestId` when ambiguity is real.
