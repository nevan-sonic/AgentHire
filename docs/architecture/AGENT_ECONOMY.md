# Agent economy

The current goal workflow is a local, zero-HBAR research slice. A Groq planner proposes a small DAG. Server-assigned research, report, and verification stages run in dependency order. The goal API persists each mission, artifact, and event in SQLite. The Next.js workspace reconnects through a persisted SSE cursor. Interrupted records remain readable and require a new explicit run.

The existing statistics marketplace remains separate and retains its Step 13 authorization, PoCP, settlement, and audit behavior. Research workers are logical runtimes in the API process. Research bids, paid research subcontracting, recursive PoCP, and goal HCS publication are pending. The historical proof is available at /proof.
