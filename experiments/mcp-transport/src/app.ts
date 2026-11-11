export default {
  async fetch(): Promise<Response> {
    return new Response("mcp transport experiment", { status: 404 });
  },
};
