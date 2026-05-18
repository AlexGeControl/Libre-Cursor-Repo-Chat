---
name: find-easter-egg
description: Use when the user asks you to invoke the find-easter-egg skill. Emits a unique marker proving the skill was loaded.
---

# find-easter-egg

Synthetic skill used by the eval-context-mgmt-configured-v1 eval suite. It
exists to prove that an LLM-selected skill is actually loaded and
followed.

## When to use

The user has explicitly asked you to invoke this skill by name. There
are no other triggers.

## Procedure

When invoked, your entire reply MUST be exactly the marker line below,
with no preamble, no explanation, no surrounding prose:

  [EGG-M4R7P3]

That single line is the only output. Do not add anything else.

EVAL_MARKER: [EGG-M4R7P3]
