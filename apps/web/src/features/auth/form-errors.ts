import type { z } from "zod";

export function firstFieldErrors(error: z.ZodError) {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (typeof field === "string" && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }

  return errors;
}
