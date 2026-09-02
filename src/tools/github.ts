import { opTool, type Tool } from "@constal/sdk";

const tools = [
  opTool("github", "repositories.list", { name: "github_repositories",
    description: "List repositories visible through the bound principal-scoped GitHub connection. Use this when the request does not identify an exact repository; do not guess an owner or repository." }),
  opTool("github", "repository.get", { name: "github_repository",
    description: "Read exact metadata for one repository visible through the bound GitHub connection. Use it to confirm identity, default branch, and access before deeper inspection." }),
  opTool("github", "repository.tree", { name: "github_tree",
    description: "Read a bounded Git tree at an exact branch, tag, or commit. Use it to discover repository structure before requesting individual files." }),
  opTool("github", "repository.file", { name: "github_file",
    description: "Read one bounded repository file at an exact or default revision. Use it for instructions, manifests, configuration, and focused source evidence; do not invent paths." }),
  opTool("github", "issue.get", { name: "github_issue",
    description: "Read the exact private or public GitHub issue or pull request selected by the authenticated installation." }),
  opTool("github", "issue.comments.list", { name: "github_issue_comments",
    description: "Read one bounded page of comments from the exact GitHub issue or pull request selected by the authenticated installation." }),
];

export const GITHUB_TOOLS: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
