import type { NexusDiagnostic } from "@floatboat/nexus-plugin-api";
import {
  DiagnosticBus,
  RuntimeCapabilityRegistry,
  type PluginManagerOptions,
} from "../dist/index";

const capabilities = new RuntimeCapabilityRegistry();
const diagnostics = new DiagnosticBus();
const options = {} as PluginManagerOptions;
const report: readonly NexusDiagnostic[] = diagnostics.diagnostics;

void capabilities;
void options;
void report;
