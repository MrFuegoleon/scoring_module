import express from "express";
import cors from "cors";

// ── Routers (compartiments) ─────────────────────────────────────────────────
import dataQualityRouter   from "./routes/dataQuality.routes.js";
import dataCleaningRouter  from "./routes/dataCleaning.routes.js";
import dataModellingRouter from "./routes/dataModelling.routes.js";

const app = express();
const PORT = 3001;

app.use(
  cors({
    exposedHeaders: [
      "X-Report-Id",
      "X-File-Hash",
      "X-Generated-At",
      "X-From-Cache",
    ],
  }),
);
app.use(express.json());

// ── Enregistrement des compartiments ───────────────────────────────────────
app.use("/api/data-quality",   dataQualityRouter);
app.use("/api/data-cleaning",  dataCleaningRouter);
app.use("/api/data-modelling", dataModellingRouter);


app.listen(PORT, () => {
  console.log(`Backend sur http://localhost:${PORT}`);
});
