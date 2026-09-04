# Horizon

Horizon is Constal's long-horizon software agent. It investigates a repository, commits an immutable natural-language execution specification, assigns each semantic responsibility to a focused child Agent, and keeps reconciling actual evidence with the plan until the work is proven complete or one material user decision is required.

It is a standalone Agent package built with `@constal/sdk`. It uses Constal's existing Model, Sandbox Pool, CAS, GitHub, and Web Resources; it does not create a parallel runtime, source store, credential system, or deployment path.

GitHub issues use two Session lanes: one stable durable work Session for investigation, planning, approval, execution, and recovery, plus one delivery-scoped foreground Session for each conversational webhook. A new question therefore does not wait behind the long-running work Session. The foreground supervisor reads the authenticated private issue, recent comments, authoritative Run detail, and open waits before deciding whether to answer, resolve a work decision, steer active work, or start new work. It preserves unavailable state as unavailable rather than interpreting a failed read as an empty Run or wait list.

The GitHub Channel authenticates and decodes the webhook, classifies supported lifecycle events, selects the Agent sink, and encodes replies. It does not implement Horizon's conversational or work semantics. Starting idle work is a durable cross-Session delivery to the stable work Session. Controls on existing work use a reviewed Constal API ChangePlan through the ordinary bound Resource; Horizon receives no ambient management credential and creates no separate authority path. See [the execution architecture](docs/execution-architecture.md#conversation-and-work-lanes).

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
                │ continue   │ replan │ ask        │ complete
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
       ├─ evidence problem ──────► Focused investigation
       │                              ↓
       │                         Design → fresh decomposition
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
       ├─ evidence problem ──────► Focused investigation → corresponding upstream route
       └─ upstream problem ──────► corresponding upstream route
```

Initial discovery and investigation own repository evidence before rubric begins. Rubric consumes that evidence and defines success; it never schedules investigation. Initial decomposition stays parallel and milestone-scoped. Repair is different: the whole-work-plan repair Agent owns the complete dependency graph, so it can merge duplicate responsibilities, move ownership, and repair cross-milestone handoffs in one pass. The whole-assertion-plan repair Agent does the same for proof obligations. Critique reports the earliest deficient owner; the planning controller chooses the transition. A material evidence gap creates one controller-owned frontier from its affected milestone and step scope, reopens a focused read-only investigation, accumulates the result in the same planning state, and returns to the requesting downstream phase. An unchanged frontier plateaus as explicit unavailable evidence rather than being regenerated from rephrased model prose.

Models never own a terminal planning transition. For each exact planning state, the controller records a repair route that returned to an already-observed state and makes that route unavailable on the next critique. The critic must then choose a different evidence or repair owner, accept explicit uncertainty that does not prevent execution, or formulate one durable user decision. This makes convergence a controller property without mechanically judging natural-language semantics.

### Execution repair and replanning

```text
Resource operation recovery
  repeat / idempotency / reconcile / outcome unknown
  (owned by the pinned Resource contract)
                     ↓
Execution attempt → Independent verification → Execution reconciliation
                                               │
                  ┌────────────────────────────┼──────────────────────────┐
                  │                            │                          │
            repair step                    reverify                    replan
                  │                            │                          │
        keep current workspace       reuse execution evidence     investigation → missing evidence
        or restore last verified     and rerun verifier only      assertions → assertion repair
                  │                                               decomposition → whole-plan repair
                  └────────────────────────────┐                  design → fresh decomposition
                                               ▼                          │
                                          next attempt ◄──────────────────┘
```

Every attempt records its plan and step Facts, verification Fact, before/after workspace identity, latest verified restore point, and compact Tool receipts in CAS. Complete evidence remains in the referenced Facts rather than being copied into child-Run input.

Reconciliation is semantic Agent work, but its controller route is structural. It may continue verified work, repair the same specification, repeat verification without repeating implementation, enter investigation or planning at the earliest invalid owner, or ask one durable user question. It cannot terminate the workflow. When repeated execution produces the same governed evidence, the controller disallows another identical execution route; one materially different replan may be tried before the unresolved decision is presented to the user. Operation retry is never an LLM decision.

A new plan revision includes an independently critiqued continuity decision for every previously verified work unit: retain, reverify, rerun, or drop. Horizon does not compare plan prose or trust model-generated semantic IDs. Forward repair in the current workspace is the default. Restoration is explicit, uses the existing Sandbox Pool image contract, verifies the exact tree and status, and conservatively discards work beyond the restored verified prefix.

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
| Plan critic | Find cross-artifact contradictions and recommend the earliest evidence or planning owner; it cannot terminate the workflow |
| Finalizer | Render converged planning artifacts into the immutable natural-language specification |
| Execution specialist | One coherent semantic responsibility, executed as its own ReAct loop |
| Verifier | Independently inspect the diff and reproduce proof before a step can complete |
| Continuity reviewer | Decide whether previously verified work remains proven, needs reverification, must rerun, or was dropped |
| Reconciler | Evidence-based continue, step repair, reverification, owner-routed replan, ask, or complete recommendation |
| Question reconciler | Decide semantically whether a proposed user decision was already answered |

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
