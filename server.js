import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

const demoCompanies = [
  "Fermionic Design",
  "Saankhya Labs",
  "Chipspirit",
  "Blueberry Semiconductors",
  "Circuitsutra Technologies"
];

app.get("/", (req, res) => {
  res.render("index", {
    title: "CV Assist",
    subtitle: "Simple dashboard for students to upload CVs and discover opportunities"
  });
});

app.get("/dashboard", (req, res) => {
  res.render("dashboard", {
    title: "Student Dashboard",
    companies: demoCompanies
  });
});

app.post("/upload", (req, res) => {
  res.status(501).send("Upload handling will be added when backend is finalized.");
});

app.listen(port, () => {
  console.log(`CV Assist running on http://localhost:${port}`);
});
