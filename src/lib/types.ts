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

export interface Metric {
  value: number;
  percentChange: number | null;
}

export interface TrendPoint {
  date: string;
  volumeKg: number;
  topWeightKg: number;
  estimatedOneRepMaxKg: number;
}

export interface ExerciseSummary {
  exercise: string;
  totalVolumeKg: number;
  topWeightKg: number;
  estimatedOneRepMaxKg: number;
  setCount: number;
  sessionCount: number;
}

export interface SessionExercise {
  exercise: string;
  sets: Array<Pick<WorkoutRecord, "set" | "weightKg" | "reps" | "volumeKg" | "memo">>;
}

export interface SessionSummary {
  date: string;
  totalVolumeKg: number;
  exercises: SessionExercise[];
}

export interface DashboardSummary {
  period: Period;
  exercise: string | null;
  range: { start: string | null; end: string | null };
  kpis: {
    totalVolumeKg: Metric;
    sessionCount: Metric;
    setCount: Metric;
    estimatedOneRepMaxKg: Metric;
  };
  trends: TrendPoint[];
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
