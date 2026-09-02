# Horizon

Horizon is Constal's long-horizon software agent. It investigates a repository, commits an immutable natural-language execution specification, assigns each semantic responsibility to a focused child Agent, and keeps reconciling actual evidence with the plan until the work is proven complete or progress honestly plateaus.

It is a standalone Agent package built with `@constal/sdk`. It uses Constal's existing Model, Sandbox Pool, CAS, GitHub, and Web Resources; it does not create a parallel runtime, source store, credential system, or deployment path.

GitHub issues use two durable Session lanes. The foreground Session remains responsive to questions, decisions, and steering while the work Session owns investigation, planning, approval, execution, and recovery. The foreground supervisor reads the authenticated private issue, recent comments, authoritative Run detail, and open waits before deciding whether to answer, resolve a work decision, steer active work, or start new work. Every work control is applied through a reviewed Constal API ChangePlan.

## Long-horizon architecture

```text
User objective
      │
      ▼
Source Resolver ReAct (only when source is ambiguous)
      │
      ▼
Deterministic workspace controller
      │ archive → environment digest → cached image fork or base preparation
      │ runner verification → synthetic Git baseline → WorkspaceReady Fact
      ▼
Discovery framer ReAct
      │
      ├── Investigation Agent · behavior / call flow
      ├── Investigation Agent · architecture / ownership
      ├── Investigation Agent · tests / verification
      └── other objective-specific investigations
      │
      ▼
Planning pipeline (detailed below)
      │
      ▼
Immutable Plan Fact r1
      │
      ▼
Dependency-ready work unit ──► Execution Agent ReAct
                                      │
                               Independent Verifier
                                      │
                               Reconciliation Agent
                ┌────────────┬────────┼────────────┐
                │ continue   │ replan │ ask        │ complete / blocked
                │            ▼        ▼            ▼
                │       Plan Fact r2  durable      immutable
                │       (r1 remains)  await        CAS artifact
                └────────────┴────────┴─────────────┘
```

### Planning and repair

```text
Initial planning
  Rubric
    ↓
  Design
    ↓
  Per-milestone decomposition
    ↓
  Structural critique
       │
       ├─ accepted ──────────────► Assertions
       │
       ├─ rubric problem ────────► Rubric → Design → fresh decomposition
       │
       ├─ design problem ────────► Design → fresh decomposition
       │
       ├─ decomposition problem ─► Whole-work-plan repair
       │                              ↓
       │                           Structural critique
       │
       └─ user decision ─────────► Durable question

Assertions
  ↓
Complete critique
       │
       ├─ assertion problem ─────► Whole-assertion-plan repair
       └─ upstream problem ──────► corresponding upstream route
```

Initial decomposition stays parallel and milestone-scoped. Repair is different: the whole-work-plan repair Agent owns the complete dependency graph, so it can merge duplicate responsibilities, move ownership, and repair cross-milestone handoffs in one pass. The whole-assertion-plan repair Agent does the same for proof obligations. Critique routes to the earliest invalid artifact, records exact affected milestone and step identities, and then critiques the repaired state again. Repeated repair scopes and repeated artifact states terminate as an honest planning plateau instead of spawning another decomposition wave.

One Horizon mission is one Constal Session and one logical Sandbox. Every child Run inherits that Session and therefore sees the same workspace. Provider standby snapshots preserve the live Session between active periods. Verified steps additionally publish immutable provider images with durable checkpoint receipts, while the original source archive, workspace identity, and final outputs remain content-addressed artifacts.

The Run can suspend and resume at every durable primitive. Source identity, WorkspaceReady, Discovery, every planning phase, plans, specialist results, independent verification, workspace checkpoints, user answers, reconciliations, plateau state, and the final artifact are committed Facts. A replan is a new immutable revision, never a mutation of earlier intent or evidence. Changed completed work is explicitly invalidated and rerun; unchanged completed proof is retained.

Large planning handoffs move through content-addressed CAS envelopes rather than inline child-Run input. ReAct loops keep recent observations verbatim, commit complete older rounds, and retain a bounded deduplicated evidence projection after compaction.

## How Horizon decides to keep going

An agentic loop exists to reduce uncertainty. Horizon treats the following as progress:

- a material unknown is resolved, narrowed, or replaced by a more precise question;
- a specialist completes a responsibility;
- a Tool returns a genuinely new observation;
- execution evidence proves that the plan must change.

Its plateau detector compares canonical Tool arguments and observed results. It does not classify English prose, grep for semantic keywords, or infer correctness from field counts. Two repeated evidence rounds force the role to resolve, replan, ask, or block without making another Tool call. A separate workflow fingerprint prevents identical failed work from looking like progress across replans.

Standard ReAct roles have a 500-model-turn emergency ceiling; execution specialists have 1,000. The shared runner ceiling is 1,000. These are deliberately Hz-scale backstops—the evidence plateau, repeated-state, question-deduplication, and convergence guards are expected to terminate normal work earlier.

## Agent roles

| Role | Responsibility |
| --- | --- |
| Source resolver | Resolve one authenticated repository and revision when the request does not supply an exact source |
| Workspace controller | Archive source, fork or prepare the Session environment, verify the runner, and commit the immutable baseline |
| Discovery framer | Divide prepared-repository questions by evidence boundary |
| Investigator | Resolve one bounded software question set without duplicating other investigations |
| Rubric | Define observable success, constraints, non-goals, and material open questions |
| Designer | Close architecture decisions and define dependency-ordered outcome milestones |
| Milestone decomposer | Turn one milestone into specialist loops, consuming accepted prerequisite work |
| Whole-work-plan repair | Reconcile ownership and handoffs across the complete work graph after critique |
| Assertion writer | Define independent positive, negative-path, and invariant proof for one step |
| Whole-assertion-plan repair | Reconcile proof ownership across every current work unit after critique |
| Plan critic | Find cross-artifact contradictions and route repair to the earliest owning planning loop |
| Finalizer | Render converged planning artifacts into the immutable natural-language specification |
| Execution specialist | One coherent semantic responsibility, executed as its own ReAct loop |
| Verifier | Independently inspect the diff and reproduce proof before a step can complete |
| Reconciler | Evidence-based continue, replan, ask, complete, or blocked transition |

Role prompts are stable and organized as Role, Task, Context, Rules, Tools, and Output. Request-specific state is supplied as turn context. Tool descriptions explain their behavioral contract and Resource boundary. JSON is used only for transport; semantic intent stays in natural-language specifications.

## Input

Horizon accepts either a string objective or a structured request:

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
      { "cmd": "npm", "args": ["ci", "--ignore-scripts"], "cwd": "/workspace/repo", "timeoutMs": 600000 }
    ]
  },
  "constraints": [
    "Reuse the existing CAS and Sandbox abstractions.",
    "Do not publish or deploy."
  ]
}
```

`source` may instead be an authorized immutable `tar.gz` artifact reference. When it is omitted, a focused Source Resolver uses the Run's bound GitHub Resource and asks only if authenticated evidence leaves multiple plausible repositories. The environment cache key includes the exact source archive, runner digest, setup specification, and Sandbox Pool revision. Credential material never enters Horizon's code, image, snapshot, or model context.

## Output

The final result reports:

- the current immutable plan revision and Fact;
- the durable WorkspaceReady receipt and whether its prepared image was reused;
- provider snapshot receipts for every independently verified step;
- every completed specialist responsibility;
- remaining unknowns, if blocked;
- the immutable CAS package produced from the governed workspace;
- long-horizon execution metadata: specialist Runs, replans, and plateau cycles.

## Development

```sh
npm install
npm run check
```

The package root is directly deployable through Constal's managed Agent deployment flow after its manifest bindings are selected for the target namespace.

Build the code Sandbox base with `docker build --platform linux/amd64 -t <registry>/constal-horizon-sandbox:<version> sandbox`. Configure the platform `sandbox-pool/constal-code` Resource with the published immutable image digest before deploying Horizon. See [docs/execution-architecture.md](docs/execution-architecture.md) for lifecycle and recovery invariants.
