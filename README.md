# Horizon

Horizon is Constal's long-horizon software agent. It investigates a repository, commits an immutable natural-language execution specification, assigns each semantic responsibility to a focused child Agent, and keeps reconciling actual evidence with the plan until the work is proven complete or progress honestly plateaus.

It is a standalone Agent package built with `@constal/sdk`. It uses Constal's existing Model, Sandbox Pool, CAS, GitHub, and Web Resources; it does not create a parallel runtime, source store, credential system, or deployment path.

## Long-horizon architecture

```text
User objective
      │
      ▼
┌───────────────────────────────────────────────┐
│ Planner ReAct                                │
│ discover repository → resolve questions      │
│ → divide semantic responsibilities           │
└──────────────────────┬────────────────────────┘
                       │ commit
                       ▼
              Immutable Plan Fact r1
                       │
             dependency-ready work unit
                       ▼
┌───────────────────────────────────────────────┐
│ Execution specialist ReAct                   │
│ inspect → decide → edit → test → inspect diff │
└──────────────────────┬────────────────────────┘
                       │ commit evidence
                       ▼
┌───────────────────────────────────────────────┐
│ Reconciliation specialist                    │
│ compare actual evidence with immutable intent │
└───────┬────────────┬──────────┬─────────┬──────┘
        │ continue   │ replan   │ ask     │ complete / blocked
        │            │          │         │
        │            ▼          ▼         ▼
        │      Plan Fact r2   durable   immutable
        │      (r1 remains)    await     CAS artifact
        └────────────┴──────────┘
```

The Run can suspend and resume at every durable primitive. Plans, specialist results, user answers, reconciliations, plateau state, and the final artifact are committed Facts. A replan is a new immutable revision, never a mutation of earlier intent or evidence.

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
| Planner | Discovery-first repository understanding and the immutable natural-language specification |
| Execution specialist | One coherent semantic responsibility, executed as its own ReAct loop |
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
