<!-- Copyright 2026 Coresource AI, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub collaboration regression

Status: in progress. Do not treat the criteria below as passed until the linked issue, Run history, and pull request establish them.

## Test bed

- Repository: `constal-ai/const-alpha` (private).
- Starting commit: `2c653af`.
- Baseline checks: typecheck and all 339 tests passed before Horizon changed the test bed.
- Model: the existing Luna binding; no stronger-model substitution.
- Issue: [Find documentation by short technical terms](https://github.com/constal-ai/const-alpha/issues/2).
- Second case: [Contributor guide without production credentials](https://github.com/constal-ai/const-alpha/issues/3), covering a documentation-only change and the shared conversational question renderer.
- Scope: the existing documentation-search implementation and its tests. Horizon must open a pull request, not merge or deploy the target repository.

The issue contains a real unresolved product choice: whether dotted initialisms should match their undotted forms. Activate it through a comment so the test also exercises preservation of the original issue body across the conversational-to-work handoff.

## Baseline observation

[Issue #1's question](https://github.com/constal-ai/const-alpha/issues/1#issuecomment-5548076495) asked the requester which “authoritative budget contract” to use, including an option to provide the issue body that was already available. The user had to repeat the requirements. The comment also exposed internal planning terminology instead of describing a product decision.

The supervisor had read the issue but handed off only the model's restatement of the objective. User answers were similarly replaced by a model-authored paraphrase. These are information-loss defects, not just style problems.

## Acceptance evidence to collect

1. The work request retains the original issue, triggering comment, and observed thread context.
2. The question concerns the actual dotted-initialism choice, explains its consequence, offers three distinct choices and a free-form answer, and does not ask the requester to repeat available evidence.
3. A free-form reply, including qualifications, reaches the waiting work Run unchanged.
4. A status question is answered while work is in progress without creating duplicate implementation work.
5. The proposed plan describes the change and verification in user-facing terms. Repository mutation waits for approval.
6. Natural-language approval resumes execution of the reviewed plan.
7. Horizon performs the edit, runs the relevant checks, and opens a pull request with a coherent diff.
8. Public comments communicate actual progress in first person; internal identifiers and orchestration mechanics are not substituted for an explanation.

Review communication semantically against the request and observed evidence. Do not add production keyword checks, required prose phrases, or arbitrary response-length gates to make this evaluation pass.

## Candidate

- Agent source: `e8859ff` on `main`.
- Deployed Agent revision: `65d280d1-67f8-42b2-a1af-47e5c5491eba`.
- Existing tenant bindings retained, including the current logical GitHub service.
- Horizon checks: typecheck and all 170 tests passed before activation.

## Result

The first live clarification was [relevant to the product choice](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5550837762), rather than asking for the issue body. Its inline A/B/C layout prompted reuse of the existing structured question renderer for conversational questions too.

The [free-form answer](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5550848199) retained the constraints on other punctuation and on synonym dictionaries. The next conversational Run produced an implementation outline instead of handing off to the work agent. This is not accepted as successful planning: the conversational agent does not own the reviewed plan or its approval wait. The prompt's handoff semantics are being corrected to state positively that starting issue work begins investigation and plan review, not mutation.

Pending: verified handoff, work-plan approval, implementation, independent checks, and pull request.

### Handoff and platform recovery

After clarifying the handoff semantics, source `60a5a3c` was deployed as `baadb326-ac41-414e-bc9d-df66e9ee9d79`. The [follow-up request](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5550889687) created work Run `8974df88-7ac0-456a-961f-30b06fd368ba` in `github-6c2d3ea2287574232a92a7c851bbe9399b2432dafd7f403e-work`.

That Run exposed a transport regression before semantic planning: the Session router rejected compound DriverContext operations such as `state/get`. A routing regression test failed for all five state operations while twelve single-segment operations passed. Core commit `6c54315e` restores forwarding of the full operation path to the existing authenticated handler; 69 related tests passed. Platform version `6abba12a-4c16-4cff-8eb7-78311424282e` was deployed, and the same waiting Run recovered and began workspace preparation without being restarted.

Separately, platform logs show repeated Billing receipt rejections. The deployed Billing worker predates main's itemized-debit protocol. Deploying those existing changes may process accumulated charges, so approval was requested separately; no billing enforcement was weakened.
