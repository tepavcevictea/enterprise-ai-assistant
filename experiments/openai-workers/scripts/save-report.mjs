import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const resultsTarget = new URL("../../../docs/experiments/004-planning-results.json", import.meta.url);
const reviewTarget = new URL("../../../docs/experiments/004-planning-review.json", import.meta.url);
const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const parsed = JSON.parse(body);
    if (parsed.probe === true) {
      response.writeHead(204);
      response.end();
      return;
    }
    const target = parsed.kind === "review" ? reviewTarget : resultsTarget;
    writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(`saved ${body.length} bytes`);
    response.writeHead(204);
    response.end();
  });
});

server.listen(47331, "127.0.0.1", () => {
  console.log("planning evidence server listening on 127.0.0.1:47331");
});
