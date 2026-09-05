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

### Shared question presentation

[Issue #3's clarification](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5550960216) uses the shared question contract: the actual documentation-scope choice, three numbered alternatives, and a fourth free-form option. It does not expose planner state or require the requester to repeat repository facts.

Source `2ce9728`, deployed as `8708d371-0fb1-4039-8c19-7b1329f92a7b`, also avoids the duplicate frontend acknowledgment after a successful work handoff. The work Run remains responsible for its start update; questions and failed handoffs are not suppressed. All 172 Horizon tests passed.

The authoritative input of issue #2's work Run was checked through the conversation endpoint: its original issue body and the full punctuation/synonym-dictionary qualifications were both present.

### Current execution checkpoint

- Issue #2's [status question](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5551005676) received a [reply](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5551010833) while its work Run was still active; it was not serialized behind completion of that work.
- Issue #3's [scope answer](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5551005678) was delivered without another mention. It created work Run `c8de6e70-3258-45b3-9b87-df7706e98ace` in `github-0ddf1d3f68ccb3448964c56b86a4b00812865d71140f026a-work`, followed by [one start acknowledgment](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5551013838).
- Both work Runs completed workspace preparation and entered focused investigation. No implementation approval, repository edit, or pull request has been observed yet.
- The latest check showed issue #2's investigators queued at journal positions 39 and 33 without progress for more than 12 minutes, with 130 pending outbox items. Issue #3 had 92 pending outbox items. Neither work Session had an open human-input wait.
- The Billing worker's latest deployment is `f8e8f495-3ba4-4ffd-84e6-58b913305ec8` from 2026-09-04, before main's itemized-debit change `1578ac84`. The old debit validator requires `amountMicroUsd`; the current platform submits canonical meter `lines`. Current Billing typecheck and all 45 Billing tests pass. Deployment approval was requested because aligning the service may process accumulated usage charges.

The end-to-end result remains unproven. Keep the existing Runs; do not mark the evaluation passed or replace them just because observation is slow.

### Follow-up review while waiting

The completed `docs-search-tokenization` investigation (`c763e0bc-4560-8bce-8cea-98084f6d49f2`, result artifact `71360920c70d4311298c47f7b2183703cd100cd03aa294fd646c3ebfd7729ac9`) found the real filter and normalization requirements. It also suggested treating the example acronyms as a possible whitelist. Review the eventual plan for this overfitting: the issue says “such as” and rejects an acronym dictionary, not general support for other meaningful short technical terms. No work-plan approval has been given.

Source `0b3c583` restores the API's existing basic-Run projection for supervision metadata. The earlier change to request full traces for status was unnecessary; the API explicitly supports basic fields without trace authority. All 172 Horizon tests passed after restoring it.

### Billing deployment and backlog recovery

Deployment was explicitly approved. Billing version `4b06ea59-b601-4d6e-ae54-8d36da014c13` now runs the existing itemized-debit implementation from core `main`; no billing enforcement or receipt checks were bypassed. Immediately afterward, issue #2's pending outbox fell from 146 to 107 items and issue #3's from 139 to 100. The same work Runs were retained. This establishes initial backlog progress, not yet end-to-end completion or full settlement of the backlog.

Within the next few minutes, the backlogs fell to one and two pending items. Issue #2 completed investigation and entered rubric/design planning; issue #3's investigators resumed and produced results. The older issue #1 planner also resumed without a restart.

Issue #2's first rubric treated the example acronyms as an exhaustive allowlist. A [clarification during planning](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5552758037) restates the original general requirement without authorizing edits. Verify that this qualification reaches the active work and the reviewed plan, rather than being acknowledged only by the conversational agent.

The conversational Run `0657a9e3-381b-4a01-9e8b-72f966c5893c` returned a successful `run.steer` receipt and [acknowledged the clarification](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5552764859). Source inspection exposes a separate uncompleted integration: normal `runHorizon()` and `runReactLoop()` do not consume ledger steering; only explicit checkpoint restart reads it. Platform steering is Run-targeted, not implicitly inherited by already-spawned children. A successful receipt therefore does not establish that the clarification reaches the reviewed work plan. Keep this case open and retain the original approval requirement; do not approve a stale allowlist plan.

### Review and guidance regression

Both original Runs reached approval. [Issue #2's plan](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5553012580) still hardcoded the three example terms, confirming the steering-consumption defect. Its [revision request](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5554140471) resumed the same work Run through its existing approval wait.

[Issue #3's plan](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5552876024) duplicated controller-owned approval and publication as execution tasks. A [revision request](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554140571) was acknowledged but sent as steering instead of resolving the open review, leaving the work waiting. This establishes that choosing between two delivery mechanisms is an unnecessary model decision.

The candidate removes that choice: one `guide-work` action carries the original event into the open wait or the Run steering ledger. Root work consumes steering with the existing native event-view abstraction and reuses immutable replanning and completed-work continuity. Tests cover guidance during discovery, planning, and approval; the last case requires renewed approval before execution. Planning roles now share the actual approval/publication ownership contract. Review rendering separates the human proposal from expandable full execution details without truncating the specification for presentation.

Live validation of this candidate remains pending. Existing work Runs retain their pinned versions; a new conversational deployment can repair delivery to their existing waits, but cannot retroactively replace their planning or execution code.

Candidate `a564efd` passed typecheck and all 190 tests and was deployed as `eadd0472-a90b-4f1f-931b-c6f491f66cf5`, retaining the existing Luna and GitHub bindings. A [fresh revision reply on issue #3](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554191569) exercises unified guidance delivery to the existing approval wait.

[Issue #4](https://github.com/constal-ai/const-alpha/issues/4) adds a fresh-version case for the frontend-to-specialist documentation guide. It complements, rather than replaces, the unfinished code-change case #2 and contributor-guide case #3. It must exercise a product-choice question, an unchanged original reply, steering during planning, plan review, documentation verification, and an actual unmerged PR. No case is passed merely because the initial acknowledgment or unit tests succeeded.

### Approval handoff defect

Issue #3's corrected plan received [natural-language approval](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554245200); issue #2's corrected plan received [approval](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5554255469) too. Both passed the actual approval interpreter and repository-permission check. Their executors nevertheless stopped without editing because their inputs contained the original pre-approval issue history but omitted the recorded approval. The affected executor Runs are `2b0dd90b-299b-870b-9c7f-86bb25c12aff` (#3) and `04f476e6-6fb7-8448-8877-e7bcb0096b87` (#2). This is a missing-context defect, not an absent user decision.

The correction passes the committed review Fact, exact plan identity, decision, and original reply through the existing request context into execution, verification, and reconciliation. Subsequent steering preserves this context. Unit tests assert those exact handoffs, including new guidance during approval requiring a fresh review. No additional permission gate was added. The conversational role is also framed as an engineering teammate, with authorization bookkeeping kept out of the user-facing reply.

Issue #4's first native steering view completed successfully. A [clarification sent after its planner started](https://github.com/constal-ai/const-alpha/issues/4#issuecomment-5554281064) asks the same worked example to cover an unsuccessful specialist result without inventing recovery behavior. The next observation must establish that this reaches the revised plan, not merely its acknowledgment.

The recorded input of issue #4's second planner (`af176b17-86af-8d15-bc30-7d539cc4d3ff`) proves consumption: revision 2, previous revision 1, restart at rubric, and the complete original clarification in `request.context.steering` at event sequence 38. This was read from the planner's first governed `getText` result (`c8ec7caa29ed17b6b86edf041ad844556a5e2b30722155f6240cc467514ce392`), not inferred from its public acknowledgment. Its root remains `af64d9b2-5725-436d-8af1-2d7974120fbb`, pinned to `eadd0472`.

Approval-context correction `6c75e43` passed typecheck and 193 tests and was deployed as `a12d0b82-e2d7-47f3-8ec6-97c2d9a5db88`. The old issue #2 root completed with an application-level blocked result; the old issue #3 root was explicitly cancelled after its executor and verifier established that no documentation edits occurred. Both histories remain intact. They were not restarted merely because they were slow; the verified missing-approval handoff is pinned into those old Agent revisions. Fresh attempts remain to be started and verified.

### Additional defects exposed by the failed attempts

- The reconciler's actual final model response selected `ask`, supplied a valid three-option question and useful guidance, and left `planningOwner` null. The parser rejected it because it required choosing a repair owner before obtaining the answer. The correction accepts that question and reuses rubric reconciliation when an owner cannot yet be chosen; an explicit `replan` still requires its owner. Tests cover both specified-owner and answer-first paths.
- Issue #2 subsequently stopped at `root/79` with `capability slot unavailable`. Core `SessionDO` currently supplies await slots only for `root/0` through `root/63`, and `Runtime.awaitHandle()` rejects all later positions. This is an implementation limit, not missing user authority. It remains to be fixed at the native wait/handle boundary, not by raising Horizon's budgets or adding an agent workaround.
- Direct Dataset capture returned `400 live delivery requires bounded { text, data? } or string input` before starting capture. The same existing Evals agent accepts the normal queued invocation. Dataset draft `horizon-github-collaboration` was created, and capture Runs `241cc430-5099-447c-8837-c6cb79ac9c3b` and `052a2a0b-88aa-4a27-aef4-b175e5a058a1` were started in Evals sessions `horizon-github-capture-issue-2` and `horizon-github-capture-issue-3`. They carry `known-failure` tags and no success oracle; capture completion and case contents must be verified before treating the records as durable regression inputs.

The issue #2 capture completed and its exact source identity was verified in the Dataset. The stopped issue #3 root was not capturable (`source run has no exact capturable Subject`), so its completed blocked executor was captured through the same Evals agent instead (capture Run `4132c61c-2efc-4e8e-ab9a-5be840d2d2e5`). Both case records were read back and published as Dataset version 1, hash `d0d8d6b3217bf5d6e11ffd50c7cf039b9874f38ff2dfadf79f454a68cabdcfb1`; see `github-collaboration-pins.json`. These are preserved failure evidence, not a claimed green Suite.

Source `cfa78c9` passed typecheck and all 194 tests and was deployed as `fc979af3-8bf7-4d1a-9391-525d17747e82`. The native late-wait defect is still unresolved; no change to core runtime or its preallocated slots has been made in this iteration. Issue #4 remains running on `eadd0472`, with its late clarification demonstrably consumed by planner revision 2. No acceptance PR has yet been produced.

### Native late-wait correction and replacement attempts

Core commit `63825f1d` derives wait identity from the Run and journal position through the same helper used by coordinator validation. It removes the new runtime's dependency on preallocated slots without changing timeout policy or resolution authority. Legacy wire hints remain for already-pinned runner bundles. New tests first reproduced, then passed, a wait at `root/79` and 100 waits created in one invocation. The late wait also replayed without repeating the preceding 79 operations. A coordinator integration case verified publishing, answering, and completing that late setup-style wait.

Platform version `f9f820b8-6afb-489b-ae62-385ef82ac2aa` and builder version `7de64198-2a1f-4f36-a185-e8f86f0a7a2f` were deployed. The builder's new image is `sha256:baa1f16d74a3f5384bcda49f196c06696d8701d812a33067f37803bd2c48383e`. Its initial rollout had not yet changed the active image: the first Horizon rebuild (`3b0eae52`) still had the old bundle digest and was not used to start replacement tests. After the container application reported version 103 on the new image, rebuilding Horizon produced revision `fe5a9b25-31ae-4683-83bc-5cfa13718eb3` with new bundle digest `c349835e4cb0fc4f10e2bc2d2f20c832d42761c1669430d71f4f2b1b00585be6`.

- Issue #2 [replacement request](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5554505024) started root `597bab49-e68b-4681-bee4-a45e846f5e4f` in the same work Session.
- Issue #3 [replacement request](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554505096) started root `bf605cda-a948-4dc7-84d1-952e9f33047f` in the same work Session.
- Both roots' Channel admission was checked against revision `fe5a9b25`; the historical failed attempts remain preserved separately.
- Issue #4's [reviewed proposal](https://github.com/constal-ai/const-alpha/issues/4#issuecomment-5554410497) uses a readable proposal with expandable implementation details and incorporates the requested unfinished-specialist behavior. It received [approval](https://github.com/constal-ai/const-alpha/issues/4#issuecomment-5554420813). Executor `dbd1b43e-bef9-8d3e-bf1d-5d928d48956c` completed the guide work unit; independent verification is still in progress. This case remains pinned to `eadd0472` and was not restarted while it was making progress.

No PR or full acceptance result is claimed yet.

### Large discussion handoff

Replacement root `597bab49-e68b-4681-bee4-a45e846f5e4f` exposed a separate agent defect before discovery: the full issue discussion exceeded the inline spawn-input limit. Discovery, source selection, and approval interpretation were the remaining direct-input handoffs; the other specialists already used `ArtifactEnvelope`. The correction brings all three onto that existing CAS path and retains CAS independently of offered Tools. No discussion text is truncated and no runtime limit is raised. Tests run the complete workflow with a large original discussion and decode large inputs at each of the three changed specialist entrypoints.

The failure formatter also no longer equates every `PolicyDecisionFailed` with absent user authority: this failure was a payload contract error. Typecheck and all 198 Horizon tests pass. The other replacement root (`bf605cda-a948-4dc7-84d1-952e9f33047f`) continues planning, and issue #4 remains in independent verification after its first completed work unit.

The artifact-handoff correction (`1625727`) was deployed as `3fbaa1e1-e44e-46fe-af77-158eb2bd2657`. Issue #3's [replacement plan](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554587947) was reviewed against the original scope and [approved](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554611201). Executor `2454e3fd-1f2a-8593-b6f0-7ae8e588ae4a` started; no PR is established yet.

### Verification memory regression

Issue #4 verifier `2b7bcf52-f6cf-8497-9244-e10c873b3021` repeatedly requested an empty tracked-file diff after its executor created an untracked guide. Inspection found two defects in the existing ReAct loop: unique command receipts defeated unchanged-output detection, and depth/string projection discarded source text before the memory checkpoint saw it. The main specialist then received only the checkpoint summary, not its resolved findings or next evidence.

The correction compares the output content of known workspace command carriers while ignoring their per-invocation receipt and metering fields. Arbitrary Tool payload fields remain significant. At the existing checkpoint cadence, the memory specialist receives the complete original request and all pending observations before any compaction; subsequent reasoning receives the full checkpoint and recent observations, with explicit receipt indexes for older evidence. The checkpoint does not determine Tool availability or declare verification passed. Loop ceilings are unchanged. The diff Tool now documents Git's existing exclusions for untracked and staged files.

Regression tests cover unique outer receipt hashes, JSON-encoded command results, changed exit/output evidence, meaningful business payload fields, complete long source text and nested instructions at compaction, and restoration of resolved questions and next evidence. Typecheck and all 201 tests pass. Live convergence on this correction remains to be verified; the still-running issue #4 verifier retains its older immutable bundle.

Source `dc819d6` was committed and pushed on `main`, then deployed as `5f118f4e-6d6b-4f36-b16c-6f78cde1c622` with bundle digest `f7fa6c8e4db9e2f8abec33618790a9947d05f205864de350631a48d95d5688d2`. The existing Luna and GitHub bindings were retained. The terminated issue #2 received a [fresh-attempt request](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5554683068) carrying its settled scope and approval requirement. Issues #3 and #4 were left running; no existing history or workspace was deleted. No acceptance PR has yet been observed.

That request started issue #2 root `02237a66-7058-4127-938e-3a539ecc28f1` on revision `5f118f4e`. Issue #4's old verifier continued repeating the same empty diff through `root/90`. A [GitHub cancellation request](https://github.com/constal-ai/const-alpha/issues/4#issuecomment-5554690256) was handled by the independent conversational supervisor: the root and child became stopped, and the [reply](https://github.com/constal-ai/const-alpha/issues/4#issuecomment-5554696584) confirmed preservation of history without starting replacement work. This verifies control while work is active, not only after it completes.

Issue #3's executor encountered malformed/stale optional hashes when editing README, but recovered through the existing patch Tool at `root/36`; it was not cancelled for those recoverable model mistakes. Verification and publication remain pending.

The completion path also now reports completed work rather than repeating the future-tense proposed plan. It retains the result Fact in the journal without appending its hash to the public reply. Tests check the completion summary, specific changed-work descriptions, and PR link while keeping internal identities out of the comment. Typecheck and all 202 tests pass.

Completion-reply source `e440c18` was deployed as `4a22b903-fba6-4e2a-8a74-ddaea612d203`. The [replacement request for issue #4](https://github.com/constal-ai/const-alpha/issues/4#issuecomment-5554706133) started root `97c217c4-92c7-441f-8c6f-0c6952f1f457`. Issue #2's replacement completed discovery framing and started three focused investigators, passing the previously failing large-discussion handoff. Issue #3 remains in its original replacement executor's final checks. No PR has been produced or marked passing yet.

Issue #3's older executor performed final Git status but then lost it from its projected checkpoint and continued rereading. The same verified memory defect was pinned into that attempt. Its [cancellation request](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554734169) stopped the work tree through the ordinary supervisor; the [replacement request](https://github.com/constal-ai/const-alpha/issues/3#issuecomment-5554747003) started root `da1325ef-0c76-4d75-af97-495d2babbc94`. No histories were deleted. Issue #4's replacement discovery explicitly observed the preserved untracked guide.

The actual search Tool uses the same command receipt carrier as exec and diff. Source `1e3aee4` extends the same unchanged-output handling and encoded/object-carrier regression tests to it; all 206 tests passed. It was deployed as `eeff9a01-5c0d-4848-9b5c-dccaf59b3a56` with unchanged bindings.

Issue #2's structural critique correctly identified that the initial work plan claimed existing tests proved unrelated global-pagination and failure-path coverage that the investigation had found missing. One whole-work-plan repair removed that overreach, and critique accepted the result. Its [full proposal](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5554765530) was reviewed and [approved](https://github.com/constal-ai/const-alpha/issues/2#issuecomment-5554771759). The proposal still exposed internal publisher terminology in the public summary and risks. This was recorded as a communication defect, not used to reject the correct plan. The finalizer's role now explicitly separates the issue author reviewing the summary from specialists reading the execution specification; no generated-prose validator or wording gate was added.
