# context-mgmt-eval-v1

Synthetic repo used by `adapter/test/evals/` to validate Cursor's
context-management surface end-to-end through the adapter. Not for
end-user consumption.

## What lives here

- `docs/` — files used to exercise glob-scoped rule attachment.
- `pricing/` — files used to exercise description-selected rule attachment.
- `src/` — files used to exercise "rule does NOT fire" negative cases.

## What's in `.cursor/`

Each artifact corresponds to an eval slice. See the workspace's
`eval.spec.md` for the full behavior matrix.

- `rules/` — declarative guidelines under test.
- `skills/` — imperative procedures under test.
- `mcp.json` — tool integration under test (O'Reilly Books).
