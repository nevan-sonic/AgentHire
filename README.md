# AgentHire

**The Autonomous Trust & Procurement Network for AI Agents.**

AgentHire is a planned marketplace where AI agents compete for jobs, negotiate prices, and demonstrate their skills through paid micro-challenges. A manager agent chooses a worker based on price and evidence of performance, then pays through x402 on Hedera.

**Early development** · [ETHGlobal Mumbai 2026](https://ethglobal.com/events/mumbai/info/details) · Targeting two [Hedera sponsor tracks](https://ethglobal.com/events/mumbai/prizes/hedera)

## The problem

A manager agent needs to find workers it can identify and contact, but advertised skills and past ratings may say little about performance on the task at hand. Prices are hard to compare when bids differ in scope or reliability. A cheap bid can become expensive if the work needs to be redone, and repeated payments can exhaust a budget. Without records that link decisions, payments, and outcomes, it is hard to determine what went wrong or recover from failed work.

## The solution

The marketplace will give manager agents a way to discover workers, exchange bids and counteroffers, commission work, and pay within a budget. It will also check delivered work and record the outcome so future decisions can use that evidence.

**Adaptive Proof-of-Capability Procurement (PoCP)** is the decision layer. It asks whether buying more evidence will improve the hiring decision enough to justify the cost. Its goal is to minimize the expected total cost of obtaining a verified successful outcome, including the cost of tests, work, validation, and recovery.

## Core innovation: Adaptive PoCP

1. The manager receives a task, a budget, and acceptance criteria.
2. It discovers candidate workers with relevant capabilities.
3. Workers submit bids and negotiate price, scope, and delivery terms.
4. The manager compares quotes, past performance evidence, and uncertainty about each worker's fit.
5. It estimates whether a small test could change the hiring decision and reduce expected rework or replacement costs by more than the test costs.
6. If the test is worthwhile and permitted by the spending policy, the manager pays for a micro-challenge through x402.
7. It evaluates the result against objective criteria defined before the test.
8. It selects a worker using the updated evidence, expected total cost, and reliability.
9. The manager pays through x402 and the worker executes the full task.
10. The manager validates the output and records spending and outcome references. If validation fails, it can retry or switch workers within the remaining budget, or stop and report the failure.

Testing spends part of the same budget as hiring. The manager can skip it when the available evidence is strong, the downside of a failed hire is low, or the result is unlikely to change the choice. A passing test is evidence about a sample; the full result still needs validation.

## Planned features

- Autonomous discovery of worker agents, with agent identity and reputation based on recorded outcomes.
- Agent2Agent (A2A) bidding and negotiation, with AgentHire defining the bid and counteroffer terms.
- Adaptive paid capability challenges and worker selection based on cost and risk.
- Autonomous x402 payments with task budgets, merchant allowlists, and per-merchant limits.
- HCS audit logging, outcome verification, and recovery when work fails.
- A marketplace dashboard for bids, spending, and task outcomes.

## System architecture

```mermaid
flowchart TD
    subgraph App["Application orchestration"]
        U["User / dashboard"] --> M["Manager agent"]
        M --> D["Agent discovery"]
        D --> A["A2A bidding and negotiation"]
        A --> P["Proof-of-Capability evaluation"]
        P --> S["Spending policy engine"]
        V["Outcome validation and recovery"] --> M
        M -.-> K["Hedera Agent Kit (optional)"]
    end

    subgraph Pay["Payment facilitation"]
        W["x402-protected worker endpoints"]
        F["x402 facilitator"]
        W -->|Verify and settle| F
    end

    subgraph Native["Native Hedera operations"]
        SDK["Hedera JavaScript SDK"]
        subgraph H["Hedera network"]
            L["Payment settlement"]
            T["HTS token operations"]
            C["HCS audit topics"]
        end
        R["Mirror Node REST API"]
        SDK --> T
        SDK --> C
        L --> R
        C --> R
    end

    S -->|Authorize challenge or job payment| W
    W -->|Return output| V
    F -->|Submit payment transaction| L
    K -.-> SDK
    M -->|Manage token associations| SDK
    V -->|Write outcome references| SDK
    M -->|Check indexed records| R
```

The manager will enforce the spending policy before signing a payment. The facilitator verifies and settles the payment; the application evaluates the work against the task criteria. HCS provides a tamper-evident record of what the application reported. It does not prove AI output correctness.

## Planned technology stack

| Layer | Provisional choices |
| --- | --- |
| Dashboard | Next.js, React, TypeScript, Tailwind CSS |
| Manager and workers | Node.js and TypeScript, with an orchestration framework or a custom state machine |
| Agent communication | A2A with application-defined procurement messages |
| Payments | x402 with a facilitator that supports Hedera |
| Native services and network reads | Hedera JavaScript SDK, HTS, HCS, and Mirror Node REST API; optional Hedera Agent Kit |
| Application storage | A lightweight off-chain database for jobs, bids, and evaluation evidence |

## Hedera integration

| Component | Planned role |
| --- | --- |
| [x402 on Hedera](https://docs.hedera.com/solutions/ai/x402/how-it-works) | A protected worker endpoint returns HTTP `402 Payment Required` with the amount, asset, recipient, and fee payer. If policy allows it, the manager signs a transfer and retries with the payment payload. The worker uses a facilitator to verify the payload and settle the transfer on Hedera. The facilitator signs as fee payer and submits the transaction. |
| [Hedera Token Service (HTS)](https://docs.hedera.com/learn/core-concepts/tokens/hts-overview) | Manage native token operations, such as associating worker accounts with a payment token, and support payments in compatible fungible HTS tokens. |
| [Hedera Consensus Service (HCS)](https://docs.hedera.com/native/consensus/create-topic) | Publish ordered, timestamped audit messages with task IDs and references to spending and validation outcomes. Detailed artifacts stay off-chain. |
| [HCS-14](https://hol.org/docs/standards/hcs-14//) | Use portable agent identifiers to help link discovery profiles to the same agent. AgentHire will define reputation from its own evidence and scoring rules. |
| [Mirror Node REST API](https://docs.hedera.com/reference/rest-api) | Read indexed transactions and topic messages to check payment and audit references against network records. |
| [Hedera JavaScript SDK](https://docs.hedera.com/native/fundamentals) | Perform native HTS and HCS operations without Solidity contracts. |
| [Hedera Agent Kit](https://docs.hedera.com/solutions/ai/agent-kit) | Optionally expose selected Hedera operations as tools for agents. |

Hedera's [x402 exact scheme](https://docs.hedera.com/solutions/ai/x402/exact-scheme) supports HBAR and fungible HTS tokens. AgentHire will confirm its settlement asset and facilitator through a working testnet integration.

## Example user journey

*Prices and outcomes are illustrative and expressed in abstract budget units.*

A manager gets a budget of 20 units to analyze a sales dataset and return totals by region. Three workers bid:

| Worker | Bid | Evidence |
| --- | ---: | --- |
| A | 8 | Little evidence that it handles duplicate rows correctly |
| B | 11 | Verified performance on similar datasets |
| C | 15 | Strong evidence, with a higher bid for the same scope |

The manager estimates that a 1-unit test of A could change the selection: a pass might justify the lower bid, and a failure would leave enough budget to hire B. It pays A through x402 to analyze a sample with known totals. A double-counts duplicates, so the manager pays B through x402 for the full job. It checks B's report against the required schema and reconciles the regional totals with the source data. It records the test result, both payment references, and the accepted outcome. Total illustrative spend: 12 units.

## Hackathon track alignment

The [official Hedera prize page](https://ethglobal.com/events/mumbai/prizes/hedera) defines the requirements. This table maps the planned submission to those requirements and highlights relevant bonus opportunities. Eligibility has not been verified.

| Target track | Mandatory requirements and planned evidence | Relevant bonus opportunities |
| --- | --- | --- |
| AI Agents That Pay: x402 on Hedera | Expose a protected worker endpoint that settles on Hedera testnet or mainnet via a listed or self-hosted facilitator. Demonstrate a client discovering it and completing a paid request without human approval. Publish a public GitHub repository with setup, architecture, payment flow, and a settled transaction ID in the README. Show settlement in a demo of at most five minutes and include a HashScan link. | Budget and merchant controls, HCS-14 identity and reputation, HCS spending logs, A2A negotiation before payment, settlement in an HTS token, and optional Agent Kit use. |
| No Solidity Allowed: Build with Hedera SDKs | Use the Hedera JavaScript SDK and no Solidity contracts. Implement at least two native services through the SDK: **HTS** for token operations and **HCS** for audit messages. Publish a public GitHub repository with setup and usage instructions and a demo of at most five minutes. | End-to-end user experience, Mirror Node queries, HCS audit logging, optional Agent Kit workflows, and key management and access controls. |

## Development roadmap

- [x] Project README
- [x] Application scaffolding
- [x] Hedera testnet configuration and native SDK foundation
- [ ] Native HTS integration
- [x] Native HCS integration
- [x] First x402-protected worker endpoint (local HTTP challenge verified)
- [x] First autonomous x402 payment
- [x] Local worker discovery, structured bidding, and automatic selection
- [ ] A2A negotiation
- [x] Adaptive PoCP engine (offline simulated tests)
- [ ] Spending controls
- [ ] Outcome verification and recovery
- [ ] Marketplace dashboard
- [ ] End-to-end testing
- [ ] Demo and submission

## Getting started

Use Node.js 22 LTS (22.13 or later within 22.x) and pnpm 10.34.9. From the repository root:

```bash
pnpm install
pnpm dev
```

- Frontend at [http://localhost:3000](http://localhost:3000).
- API health check at [http://localhost:3001/health](http://localhost:3001/health). It returns `{"status":"ok","service":"agenthire-api"}`.

Both apps run with local defaults. To change the API port, copy the root `.env.example` to `.env` and set `API_PORT`. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `NEXT_PUBLIC_API_URL` to the matching API origin. Restart the development servers after changing these values.

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

### Hedera testnet diagnostics

1. Sign in to the [Hedera Developer Portal](https://portal.hedera.com/) and create a testnet account, or use an existing testnet account you control. Get the numeric account ID and matching private key from your testnet account credentials.
2. Copy the root `.env.example` to `.env`. Keep `HEDERA_NETWORK=testnet`, set `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`, then set `HEDERA_DIAGNOSTICS_ENABLED=true`. Paste the DER hex key as issued. For a raw hex key, use the `ed25519:` or `ecdsa:` prefix to specify the algorithm. Unprefixed raw hex is interpreted as ED25519.
3. Run `pnpm dev` from the repository root and open [http://localhost:3001/api/hedera/status](http://localhost:3001/api/hedera/status), using your configured API port if different.

A successful query returns a response like the following. The account ID and balance are illustrative.

```json
{
  "network": "testnet",
  "connected": true,
  "operatorAccountId": "0.0.123456",
  "hbarBalance": "10.00000000",
  "unit": "HBAR"
}
```

The endpoint requires explicit opt-in and loopback access. It is disabled in production. Missing or invalid settings and failed balance queries return HTTP 503 when diagnostics are enabled. The existing `/health` endpoint stays available regardless of Hedera configuration.

Keep the private key in the ignored root `.env` file or an API-only secret store. Never commit or share it. Enable diagnostics only for local development and keep the API off public proxies while enabled.

The status endpoint uses `MirrorNodeAccountBalanceQuery` from the [native Hedera SDK](https://docs.hedera.com/hedera/sdks-and-apis/sdks) to read indexed account data through the [Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api). `HEDERA_MIRROR_NODE_URL` sets the HTTPS endpoint and defaults to the Hedera testnet Mirror Node.

A response with `connected: true` confirms that the Mirror Node returned a balance for the configured account. Consensus-node access and the ability to sign transactions require separate verification. See [Hedera's SDK migration guide](https://hedera.com/blog/mirrornodeaccountbalancequery-the-sdk-native-migration-path-for-accountbalancequery/).

### Native HTS demo

The CLI uses the Hiero SDK to create a fungible token, associate it with an account, and transfer it on Hedera testnet. **AgentHire Credit (AHC)** is a demonstration asset with two decimal places and a fixed supply of 100,000 base units (1,000.00 AHC). The operator is the treasury and holds the initial supply. AHC has no stated peg and no verified x402 facilitator support. The payment asset will be selected separately.

Use the testnet operator credentials in the ignored root `.env`. Preview token creation:

```bash
pnpm --filter @agenthire/api hedera:hts-demo --create
```

Add `--execute` only when you intend to submit the transaction and pay the testnet fee. The preview shows the maximum transaction fee, which is 50 HBAR for creation and 5 HBAR each for association and transfer. The network determines the actual fee.

```bash
pnpm --filter @agenthire/api hedera:hts-demo --create --execute
```

Save the token ID from the successful receipt as `HEDERA_HTS_TOKEN_ID`. Set `HEDERA_HTS_RECIPIENT_ID` to a separate existing testnet account you are authorized to use. Explicit association also requires its matching `HEDERA_HTS_RECIPIENT_KEY` in the same format as the operator key. If the recipient already has an association or has an available automatic association slot, you can go directly to transfer.

```bash
pnpm --filter @agenthire/api hedera:hts-demo --associate --execute
pnpm --filter @agenthire/api hedera:hts-demo --transfer --execute
```

Association and transfer verify the configured AHC token and treasury against indexed Mirror Node data. The transfer sends 100 base units (1.00 AHC) from treasury and checks its indexed token balance, which can lag after creation. Each operation prints its transaction ID, receipt status, and HashScan link. Open the creation receipt and token links to verify the ID and supply. Verify association and transfer from their own receipts. If submission or receipt retrieval fails, check the reported transaction in HashScan before retrying. Use the saved token ID for later steps.

AgentHire Credit creation was verified on Hedera testnet. The consensus receipt returned `SUCCESS`, and the Mirror Node confirmed the treasury and initial supply. Association and transfer were verified with offline tests and await live verification.

| Field | Verified result |
| --- | --- |
| Token ID | [`0.0.11331329`](https://hashscan.io/testnet/token/0.0.11331329) |
| Receipt status | `SUCCESS` |
| Transaction ID | [`0.0.11330954@1793920574.831650235`](https://hashscan.io/testnet/transaction/0.0.11330954-1793920574-831650235) |
| Charged fee | 14.79494208 testnet HBAR |

### Native HCS procurement audit trail

The HCS CLI submits compact procurement references to a testnet topic using the native SDK. The topic memo is `AgentHire Procurement Audit Trail`. The operator's public key is the submit key, so a submission requires the corresponding signature. The topic has no admin key, which makes its permissions immutable. Topic messages are publicly readable.

Version 1 events contain `version`, `eventId`, `eventType`, `jobId`, `agentId`, `timestamp`, `metadata`, and `payloadHash`. The event types are `JOB_CREATED`, `BID_SUBMITTED`, `CAPABILITY_TEST_REQUESTED`, `CAPABILITY_TEST_COMPLETED`, `WORKER_SELECTED`, `PAYMENT_SETTLED`, `TASK_COMPLETED`, and `TASK_FAILED`. Use opaque, non-sensitive identifiers and a UTC timestamp with millisecond precision. Metadata can include a worker ID, payment transaction ID, outcome, artifact digest, or a decimal string in `amountBaseUnits` with `amountUnit` set to `tinybar` or `token-base-unit`. Token amounts also require `tokenId`. Use only public references and digests. Keep credentials, personal data, prompts, and task contents off the topic.

To reproduce `payloadHash`, remove that field, sort the remaining envelope keys and the keys inside `metadata` lexicographically, and serialize as compact JSON without whitespace or a trailing newline. Hash those UTF-8 bytes with SHA-256 and encode the digest as lowercase hexadecimal. The transmitted envelope also uses sorted keys, includes the digest, and is capped at 768 UTF-8 bytes.

```bash
pnpm --filter @agenthire/api hedera:hcs-demo create-topic --max-fee-hbar 2
pnpm --filter @agenthire/api hedera:hcs-demo submit-event --max-fee-hbar 1
```

These commands preview one operation each. The fees shown are example caps in testnet HBAR. Set a deliberate cap and add `--execute` to submit that operation. Save the successful topic ID in the ignored root `.env` as `HEDERA_HCS_TOPIC_ID` before previewing or submitting an event. The sample event uses fixed illustrative identifiers and a fixed application timestamp. If submission is uncertain, check the printed transaction link before trying again.

```bash
pnpm --filter @agenthire/api hedera:hcs-demo verify-event --sequence <sequence-number>
```

Use the sequence number returned by the submission receipt or found on the Mirror Node. Verification is read-only and can run without operator credentials. It fetches the message at that topic and sequence, decodes the base64 payload, validates the schema, and recomputes its hash. The result is `verified`, `pending` after bounded polling for indexing, `invalid` for a malformed message or hash mismatch, or `error` for a retrieval failure. Indexed results include the consensus timestamp separately from the event's application timestamp. An HCS record establishes what was submitted to consensus. Task outcomes and payment claims require independent verification.

The live testnet topic is [`0.0.11331471`](https://hashscan.io/testnet/topic/0.0.11331471). The [topic creation](https://hashscan.io/testnet/transaction/0.0.11330954-1793921406-890328389) and [demo event submission](https://hashscan.io/testnet/transaction/0.0.11330954-1793921496-879828644) returned `SUCCESS`. The event at sequence `1` was retrieved from the Mirror Node and independently verified.

### Autonomous x402 worker demo

The demo uses the [official x402 facilitator](https://docs.hedera.com/solutions/ai/x402/facilitators) at `https://x402.org/facilitator`. Its live `/supported` response advertises x402 v2 `exact` on `hedera:testnet` with fee payer `0.0.9185802`. The hosted testnet integration requires no API key or merchant registration. The [Hedera exact scheme](https://docs.hedera.com/solutions/ai/x402/exact-scheme) represents native HBAR as `0.0.0` and amounts in tinybars. The demo uses HBAR because it needs no token association or approval transaction. AHC remains a separate HTS demonstration asset.

The API uses `@x402/core` and `@x402/hedera` **2.30.0**, with the installed Hiero SDK **2.90.1**. The Fastify adapter uses official x402 header codecs and the official HTTP facilitator client. The payer uses the official Hedera exact signer to create a partially signed transfer. The facilitator verifies it, signs as network fee payer, and submits it. The worker checks the settlement transaction ID and releases the result only after a successful settlement response.

Set these variables in the ignored root `.env`:

| Variable | Setting |
| --- | --- |
| `X402_ENABLED` | Set to `true` to enable the local worker endpoint. |
| `X402_MERCHANT_ID` | An existing testnet account that will receive HBAR. The HTS/HCS operator account can serve as merchant. |
| `X402_PAYER_ID` | A separate testnet account funded with HBAR. |
| `X402_PAYER_KEY` | That account's private key, using the same format as the operator key. Only the payer CLI uses it to sign. |

The worker runs at `POST /api/workers/analyze` and accepts JSON such as `{"values":[2,4,6,8]}`. It returns `402` with `PAYMENT-REQUIRED` for unpaid requests and returns count, min, max, and mean after settlement. The payer pins the endpoint, merchant, network, asset, and fee payer, then checks a total budget and per-payment cap of 1,000,000 tinybars (0.01 HBAR) before signing. The signed transaction's network fee cap is checked against 1 HBAR, sponsored by the facilitator. The worker atomically claims each transaction ID in the ignored `.agenthire-x402/` directory before settlement. Keep that directory for replay protection across local restarts. An ambiguous result requires reconciliation before another attempt.

With the API running via `pnpm dev`, preview the actual HTTP challenge without a payer key or payment:

```bash
pnpm --filter @agenthire/api x402:demo
```

After authorizing one testnet payment from the configured payer, run:

```bash
pnpm --filter @agenthire/api x402:demo --execute
```

The CLI sends one paid request and prints the facilitator's transaction ID, HashScan link, and worker result. It then checks the Mirror Node for the matching HBAR debit and credit, consensus status, and charged fee. A pending or inconclusive read requires checking that transaction before retrying.

The official facilitator verified and settled one live testnet payment. The Mirror Node independently confirmed `SUCCESS`, the exact HBAR debit and credit, and the charged fee. The worker returned `{"count":4,"min":2,"max":8,"mean":5}` after settlement.

| Field | Verified result |
| --- | --- |
| Payer | `0.0.11331589` |
| Merchant | `0.0.11330954` |
| Asset and amount | Native HBAR (`0.0.0`), 1,000,000 tinybars (0.01 HBAR) |
| Sponsored fee payer | `0.0.9185802` |
| Actual network fee | 0.00295897 testnet HBAR |
| Consensus timestamp | `1793922746.955672525` |
| Transaction ID | [`0.0.9185802@1793922740.663974206`](https://hashscan.io/testnet/transaction/0.0.9185802-1793922740-663974206) |

### Worker discovery and autonomous bidding

The manager discovers available workers in a local registry, asks each matching adapter for a bid concurrently, and ranks the valid offers. Each bid identifies the task, worker, capability, price in tinybars, estimated latency, assumed reliability, expiration, and payment destination. The manager rejects timeouts, stale or mismatched bids, untrusted payment destinations, unsupported assets or networks, and offers outside the task's budget, deadline, or reliability threshold.

These are three demo adapters in the same API process. They have separate IDs, pricing, and service routes and share deterministic statistics computation. The reliability estimates are assumptions for the demo.

| Worker ID | Capability | Price (tinybars) | Latency (ms) | Assumed reliability |
| --- | --- | ---: | ---: | ---: |
| `economy` | `statistics.summary` | 600,000 | 300 | 60% |
| `balanced` | `statistics.summary` | 750,000 | 200 | 95% |
| `premium` | `statistics.summary` | 950,000 | 100 | 99% |

- `GET /api/agents/workers?capability=statistics.summary` lists available workers in worker ID order. Omit the filter to list all available workers. Unsupported filters return HTTP 400.
- `POST /api/agents/procure` accepts the task below. It returns the discovered workers, bids and rejection reasons, ranked eligible offers, winning bid, projected budget remaining, rationale, payment readiness, and pending audit records. A valid task with no eligible offer returns `no_eligible_bids`.

```json
{
  "taskId": "demo-job",
  "taskType": "statistics.summary",
  "capability": "statistics.summary",
  "input": [2, 4, 6, 8],
  "maxBudgetTinybars": "1000000",
  "deadlineMs": 1000,
  "minimumReliabilityBps": 6000,
  "selectionStrategy": "expected_cost"
}
```

Selected fields from the response:

```json
{
  "status": "selected",
  "taskId": "demo-job",
  "selectedWorker": { "workerId": "balanced" },
  "winningBid": { "priceTinybars": "750000", "reliabilityBps": 9500 },
  "budgetRemainingTinybars": "250000",
  "paymentHandoff": { "paymentAuthorized": false }
}
```

The budget remaining is the projected remainder after the bid. Procurement reserves no funds. The same input produces `{"count":4,"min":2,"max":8,"mean":5}` if later executed by the worker.

`cheapest_eligible` ranks by nominal price, then expected cost. `expected_cost` ranks by price divided by reliability, then nominal price. Both finish ties by lower latency and worker ID. Reliability uses integer basis points, and scores are returned as exact fractions in tinybars. The manager compares these fractions with integer cross-products. Economy wins on price, while Balanced wins on expected cost.

```bash
pnpm --filter @agenthire/api agents:demo
```

The demo runs both strategies offline without credentials. The x402 handoff includes the selected worker ID, trusted endpoint, merchant, network, asset, bid ceiling, expiration, task ID, and dataset. It explicitly carries `paymentAuthorized: false`. A future executor must check that the bid is current, validate the live HTTP 402 quote against the handoff, and apply the payer's spending policy and authorization. The worker-specific payment routes are enabled only with the existing `X402_ENABLED` setting.

The manager returns schema-validated `JOB_CREATED`, `BID_SUBMITTED`, and `WORKER_SELECTED` events as pending HCS records. They contain public references and amounts. Procurement neither submits the records nor invokes the payer.

### Adaptive Proof-of-Capability Procurement

PoCP estimates whether buying one small test could improve the hiring decision enough to cover its price. It starts with Step 07's eligible bids and expected-cost-per-success ranking. The test decision and final hire instead minimize a consistent loss in tinybars:

```text
hireLoss(worker) = bidPrice + failurePenalty × (1 − reliability)
testLoss(worker) = testPrice + P(pass) × bestLossAfterPass + P(fail) × bestLossAfterFail
netValue = bestLossWithoutTest − testLoss(worker)
```

The manager assigns each worker a Beta prior with strength 2 and the assumed bid reliability as its mean. Economy starts at Beta(1.2, 0.8), Balanced at Beta(1.9, 0.1), and Premium at Beta(1.98, 0.02). A 100% bid estimate is capped at 99.99% when constructing the prior so both parameters stay positive. The predictive probability of passing is `alpha / (alpha + beta)`. A pass adds one to alpha, and a failure adds one to beta. The trace labels assumptions, the observed result, and the updated estimate separately.

The manager values each available test using the budget left after its cost. Both branches recheck affordability, deadline, bid expiration, and the reliability threshold. A branch without an eligible hire uses a terminal loss of `totalBudget + failurePenalty + 1` tinybars. The manager takes only the feasible test with the highest strictly positive net value, breaking ties by lower test price and worker ID. It re-ranks hires after the observation by loss, expected cost per success, nominal price, latency, and worker ID. Prices and budgets use integer tinybars, while losses and probabilities use exact fractions.

Opt in through the existing procurement endpoint:

```json
{
  "taskId": "pocp-demo",
  "taskType": "statistics.summary",
  "capability": "statistics.summary",
  "input": [2, 4, 6, 8],
  "maxBudgetTinybars": "1000000",
  "deadlineMs": 1000,
  "minimumReliabilityBps": 3500,
  "selectionStrategy": "adaptive_pocp",
  "pocp": { "failurePenaltyTinybars": "400000" }
}
```

The response includes the baseline hire, each candidate's valuation, the test decision, observed output, posterior, final hire, and budget projection. The evaluator compares the actual adapter output for `[3,6,9]` with a fixed reference. The evidence digest is SHA-256 of compact UTF-8 JSON in the fixed field order `input`, `observed`, `passed`, `reason`. The observed summary uses the field order `count`, `min`, `max`, `mean`. Malformed outputs, errors, and timeouts count as failed observations and are represented without raw error text.

```bash
pnpm --filter @agenthire/api pocp:demo
```

| Scenario | Decision and result |
| --- | --- |
| Positive value | Test Economy for 5,000 tinybars. Baseline loss is 760,000 and expected test loss is 737,000, so net value is 23,000. A pass raises Economy's mean to 11/15 and keeps it selected. |
| Test too costly relative to the benefit | A 100,000-tinybar failure penalty yields no positive test valuation. Skip. |
| Insufficient budget | A 600,000-tinybar budget leaves no affordable hire after the test. Skip and retain Economy. |
| Failed test | Economy returns an incorrect mean. Its posterior falls to 2/5 and the final choice changes to Balanced. |

In simulation, the trace reports zero committed on-chain spend and separates simulated test cost, projected hire cost, and remaining budget. The payment plan carries `paymentAuthorized: false` and marks test payment as `simulated` or `not_required`. Pending HCS records carry the test outcome and evidence hash. Live tests require their own x402 quote, settlement, and authorization. The model assumes the micro-test is informative about later success, and the fixture behavior and priors have no real-world calibration.

### Paid capability-test demo

`POST /api/workers/capability-test` is available when the local x402 worker is enabled. Send `taskId`, `testId`, `workerId`, `capability`, and `input`. The test ID follows `<taskId>-<workerId>-statistics-v1`. The endpoint validates the request, returns an x402 v2 HTTP 402 quote, and releases the selected adapter's output only after the official facilitator confirms settlement. The adapter receives the test input. The manager keeps the reference answer and grades the output independently.

The test price defaults to **5,000 tinybars (0.00005 HBAR)**. `POCP_TEST_PRICE_TINYBARS` configures the price between 1 and 100,000 tinybars, below every production-worker quote in the demo. The quote includes a digest of the task, test, worker, capability, and input. The payer signs a separate application binding over that digest, the endpoint and quote terms, and the hash of the signed Hedera transfer. The worker verifies the binding against the payer's indexed public key before passing the standard transfer to the facilitator. This prevents a proof issued for one capability test from unlocking a different request.

```bash
pnpm --filter @agenthire/api pocp:paid-demo
```

The default CLI run is a simulation. The public procurement API also stays in simulation. The demo values one test with a 400,000-tinybar failure penalty and protects 750,000 tinybars for the more expensive hire across the two possible outcomes. The local Economy fixture returns an incorrect mean, which changes the selected worker to Balanced. The workers share an API process and their fixture behavior and priors are illustrative. Offline tests exercise TEST, SKIP, incorrect output, rejected quotes, failed settlement, and delayed or uncertain settlement with a mocked facilitator.

For a separately authorized live test, configure the existing x402 merchant and dedicated payer in the ignored root `.env`, enable `X402_ENABLED`, and restart the API. Then set `POCP_LIVE_ENABLED=true`, a unique `POCP_LIVE_TASK_ID` for the authorized attempt, `POCP_LIVE_AUTHORIZED_PRICE_TINYBARS` to the exact approved price, `POCP_LIVE_MAX_TOTAL_TINYBARS=1000000`, `POCP_LIVE_FINAL_HIRE_RESERVE_TINYBARS=750000`, and `POCP_LIVE_EXPIRES_AT` to the approval's expiration time in ISO UTC. The CLI requires the Economy test to match the approved operation and uses the existing payer and fee controls. Run `pnpm --filter @agenthire/api pocp:paid-demo --execute` only after that authorization. The final production bid is a plan for later approval.

The attempt journal records `planned`, `quoted`, `authorized`, and `submitted` before the associated actions advance. Facilitator confirmation records `settled`. A matching Mirror Node transfer advances it to `verified`. Definite rejection reports `failed`, and an ambiguous submission reports `uncertain` and protects the test amount as a reservation. A settled payment with delayed indexing remains settled pending independent verification. The ignored `.agenthire-x402/` journal prevents another attempt for the same task across CLI restarts. Keep the journal and reconcile the recorded transaction before any further authorization.

The manager charges live test spend only after settlement confirmation and rechecks final-hire affordability. Pending HCS records include a `PAYMENT_SETTLED` reference when applicable, without private input or signed payment credentials.

The manager chose **TEST** for `paid-pocp-live-001` because the estimated net value was **23,000 tinybars**. The official facilitator settled one payment on Hedera testnet before the Economy adapter released its output. The Mirror Node independently confirmed `SUCCESS`, the payer debit, the merchant credit, and the sponsored fee.

| Field | Verified result |
| --- | --- |
| Worker tested | Economy |
| Payment | 5,000 tinybars (0.00005 HBAR) |
| Payer | `0.0.11331589` |
| Merchant | `0.0.11330954` |
| Settlement transaction | [`0.0.9185802@1793924857.289452104`](https://hashscan.io/testnet/transaction/0.0.9185802-1793924857-289452104) |
| Sponsored network fee | 0.00295981 HBAR, charged to `0.0.9185802` |
| Test input | `[3,6,9]` |
| Worker output | `{"count":3,"min":3,"max":9,"mean":7}` |
| Independent evaluation | **FAIL**. The expected mean was 6. |
| Evidence SHA-256 | `501649a83faea80bb75486ec93978d7401a11a9a96963b5188171577df9d2867` |
| Economy prior | Beta(1.2, 0.8), 60% |
| Economy posterior | Beta(1.2, 1.8), 40% |

The failed test changed the final selection from Economy to **Balanced**. After the settled test payment, **995,000 tinybars** remained. Balanced's **750,000-tinybar** hire later settled, leaving **245,000 tinybars**.

### Complete the selected hire

The final-hire CLI resumes `paid-pocp-live-001` from the local Step 09 journal and repository-pinned evidence. It checks the original test transaction on the Mirror Node, recomputes the capability evidence hash, and reconstructs the original dataset and Balanced selection. The old bid has expired. The CLI requests a fresh offer only from Balanced and checks that the price and trusted payment destination still match. Preserve the original ignored `.agenthire-x402/` directory to resume this task.

Balanced serves the production request at `POST /api/workers/analyze/balanced`. The body contains the task ID, accepted bid ID, worker ID, capability, and original input. The x402 quote binds those fields to the exact price and merchant. The worker verifies the payer's request signature against the indexed public key, then releases the Balanced adapter's output after facilitator settlement. The adapter runs locally in the same API process as the other demo workers.

Start the API with `X402_ENABLED=true` and `X402_MERCHANT_ID=0.0.11330954` in the ignored root `.env`, then preview the live HTTP 402 quote:

```bash
pnpm --filter @agenthire/api procurement:complete
```

The preview checks the refreshed bid, available budget, and quote and displays the expected summary `{"count":4,"min":2,"max":8,"mean":5}`. It never signs a payment.

After separate authorization for exactly one final hire, set `HIRE_LIVE_ENABLED=true`, `HIRE_LIVE_TASK_ID=paid-pocp-live-001`, `HIRE_LIVE_AUTHORIZED_TINYBARS=750000`, `HIRE_LIVE_MAX_TOTAL_TINYBARS=1000000`, and `HIRE_LIVE_EXPIRES_AT` to the approval expiry in ISO UTC. Use the existing dedicated x402 payer credentials. Only then run `pnpm --filter @agenthire/api procurement:complete --execute`.

The final hire uses a separate durable attempt journal linked to the same task. An existing attempt is referenced and reconciled through read-only Mirror Node checks. The CLI never starts a second payment for that task. The ledger distinguishes settled test and hire spending, reservations, and available budget. An uncertain settlement holds the hire reservation, while a definite rejection releases it. The facilitator sponsors the network fee, which is outside the payer budget.

Completion requires independently verified settlement and output. The evaluator computes a reference from the original task input, checks count, min, max, and mean, and hashes the input, sanitized observed output, and evaluation. A wrong answer keeps the payment record and marks the task failed.

The official facilitator settled the final hire, and the Mirror Node confirmed `SUCCESS`: payer `0.0.11331589` paid merchant `0.0.11330954` **750,000 tinybars (0.0075 HBAR)**. The sponsored fee was **0.00295981 HBAR**, charged to `0.0.9185802`. [Final-hire transaction](https://hashscan.io/testnet/transaction/0.0.9185802-1793925842-587414987)

Balanced returned `{"count":4,"min":2,"max":8,"mean":5}` for `[2,4,6,8]`, matching the independent reference. The evidence SHA-256 is `0d552ae272bda05a5dc607c27767728cab84dc2677d064014252d0bed6f9ca23`. The task reached `task_completed`, with **245,000 tinybars** available and zero outstanding reservations.

### Publish the completed procurement audit

The publisher loads the completed final-hire and capability-test journals, independently checks both x402 transfers, and revalidates the result and budget. It loads the eight version 1 records from the final-hire journal. Their deterministic IDs derive from the task ID, event type, and occurrence role, which separates the two settlement records. The ordered manifest pins each event ID and canonical payload hash. The stored event timestamps describe record preparation. Mirror Node consensus timestamps and sequences describe publication.

The order is `JOB_CREATED`, `BID_SUBMITTED` (the accepted Balanced bid summary), `CAPABILITY_TEST_REQUESTED`, `PAYMENT_SETTLED` (test), `CAPABILITY_TEST_COMPLETED`, `WORKER_SELECTED`, `PAYMENT_SETTLED` (hire), and `TASK_COMPLETED`. The test settlement precedes test completion because the Economy adapter released its output after payment.

```bash
pnpm --filter @agenthire/api audit:publish
```

The default command reads the existing testnet topic and verifies the operator key, original demo message at sequence 1, both payment records, and each prepared event hash. It reports the indexed topic head and whether any task events are already published, missing, conflicting, or uncertain. The eight procurement events are prepared and await authorized publication.

After explicit authorization for the reported manifest, set `AUDIT_LIVE_ENABLED=true`, `AUDIT_LIVE_TASK_ID=paid-pocp-live-001`, `AUDIT_LIVE_TOPIC_ID=0.0.11331471`, `AUDIT_LIVE_MANIFEST_HASH` to the reported hash, and `AUDIT_LIVE_EXPIRES_AT` to the approval expiry in ISO UTC. The proposed limits are `AUDIT_LIVE_MAX_SUBMISSIONS=8`, `AUDIT_LIVE_PER_MESSAGE_TINYBARS=10000000` (0.1 HBAR), and `AUDIT_LIVE_AGGREGATE_TINYBARS=80000000` (0.8 HBAR). With approval and these settings, `pnpm --filter @agenthire/api audit:publish --execute` submits one event at a time through the native SDK and independently verifies each indexed message before advancing.

Keep the ignored `.agenthire-x402/` journals. Each submission is claimed on disk and its Hedera transaction ID is recorded before execution. A restart scans the topic for the same identity and hash, skips verified records, and stops on conflicts or unconfirmed attempts. If indexing is delayed, rerun the read-only command to reconcile the journal with topic history. Keep publication to one workspace with the shared journal. The publisher leaves both settled x402 payments intact.

## References

- [x402 protocol specification and reference implementations](https://github.com/x402-foundation/x402)
- [Hedera x402 facilitators](https://docs.hedera.com/solutions/ai/x402/facilitators)
- [Agent2Agent protocol documentation](https://a2a-protocol.org/)
- [ETHGlobal Mumbai event rules and submission details](https://ethglobal.com/events/mumbai/info/details)

## Project status

**Early Development — ETHGlobal Mumbai 2026**

The scaffold includes a landing page, testnet balance diagnostics, verified native HTS token creation, a verified HCS audit event, a verified autonomous x402 payment, local worker discovery, and adaptive selection with simulated capability tests. Live HTS association and transfer verification remain pending.

## Judge dashboard

Run `pnpm --filter @agenthire/web dev` from the repository root after running `pnpm install`, then open [the historical dashboard](http://localhost:3000/proof). The dashboard needs no wallet, account, environment secrets, or running API. To run the Fastify API separately, use `pnpm --filter @agenthire/api dev` in another terminal. Use the repository's Node 22 and pnpm versions.

The dashboard labels its public snapshot **Recorded verified testnet execution**. It works offline from the API and Mirror Node because it renders checked-in public evidence from the completed procurement. Set `NEXT_PUBLIC_API_URL=http://localhost:3001` in `apps/web/.env.local` before starting Next.js to enable an optional read-only check against `GET /api/demo/procurement/paid-pocp-live-001`. The route reconciles the local procurement and publication journals with the Mirror Node. If the check times out or evidence is unavailable, the recorded dashboard stays visible. The replay only advances a browser-local timeline with Play, Pause, Reset, and Step forward. It submits no payments or HCS messages. Economy, Balanced, and Premium are local demo adapters. Their reliability percentages are model estimates. Both x402 settlements used native HBAR.

- [Capability-test payment](https://hashscan.io/testnet/transaction/0.0.9185802-1793924857-289452104)
- [Final-hire payment](https://hashscan.io/testnet/transaction/0.0.9185802-1793925842-587414987)
- [HCS topic with eight procurement events at sequences 2–9](https://hashscan.io/testnet/topic/0.0.11331471)

### 60-second judge demo

1. **0–15 seconds.** Open the dashboard and click **Replay Procurement**. Point out that the manager bought a 5,000-tinybar test because the estimated net value was 23,000 tinybars.
2. **15–30 seconds.** Show Economy's incorrect mean of 7, the reference mean of 6, and the reliability update from 60% to 40%. The manager switched to Balanced.
3. **30–45 seconds.** Open **View On-Chain Proof**. Show the two settled x402 transactions, Balanced's independently checked output, and the 245,000-tinybar balance.
4. **45–60 seconds.** Expand an audit event to show its consensus sequence, event ID, hash, and transaction. Open the HCS topic in HashScan.

## Local agent marketplace

Use Node 22 and the pinned pnpm version. Run `pnpm install` and start these five processes in separate terminals:

```sh
pnpm --filter @agenthire/api worker fast
pnpm --filter @agenthire/api worker reliable
pnpm --filter @agenthire/api worker premium
pnpm --filter @agenthire/api dev
pnpm --filter @agenthire/web dev
```

Open [Marketplace](http://localhost:3000/), [My Jobs](http://localhost:3000/jobs), or [historical proof](http://localhost:3000/proof). The web app proxies its marketplace requests to the local API on port 3001. The workers are first-party processes bound to loopback ports 3101, 3102, and 3103. They share the configured testnet merchant. No wallet is required.

| Worker | Starting bid (tinybars) | Input limit | Execution |
| --- | ---: | ---: | --- |
| Fast Analyst | 600,000 | 20 | Single-pass summary |
| Reliable Analyst | 750,000 | 60 | Compensated sum and consistency checks |
| Premium Analyst | 950,000 | 100 | Sorted distribution and median calculation |

Workers expose `GET /agent`, `GET /health`, `POST /bid`, and x402-protected `POST /capability-test` and `POST /execute`. The quote is bound to the task, worker, endpoint, amount, and input digest. Bids expire after ten minutes and are validated against trusted loopback registrations. Price increases by 200 tinybars per input above five. Reliability estimates are Bayesian priors. The detail view separately counts observed independently evaluated tests.

Jobs, registry snapshots, bids, plans, authorizations, and execution evidence are persisted in the local SQLite database at `.agenthire-marketplace/jobs.sqlite`. SSE resumes from a persisted cursor and refresh restores the saved job. The historical x402 and HCS journals remain separate.

**Preview** performs actual discovery and bidding, calculates PoCP, and stops at the plan. It does not run a protected task or publish anything. **Live testnet** creates a plan and waits for a separate authenticated authorization. An operator should first run `pnpm --filter @agenthire/api marketplace:operator preflight JOB_ID` to review the job, payer, facilitator, and audit scope. It only reads local records and public network data.

Live execution is disabled by default. After explicit authorization, enable `MARKETPLACE_LIVE_ENABLED=true` and set a high-entropy `MARKETPLACE_OPERATOR_TOKEN` (32 characters minimum) in the ignored root `.env`, then start the API with the existing payer, merchant, and Hedera operator configuration. The browser has no signing keys or operator token. Submit the approved policy with `pnpm --filter @agenthire/api marketplace:operator authorize path/to/policy.json`. The policy contains these fields:

- `jobId`, `payer`, `merchant`, `network` (`hedera:testnet`), `asset` (`0.0.0`), and `endpoints` (the exact approved worker URLs).
- `maxTotal`, `maxTest`, `maxHire`, and `maxSponsoredFee` as tinybar strings. The sponsored fee cap supported by this integration is `100000000` per payment.
- `maxPayments` (1 or 2), `expiresAt` (UTC ISO timestamp within ten minutes), `topic` (`0.0.11331471`), `maxAuditMessages`, and `maxAuditFee` as a tinybar string. The HCS cap is 10,000,000 tinybars per message and the aggregate must cover the planned submissions.

The manager refreshes and matches the approved plan, uses the official x402 facilitator, independently reconciles each settlement, then evaluates the returned output. It uses the existing Hedera SDK and canonical audit schema to publish and verify job-specific HCS events. An interrupted live job requires reconciliation. The authenticated `POST /api/marketplace/jobs/:jobId/reconcile` reads existing settlement and HCS evidence and leaves the job stopped for operator review. It does not resubmit. The API and database are intended for one local operator process. Public or multi-tenant deployment would need user authentication, job isolation, distributed execution coordination, and a more scalable audit-history index. Do not submit sensitive datasets to the local shared job workspace.

### 60-second marketplace walkthrough

1. Open the marketplace and confirm the worker health indicators.
2. Create a preview job with `[10,20,30,40,50]`. Open the returned bids and PoCP valuation.
3. For a separately authorized live job, show the approved scope, then follow the settlement and evaluation events.
4. Open the verified settlement and HCS links. For an offline demonstration, use the previously verified `/proof` dashboard.

## Research goals

Open [Create a Goal](http://localhost:3000/goals) with the existing local API and frontend running. Describe a public repository research objective and the expected report. Configure server-side Groq credentials and opt in to usage as described in the [Groq guide](docs/architecture/GROQ_INTEGRATION.md). The goal workspace shows the validated plan, assigned missions, real provider and retrieval activity, linked artifacts, and a downloadable cited report record. Goal history and artifacts persist in `.agenthire-marketplace/goals.sqlite`.

This research workflow sends the goal to Groq and derived search terms to GitHub. Use public, non-sensitive objectives. Direct research and procurement preview have zero HBAR authority. The [statistics marketplace](http://localhost:3000/agents) and [historical proof](http://localhost:3000/proof) remain available independently. See the [architecture](docs/architecture/AGENT_ECONOMY.md) and [NevoraX audit](docs/architecture/NEVORAX_REUSE_AUDIT.md) for scope and pending integrations.

### Competitive paid research

Start both research workers with `pnpm --filter @agenthire/api research:worker quick-research` and `pnpm --filter @agenthire/api research:worker deep-research`. Choose **Procurement preview** on the Goals page. After authorized Groq planning, the goal displays actual worker bids, PoCP and the reviewed payment branches. An authenticated operator can read the preflight and, only with separate approval, resume the goal with bounded x402 and HCS authority.

See [paid research procurement](docs/architecture/PAID_RESEARCH_PROCUREMENT.md) for the policy fields, verification rules and operator commands. The first live paid research settlement remains pending.
