# Synthetic API doc

This file exists so eval prompts can reference a file under `docs/` and
exercise a glob-scoped rule attachment in `.cursor/rules/`.

The content is intentionally bland. The eval doesn't care what's here;
it cares whether a rule scoped to `docs/**` fires when this file is in
the active context.
