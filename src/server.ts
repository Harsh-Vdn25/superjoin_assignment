import express from "express";
import { documentRouter } from "./routes/documents";
import { factRouter } from "./routes/facts";
import { relationRouter } from "./routes/relationships";

const app = express();
app.use(express.json());

app.use("/documents", documentRouter);
app.use("/facts", factRouter);
app.use("/relationships", relationRouter);

app.listen(5000, () => {
  console.log("App is listening on port 5000");
});
