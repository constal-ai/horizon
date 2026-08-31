import { agent } from "@constal/sdk";
import { runHorizonSetup } from "./workflow.js";

export default agent({
  id: "horizon-setup",
  version: "0.1.0",
  model: "model",
  mode: "script",
  onMessage: runHorizonSetup,
});

export { runHorizonSetup } from "./workflow.js";
