export const HORIZON_GITHUB_EVENT_CATALOG = {
  object: "constal.horizon.github-event-catalog",
  version: 1,
  events: [{
    id: "github.issue.activated", title: "Issue activation",
    description: "Start issue work when Horizon is mentioned in an issue body or comment, or when a configured label is applied.",
    behaviors: ["issue-work"], defaultBehavior: "issue-work",
  }, {
    id: "github.issue.comment", title: "Issue conversation",
    description: "Answer questions, interpret plan feedback, and continue an active issue conversation.",
    behaviors: ["operate", "issue-work"], defaultBehavior: "operate",
  }, {
    id: "github.pull-request.comment", title: "Pull request conversation",
    description: "Answer questions and perform bounded operational work on pull request comments.",
    behaviors: ["operate"], defaultBehavior: "operate",
  }, {
    id: "github.status", title: "Status requests",
    description: "Report the current durable state of Horizon work.",
    behaviors: ["operate"], defaultBehavior: "operate",
  }],
} as const;
