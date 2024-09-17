import { defineApp } from "convex/server";
import component from "@convex-dev/migrations/convex.config.js";

const app = defineApp();
app.use(component);

export default app;
