# Horizon

Horizon is Constal's long-horizon software agent. It investigates a repository, commits an immutable natural-language execution specification, assigns each semantic responsibility to a focused child Agent, and keeps reconciling actual evidence with the plan until the work is proven complete or progress honestly plateaus.

It is a standalone Agent package built with `@constal/sdk`. It uses Constal's existing Model, Sandbox Pool, CAS, GitHub, and Web Resources; it does not create a parallel runtime, source store, credential system, or deployment path.

## Long-horizon architecture

```text
User objective
      │
      ▼
Discovery framer ReAct
      │
      ├── Investigation Agent · behavior / call flow
      ├── Investigation Agent · architecture / ownership
      ├── Investigation Agent · tests / verification
      └── other objective-specific investigations
      │
      ▼
Rubric Agent ──► Design + Milestone Agent
                       │
                       ├── Milestone Decomposer Agent · milestone 1
                       ├── Milestone Decomposer Agent · milestone 2
                       └── accepted prerequisite work flows forward
                                      │
                                      ├── Assertion Agent · step A
                                      ├── Assertion Agent · step B
                                      └── Assertion Agent · step C
                                                   │
                                                   ▼
                                         Cross-plan Critique Agent
                                                   │
                         blocking finding ──────────┤
                         ▼                         │ accepted
             rerun owning planning loop             ▼
             + every dependent loop        Finalization Agent
                         └───────────────►  Immutable Plan Fact r1
                                                   │
                                      dependency-ready work unit
                                                   ▼
                                          Execution Agent ReAct
                                                   │
                                          Independent Verifier
                                                   │
                                          Reconciliation Agent
                         ┌────────────┬─────────────┼────────────┐
                         │ continue   │ replan      │ ask        │ complete / blocked
                         │            ▼             ▼            ▼
                         │       Plan Fact r2    durable      immutable
                         │       (r1 remains)     await       CAS artifact
                         └────────────┴─────────────┘
```

The Run can suspend and resume at every durable primitive. Discovery, every planning phase, plans, specialist results, independent verification, user answers, reconciliations, plateau state, and the final artifact are committed Facts. A replan is a new immutable revision, never a mutation of earlier intent or evidence. Changed completed work is explicitly invalidated and rerun; unchanged completed proof is retained.

Large planning handoffs move through content-addressed CAS envelopes rather than inline child-Run input. ReAct loops keep recent observations verbatim, commit complete older rounds, and retain a bounded deduplicated evidence projection after compaction.

## How Horizon decides to keep going

An agentic loop exists to reduce uncertainty. Horizon treats the following as progress:

- a material unknown is resolved, narrowed, or replaced by a more precise question;
- a specialist completes a responsibility;
- a Tool returns a genuinely new observation;
- execution evidence proves that the plan must change.

Its plateau detector compares canonical Tool arguments and observed results. It does not classify English prose, grep for semantic keywords, or infer correctness from field counts. Two repeated evidence rounds force the role to resolve, replan, ask, or block without making another Tool call. A separate workflow fingerprint prevents identical failed work from looking like progress across replans.

## Agent roles

| Role | Responsibility |
| --- | --- |
| Discovery framer | Establish the immutable source workspace and divide repository questions by evidence boundary |
| Investigator | Resolve one bounded software question set without duplicating other investigations |
| Rubric | Define observable success, constraints, non-goals, and material open questions |
| Designer | Close architecture decisions and define dependency-ordered outcome milestones |
| Milestone decomposer | Turn one milestone into specialist loops, consuming accepted prerequisite work |
| Assertion writer | Define independent positive, negative-path, and invariant proof for one step |
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
  "context": {
    "repository": "constal-ai/example"
  },
  "constraints": [
    "Reuse the existing CAS and Sandbox abstractions.",
    "Do not publish or deploy."
  ]
}
```

Repository access is resolved through the Run's bound GitHub Resource. Credential material never enters Horizon's code or model context.

## Output

The final result reports:

- the current immutable plan revision and Fact;
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
