<!-- Copyright 2026 Coresource AI, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Horizon

**Horizon is a long-horizon software engineering agent that follows the software engineering workflow.**

Horizon carries a change from an ambiguous objective to a verified pull request. It builds an evidence-grounded understanding of the repository, turns that evidence into a rubric and design, plans the work and its proof, then implements each responsibility with independent verification. When the evidence changes, the right planning phase opens again.

Give Horizon a repository and an objective. It can stay with the work across many specialist runs, failed attempts, replans, approvals, and human pauses—then return a verified pull request or one precise reason it cannot safely continue.

Horizon is open source under Apache 2.0 and built on the [Constal](https://constal.ai) runtime.

## The long-horizon software engineering loop

This is a recursive engineering system. Planning loops until the specification is coherent. Execution loops until the evidence is strong enough to continue, replan, ask for a decision, or ship.

### 1. The full run

```text
                              revise
                    ┌──────────────────────┐
                    │                      │
                    ▼                      │
Repository ──► Planning loop ──► Plan approval ──► Execution loop
    +               ▲                                  │
 objective          │                                  │
                    └──────────── replan ──────────────┤
                                                       │ all work proven
                                                       ▼
                                             Verified package / PR

Planning or execution ──► decision needed ──► durable human wait
        ▲                                              │
        └──────── resume responsible phase ◄──────────┘
```

### 2. Milestones expand into work and proof

```text
Investigations ──► Rubric ──► Design Agent ──► Milestone graph
                                                    │
                                                    ▼
                                  expand in topological order

Milestone A ──► Decomposition Agent A ──► Steps A1, A2, A3
     │                                           │
     │        accepted prerequisite steps       │
     ▼                                           │
Milestone B ──► Decomposition Agent B ──► Steps B1, B2
     │                                           │
     ▼                                           │
Milestone C ──► Decomposition Agent C ──► Steps C1, C2, C3
                                                 │
                    ┌────────────────────────────┘
                    ▼
             Combined work graph
                    │
                    ▼
            Structural critique
                    │ accepted
                    ▼
       concurrent proof fan-out by step

Step A1 ──► Assertion Agent A1 ──► Proof for A1 ──┐
Step A2 ──► Assertion Agent A2 ──► Proof for A2 ──┤
Step B1 ──► Assertion Agent B1 ──► Proof for B1 ──┼─► Assertion plan
Step C1 ──► Assertion Agent C1 ──► Proof for C1 ──┘          │
                                                             ▼
                                              Continuity review on replans
                                                             │
                                                             ▼
                                                   Complete critique
                                                             │ accepted
                                                             ▼
                                                Immutable plan revision
```

The Design Agent creates the milestone graph. Horizon then gives each milestone to its own Decomposition Agent, in dependency order, so downstream milestones can consume the accepted terminal steps of their prerequisites. Once structural critique accepts the combined work graph, Horizon creates every per-step Assertion Agent before awaiting any of them. That second expansion is a true concurrent fan-out.

### 3. Planning repair loops

```text
Structural critique
    ├─ missing evidence ──► Investigate ──► regenerate downstream planning
    ├─ rubric gap ────────► Rubric ───────► Design ─► Milestones ─► Steps
    ├─ design gap ────────► Design ───────► Milestones ─► Steps
    ├─ work-plan gap ─────► Repair the combined work graph
    ├─ product decision ──► Ask user and wait durably
    └─ accepted ──────────► Fan out per-step assertions

Complete critique
    ├─ missing evidence ──► Investigate, then regenerate affected downstream work
    ├─ rubric gap ────────► Rubric, design, milestones, steps, and assertions
    ├─ design gap ────────► Design, milestones, steps, and assertions
    ├─ work-plan gap ─────► Repair work graph, then regenerate assertions
    ├─ proof gap ─────────► Repair the complete assertion plan
    ├─ continuity gap ────► Reconcile prior verified work with this revision
    ├─ product decision ──► Ask user and wait durably
    └─ accepted ──────────► Immutable plan revision
```

### 4. The execution loop

```text
Next dependency-ready unit ──► Implement ──► Independent verification
                                    ▲                  │
                                    │                  ▼
                                    └────────────── Reconcile evidence

Reconcile evidence
    ├─ repair step ───────────► Implement again
    ├─ reverify ──────────────► Independent verification
    ├─ step proven ───────────► Checkpoint, then take the next ready unit
    ├─ planning defect ───────► Re-enter the earliest deficient planning phase
    ├─ product decision ──────► Ask user and wait durably
    └─ all work proven ───────► Package workspace and publish the PR
```

Each phase has one job.

- **Investigate:** Read the repository before proposing changes. Trace behavior, architecture, call paths, tests, and the evidence specific to the objective.
- **Define the rubric:** Turn “make this work” into observable success criteria, constraints, non-goals, and material open questions.
- **Design the solution:** Make the architectural decisions and generate a dependency-ordered milestone graph.
- **Plan the work:** Give each milestone to a focused Decomposition Agent, then join its steps into one executable work graph.
- **Define the proof:** After structural critique, fan every step out to its own Assertion Agent for positive behavior, negative paths, and invariants.
- **Critique and approve:** Critique structure before assertion fan-out, critique the complete plan afterward, and ask for human approval before GitHub-initiated mutation.
- **Implement:** Change one coherent part of the system at a time in a shared, recoverable workspace.
- **Verify independently:** Have a separate verifier inspect the diff and reproduce the required evidence. The implementer does not mark its own homework.
- **Reconcile:** Keep useful work, repair the step, verify again, restore a known-good checkpoint, or revise the plan when reality disagrees with it.
- **Ship:** Package the verified workspace, publish an immutable branch, and open a pull request tied to the original issue.

That loop is what lets Horizon take on changes that fight back: multi-file refactors, migrations, reliability work, cross-subsystem features, and tasks where the first reasonable plan is rarely the final one.

## Why it can stay with hard work

- **Plans improve without losing history.** Every revision is critiqued and remains connected to the repository evidence that produced it.
- **Evidence defines progress.** New observations move the work forward; repetition triggers a different route, a sharper question, or an honest stop.
- **Verification is independent.** Implementation and proof belong to separate specialist responsibilities.
- **Decisions remain explainable.** Investigations, rubrics, designs, plans, attempts, user answers, and verification results stay durable and addressable.
- **Time is part of the workflow.** A run can wait for a person, survive a process failure, and resume from the last durable fact and verified workspace checkpoint.

The goal is not endless autonomy. The goal is to reduce uncertainty until the work is proven complete or there is one clear decision only a human can make.

## Using Horizon from GitHub

Horizon includes a GitHub Channel and Auth Provider. Once they are installed for a repository, the issue becomes the human interface for a run.

1. Open an issue that describes the outcome you want.
2. Mention the configured Horizon account or apply the configured label.
3. Horizon prepares the repository, investigates it, and posts its plan.
4. A collaborator with `write`, `maintain`, or `admin` permission approves, requests a revision, or cancels.
5. Horizon implements and verifies the approved work.
6. On success, it publishes an immutable branch and opens a pull request linked to the issue.

Questions and steering do not wait behind the long-running work. Each GitHub conversation event gets a short foreground Session that reads the issue and the authoritative state of the stable work Session, then either answers directly or applies a reviewed control to the work. A failed state read remains unavailable; it is never mistaken for “nothing is running.”

Answers, plan revisions, and steering share one guidance action. Horizon routes the original message to the open work question when there is one, otherwise to the existing Run steering ledger. The work workflow reads those events through a native ledger view before planning, after a child completes, and after approval. New guidance is reconciled with the current plan and verified work before further execution; a changed plan requires fresh approval. An in-flight tool call is not implicitly interrupted. Explicit pause, cancel, and interrupt remain separate controls.

The outer workflow owns plan review, approval, independent verification, workspace packaging, and GitHub publication. Execution work units describe repository changes and their local checks, not another approval ceremony or a duplicate PR publisher. The GitHub review shows the proposal and intended changes with the complete implementation specification and checks available in expandable details.

The GitHub integration deliberately separates transport from engineering behavior:

- the **Auth Provider** verifies webhook authenticity;
- the **Channel** decodes events, rejects unsupported activity, routes messages, and delivers idempotent comments;
- the **Horizon Agent** owns investigation, planning, execution, verification, and conversation semantics.

See [conversation and work lanes](docs/execution-architecture.md#conversation-and-work-lanes) for the exact ownership model.

## Calling Horizon directly

Horizon accepts a plain string objective or a structured request. A structured request is useful when the source revision, environment setup, or constraints must be explicit:

```json
{
  "objective": "Add resumable repository imports and prove replay after interruption.",
  "source": {
    "kind": "github",
    "owner": "constal-ai",
    "repository": "example",
    "ref": "main"
  },
  "environment": {
    "name": "node",
    "cache": true,
    "setup": [
      {
        "cmd": "npm",
        "args": ["ci", "--ignore-scripts"],
        "cwd": "/workspace/repo",
        "timeoutMs": 600000
      }
    ]
  },
  "constraints": [
    "Reuse the existing storage and sandbox abstractions.",
    "Do not publish or deploy."
  ]
}
```

Save the request as `request.json`, then start it in a stable Session with the Constal CLI:

```sh
constal runs start horizon repository-imports --data @request.json --deliver live
```

The source may also be an authorized immutable `tar.gz` artifact. If no source is supplied, Horizon uses its bound GitHub Resource to resolve one and asks the user when the available evidence is ambiguous.

At a high level, a terminal result is always explicit about success or failure. The complete versioned contract lives in [`src/contracts.ts`](src/contracts.ts).

```ts
type HorizonResult = {
  status: "complete" | "blocked";
  summary: string;
  plan: { revision: number; fact: string } | null;
  completedSteps: Array<{ id: string; status: string; summary: string }>;
  remainingUnknowns: unknown[];
  artifact: { ref: string; bytes: number; path: string } | null;
  publication: {
    repository: string;
    branch: string;
    commit: string;
    pullRequest: { number: number; url: string };
  } | null;
};
```

`blocked` is not a disguised success. Horizon uses it when the source cannot be prepared, proof cannot be reproduced, an external outcome is genuinely unknown, or no safe dependency-ready action remains.

## Runtime architecture

One Horizon mission maps to one durable Constal Session and one logical workspace. Child Agents inherit that Session, so they share the same repository and checkpoint history.

The major ownership boundaries are intentionally simple:

- **Constal owns orchestration.** The journal and Facts are authoritative for plans, accepted Resources, Policy, user decisions, recovery, and completion.
- **The sandbox owns temporary compute.** It holds the live filesystem and processes, but it is replaceable. Horizon can reconstruct it from immutable source and verified checkpoints.
- **Content-addressed storage owns durable artifacts.** Source archives, planning envelopes, attempt records, checkpoint receipts, and final packages have stable identities.
- **Resource contracts own external effects.** A model never decides whether an ambiguous API call is safe to retry. The pinned Resource declares repeat, idempotency, reconciliation, or unknown-outcome behavior.
- **Readers may run in parallel; writers do not.** Investigators can inspect concurrently. Execution specialists get exclusive, ordered access to the Session workspace.

Provider standby snapshots make ordinary resume fast. They are an optimization, not the durable record. Horizon verifies a cached image before trusting it and rebuilds from the immutable source archive when the receipt, runner, Git baseline, tree, or status does not match.

The full state machine, cache identity, checkpoint protocol, recovery behavior, and replan rules are documented in [Horizon execution architecture](docs/execution-architecture.md).

## Safety boundaries

Horizon is intentionally opinionated about what an engineering agent may claim:

- GitHub work requires an approved plan before repository mutation.
- Source revisions and platform Resources are pinned for the run.
- Workspace paths are confined to `/workspace/repo`.
- Credentials stay behind Resources and never enter prompts, setup commands, images, or repository files.
- Every completed step has independently reproduced evidence.
- An unavailable read is never treated as an empty result.
- Repeated evidence does not count as progress; plateau guards force a different route, a precise question, or an honest stop.
- Restoring files does not pretend to reverse an external side effect.
- Horizon publishes a branch and pull request; it does not silently merge the result.

The standard specialist loop has a 500-turn emergency ceiling. Execution specialists and the shared runner have a 1,000-turn ceiling. These are backstops, not targets: evidence plateaus and repeated-state guards should end normal work much earlier.

## Current scope

Horizon currently assumes:

- a GitHub repository or immutable source archive;
- a Constal deployment with Model, Sandbox Pool, CAS, GitHub, Web, Search, and Constal API Resources;
- one logical writable workspace per mission;
- explicit argv-based environment setup inside the configured sandbox image;
- pull-request delivery for GitHub-initiated work.

The default sandbox image is Node-based and contains Git, `tar`, `gzip`, and `ripgrep`. A different toolchain should be prepared through explicit setup or a separately governed Sandbox Pool image. Model output cannot select an arbitrary base image or start a nested container runtime.

Horizon is under active development and remains pre-1.0. Its execution contracts are tested and versioned, but operators should review [known issues](docs/known-issues.md) before using it on critical repositories.

## Repository guide

| Path | Purpose |
| --- | --- |
| `src/workflow.ts` | Top-level durable workflow and execution/reconciliation loop |
| `src/tasks/` | Focused planning, execution, verification, and repair Agents |
| `src/prompts/` | Stable role prompts; request-specific state is supplied separately |
| `src/workspace/` | Deterministic preparation, inspection, checkpoints, and restore |
| `src/tools/` | Model-facing GitHub, workspace, Web, and platform Tools |
| `src/github-channel/` | Webhook routing and idempotent issue-comment delivery |
| `src/github-auth-provider/` | GitHub webhook authentication |
| `src/views/` | Live progress projection for operators and users |
| `evals/` | Capability, boundary, and proportionality evaluation suites |
| `sandbox/` | Pinned base image and workspace runner |
| `docs/` | Detailed architecture and operational notes |

## Development

Horizon is written in TypeScript and tested with Vitest. Node.js 24 is the reference runtime used by the sandbox image.

```sh
npm ci
npm run check
```

`npm run check` runs TypeScript validation and the complete unit-test suite. The tests cover parsing, planning convergence, evidence plateaus, GitHub routing, workspace confinement, checkpoint recovery, publication, and failure behavior.

To validate or build the default sandbox image:

```sh
npm run sandbox:check
npm run sandbox:build
```

Model quality is evaluated separately from deterministic runtime correctness. See [Horizon evaluations](evals/README.md) for the capability, safety-boundary, and proportionality suites and their pinned baselines.

## Deployment

Horizon is a Constal Agent package, not a standalone background daemon. Before deploying it into another namespace, update `constal.agent.json` with the exact Resource bindings for that environment. The checked-in manifest stays portable; `npm run deploy` adds the target tenant's current deployment revision to its temporary release archive.

With the Constal CLI authenticated:

```sh
constal deploy . --wait
```

The GitHub Channel and Auth Provider are separate deployable Resources because they own different security boundaries. Repository maintainers can release those components with `npm run deploy:components`; `npm run deploy` packages and releases the Agent. The release scripts require `CONSTAL_TENANT_ID` and the administrative credential file documented at the top of each script.

Publishing a new sandbox image is a separate operation because the Sandbox Pool pins an immutable image digest. Follow the [release sequence](docs/execution-architecture.md#release-sequence) rather than changing the image underneath an active run.

## License

Copyright 2026 Coresource AI, Inc.

Licensed under the [Apache License, Version 2.0](LICENSE).
