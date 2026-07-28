import { parseDelimitedText } from "./delimited";
import type { ParsedWorkoutSheet } from "./types";
import { parseWorkoutValues } from "./workouts";

export function parseImportedFile(fileName: string, contents: string): ParsedWorkoutSheet {
  const data = parseWorkoutValues(parseDelimitedText(contents, fileName));
  const headerError = data.warnings.find((warning) => warning.row === 1);
  if (data.records.length === 0 && headerError) throw new Error(headerError.message);
  return data;
}
