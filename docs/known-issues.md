# Known issues

## Deleted GitHub issues can activate work

- Status: fixed in Horizon GitHub Channel 0.3.10
- Observed: 2026-09-03
- Evidence: Run `43721e92-dd93-48ca-9d4e-6422078e77cb`

The GitHub Channel classified an `issues` webhook whose action was `deleted` as
`github.issue.activated` because the deleted issue body still contained a configured
mention. Horizon consequently started work and created a durable question whose reply
destination was the deleted issue.

The Channel must accept an issue activation only for explicitly supported lifecycle
actions. A mention in a webhook payload is not sufficient to turn a deletion, closure,
or unrelated update into new work.

## A classified decision reply can fail to reach the work wait

- Status: fixed in Horizon 0.6.15 and Constal API Resource 15
- Observed: 2026-09-03
- Evidence: foreground Run `951770da-1c9b-4633-88cf-9384cf43aabd`, work Run `0cd361b2-5262-4215-bbae-3d6c11269d79`

The conversational supervisor correctly classified GitHub issue #14 comment
`5521467977` as `answer-work`, but its work-session Run and wait queries failed with
`PolicyDenied: ConstalApiDelegationInvalid`. The controller collapsed unavailable
supervision evidence into an empty wait list and responded that no decision was open.

Unavailable work-session state must remain unavailable. It must never be interpreted as
an authoritative empty result, and authenticated supervision must be able to inspect and
control the exact work Session identified by the admitted Channel event.
