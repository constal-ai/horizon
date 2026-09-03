# Horizon execution architecture

## Ownership

A Horizon mission maps to one Constal Session. The bound Sandbox Pool derives one logical sandbox from the tenant, exact Sandbox Pool revision, Horizon Agent CRN, and Session ID. Child Runs inherit the Session and share that workspace; a new mission uses a new Session.

The Session sandbox is recoverable compute, not authority. Constal's journal and Facts own orchestration, Policy, accepted Resource revisions, plans, verification, and checkpoint lineage. The sandbox owns only the current working filesystem and local processes. The workspace runner supervises commands, forwards cancellation, confines working directories to `/workspace`, and computes the actual Git worktree tree without mutating the repository index.

## Image layers

```text
immutable Constal code base image
  Node + Git + tar + ripgrep + workspace runner
                    │
                    ▼
tenant/Agent-scoped prepared environment image
  exact source archive + explicit setup + synthetic Git baseline
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Session sandbox A    Session sandbox B
   provider standby     provider standby
```

The base image is built from a digest-pinned upstream image. A tenant-provided OCI base belongs in a separately configured Sandbox Pool Resource; Horizon never starts a nested container runtime or accepts an arbitrary image reference from model output.

Prepared images are keyed by a full SHA-256 environment identity containing:

- the exact Sandbox Pool CRN; the Driver additionally scopes by its immutable Resource hash;
- workspace runner protocol, version, and source digest;
- immutable source archive identity and confirmed GitHub coordinates, when applicable;
- the complete explicit environment setup specification.

The Sandbox Driver further scopes the image to the authenticated tenant and Agent. An image cannot be selected, resolved, or deleted by another tenant or Agent, even if its cache key is known.

## Deterministic preparation

1. Parse an explicit GitHub or artifact source. If none is supplied, run the read-only Source Resolver and durably ask when evidence is ambiguous.
2. Confirm GitHub repository access, archive the requested revision through the governed GitHub Resource, and import the bytes into tenant-scoped CAS.
3. Compute the environment cache key before creating provider compute.
4. Resolve a prepared image. On a hit, fork it into the Session sandbox, install the exact rollout runner, and verify the stored receipt, baseline commit, actual worktree tree, and clean status.
5. On a miss, create the Session sandbox from the stable pool base, install and probe the runner, extract the archive into `/workspace/repo`, and execute only the user-supplied argv setup commands.
6. Create a synthetic Git repository and immutable baseline commit after preparation.
7. store a canonical WorkspaceReady receipt in CAS and inside the image, then publish the prepared image under the environment key.
8. Commit the WorkspaceReady Fact before Discovery or any semantic planning begins.

Source resolution is semantic work. Archive retrieval, extraction, baseline creation, cache publication, and receipt verification are deterministic controller work. Models cannot choose an alternate workspace root or repeat source import.

## Execution and concurrency

Investigators receive read-only workspace Tools and may run concurrently before mutation. The workflow admits one execution specialist at a time. The verifier runs only after that specialist returns, and reconciliation runs only after verification. The platform code Sandbox Pool additionally admits one command at a time and the coordinator orders same-time commands by durable command identity. Together these make the Session workspace an exclusive deterministic writer without introducing a second lock service. Future parallel writers must use isolated Git worktrees or independent sandbox forks from one verified checkpoint.

Every workspace Tool reopens the same logical Session sandbox and routes argv execution through the pinned runner. Paths used for repository reads, writes, patches, diffs, searches, and commands are confined to `/workspace/repo`. Credentials remain behind Resources and are never written into setup specifications or snapshots.

## Snapshots, resume, and recovery

Provider standby snapshot/resume is the normal fast path for a live Session. After each passed independent verification, Horizon computes the actual worktree tree through an alternate temporary Git index, publishes an immutable provider image, stores a checkpoint receipt in CAS, and commits its lineage to the plan, execution, and verification Facts.

Each execution attempt is also a durable CAS record. It binds the immutable plan Fact, work-unit identity, prior-attempt reference, executor and verifier Facts, compact Tool receipts, before/after workspace tree and status, and the verified image to which the attempt may safely return. The executor, verifier, reconciler, and planner receive CAS envelopes rather than copied large payloads. Exact Tool evidence remains in the referenced Facts and Run journal.

Failed verification does not automatically rewind the workspace. Reconciliation normally continues useful partial work in place. It may explicitly select the latest verified restore point only when unverified changes are corrupt, mis-scoped, or should be abandoned. Horizon recreates the same logical Session sandbox from that exact image and accepts it only when its inspected tree and status match the checkpoint receipt. If no image exists or verification differs, restoration stops with a durable blocked result.

Execution replanning enters the existing planning pipeline at the earliest invalid owner. Assertion defects repair the complete assertion plan and can re-run verification without implementation. Work ownership or dependency defects enter whole-work-plan repair. Design and rubric defects rebuild their downstream artifacts. A continuity Agent then classifies every prior verified work unit as retained, reverified, rerun, or dropped; the cross-plan critic reviews those decisions before the new plan becomes immutable. Runtime enforcement checks only graph references and receipts, never plan prose.

Resource operation recovery remains below this workflow. The pinned operation contract—not a model—decides whether an invocation repeats, deduplicates, reconciles, or returns an unknown outcome. Restoring files never claims to reverse an external effect.

A prepared cache image is never trusted merely because its identifier resolves. Horizon verifies its runner and WorkspaceReady receipt after forking. If materialization, receipt verification, or baseline verification fails, Horizon:

1. commits a cache-invalid Fact;
2. deletes the failed Session sandbox;
3. evicts the prepared image idempotently;
4. resets the logical Session to the Sandbox Pool base image;
5. repeats deterministic preparation from the immutable source archive;
6. publishes the repaired image under the same environment key.

Provider snapshots accelerate resume and branching. The source archive, natural-language plan revisions, verified checkpoint receipts, and final package remain the provider-independent durable record.

## Release sequence

1. Build and test the base image for the provider architecture.
2. Run `node scripts/release-sandbox-image.mjs --publish <registry>/constal-horizon-sandbox:<release>` and record the returned immutable image digest.
3. Deploy Sandbox Driver v18 and the Sandbox Driver service.
4. Update the platform's immutable Sandbox Driver reference.
5. set `PLATFORM_CODE_SANDBOX_IMAGE` to the published digest and provision platform catalog generation 33.
6. Deploy Horizon with `sandbox` bound to `sandbox-pool/constal-code`.
7. Verify one cache miss, a new-Session cache hit, provider standby resume, invalid-cache rebuild, verified-step snapshot, and final artifact packaging.
