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
2. Publish it and record the immutable image digest.
3. Deploy Sandbox Driver v18 and the Sandbox Driver service.
4. Update the platform's immutable Sandbox Driver reference.
5. set `PLATFORM_CODE_SANDBOX_IMAGE` to the published digest and provision platform catalog generation 33.
6. Deploy Horizon with `sandbox` bound to `sandbox-pool/constal-code`.
7. Verify one cache miss, a new-Session cache hit, provider standby resume, invalid-cache rebuild, verified-step snapshot, and final artifact packaging.
