---
name: grilling
description: >
  Use when the user wants a plan, decision, or idea sharpened through questioning
  before acting on it, or when another skill needs the interview primitive. Triggers
  on: "grill me", "grill this plan", "stress-test this design with questions",
  "interview me about this".
license: MIT (adapted from mattpocock/skills)
---

Interview me relentlessly about every aspect of this — a plan, a decision, an idea — until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a *fact* can be found by exploring the environment (filesystem, tools, etc.), look it up rather than asking me — dispatch a sub-agent for the lookup so the interview doesn't block on it. The *decisions*, though, are mine — put each one to me and wait for my answer.

Do not act on it until I confirm we have reached a shared understanding.
