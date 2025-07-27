import express from "express";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const app = express();

app.get("/health", (_, res) => {
  res.status(200).send("OK");
});

app.use((_, res) => {
  res.status(404).send("Not Found");
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
