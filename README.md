# TX Services

Local Cloudflare backend for a fictional IT and HR assistant. A demo user sends a message, the orchestrator plans with GPT-6.1 Sol, and the matching specialist answers. IT can load the VPN troubleshooting procedure with `loadSkill` and call the native `getServiceStatus` tool. IT Support can run a simulated password reset. HR calls `searchPolicies` on the policy Worker through a private service binding. The reply, trace, and separate agent histories are stored in that user's SQLite Durable Object.

The demo header `x-demo-user` (`alex`, `jordan`, or `taylor`) selects a session. It is not a login. The React app in `web/` sends that header and reads the stored session. It does not see the API key.

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

In a second terminal:

```sh
cd web
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The page proxies `/messages` and `/session` to the worker on port 8787. Leave `npm run dev` running at the repository root while the page is open.

`npm test` uses a stub model and the real policy Worker. `npm run test:live` calls GPT-6.1 Sol inside workerd. `npm run dev` serves the app Worker and the policy Worker together.

Frontend checks, from `web/`:

```sh
npm run typecheck
npm test
npm run build
```

```sh
curl -s -X POST http://localhost:8787/messages \
  -H 'content-type: application/json' \
  -H 'x-demo-user: alex' \
  -d '{"message":"Is the company VPN service operational?","idempotencyKey":"vpn-1"}'

curl -s -X POST http://localhost:8787/messages \
  -H 'content-type: application/json' \
  -H 'x-demo-user: alex' \
  -d '{"message":"What does the leave approval policy say?","idempotencyKey":"leave-1"}'
```

Reset that user's session with `POST /session/reset` and the same header. `GET /session` returns the stored histories and traces.
