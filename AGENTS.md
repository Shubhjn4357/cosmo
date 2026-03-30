<!-- BEGIN: AgentMemoryBootstrap -->
## Codex Memory Bootstrap

When this workspace is loaded, initialize the shared memory context before
continuing:

1. Run `python ../.Agent/scripts/mem.py ctx --agent codex --max-tokens 4000`.
2. Load the returned `<MEMORY_CONTEXT>` into working context before proceeding.
3. If there is an active in-progress task, continue it unless the user redirects.
4. Save checkpoints with `python ../.Agent/scripts/mem.py cp "what was done. next step" --agent codex`.
5. Finish with `python ../.Agent/scripts/mem.py done "summary"` and `python ../.Agent/scripts/mem.py log <input> <output> --agent codex --model <model>` when token counts are available.

Reference: `../.Agent/AGENT_MEMORY.md`
<!-- END: AgentMemoryBootstrap -->
