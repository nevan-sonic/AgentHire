# NevoraX reuse audit

Reference checkout inspected at `eff3d19da228ac519d7afc21a1db390b81a96662`, separately from AgentHire. NevoraX is a design reference. This change copies no source files, historical data, or wallet material.

AgentHire Step 13 is at `fddb4f1`. Fastify starts at `apps/api/src/server.ts`. Marketplace workers have independent loopback processes, bound bids, durable SQLite jobs and cursor-based SSE. The manager uses the existing PoCP model and a separately authenticated x402 and HCS path. The new Step 13 payment path passed mocked execution and public read-only preflight. A new live Step 13 settlement remains unverified.

| NevoraX source under backend/src | Observed behavior and dependencies | Decision and destination |
|---|---|---|
| llm/groqClient.js | Lazy groq-sdk client, retry loop and ledger integration. Missing credentials permit fallback upstream. | ADAPT centralized provider boundary in goals/groq.ts. Validate output, cap calls and tokens, and surface missing configuration. |
| core/workflow-engine/planner/taskPlanner.js | Prompts Groq using registry data and extracts JSON. Falls back to deterministic decomposition. | REIMPLEMENT validated DAG in goals/plan.ts. Model output never defines tools or authority. |
| openclaw/OpenClawRegistry.js | Creates in-memory mission and signal envelopes, tracks assigned units and telemetry, and sets static WDK compliance labels. Node crypto supplies identities. | ADAPT envelope identity and telemetry concepts into packages/shared and goals/workflow.ts. Replace static compliance claims with enforced permissions and hashes. |
| agents/orchestrator-agent/orchestratorAgent.js | Bridges OpenClaw mission records to progress and calls pre-bridge/pre-payment safety checks. Goal text can also select EVM transaction branches. | SKIP execution branches and raw goal logging. Keep trusted verification and explicit Hedera authorization. |
| core/orchestrator/agentCoordinator.js | Creates service agreements and records expense through local finance functions with a fixed ETH price. | ADAPT parent-child contract concept. Keep settlement in AgentHire. |
| contracts/service-agreement-manager/agreementManager.js | In-memory agreement lifecycle and signature fields. | REIMPLEMENT durable mission IDs and lifecycle. Agent identity is a server assignment. |
| marketplace/agent-registry/agentRegistry.js | Service roles, mutable reputation, and simulated economic entropy. | ADAPT role taxonomy. Preserve AgentHire's actual worker registry. |
| marketplace/matching-engine/matchingEngine.js | Collects and ranks offers, changes synthetic demand, and includes an emergency fallback. | SKIP synthetic market and fallback ranking. Preserve Step 13 bidding. |
| economy/reputation-engine/reputationEngine.js | Mutable per-agent scores initialized to defaults. | SKIP scores. Preserve Bayesian priors and verified observations. |
| assets/deliverableStore.js | Collects typed deliverable records in process. | ADAPT typed records with durable content hashes and parent references. |
| events/economyEventBus.js | In-memory events with generated IDs. | ADAPT event vocabulary. Persist goal event IDs in SQLite. |
| agents/execution-agents/safetyEnforcerAgent.js | Mixes Groq judgment, ethers operations and financial rules. | REIMPLEMENT trusted deterministic permission checks independent of model judgment. |
| wallets/agent-wallet-manager/walletManager.js | WDK agent account indices, signing, transfer and balance operations. | SKIP. AgentHire uses centrally authorized Hedera testnet settlement. |
| payments/payment-orchestrator/paymentEngine.js | Existing reference payment orchestration tied to the legacy financial stack. | SKIP EVM/WDK, escrow, bridging, lending, subscriptions, and trading. |

OpenClaw has mission envelopes and progress telemetry. The inspected implementation does not validate a durable delegated budget or cryptographically enforce the static compliance labels. AgentHire defines its own contracts and keeps policy, deterministic verification, and model-assisted assessment separate.
