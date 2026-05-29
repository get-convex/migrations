import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config";
import localComponent from "./localComponent/convex.config";

const app = defineApp();
app.use(migrations);
// Example: A local component that also uses migrations for its own data
app.use(localComponent);

export default app;
