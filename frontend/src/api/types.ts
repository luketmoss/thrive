// Groundwork data types — mirrors Google Sheet column structure.

export type WorkoutType = 'weight' | 'stretch' | 'bike' | 'hike';
export type Effort = 'Easy' | 'Medium' | 'Hard';
export type Section = 'warmup' | 'primary' | 'SS1' | 'SS2' | 'SS3' | 'burnout' | 'cooldown';

export interface Exercise {
  id: string;
  name: string;
  tags: string;       // comma-separated
  notes: string;
  created: string;
}
export interface ExerciseWithRow extends Exercise { sheetRow: number; }

export interface TemplateRow {
  template_id: string;
  template_name: string;
  order: number;
  exercise_id: string;
  exercise_name: string;
  section: Section | string;
  sets: string;        // "4-5" range
  reps: string;        // "4-6" range
  rest_seconds: string;
  group_rest_seconds: string;
  created: string;
  updated: string;
}
export interface TemplateRowWithRow extends TemplateRow { sheetRow: number; }

export interface Template {
  id: string;
  name: string;
  exercises: TemplateRowWithRow[];
}

export interface Workout {
  id: string;
  date: string;
  time: string;
  type: WorkoutType;
  name: string;
  template_id: string;
  notes: string;
  duration_min: string;
  created: string;
  copied_from: string;
}
export interface WorkoutWithRow extends Workout { sheetRow: number; }

export interface WorkoutSet {
  workout_id: string;
  exercise_id: string;
  exercise_name: string;
  section: string;
  exercise_order: number;
  set_number: number;
  planned_reps: string;
  weight: string;
  reps: string;
  effort: Effort | '';
  notes: string;
}
export interface SetWithRow extends WorkoutSet { sheetRow: number; }

export interface Label {
  id: string;
  name: string;
  color_key: string;
  created: string;
}
export interface LabelWithRow extends Label { sheetRow: number; }

export interface UserInfo {
  email: string;
  name: string;
  picture: string;
}
