import type { EventProcessingState } from "@meterpilot/contracts/events";
import type { StatusTone } from "@meterpilot/ui";

export function formatEventTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function processingTone(state: EventProcessingState): StatusTone {
  switch (state) {
    case "failed":
      return "danger";
    case "pending":
      return "warning";
    case "processed":
      return "success";
    case "processing":
      return "info";
  }
}
