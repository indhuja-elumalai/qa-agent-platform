import { QaOrchestrator } from "@qa/orchestrator";

const globalService = globalThis as typeof globalThis & { qaOrchestrator?: QaOrchestrator };

export function getOrchestrator() {
  if (!globalService.qaOrchestrator) globalService.qaOrchestrator = new QaOrchestrator();
  return globalService.qaOrchestrator;
}
