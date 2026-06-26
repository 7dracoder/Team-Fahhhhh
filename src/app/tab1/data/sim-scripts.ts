import type { Patient } from "@/app/tab1/types";

export interface ScriptEntry {
  delayMs: number; // ms after video starts to fire this analysis result
  analysisMs?: number; // how long the "Analyzing" spinner shows (default 1400ms)
  patients: Omit<Patient, "firstSeen" | "lastSeen" | "cameraLabel" | "thumbnail">[];
  // optional per-patient image paths (relative to /public). index matches patients array.
  // e.g. ["/sim_thumbnails/man-convulsing.jpg", null] — null falls back to live video crop.
  thumbnails?: (string | null)[];
}

// Pre-built analysis results for specific simulation videos.
// Pose skeleton overlay runs live via YOLO on the actual video frames.
export const SIM_SCRIPTS: Record<string, ScriptEntry[]> = {
  "doctor's office waiting room 2.mp4": [
    {
      delayMs: 1000,
      analysisMs: 1000,
      patients: [
        {
          id: "woman blond hair sitting",
          location: "waiting area",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, calling and sitting in chair.",
          confidence: 0.95
        },
        {
          id: "male doctor talking",
          location: "waiting area",
          posture: "standing",
          movement: "slow",
          visible_distress: false,
          triage: "STABLE",
          reason: "Doctor appears stable, standing and talking.",
          confidence: 0.8
        },
        {
          id: "female doctor standing",
          location: "waiting area",
          posture: "standing",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Doctor appears stable, standing and resting in waiting room.",
          confidence: 0.85
        },
      ],
      thumbnails: ["/thumbnails/woman_calling.png","/thumbnails/male_doctor.png","/thumbnails/female_doctor.png"],
    },
  ],
  "hospital lobby 1.mov": [
    {
      delayMs: 200,
      analysisMs: 800,
      patients: [
        {
          id: "woman white jacket sitting",
          location: "lobby area",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, resting and sitting in chair.",
          confidence: 0.97
        },
        {
          id: "person dark clothing sitting",
          location: "lobby area",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, turned away and resting in chair.",
          confidence: 0.97
        },
        {
          id: "man blue jeans sitting",
          location: "lobby area",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, leaning over and sitting in chair.",
          confidence: 0.97
        },
      ],
      thumbnails: ["/thumbnails/woman_white_jacket.png", "/thumbnails/man_gru.png", "/thumbnails/man_ben_dover.png",],
    },
  ],
  "hospital lobby 2.mp4": [
    {
      delayMs: 1600,
      analysisMs: 1000,
      patients: [
        {
          id: "Person Far Right Hallway",
          location: "lobby area",
          posture: "standing",
          movement: "active",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, moving and walking into lobby area.",
          confidence: 0.85
        },
      ],
      thumbnails: ["/thumbnails/man_walking.png"],
    },
  ],
  "hospital waiting room 1.mp4": [
    {
      delayMs: 5500,
      analysisMs: 1000,
      patients: [
        {
          id: "man convulsing floor",
          location: "waiting area floor",
          posture: "lying",
          movement: "active",
          visible_distress: true,
          triage: "CRITICAL",
          reason: "Patient in active seizure on the floor, convulsing — immediate intervention required.",
          confidence: 0.97
        },
      ],
      thumbnails: ["/thumbnails/man_convulsing.jpg"],
    },
    {
      delayMs: 7500,
      analysisMs: 1400,
      patients: [
        {
          id: "man convulsing floor",
          location: "waiting area floor",
          posture: "lying",
          movement: "slow",
          visible_distress: true,
          triage: "CRITICAL",
          reason: "Seizure patient still on floor, post-ictal state — requires immediate care.",
          confidence: 0.95,
        },
      ],
    },
  ],
  "hospital waiting room 2.mp4": [
    {
      delayMs: 800,
      analysisMs: 1600,
      patients: [
        {
          id: "bearded man dark jacket",
          location: "right seating row",
          posture: "sitting",
          movement: "slow",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, resting with his hand against the chest.",
          confidence: 0.7,
        },
        {
          id: "woman gray sweater",
          location: "center waiting area",
          posture: "sitting",
          movement: "slow",
          visible_distress: false,
          triage: "MONITORING",
          reason: "Patient repeatedly blowing nose, appears to have a cold or mild respiratory illness.",
          confidence: 0.88,
        },
      ],
      thumbnails: ["/thumbnails/man_heart_attack.png", "/thumbnails/woman_nose_blowing.png"],
    },
    {
      delayMs: 5000,
      analysisMs: 800,
      patients: [
        {
          id: "bearded man dark jacket",
          location: "right seating row",
          posture: "sitting",
          movement: "slow",
          visible_distress: true,
          triage: "URGENT",
          reason: "Patient appears pale and is holding chest, possible cardiac event — monitor closely.",
          confidence: 0.85,
        },
        {
          id: "woman gray sweater",
          location: "center waiting area",
          posture: "sitting",
          movement: "slow",
          visible_distress: false,
          triage: "MONITORING",
          reason: "Patient standing up, and slowly walking away from rest area.",
          confidence: 0.9,
        },
      ],
    },
  ],
  "hospital waiting room 3.mp4": [
    {
      delayMs: 1200,
      analysisMs: 1000,
      patients: [
        {
          id: "Person Right Side Seated",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Woman Far Left Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
      ],
      thumbnails: ["/thumbnails/man_far_right.png", "/thumbnails/woman_far_left.png"],
    },
    {
      delayMs: 4500,
      analysisMs: 800,
      patients: [
        {
          id: "Person Right Side Seated",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Woman Far Left Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Doctor Blue Shirt Center",
          location: "waiting room",
          posture: "standing",
          movement: "slow",
          visible_distress: false,
          triage: "STABLE",
          reason: "Doctor appears stable, standing and walking in waiting room.",
          confidence: 0.85
        },
      ],
      thumbnails: ["/thumbnails/man_far_right.png", "/thumbnails/woman_far_left.png", "/thumbnails/doctor_blue.png"],
    },
  ],
  "hospital waiting room 4.mp4": [
    {
      delayMs: 1200,
      analysisMs: 1000,
      patients: [
        {
          id: "Man Right Side Seated",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Person Center Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Woman Teal Shirt Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Man Far Left Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
      ],
      thumbnails: ["/thumbnails/man_right_1.png", "/thumbnails/woman_center_1.png","/thumbnails/woman_left_2.png", "/thumbnails/man_left_2.png"],
    },
  ],
  "hospital waiting room 5.mp4": [
    {
      delayMs: 1400,
      analysisMs: 1300,
      patients: [
        {
          id: "Boy Far Right Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Nurse appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
        {
          id: "Nurse White Shirt Sitting",
          location: "waiting room",
          posture: "sitting",
          movement: "none",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears stable, sitting and resting in waiting room.",
          confidence: 0.95
        },
      ],
      thumbnails: ["/thumbnails/boy_far_right.png", "/thumbnails/nurse_back.png",],
    },
  ],
  "hospital waiting room 6.mp4": [
    {
      delayMs: 900,
      analysisMs: 1000,
      patients: [
        {
          id: "Man Dark Outfit Walking",
          location: "waiting room",
          posture: "standing",
          movement: "active",
          visible_distress: false,
          triage: "STABLE",
          reason: "Patient appears to be stable, walking down hallway.",
          confidence: 0.85
        },
      ],
      thumbnails: ["/thumbnails/police_man.png",],
    },
  ]
};
