# Groq integration

Set the server-only GROQ_API_KEY and explicitly enable GROQ_GOALS_ENABLED in the ignored root .env after authorizing provider usage. Configure GROQ_MANAGER_MODEL, GROQ_WORKER_MODEL, and GROQ_VERIFIER_MODEL as needed. The default is llama-3.1-8b-instant. The client uses Groq's JSON object mode and validates application schemas locally. It limits time, output, and per-goal requests and tokens. Short rate limits and service-unavailable responses can trigger one bounded retry. Usage and conservative reservations appear in goal history. Provider failures are visible in the goal workspace.

See the [Groq model card](https://console.groq.com/docs/model/llama-3.1-8b-instant) and [JSON object mode documentation](https://console.groq.com/docs/structured-outputs).

Paid procurement uses the same planner and report/verification models. The planner is limited to one research child for this workflow. A reviewed plan is persisted before approval, and provider requests and token accounting carry over when the approved goal resumes.
