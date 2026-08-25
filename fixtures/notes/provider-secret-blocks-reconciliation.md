---
id: provider-secret-blocks-reconciliation
kind: impediment
title: Reconciliation is blocked on a provider signing secret
status: open
recency: dated
relatedKeys: [PAY-9041]
tags: []
createdAt: 2026-08-20T09:02:00.000Z
updatedAt: 2026-08-20T09:02:00.000Z
verifiedAt: 2026-08-20T09:02:00.000Z
owner: dana@example.com
dueAt: 2026-08-26T17:00:00.000Z
container: sprint:PAY Sprint 14
joins:
  - {"key":"PAY-9041","tier":"EXTRACTED"}
evidence:
  - {"surface":"slack","label":"#eng-payments — dana","quote":"PAY-9041 is still blocked on the provider signing secret. I cannot test it until we have one.","ref":{"surface":"slack","id":"eng-payments-6"}}
---

Raised twice. The provider owes us a sandbox credential and nobody has chased it.
