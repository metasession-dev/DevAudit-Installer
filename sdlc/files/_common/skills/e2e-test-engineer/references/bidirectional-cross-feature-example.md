# Worked example: bidirectional cross-feature scenarios

A concrete case for Phase 3 item 5 ("Bidirectional cross-feature scenarios")
and Phase 4 item 4 ("Missing reverse-direction coverage"), so the abstract
principle is checkable by a reviewer at Stage 1/Phase 3.

## The pattern

Two features, A and B, both read or write fields on the same shared document.
Coverage that only tests "does A's behaviour corrupt B's field" is
**one-directional** — it never asks the mirror question, "does B's behaviour
corrupt A's field." Both directions involve the exact same document and the
exact same class of risk; there is no reason correctness in one direction
implies correctness in the other.

## The concrete case (DevAudit-Installer#834)

Feature A: **kitchen-status workflow.** Marking an order's kitchen status
complete auto-updates the same `Order` document's `paymentStatus` field
(`paid`) and `paymentMethod` field (`cash`) — intentionally, for walk-in
orders — while guarding against doing this for tab-linked orders via
`!order.tabId`.

Feature B: **tab-payment workflow.** Closing or paying a tab writes to the
same `Order` document's tab-scoped payment fields for every order attached
to that tab.

Both features read and write overlapping fields (`paymentStatus`,
`paymentMethod`, `tabId`) on the same `Order` document. That is the shared-field
signal Phase 3 item 5 looks for.

**Direction A→B (was covered):** a spec asserting that paying/closing a tab
does not corrupt an order's kitchen status. This shipped as
`e2e/critical/tab-payment-no-status-reset.spec.ts`.

**Direction B→A (was missing):** a spec asserting that progressing an
order's kitchen status does not corrupt its tab-scoped payment status. No
such scenario was ever derived — the same two features, the same document,
the same class of bug, but only checked one way.

The real-world consequence: `order.tabId` was not reliably set at the point
the kitchen-status guard checked it, so tab orders were silently marked
`paid`/`cash` on kitchen completion, corrupting revenue and cash-reconciliation
reporting. A B→A scenario would have caught this before it shipped.

## How to apply this check

1. During Phase 3, when you identify that the diff touches a field also
   read/written by another already-shipped feature, name the pair explicitly:
   *"Feature A (this diff) and Feature B (existing) both touch `Order.X`."*
2. Ask both directions out loud: *"Does A's change corrupt B's data?"* and
   *"Does B's existing behaviour corrupt A's new field/logic?"*
3. During Phase 4, before accepting an existing test as "overlap" for this
   pair, confirm which direction it actually asserts. A test file named for
   one direction (e.g. `tab-payment-no-status-reset.spec.ts`) covers that
   direction only — it is not evidence the reverse direction is covered too.
4. If the reverse direction has no AC to derive a scenario from, that is a
   requirements gap, not a testing gap — route it through `sdlc-implementer`'s
   requirements gap flow (devaudit-installer#212) so an AC gets proposed for
   it, rather than silently adding an untracked test.
