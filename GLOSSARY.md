# Glossary

Domain terms for the CDST. Definitions only — no implementation details (see `docs/adr/` and `docs/superpowers/specs/` for decisions and designs).

| Term | Definition |
|------|------------|
| **Pharmacy** | The tenant and the billing subscriber. One row = one pharmacy location; has exactly one tier. Pharmacists belong to a pharmacy; an account may own several pharmacies (e.g. multiple locations) — each subscribes separately. |
| **Tier** | A pharmacy's subscription level: `basic` (no active subscription — tool locked), `pro` (active subscription — tool usable), `enterprise` (manual arrangement, no self-serve path). |
| **Pay-to-use** | The access model: only pharmacies with an active subscription can use the tool. There is no free tier. |
| **Lockout** | What a non-pro pharmacy experiences: navigation to clinical routes redirects to the billing page. Account data is preserved; unlocking is immediate on re-subscription. |
| **Lapse** | A subscription reaching its end without renewal (cancellation period over, or failed payment). Hard lock — no grace window. |
| **Owner** | A pharmacy member with full control of that pharmacy: billing, invites, pharmacy settings. Only owners see upgrade/manage actions. |
| **Pharmacist (member)** | An invited member of a pharmacy; uses the tool under the pharmacy's subscription. |
| **Invite** | An owner's pending offer for a pharmacist to join a specific pharmacy; expires after 7 days if unaccepted. |
| **Checkout session** | A short-lived Polar-hosted payment page. Created server-side with the pharmacy's identity baked in; completing it starts the subscription. |
| **Sync** | Applying a Polar subscription event to a pharmacy's tier. The only path Polar events take into the database. |
| **Customer portal** | Polar-hosted page where an owner manages the subscription: payment method, cancellation, invoices. |
