---
id: cache-over-constraint
kind: decision
title: A dedupe cache, not a database constraint
status: resolved
recency: dated
relatedKeys: [PAY-9012]
tags: []
createdAt: 2026-07-06T13:28:00.000Z
updatedAt: 2026-07-06T13:28:00.000Z
verifiedAt: 2026-07-06T13:28:00.000Z
container: sprint:PAY Sprint 12
joins:
  - {"key":"PAY-9012","tier":"EXTRACTED"}
evidence:
  - {"surface":"zoom","label":"PAY Sprint 12 planning","quote":"A cache in front of it. A unique constraint means a migration on the hot table and we are not doing that before the freeze.","at":1705,"ref":{"surface":"zoom","id":"sprint-12-planning","at":1705}}
---

Recorded in Confluence four days later. See [[adr-011-cache-over-constraint]].
