import { boot } from "./app";

void boot().catch((error) => {
  console.error("Nexus renderer failed to start", error);
});
