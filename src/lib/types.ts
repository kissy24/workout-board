export interface WorkoutRecord {
  date: string;
  exercise: string;
  set: number;
  weightKg: number;
  reps: number;
  volumeKg: number;
  memo: string;
  sourceRow: number;
}

export interface ValidationWarning {
  row: number;
  message: string;
}

export interface ParsedWorkoutSheet {
  records: WorkoutRecord[];
  warnings: ValidationWarning[];
}

export type Period = "30" | "90" | "180" | "all";

export interface ExerciseSummary {
  exercise: string;
  latestDate: string;
  bestSetWeightKg: number;
  bestSetReps: number;
  sessionCount: number;
}

export interface SessionExercise {
  exercise: string;
  sets: Array<Pick<WorkoutRecord, "set" | "weightKg" | "reps" | "volumeKg" | "memo">>;
}

export interface SessionSummary {
  date: string;
  exercises: SessionExercise[];
}

export interface DashboardInsights {
  lastWorkoutDate: string | null;
  daysSinceLastWorkout: number | null;
  weeklyFrequency: number;
  activeWeekStreak: number;
  personalRecordExerciseCount: number;
}

export interface DashboardSummary {
  period: Period;
  range: { start: string | null; end: string | null };
  insights: DashboardInsights;
  exercises: ExerciseSummary[];
  sessions: SessionSummary[];
  availableExercises: string[];
  warnings: ValidationWarning[];
  lastSyncedAt: string | null;
}

export interface WorksheetInfo {
  sheetId: number;
  title: string;
  index: number;
  hidden: boolean;
}

export interface SheetSettings {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetId: number;
  sheetTitle: string;
  sourceUrl: string;
}

export interface AppConfig {
  sheet: SheetSettings | null;
}

export interface ImportedFile {
  type: "import";
  fileName: string;
  importedAt: string;
}

export interface StoredImport extends ImportedFile {
  version: 1;
  contents: string;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  authUri: "https://accounts.google.com/o/oauth2/auth";
  tokenUri: "https://oauth2.googleapis.com/token";
}

export interface AccessToken {
  value: string;
  expiresAt: number;
}
