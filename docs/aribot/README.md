# ARIBOT knowledge

The text the bot reads is `apps/api/src/bot/knowledge/all.md`, plus `director.md` when the signed-in person is a Director.

Those files are definitions: what a word means, who can see whom, and which tool answers which question. They do not contain a person's results, a target, or a doctor list. Live figures come from the reporting-line tools on `POST /v1/bot/ask`.

`OPENAI_API_KEY` is read by the API at request time. Until it is set, the endpoint answers 503 and the rest of the API keeps running. `OPENAI_MODEL` overrides the model (default `gpt-5.4-nano`). `BOT_RATE_PER_USER` is questions per user per hour (default 40).
