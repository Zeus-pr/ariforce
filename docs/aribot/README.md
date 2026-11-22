# ARIBOT knowledge

The text the bot reads is `apps/api/src/bot/knowledge/all.md` and `howto.md`, plus `director.md` when that person's team is the whole company (a Director or Distribution Head).

Those files are definitions: what a word means, who can see whom, and which tool answers which question. They do not contain a person's results, a target, or a doctor list. Live figures come from the reporting-line tools on `POST /v1/bot/ask`.

`XAI_API_KEY` is read by the API at request time. Until it is set, the endpoint answers 503 and the rest of the API keeps running. Each question uses `grok-4.3`, or `grok-4.7` when it compares, asks why, or names more than one month. That model name is sent on the call. `BOT_RATE_PER_USER` is questions per user per hour (default 40).
