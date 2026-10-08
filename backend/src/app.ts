import express from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./config/swagger.js";

// The Express app is created and exported WITHOUT listening, so tests can
// drive it in-process (supertest). server.ts is the only file that listens.
export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
