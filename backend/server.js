import express from "express";
import cors from "cors";

// ── Routers (compartiments) ─────────────────────────────────────────────────
import dataQualityRouter   from "./routes/dataQuality.routes.js";
import dataCleaningRouter  from "./routes/dataCleaning.routes.js";
import dataModellingRouter from "./routes/dataModelling.routes.js";
import multilabelRouter    from "./routes/multilabel.routes.js";
import deploymentRouter    from "./routes/deployment.routes.js";

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
app.use("/api/multilabel",     multilabelRouter);
app.use("/api/deployment",     deploymentRouter);


app.listen(PORT, () => {
  console.log(`Backend sur http://localhost:${PORT}`);
});
