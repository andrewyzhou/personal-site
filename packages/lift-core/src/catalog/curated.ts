import type { Equipment, Exercise, ExerciseCategory, MuscleRegion, TrackingType } from "../types";

// hand-curated entries. names follow strong's "Movement (Equipment)" style because
// strong share text is ingested by exact name. order matters: within a search tier
// ties fall back to this order, so the most common variant of a movement goes first.
//
// ids are derived from the name once (slugify) and must never change after shipping.
// if a name is ever corrected, pin the old id with `id:` so stored workouts still resolve.
//
// generic aliases point at one variant only (search surfaces the siblings):
// "shoulder press"/"ohp"/"military press" -> overhead press (barbell), "bench" -> barbell
// bench, "curl" -> dumbbell bicep curl, "pulldown" -> cable lat pulldown, "rdl" -> barbell rdl.

interface Def {
  name: string;
  equipment: Equipment;
  tracking: TrackingType;
  primary: MuscleRegion[];
  secondary?: MuscleRegion[];
  aliases?: string[];
  freeDbId?: string;
  category?: ExerciseCategory;
  id?: string;
}

/** "Triceps Pushdown (Cable - Straight Bar)" -> "triceps-pushdown-cable-straight-bar" */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const W = "weight_reps" as const;
const R = "reps" as const;
const WB = "weighted_bodyweight" as const;
const AB = "assisted_bodyweight" as const;
const D = "duration" as const;
const DD = "distance_duration" as const;
const WD = "weight_distance" as const;

const DEFS: Def[] = [
  // ---- chest
  { name: "Bench Press (Barbell)", equipment: "barbell", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["bench", "bench press", "flat bench", "barbell bench press", "bb bench"], freeDbId: "Barbell_Bench_Press_-_Medium_Grip" },
  { name: "Bench Press (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["dumbbell bench press", "db bench", "db bench press", "flat db press"], freeDbId: "Dumbbell_Bench_Press" },
  { name: "Bench Press (Smith Machine)", equipment: "smith", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["smith bench", "smith machine bench press"], freeDbId: "Smith_Machine_Bench_Press" },
  { name: "Close Grip Bench Press (Barbell)", equipment: "barbell", tracking: W, primary: ["triceps", "chest"], secondary: ["front_delts"], aliases: ["close grip bench", "cgbp"], freeDbId: "Close-Grip_Barbell_Bench_Press" },
  { name: "Incline Bench Press (Barbell)", equipment: "barbell", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["incline bench", "incline barbell press"], freeDbId: "Barbell_Incline_Bench_Press_-_Medium_Grip" },
  { name: "Incline Bench Press (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["incline dumbbell press", "incline db press", "incline press"], freeDbId: "Incline_Dumbbell_Press" },
  { name: "Incline Bench Press (Smith Machine)", equipment: "smith", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["smith incline", "smith incline press"], freeDbId: "Smith_Machine_Incline_Bench_Press" },
  { name: "Decline Bench Press (Barbell)", equipment: "barbell", tracking: W, primary: ["chest"], secondary: ["triceps", "front_delts"], aliases: ["decline bench"], freeDbId: "Decline_Barbell_Bench_Press" },
  { name: "Decline Bench Press (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["chest"], secondary: ["triceps", "front_delts"], freeDbId: "Decline_Dumbbell_Bench_Press" },
  { name: "Floor Press (Barbell)", equipment: "barbell", tracking: W, primary: ["chest", "triceps"], secondary: ["front_delts"], freeDbId: "Floor_Press" },
  { name: "Chest Press (Machine)", equipment: "machine", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["machine chest press", "seated chest press"], freeDbId: "Leverage_Chest_Press" },
  { name: "Incline Chest Press (Machine)", equipment: "machine", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["machine incline press"], freeDbId: "Leverage_Incline_Chest_Press" },
  { name: "Chest Press (Cable)", equipment: "cable", tracking: W, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["cable chest press"], freeDbId: "Cable_Chest_Press" },
  { name: "Chest Fly (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["chest"], secondary: ["front_delts"], aliases: ["dumbbell fly", "db fly", "chest flye"], freeDbId: "Dumbbell_Flyes" },
  { name: "Incline Chest Fly (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["chest"], secondary: ["front_delts"], aliases: ["incline fly", "incline dumbbell fly"], freeDbId: "Incline_Dumbbell_Flyes" },
  { name: "Chest Fly (Machine)", equipment: "machine", tracking: W, primary: ["chest"], secondary: ["front_delts"], aliases: ["pec deck", "pec fly", "butterfly", "machine fly"], freeDbId: "Butterfly" },
  { name: "Cable Crossover", equipment: "cable", tracking: W, primary: ["chest"], secondary: ["front_delts"], aliases: ["cable fly", "crossover", "chest fly cable"], freeDbId: "Cable_Crossover" },
  { name: "Low Cable Crossover", equipment: "cable", tracking: W, primary: ["chest"], secondary: ["front_delts"], aliases: ["low to high cable fly"], freeDbId: "Low_Cable_Crossover" },
  { name: "Push Up", equipment: "bodyweight", tracking: R, primary: ["chest"], secondary: ["front_delts", "triceps", "abs"], aliases: ["press up"], freeDbId: "Pushups" },
  { name: "Incline Push Up", equipment: "bodyweight", tracking: R, primary: ["chest"], secondary: ["front_delts", "triceps"], freeDbId: "Incline_Push-Up" },
  { name: "Decline Push Up", equipment: "bodyweight", tracking: R, primary: ["chest"], secondary: ["front_delts", "triceps"], aliases: ["feet elevated push up"], freeDbId: "Decline_Push-Up" },
  { name: "Chest Dip", equipment: "bodyweight", tracking: WB, primary: ["chest", "triceps"], secondary: ["front_delts"], aliases: ["dip", "parallel bar dip", "weighted dip"], freeDbId: "Dips_-_Chest_Version" },
  { name: "Chest Dip (Assisted)", equipment: "assisted_bodyweight", tracking: AB, primary: ["chest", "triceps"], secondary: ["front_delts"], aliases: ["assisted dip", "machine assisted dip"] },
  { name: "Pullover (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["chest", "lats"], secondary: ["triceps"], aliases: ["dumbbell pullover"], freeDbId: "Bent-Arm_Dumbbell_Pullover" },

  // ---- shoulders
  { name: "Overhead Press (Barbell)", equipment: "barbell", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps", "traps"], aliases: ["shoulder press", "ohp", "military press", "strict press", "standing press", "barbell shoulder press"], freeDbId: "Standing_Military_Press" },
  { name: "Overhead Press (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps"], aliases: ["dumbbell shoulder press", "db shoulder press", "seated dumbbell press", "db ohp"], freeDbId: "Dumbbell_Shoulder_Press" },
  { name: "Seated Overhead Press (Barbell)", equipment: "barbell", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps"], aliases: ["seated military press"], freeDbId: "Seated_Barbell_Military_Press" },
  { name: "Overhead Press (Smith Machine)", equipment: "smith", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps"], aliases: ["smith shoulder press"], freeDbId: "Smith_Machine_Overhead_Shoulder_Press" },
  { name: "Shoulder Press (Machine)", equipment: "machine", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps"], aliases: ["machine shoulder press"], freeDbId: "Machine_Shoulder_Military_Press" },
  { name: "Arnold Press (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps"], aliases: ["arnold press"], freeDbId: "Arnold_Dumbbell_Press" },
  { name: "Push Press", equipment: "barbell", tracking: W, primary: ["front_delts"], secondary: ["triceps", "quads", "side_delts"], freeDbId: "Push_Press" },
  { name: "Lateral Raise (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["side_delts"], secondary: ["traps"], aliases: ["lat raise", "side raise", "side lateral raise", "side lateral", "db lateral raise"], freeDbId: "Side_Lateral_Raise" },
  { name: "Lateral Raise (Cable)", equipment: "cable", tracking: W, primary: ["side_delts"], secondary: ["traps"], aliases: ["cable lateral raise", "cable side raise"], freeDbId: "Cable_Seated_Lateral_Raise" },
  { name: "Lateral Raise (Machine)", equipment: "machine", tracking: W, primary: ["side_delts"], secondary: ["traps"], aliases: ["machine lateral raise"] },
  { name: "Lateral Raise (Band)", equipment: "band", tracking: W, primary: ["side_delts"], secondary: ["traps"], freeDbId: "Lateral_Raise_-_With_Bands" },
  { name: "Front Raise (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["front_delts"], secondary: ["side_delts"], aliases: ["front raise", "front delt raise"], freeDbId: "Front_Dumbbell_Raise" },
  { name: "Front Raise (Cable)", equipment: "cable", tracking: W, primary: ["front_delts"], secondary: ["side_delts"], freeDbId: "Front_Cable_Raise" },
  { name: "Front Raise (Plate)", equipment: "plate", tracking: W, primary: ["front_delts"], secondary: ["side_delts"], aliases: ["plate raise"], freeDbId: "Front_Plate_Raise" },
  { name: "Upright Row (Barbell)", equipment: "barbell", tracking: W, primary: ["side_delts", "traps"], secondary: ["front_delts", "biceps"], aliases: ["upright row"], freeDbId: "Upright_Barbell_Row" },
  { name: "Upright Row (Cable)", equipment: "cable", tracking: W, primary: ["side_delts", "traps"], secondary: ["front_delts", "biceps"], freeDbId: "Upright_Cable_Row" },
  { name: "Upright Row (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["side_delts", "traps"], secondary: ["front_delts", "biceps"], freeDbId: "Standing_Dumbbell_Upright_Row" },
  { name: "Reverse Fly (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["rear_delts"], secondary: ["upper_back", "traps"], aliases: ["rear delt fly", "rear delt raise", "bent over reverse fly", "rear lateral raise"], freeDbId: "Reverse_Flyes" },
  { name: "Reverse Fly (Machine)", equipment: "machine", tracking: W, primary: ["rear_delts"], secondary: ["upper_back", "traps"], aliases: ["reverse pec deck", "rear delt fly machine", "machine rear delt fly"], freeDbId: "Reverse_Machine_Flyes" },
  { name: "Reverse Fly (Cable)", equipment: "cable", tracking: W, primary: ["rear_delts"], secondary: ["upper_back", "traps"], aliases: ["cable rear delt fly"], freeDbId: "Cable_Rear_Delt_Fly" },
  { name: "Face Pull (Cable)", equipment: "cable", tracking: W, primary: ["rear_delts"], secondary: ["upper_back", "traps", "side_delts"], aliases: ["face pull", "rope face pull"], freeDbId: "Face_Pull" },
  { name: "Shrug (Barbell)", equipment: "barbell", tracking: W, primary: ["traps"], secondary: ["forearms"], aliases: ["barbell shrug"], freeDbId: "Barbell_Shrug" },
  { name: "Shrug (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["traps"], secondary: ["forearms"], aliases: ["shrug", "dumbbell shrug", "db shrug"], freeDbId: "Dumbbell_Shrug" },
  { name: "Shrug (Smith Machine)", equipment: "smith", tracking: W, primary: ["traps"], secondary: ["forearms"], freeDbId: "Smith_Machine_Behind_the_Back_Shrug" },

  // ---- back
  { name: "Pull Up", equipment: "bodyweight", tracking: WB, primary: ["lats"], secondary: ["biceps", "upper_back", "rear_delts"], aliases: ["weighted pull up", "pull up weighted", "wide grip pull up"], freeDbId: "Pullups" },
  { name: "Chin Up", equipment: "bodyweight", tracking: WB, primary: ["lats", "biceps"], secondary: ["upper_back", "forearms"], aliases: ["weighted chin up", "chins"], freeDbId: "Chin-Up" },
  { name: "Pull Up (Assisted)", equipment: "assisted_bodyweight", tracking: AB, primary: ["lats"], secondary: ["biceps", "upper_back", "rear_delts"], aliases: ["assisted pull up", "machine assisted pull up", "band assisted pull up"], freeDbId: "Band_Assisted_Pull-Up" },
  { name: "Chin Up (Assisted)", equipment: "assisted_bodyweight", tracking: AB, primary: ["lats", "biceps"], secondary: ["upper_back"], aliases: ["assisted chin up"] },
  { name: "Neutral Grip Pull Up", equipment: "bodyweight", tracking: WB, primary: ["lats"], secondary: ["biceps", "upper_back"], aliases: ["hammer grip pull up"], freeDbId: "V-Bar_Pullup" },
  { name: "Muscle Up", equipment: "bodyweight", tracking: WB, primary: ["lats", "triceps"], secondary: ["chest", "biceps", "front_delts"], freeDbId: "Muscle_Up" },
  { name: "Lat Pulldown (Cable)", equipment: "cable", tracking: W, primary: ["lats"], secondary: ["biceps", "upper_back", "rear_delts"], aliases: ["lat pulldown", "pulldown", "lat pull", "lat pull down", "wide grip pulldown"], freeDbId: "Wide-Grip_Lat_Pulldown" },
  { name: "Lat Pulldown (Machine)", equipment: "machine", tracking: W, primary: ["lats"], secondary: ["biceps", "upper_back"], aliases: ["machine pulldown"] },
  { name: "Close Grip Lat Pulldown (Cable)", equipment: "cable", tracking: W, primary: ["lats"], secondary: ["biceps", "upper_back"], aliases: ["close grip pulldown", "v bar pulldown"], freeDbId: "V-Bar_Pulldown" },
  { name: "Reverse Grip Lat Pulldown (Cable)", equipment: "cable", tracking: W, primary: ["lats"], secondary: ["biceps", "upper_back"], aliases: ["underhand pulldown"], freeDbId: "Underhand_Cable_Pulldowns" },
  { name: "Single Arm Lat Pulldown (Cable)", equipment: "cable", tracking: W, primary: ["lats"], secondary: ["biceps"], aliases: ["one arm pulldown"], freeDbId: "One_Arm_Lat_Pulldown" },
  { name: "Straight Arm Pulldown (Cable)", equipment: "cable", tracking: W, primary: ["lats"], secondary: ["triceps", "rear_delts"], aliases: ["straight arm pulldown", "lat prayer", "cable pullover"], freeDbId: "Straight-Arm_Pulldown" },
  { name: "Seated Row (Cable)", equipment: "cable", tracking: W, primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], aliases: ["seated cable row", "cable row", "low row"], freeDbId: "Seated_Cable_Rows" },
  { name: "Seated Row (Machine)", equipment: "machine", tracking: W, primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"], aliases: ["machine row", "iso row"], freeDbId: "Leverage_Iso_Row" },
  { name: "High Row (Machine)", equipment: "machine", tracking: W, primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], freeDbId: "Leverage_High_Row" },
  { name: "Bent Over Row (Barbell)", equipment: "barbell", tracking: W, primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps", "lower_back"], aliases: ["barbell row", "bb row", "bent over row", "bent row"], freeDbId: "Bent_Over_Barbell_Row" },
  { name: "Pendlay Row (Barbell)", equipment: "barbell", tracking: W, primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps", "lower_back"], aliases: ["pendlay row"] },
  { name: "Bent Over Row (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], aliases: ["dumbbell row", "db row"], freeDbId: "Bent_Over_Two-Dumbbell_Row" },
  { name: "Single Arm Row (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], aliases: ["one arm dumbbell row", "single arm row", "kroc row"], freeDbId: "One-Arm_Dumbbell_Row" },
  { name: "Chest Supported Row (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"], aliases: ["incline dumbbell row", "chest supported row"], freeDbId: "Dumbbell_Incline_Row" },
  { name: "T Bar Row", equipment: "barbell", tracking: W, primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps", "lower_back"], aliases: ["landmine row"], freeDbId: "T-Bar_Row_with_Handle" },
  { name: "Bent Over Row (Smith Machine)", equipment: "smith", tracking: W, primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], freeDbId: "Smith_Machine_Bent_Over_Row" },
  { name: "Inverted Row", equipment: "bodyweight", tracking: R, primary: ["upper_back", "lats"], secondary: ["biceps", "rear_delts"], aliases: ["australian pull up", "body row"], freeDbId: "Inverted_Row" },
  { name: "Back Extension", equipment: "bodyweight", tracking: WB, primary: ["lower_back"], secondary: ["glutes", "hamstrings"], aliases: ["hyperextension", "back hyperextension", "45 degree back extension"], freeDbId: "Hyperextensions_Back_Extensions" },
  { name: "Good Morning (Barbell)", equipment: "barbell", tracking: W, primary: ["hamstrings", "lower_back"], secondary: ["glutes"], aliases: ["good morning"], freeDbId: "Good_Morning" },

  // ---- legs
  { name: "Squat (Barbell)", equipment: "barbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors", "lower_back"], aliases: ["squat", "back squat", "barbell squat", "high bar squat", "low bar squat"], freeDbId: "Barbell_Squat" },
  { name: "Front Squat (Barbell)", equipment: "barbell", tracking: W, primary: ["quads"], secondary: ["glutes", "abs", "upper_back"], aliases: ["front squat"], freeDbId: "Front_Barbell_Squat" },
  { name: "Squat (Smith Machine)", equipment: "smith", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["smith squat"], freeDbId: "Smith_Machine_Squat" },
  { name: "Box Squat (Barbell)", equipment: "barbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors", "lower_back"], aliases: ["box squat"], freeDbId: "Box_Squat" },
  { name: "Goblet Squat (Kettlebell)", equipment: "kettlebell", tracking: W, primary: ["quads", "glutes"], secondary: ["adductors", "abs"], aliases: ["goblet squat"], freeDbId: "Goblet_Squat" },
  { name: "Goblet Squat (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["adductors", "abs"], aliases: ["dumbbell goblet squat"] },
  { name: "Squat (Bodyweight)", equipment: "bodyweight", tracking: R, primary: ["quads", "glutes"], secondary: ["hamstrings"], aliases: ["air squat", "bodyweight squat"], freeDbId: "Bodyweight_Squat" },
  { name: "Hack Squat (Machine)", equipment: "machine", tracking: W, primary: ["quads"], secondary: ["glutes", "adductors"], aliases: ["hack squat"], freeDbId: "Hack_Squat" },
  { name: "Pendulum Squat (Machine)", equipment: "machine", tracking: W, primary: ["quads"], secondary: ["glutes", "adductors"], aliases: ["pendulum squat"] },
  { name: "Leg Press", equipment: "machine", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["leg press machine", "45 degree leg press", "sled leg press"], freeDbId: "Leg_Press" },
  { name: "Single Leg Press", equipment: "machine", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings"], aliases: ["one leg press"] },
  { name: "Bulgarian Split Squat", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["bss", "rear foot elevated split squat", "rfess", "bulgarian"] },
  { name: "Split Squat (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["split squat", "static lunge"], freeDbId: "Split_Squat_with_Dumbbells" },
  { name: "Lunge (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["lunge", "dumbbell lunge"], freeDbId: "Dumbbell_Lunges" },
  { name: "Lunge (Barbell)", equipment: "barbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["barbell lunge"], freeDbId: "Barbell_Lunge" },
  { name: "Walking Lunge (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors"], aliases: ["walking lunge"] },
  { name: "Reverse Lunge (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings"], aliases: ["reverse lunge"], freeDbId: "Dumbbell_Rear_Lunge" },
  { name: "Step Up (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["quads", "glutes"], secondary: ["hamstrings"], aliases: ["step up", "box step up"], freeDbId: "Dumbbell_Step_Ups" },
  { name: "Leg Extension (Machine)", equipment: "machine", tracking: W, primary: ["quads"], aliases: ["leg extension", "quad extension"], freeDbId: "Leg_Extensions" },
  { name: "Lying Leg Curl (Machine)", equipment: "machine", tracking: W, primary: ["hamstrings"], secondary: ["calves"], aliases: ["leg curl", "hamstring curl", "lying hamstring curl", "prone leg curl"], freeDbId: "Lying_Leg_Curls" },
  { name: "Seated Leg Curl (Machine)", equipment: "machine", tracking: W, primary: ["hamstrings"], secondary: ["calves"], aliases: ["seated hamstring curl"], freeDbId: "Seated_Leg_Curl" },
  { name: "Standing Leg Curl (Machine)", equipment: "machine", tracking: W, primary: ["hamstrings"], freeDbId: "Standing_Leg_Curl" },
  { name: "Nordic Hamstring Curl", equipment: "bodyweight", tracking: R, primary: ["hamstrings"], secondary: ["glutes"], aliases: ["nordic curl", "nordics", "glute ham raise"], freeDbId: "Natural_Glute_Ham_Raise" },
  { name: "Deadlift (Barbell)", equipment: "barbell", tracking: W, primary: ["hamstrings", "glutes", "lower_back"], secondary: ["quads", "traps", "upper_back", "forearms"], aliases: ["deadlift", "conventional deadlift", "barbell deadlift", "dl"], freeDbId: "Barbell_Deadlift" },
  { name: "Sumo Deadlift (Barbell)", equipment: "barbell", tracking: W, primary: ["glutes", "hamstrings", "adductors"], secondary: ["quads", "lower_back", "traps"], aliases: ["sumo deadlift", "sumo"], freeDbId: "Sumo_Deadlift" },
  { name: "Trap Bar Deadlift", equipment: "trap_bar", tracking: W, primary: ["quads", "glutes", "hamstrings"], secondary: ["lower_back", "traps", "forearms"], aliases: ["hex bar deadlift", "trap bar dl"], freeDbId: "Trap_Bar_Deadlift" },
  { name: "Romanian Deadlift (Barbell)", equipment: "barbell", tracking: W, primary: ["hamstrings", "glutes"], secondary: ["lower_back", "forearms"], aliases: ["rdl", "romanian deadlift", "barbell rdl"], freeDbId: "Romanian_Deadlift" },
  { name: "Romanian Deadlift (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["hamstrings", "glutes"], secondary: ["lower_back"], aliases: ["dumbbell rdl", "db rdl"], freeDbId: "Stiff-Legged_Dumbbell_Deadlift" },
  { name: "Stiff Leg Deadlift (Barbell)", equipment: "barbell", tracking: W, primary: ["hamstrings", "glutes"], secondary: ["lower_back"], aliases: ["stiff leg deadlift", "sldl", "stiff legged deadlift"], freeDbId: "Stiff-Legged_Barbell_Deadlift" },
  { name: "Single Leg Romanian Deadlift (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["hamstrings", "glutes"], secondary: ["lower_back", "abductors"], aliases: ["single leg rdl", "sl rdl"] },
  { name: "Hip Thrust (Barbell)", equipment: "barbell", tracking: W, primary: ["glutes"], secondary: ["hamstrings", "quads"], aliases: ["hip thrust", "barbell hip thrust"], freeDbId: "Barbell_Hip_Thrust" },
  { name: "Hip Thrust (Machine)", equipment: "machine", tracking: W, primary: ["glutes"], secondary: ["hamstrings"], aliases: ["machine hip thrust", "glute drive"] },
  { name: "Glute Bridge", equipment: "bodyweight", tracking: R, primary: ["glutes"], secondary: ["hamstrings"], aliases: ["bridge", "hip bridge"], freeDbId: "Butt_Lift_Bridge" },
  { name: "Glute Bridge (Barbell)", equipment: "barbell", tracking: W, primary: ["glutes"], secondary: ["hamstrings"], aliases: ["barbell glute bridge"], freeDbId: "Barbell_Glute_Bridge" },
  { name: "Glute Kickback (Cable)", equipment: "cable", tracking: W, primary: ["glutes"], secondary: ["hamstrings"], aliases: ["cable kickback", "glute kickback"], freeDbId: "One-Legged_Cable_Kickback" },
  { name: "Hip Abduction (Machine)", equipment: "machine", tracking: W, primary: ["abductors"], secondary: ["glutes"], aliases: ["hip abduction", "abductor machine", "outer thigh machine"], freeDbId: "Thigh_Abductor" },
  { name: "Hip Adduction (Machine)", equipment: "machine", tracking: W, primary: ["adductors"], aliases: ["hip adduction", "adductor machine", "inner thigh machine"], freeDbId: "Thigh_Adductor" },
  { name: "Calf Raise (Machine)", equipment: "machine", tracking: W, primary: ["calves"], aliases: ["calf raise", "standing calf raise machine"], freeDbId: "Standing_Calf_Raises" },
  { name: "Standing Calf Raise (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["calves"], aliases: ["dumbbell calf raise"], freeDbId: "Standing_Dumbbell_Calf_Raise" },
  { name: "Standing Calf Raise (Smith Machine)", equipment: "smith", tracking: W, primary: ["calves"], aliases: ["smith calf raise"], freeDbId: "Smith_Machine_Calf_Raise" },
  { name: "Seated Calf Raise (Machine)", equipment: "machine", tracking: W, primary: ["calves"], aliases: ["seated calf raise"], freeDbId: "Seated_Calf_Raise" },
  { name: "Calf Press (Leg Press)", equipment: "machine", tracking: W, primary: ["calves"], aliases: ["calf press", "leg press calf raise"], freeDbId: "Calf_Press_On_The_Leg_Press_Machine" },

  // ---- arms
  { name: "Bicep Curl (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["biceps"], secondary: ["forearms"], aliases: ["curl", "dumbbell curl", "db curl", "bicep curls"], freeDbId: "Dumbbell_Bicep_Curl" },
  { name: "Bicep Curl (Barbell)", equipment: "barbell", tracking: W, primary: ["biceps"], secondary: ["forearms"], aliases: ["barbell curl", "bb curl"], freeDbId: "Barbell_Curl" },
  { name: "Bicep Curl (EZ Bar)", equipment: "ez_bar", tracking: W, primary: ["biceps"], secondary: ["forearms"], aliases: ["ez bar curl", "ez curl"], freeDbId: "EZ-Bar_Curl" },
  { name: "Bicep Curl (Cable)", equipment: "cable", tracking: W, primary: ["biceps"], secondary: ["forearms"], aliases: ["cable curl"], freeDbId: "Standing_Biceps_Cable_Curl" },
  { name: "Bicep Curl (Machine)", equipment: "machine", tracking: W, primary: ["biceps"], aliases: ["machine curl"], freeDbId: "Machine_Bicep_Curl" },
  { name: "Hammer Curl (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["biceps", "forearms"], aliases: ["hammer curl"], freeDbId: "Hammer_Curls" },
  { name: "Hammer Curl (Cable)", equipment: "cable", tracking: W, primary: ["biceps", "forearms"], aliases: ["rope hammer curl", "cable hammer curl"], freeDbId: "Cable_Hammer_Curls_-_Rope_Attachment" },
  { name: "Incline Curl (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["biceps"], aliases: ["incline dumbbell curl", "incline curl"], freeDbId: "Incline_Dumbbell_Curl" },
  { name: "Preacher Curl (Barbell)", equipment: "barbell", tracking: W, primary: ["biceps"], aliases: ["preacher curl", "ez bar preacher curl"], freeDbId: "Preacher_Curl" },
  { name: "Preacher Curl (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["biceps"], aliases: ["dumbbell preacher curl"], freeDbId: "One_Arm_Dumbbell_Preacher_Curl" },
  { name: "Preacher Curl (Machine)", equipment: "machine", tracking: W, primary: ["biceps"], aliases: ["machine preacher curl"], freeDbId: "Machine_Preacher_Curls" },
  { name: "Concentration Curl (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["biceps"], aliases: ["concentration curl"], freeDbId: "Concentration_Curls" },
  { name: "Spider Curl (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["biceps"], aliases: ["spider curl"] },
  { name: "Reverse Curl (Barbell)", equipment: "barbell", tracking: W, primary: ["forearms", "biceps"], aliases: ["reverse curl", "reverse grip curl"], freeDbId: "Reverse_Barbell_Curl" },
  { name: "Wrist Curl (Barbell)", equipment: "barbell", tracking: W, primary: ["forearms"], aliases: ["wrist curl", "forearm curl"], freeDbId: "Palms-Up_Barbell_Wrist_Curl_Over_A_Bench" },
  { name: "Triceps Pushdown (Cable - Straight Bar)", equipment: "cable", tracking: W, primary: ["triceps"], aliases: ["triceps pushdown", "pushdown", "straight bar pushdown"], freeDbId: "Triceps_Pushdown" },
  { name: "Triceps Pushdown (Cable - Rope)", equipment: "cable", tracking: W, primary: ["triceps"], aliases: ["rope pushdown", "rope tricep pushdown"], freeDbId: "Triceps_Pushdown_-_Rope_Attachment" },
  { name: "Triceps Pushdown (Cable - V Bar)", equipment: "cable", tracking: W, primary: ["triceps"], aliases: ["v bar pushdown"], freeDbId: "Triceps_Pushdown_-_V-Bar_Attachment" },
  { name: "Triceps Extension (Cable)", equipment: "cable", tracking: W, primary: ["triceps"], aliases: ["overhead cable extension", "cable overhead triceps extension", "overhead rope extension"], freeDbId: "Cable_Rope_Overhead_Triceps_Extension" },
  { name: "Triceps Extension (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["triceps"], aliases: ["overhead dumbbell extension", "overhead triceps extension", "french press"], freeDbId: "Standing_Dumbbell_Triceps_Extension" },
  { name: "Triceps Extension (Machine)", equipment: "machine", tracking: W, primary: ["triceps"], aliases: ["machine tricep extension"], freeDbId: "Machine_Triceps_Extension" },
  { name: "Skullcrusher (Barbell)", equipment: "barbell", tracking: W, primary: ["triceps"], aliases: ["skull crusher", "lying triceps extension"], freeDbId: "Lying_Close-Grip_Barbell_Triceps_Extension_Behind_The_Head" },
  { name: "Skullcrusher (EZ Bar)", equipment: "ez_bar", tracking: W, primary: ["triceps"], aliases: ["ez bar skullcrusher"], freeDbId: "EZ-Bar_Skullcrusher" },
  { name: "Skullcrusher (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["triceps"], aliases: ["dumbbell skullcrusher"], freeDbId: "Lying_Dumbbell_Tricep_Extension" },
  { name: "Triceps Kickback (Dumbbell)", equipment: "dumbbell", tracking: W, primary: ["triceps"], aliases: ["tricep kickback", "dumbbell kickback"], freeDbId: "Tricep_Dumbbell_Kickback" },
  { name: "Triceps Dip", equipment: "bodyweight", tracking: WB, primary: ["triceps"], secondary: ["chest", "front_delts"], freeDbId: "Dips_-_Triceps_Version" },
  { name: "Bench Dip", equipment: "bodyweight", tracking: WB, primary: ["triceps"], secondary: ["chest", "front_delts"], freeDbId: "Bench_Dips" },
  { name: "Diamond Push Up", equipment: "bodyweight", tracking: R, primary: ["triceps", "chest"], secondary: ["front_delts"], aliases: ["close grip push up"], freeDbId: "Push-Ups_-_Close_Triceps_Position" },

  // ---- core
  { name: "Plank", equipment: "bodyweight", tracking: D, primary: ["abs"], secondary: ["obliques"], aliases: ["front plank"], freeDbId: "Plank" },
  { name: "Side Plank", equipment: "bodyweight", tracking: D, primary: ["obliques"], secondary: ["abs"], aliases: ["side bridge"], freeDbId: "Side_Bridge" },
  { name: "Crunch", equipment: "bodyweight", tracking: R, primary: ["abs"], aliases: ["ab crunch"], freeDbId: "Crunches" },
  { name: "Cable Crunch", equipment: "cable", tracking: W, primary: ["abs"], aliases: ["kneeling cable crunch", "rope crunch"], freeDbId: "Cable_Crunch" },
  { name: "Crunch (Machine)", equipment: "machine", tracking: W, primary: ["abs"], aliases: ["ab machine", "machine crunch"], freeDbId: "Ab_Crunch_Machine" },
  { name: "Sit Up", equipment: "bodyweight", tracking: R, primary: ["abs"], freeDbId: "Sit-Up" },
  { name: "Decline Crunch", equipment: "bodyweight", tracking: R, primary: ["abs"], freeDbId: "Decline_Crunch" },
  { name: "Hanging Leg Raise", equipment: "bodyweight", tracking: R, primary: ["abs"], secondary: ["obliques"], aliases: ["leg raise", "hanging knee raise", "toes to bar"], freeDbId: "Hanging_Leg_Raise" },
  { name: "Lying Leg Raise", equipment: "bodyweight", tracking: R, primary: ["abs"], aliases: ["floor leg raise"], freeDbId: "Flat_Bench_Lying_Leg_Raise" },
  { name: "Captain's Chair Leg Raise", equipment: "bodyweight", tracking: R, primary: ["abs"], aliases: ["captains chair", "knee raise", "vertical knee raise"], freeDbId: "Knee_Hip_Raise_On_Parallel_Bars" },
  { name: "Ab Wheel", equipment: "other", tracking: R, primary: ["abs"], secondary: ["lats", "obliques"], aliases: ["ab rollout", "ab roller", "rollout"], freeDbId: "Ab_Roller" },
  { name: "Russian Twist", equipment: "bodyweight", tracking: R, primary: ["obliques"], secondary: ["abs"], freeDbId: "Russian_Twist" },
  { name: "Dead Bug", equipment: "bodyweight", tracking: R, primary: ["abs"], freeDbId: "Dead_Bug" },
  { name: "Pallof Press (Cable)", equipment: "cable", tracking: W, primary: ["obliques", "abs"], aliases: ["pallof press", "anti rotation press"], freeDbId: "Pallof_Press" },
  { name: "Woodchopper (Cable)", equipment: "cable", tracking: W, primary: ["obliques"], secondary: ["abs"], aliases: ["woodchop", "cable woodchop", "wood chopper"] },
  { name: "Mountain Climber", equipment: "bodyweight", tracking: R, primary: ["abs"], secondary: ["quads", "front_delts"], freeDbId: "Mountain_Climbers" },

  // ---- kettlebell, carries, full body
  { name: "Kettlebell Swing", equipment: "kettlebell", tracking: W, primary: ["glutes", "hamstrings"], secondary: ["lower_back", "front_delts", "abs"], aliases: ["kb swing", "swings", "russian swing"], freeDbId: "One-Arm_Kettlebell_Swings" },
  { name: "Turkish Get Up (Kettlebell)", equipment: "kettlebell", tracking: W, primary: ["front_delts", "abs"], secondary: ["glutes", "quads", "obliques"], aliases: ["turkish get up", "tgu"], freeDbId: "Kettlebell_Turkish_Get-Up_Squat_style" },
  { name: "Overhead Press (Kettlebell)", equipment: "kettlebell", tracking: W, primary: ["front_delts"], secondary: ["side_delts", "triceps"], aliases: ["kettlebell press", "kb press"], freeDbId: "Two-Arm_Kettlebell_Military_Press" },
  { name: "Farmer's Walk", equipment: "dumbbell", tracking: WD, primary: ["forearms", "traps"], secondary: ["abs", "obliques", "glutes"], aliases: ["farmer carry", "loaded carry"], freeDbId: "Farmers_Walk", category: "strongman" },
  { name: "Sled Push", equipment: "other", tracking: WD, primary: ["quads", "glutes"], secondary: ["calves", "hamstrings"], aliases: ["prowler push"], freeDbId: "Sled_Push", category: "strongman" },
  { name: "Power Clean", equipment: "barbell", tracking: W, primary: ["hamstrings", "glutes", "traps"], secondary: ["quads", "lower_back", "front_delts"], freeDbId: "Power_Clean", category: "olympic" },
  { name: "Clean and Jerk", equipment: "barbell", tracking: W, primary: ["quads", "glutes", "front_delts"], secondary: ["hamstrings", "traps", "triceps"], aliases: ["c&j"], freeDbId: "Clean_and_Jerk", category: "olympic" },
  { name: "Snatch", equipment: "barbell", tracking: W, primary: ["hamstrings", "glutes", "front_delts"], secondary: ["quads", "traps", "lower_back"], aliases: ["full snatch", "squat snatch"], freeDbId: "Snatch", category: "olympic" },
  { name: "Thruster (Barbell)", equipment: "barbell", tracking: W, primary: ["quads", "front_delts"], secondary: ["glutes", "triceps"], aliases: ["thruster"] },
  { name: "Burpee", equipment: "bodyweight", tracking: R, primary: ["quads", "chest"], secondary: ["front_delts", "triceps", "abs"], category: "plyometrics" },
  { name: "Box Jump", equipment: "bodyweight", tracking: R, primary: ["quads", "glutes"], secondary: ["calves", "hamstrings"], freeDbId: "Front_Box_Jump", category: "plyometrics" },
  { name: "Neck Curl (Plate)", equipment: "plate", tracking: W, primary: ["neck"], aliases: ["neck curl", "neck flexion"] },

  // ---- cardio
  { name: "Running (Treadmill)", equipment: "cardio", tracking: DD, primary: ["quads", "hamstrings"], secondary: ["calves", "glutes"], aliases: ["treadmill", "treadmill run"], freeDbId: "Running_Treadmill", category: "cardio" },
  { name: "Running", equipment: "cardio", tracking: DD, primary: ["quads", "hamstrings"], secondary: ["calves", "glutes"], aliases: ["run", "outdoor run", "jog", "jogging"], category: "cardio" },
  { name: "Walking (Treadmill)", equipment: "cardio", tracking: DD, primary: ["quads"], secondary: ["calves", "glutes", "hamstrings"], aliases: ["treadmill walk", "incline walk"], freeDbId: "Walking_Treadmill", category: "cardio" },
  { name: "Walking", equipment: "cardio", tracking: DD, primary: ["quads"], secondary: ["calves", "glutes"], aliases: ["walk"], category: "cardio" },
  { name: "Cycling (Indoor)", equipment: "cardio", tracking: DD, primary: ["quads"], secondary: ["hamstrings", "glutes", "calves"], aliases: ["stationary bike", "exercise bike", "spin bike", "indoor cycling"], freeDbId: "Bicycling_Stationary", category: "cardio" },
  { name: "Cycling", equipment: "cardio", tracking: DD, primary: ["quads"], secondary: ["hamstrings", "glutes", "calves"], aliases: ["bike", "bike ride", "outdoor cycling"], freeDbId: "Bicycling", category: "cardio" },
  { name: "Rowing (Machine)", equipment: "cardio", tracking: DD, primary: ["upper_back", "quads"], secondary: ["lats", "hamstrings", "biceps"], aliases: ["rower", "erg", "concept2"], freeDbId: "Rowing_Stationary", category: "cardio" },
  { name: "Elliptical", equipment: "cardio", tracking: DD, primary: ["quads"], secondary: ["glutes", "hamstrings"], aliases: ["elliptical trainer", "cross trainer"], freeDbId: "Elliptical_Trainer", category: "cardio" },
  { name: "Stair Climber (Machine)", equipment: "cardio", tracking: D, primary: ["quads", "glutes"], secondary: ["calves", "hamstrings"], aliases: ["stairmaster", "stair stepper", "step mill"], freeDbId: "Stairmaster", category: "cardio" },
  { name: "Jump Rope", equipment: "other", tracking: D, primary: ["calves"], secondary: ["quads"], aliases: ["skipping", "rope jumping"], freeDbId: "Rope_Jumping", category: "cardio" },
  { name: "Swimming", equipment: "cardio", tracking: DD, primary: ["lats"], secondary: ["front_delts", "triceps", "abs"], aliases: ["swim"], category: "cardio" },
];

export const CURATED_EXERCISES: readonly Exercise[] = DEFS.map((d) => {
  const ex: Exercise = {
    id: d.id ?? slugify(d.name),
    name: d.name,
    equipment: d.equipment,
    category: d.category ?? (d.equipment === "cardio" ? "cardio" : "strength"),
    tracking: d.tracking,
    primary: d.primary,
    secondary: d.secondary ?? [],
    aliases: d.aliases ?? [],
    curated: true,
  };
  if (d.freeDbId) ex.freeDbId = d.freeDbId;
  return ex;
});
