<!-- Copyright 2026 Coresource AI, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Put Horizon to work

Horizon takes a software change from an initial request through investigation, planning, implementation, independent verification, and a pull request. The GitHub issue is the shared workspace: start the task there, then use the same thread to answer questions, approve the plan, steer the work, or cancel it.

[Create a task for Horizon →](https://github.com/constal-ai/horizon/issues/new?title=Implement%3A%20&body=%40constal-ai%20Implement%20this%20feature%3A%0A%0A%3CDescribe%20the%20outcome%20you%20want.%3E%0A%0AAcceptance%20criteria%3A%0A-%20)

## Write the request

Start the issue body with the Horizon mention:

```text
@constal-ai Implement this feature:

Describe the outcome you want and why it matters.

Acceptance criteria:
- Describe behavior that would prove the change works.
- Include important constraints or non-goals.
```

You do not need to produce an implementation plan. Horizon begins by reading the repository and turns the request into an evidence-grounded rubric, design, milestone graph, work graph, and verification plan.

## Follow the run in GitHub

1. Submit the issue. Horizon acknowledges it and begins investigating the repository.
2. Review the plan Horizon posts. A collaborator with `write`, `maintain`, or `admin` permission can approve it or request changes.
3. Keep using the issue thread. Ask for status, answer a question, add a constraint, revise the objective, or cancel the work there.
4. When every planned change has independent verification, Horizon publishes a branch and opens a pull request linked to the issue.

Horizon can pause safely while it waits for a decision. Reply on the issue whenever you are ready; the same durable run continues from its recorded state.

## Call Horizon directly

You can also start Horizon from the Constal CLI with a stable Session:

```sh
constal runs start horizon my-task --data '{"objective":"Implement this feature"}' --deliver live
```

For explicit source revisions, environment setup, constraints, and the complete request contract, see the repository [README](https://github.com/constal-ai/horizon#calling-horizon-directly).
