# Mission protocol

Each child uses the agenthire-a2a 1.0 envelope in packages/shared. A goal supplies a root mission identity. Children reference that root and inherit zero financial authority. The runtime validates the bounded DAG before assigning children. It checks dependency membership and content hashes before constructing input references. Child envelopes bind the goal, plan step, and input hashes. Idempotency keys derive from the goal and step. A completed step hands off its persisted artifact to dependent steps.

The current graph supports up to four tasks and one delegation level. Each child has a bounded expiry and no permission to create more children. Only research children can call the GitHub dispatcher.
