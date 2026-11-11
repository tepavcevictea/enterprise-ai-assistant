# TX Services

Local Cloudflare backend for a fictional IT and HR assistant. This slice handles one demo user's message: the orchestrator plans with GPT-6.1 Sol, the IT specialist calls `getServiceStatus`, and the reply and trace are stored in that user's SQLite Durable Object.

HR, MCP, skill loading, and the React UI are not in this slice. The demo header `x-demo-user` (`alex`, `jordan`, or `taylor`) selects a session. It is not a login.

## Setup

Node 22. From this directory:

```sh
npm install
cp .dev.vars.example .dev.vars
```

Put the OpenAI API key in `.dev.vars`. The file is gitignored.

## Commands

```sh
npm run typecheck
npm test
npm run test:live
npm run dev
```

`npm test` uses a stub model. `npm run test:live` calls GPT-6.1 Sol inside workerd. `npm run dev` serves the worker locally.

```sh
curl -s -X POST http://localhost:8787/messages \
  -H 'content-type: application/json' \
  -H 'x-demo-user: alex' \
  -d '{"message":"Is the company VPN service operational?","idempotencyKey":"vpn-1"}'
```

Reset that user's session with `POST /session/reset` and the same header. `GET /session` returns the stored histories and traces.
