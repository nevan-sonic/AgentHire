# Verification

The deterministic layer checks dependency integrity, report shape, source identities, and exact excerpts against the retrieved records. The verification role makes a separately labeled Groq-assisted assessment of completeness and support. A negative assessment preserves the artifacts and puts the run into a failed state for review. Neither stage establishes that repository authors' claims are independently true.

Policy checks happen in server code. Retrieval is limited to GitHub's public API with redirects disabled, bounded response sizes, timeouts, and per-goal calls. The model receives source text as data and has no arbitrary tool or financial authority.
