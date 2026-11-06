# Paid research procurement

## Local services

Start the existing API and web app, then run one command in each worker terminal.

```sh
pnpm --filter @agenthire/api research:worker quick-research
pnpm --filter @agenthire/api research:worker deep-research
```

Quick binds to loopback port 3111 and uses the first query with up to four candidates. Deep binds to 3112 and interleaves up to eight candidates across two queries. The loopback ports can be overridden with `RESEARCH_QUICK_PORT` and `RESEARCH_DEEP_PORT`. Both require the negotiated source count. Queries are alternative search strategies for the same objective. Each worker has independent identity, health and pricing. Set `RESEARCH_QUICK_MERCHANT` and `RESEARCH_DEEP_MERCHANT` to configure separate merchants. Both fall back to the configured x402 merchant or the local testnet default.

| Endpoint | Behavior |
|---|---|
| GET /agent | Public worker identity, capabilities and configured merchant |
| GET /health | Health and worker identity |
| POST /bid | Binds the goal, parent, mission, input digest, resource limits and quote expiry |
| POST /capability-test | Returns an x402 challenge and, after verified settlement, retrieves the fixed public Octokit README |
| POST /execute | Returns an x402 challenge and, after verified settlement, runs the worker's research strategy |

The price in tinybars is the worker base (90,000 or 140,000), plus 3,000 per required source and 2,000 per supported query used. The capability test costs 5,000 tinybars. Bids expire after ten minutes. Signed proof binds the canonical request digest, endpoint, amount, merchant and Hedera transaction. Both transaction and intent replay claims precede settlement. The paid resource verifies settlement through Mirror Node before retrieval. The manager independently rechecks settlement before accepting the result.

## Preview and approval

Choose **Procurement preview** on the Goals page. The Groq planner validates a research → report → verification DAG. The lead mission discovers both configured workers, requests bids concurrently and validates their actual HTTP 402 challenges. The existing PoCP engine uses task risk, quote price, delegated funds and observed Bayesian reliability to choose TEST or SKIP. The plan includes the authorized alternatives needed for both possible probe outcomes. Preview grants zero HBAR and ends at **awaiting authorization**. **Direct research** keeps the existing zero-HBAR workflow.

The operator token stays in the ignored server environment. Set `RESEARCH_LIVE_ENABLED=true` only when ready for separately approved spending. Groq credentials and inference enablement are independently required. Use these commands after the plan is available:

```sh
pnpm --filter @agenthire/api research:operator preflight GOAL_ID
pnpm --filter @agenthire/api research:operator authorize path/to/approved-policy.json
pnpm --filter @agenthire/api research:operator reconcile GOAL_ID
```

The policy JSON binds `goalId`, `parentId`, `missionId`, `planHash`, `payer`, `merchants`, `endpoints`, `capability`, `network`, and `asset`. Set `capability` to `web.research`, `network` to `hedera:testnet`, `asset` to `0.0.0`, and `maxDelegationDepth` to 1. Use integer tinybar strings for `total`, `parentAllocation`, `childAllocation`, `maxTest`, `maxHire`, `maxPerPayment`, `maxSponsoredFee` and `maxAuditFee`. Use `100000000` for the supported per-payment sponsored fee ceiling. Set `maxPayments` to 1 or 2, and supply a short UTC `expiresAt` and an explicit `maxAuditMessages`. An audit count and fee cap of zero disable publication. A successful SKIP run has nine audit messages and a successful TEST run has twelve. HCS is capped at 10,000,000 tinybars per message.

## Accounting and evidence

SQLite atomically records the one-time authorization and reserves worker funds before signing. Goal, parent and child allocations form nested ceilings for one paid research child per goal. The test and hire intents cannot be repeated. Submitted or uncertain intents retain their reservation. Independently settled funds remain spent when a worker fails. The lead is the logical buyer and the existing server-controlled Hedera testnet payer supplies the actual signature. x402 settlement is final payment rather than escrow.

The manager independently repeats source discovery and checks repository identity, README blob and excerpt before handing the artifact to the existing report mission. Test and hire observations use distinct intent IDs. An unavailable independent verifier leaves the confirmed payment recorded and halts further purchases. Groq quality evaluation remains model-assisted. Inference usage, worker spending, sponsored fees and HCS fees are separate.

The authorized HCS batch uses topic `0.0.11331471`, deterministic event IDs and public metadata or hashes. Every submission is recorded before send and verified against canonical bytes through Mirror Node. Uncertainty stops the run. The operator reconciliation command returns read-only payment and topic evidence. Interrupted or uncertain goals are retained and never automatically replayed. A new attempt requires a fresh reviewed goal. The local paid path is covered by mocked external settlement and is pending its first authorized live run.
