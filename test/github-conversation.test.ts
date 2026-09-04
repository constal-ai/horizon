// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { questionMarkdown } from "../src/github-conversation.js";

describe("GitHub decision questions", () => {
  it("renders one first-person question, three choices, and a free-form path", () => {
    const body = questionMarkdown({ prompt: "When should I use a reaction-only acknowledgment?", options: [
      "Only when acknowledgment fully satisfies the request.",
      "Use a reaction together with a short textual response.",
      "Always use a textual response and never react alone.",
    ] });
    expect(body).toContain("## I need one decision");
    expect(body).toContain("**When should I use a reaction-only acknowledgment?**");
    expect(body).toContain("1. Only when acknowledgment fully satisfies the request.");
    expect(body).toContain("2. Use a reaction together with a short textual response.");
    expect(body).toContain("3. Always use a textual response and never react alone.");
    expect(body).toContain("4. **Write your own answer**");
    expect(body).not.toContain("Horizon");
  });
});
