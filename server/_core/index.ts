import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "balku" });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.log(`BALKU server listening on port ${port}`);
  });
}

startServer().catch(error => {
  console.error("Failed to start BALKU server", error);
  process.exit(1);
});
