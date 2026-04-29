import { defineComponent } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config";

const component = defineComponent("localComponent");

// The local component uses the migrations component for its own data
component.use(migrations);

export default component;
