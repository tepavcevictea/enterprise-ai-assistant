export default {
  async fetch(): Promise<Response> {
    return new Response("openai workers experiment", { status: 404 });
  },
};
