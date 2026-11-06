import type { FastifyReply } from "fastify";

type Event = { id: number };

export function eventStreams(limit: number) {
  const streams = new Set<() => void>();
  return {
    close() { for (const close of streams) close(); },
    open(reply: FastifyReply, last: unknown, read: (cursor: number) => Event[]) {
      if (streams.size >= limit) return reply.code(429).send({ error: "Too many event streams" });
      if (typeof last !== "string" || !/^\d{1,15}$/.test(last)) return reply.code(400).send({ error: "Invalid event cursor" });
      let cursor = Number(last);
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no", Connection: "keep-alive" });
      response.write("retry: 1500\n\n");
      const close = () => { clearInterval(timer); streams.delete(close); if (!response.writableEnded) response.end(); };
      const flush = () => {
        if (response.writableLength > 64_000) return close();
        const events = read(cursor);
        if (!events.length) response.write(": heartbeat\n\n");
        for (const event of events) {
          response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.id;
        }
      };
      const timer = setInterval(flush, 750);
      streams.add(close);
      response.on("close", close);
      flush();
    },
  };
}
