# Horizon evaluations

Horizon is evaluated through Constal's normal Dataset, Scorer, and Suite Resources. The cases in this directory are immutable inputs to ordinary Horizon Runs; there is no test-only execution path.

The first evaluation layer is deliberately deterministic:

- `horizon-capability` contains representative repository missions that must produce a verified workspace artifact.
- `horizon-boundaries` contains invalid source or environment requests that must stop with an explicit blocked result without pretending work succeeded.
- `horizon-complete-contract` checks the durable result, plan, workspace, artifact, resolved-unknown, and convergence contract.
- `horizon-blocked-contract` checks honest terminal failure shape without requiring a plan or workspace that could not have been created.

Every repository case pins source commit `fb0b2def8ef6c373fb205befee061167faed756e`. Publishing a Dataset version therefore freezes both the case and the repository world it describes.

## Run the matrix

Use Luna for broad capability testing. A stronger model belongs only in a separately named comparison Suite; changing the bound Model changes the Agent execution identity and must never be folded into the same baseline.

```sh
constal evals scorers create --body @evals/scorers/complete-contract.json
constal evals scorers create --body @evals/scorers/blocked-contract.json

constal evals datasets create horizon-capability \
  --body '{"displayName":"Horizon capability","description":"Representative repository missions that must finish with independently verified artifacts."}'
constal evals datasets create horizon-boundaries \
  --body '{"displayName":"Horizon boundaries","description":"Source and environment failures that Horizon must report honestly without unnecessary model work."}'
```

Add every case as `{ "case": CASE, "replace": true }`, publish both drafts, and start one fresh Suite per Dataset with concurrency `1`. Keeping the Suites separate allows each Dataset to use one narrow Scorer and prevents a blocked safety case from being counted as a capability failure.

The exact published Resources and tested Agent identity are recorded in `pins.json`. Ready-to-run Suite requests are in `suites/`; they pin the tested bundle rather than floating to a later deployment.

```json
{
  "id": "horizon-capability-0-3-16-luna-v1",
  "dataset": { "crn": "DATASET_CRN", "version": "1", "hash": "DATASET_HASH" },
  "subject": {
    "agent": "crn:constal:production:52752121874141666554:default:agent/horizon",
    "bundle": "BUNDLE_HASH"
  },
  "mode": "fresh",
  "scorers": [{ "crn": "SCORER_CRN", "version": "1", "hash": "SCORER_HASH" }],
  "concurrency": 1,
  "budgetMicroUsd": 20000000
}
```

```sh
constal evals suites start --body @evals/suites/boundaries-luna.json
constal evals suites start --body @evals/suites/capability-luna.json
```

Review case errors separately from Scorer failures. An execution error is not a low quality score. Promote a result to the Horizon baseline only after all cases complete, every deterministic Scorer passes, the generated diffs and planning Facts have been sampled manually, and the settled cost is understood.

## Coverage

| Case | Capability under evaluation |
| --- | --- |
| `single-file-documentation` | Repository investigation, one bounded edit, verification, packaging |
| `multi-file-consistency` | Cross-file planning, dependency ordering, consistent terminology |
| `already-satisfied` | Evidence-based no-op rather than gratuitous editing |
| `code-and-test` | Source/test responsibility split and independent test reproduction |
| `invalid-repository` | Source failure is terminal and honest |
| `invalid-environment-root` | Workspace confinement is enforced before setup execution |
| `failing-environment-setup` | Deterministic setup failure blocks before semantic work |

Unit tests continue to cover injected runtime failures—compaction, plateau detection, optional provider images, stale reads, and recovery—because those are deterministic implementation contracts rather than model-quality questions. Successful and failed production Runs should additionally be captured into later Dataset versions for replay regression coverage.
