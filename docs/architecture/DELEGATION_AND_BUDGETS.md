# Delegation and budgets

The goal, lead and child allowances are nested. One paid research child can reserve a test and a hire. Approval and goal state change share a SQLite transaction. Every reservation takes an immediate write transaction and reduces available funds. A reservation can be released only before submission. Submitted or uncertain amounts remain unavailable. Verified settled amounts remain spent even when the result is unusable.

The authorization binds the exact reviewed goal, parent, child and quote plan, plus explicit merchants, endpoints, network, asset, per-payment, total, count and expiry limits. The model supplies none of this authority. HCS fees and Groq token usage are accounted for separately. See [operator usage](PAID_RESEARCH_PROCUREMENT.md).
