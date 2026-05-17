# context-mgmt-eval-bare-v1

Negative-control twin of `context-mgmt-eval-v1`. Same repo content,
deliberately **no `.cursor/` directory**. The eval suite asserts that
features supplied by `.cursor/` (rules, skills, MCP) do NOT appear
when run against this workspace — proving the configured-workspace
evals actually test what they claim.

See `../context-mgmt-eval-v1/eval.spec.md` for the full eval design.
