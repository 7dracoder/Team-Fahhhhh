// Hybrid pose worker: MediaPipe (default, fast) ↔ YOLOv8 (3+ people)
// Runs entirely off the main thread — UI stays at 60fps regardless of inference speed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _self = self as any;

const YOLO_INPUT_SIZE = 640;
const YOLO_CONF_THRESHOLD = 0.25;
const LOW_COUNT_SWITCH_FRAMES = 8; // consecutive frames with < 3 people before switching back to MP

interface Keypoint { x: number; y: number; conf: number; }
type Posture = "standing" | "sitting" | "lying";
export interface WorkerPose { keypoints: Keypoint[]; score: number; posture: Posture; }

// MediaPipe 33-landmark → COCO 17-keypoint index map
const MP_TO_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// COCO 17-keypoint skeleton connections for YOLOv8 pose
const POSE_CONNECTIONS = [
  [0,1],[0,2],[1,3],[2,4],
  [5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],
  [11,13],[13,15],[12,14],[14,16],
];
void POSE_CONNECTIONS; // used by main thread for drawing, kept here for reference

// classify posture from landmark bounding-box height/width ratio
function classifyPosture(keypoints: Keypoint[]): Posture {
  const visible = keypoints.filter((k) => k.conf > 0.3);
  if (visible.length < 4) return "standing";
  const ys = visible.map((k) => k.y);
  const xs = visible.map((k) => k.x);
  const h = Math.max(...ys) - Math.min(...ys);
  const w = Math.max(...xs) - Math.min(...xs);
  if (w === 0) return "standing";
  const ratio = h / w;
  if (ratio > 1.0) return "standing";
  if (ratio > 0.45) return "sitting";
  return "lying";
}

function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ix1 = Math.max(a[0], b[0]), iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]), iy2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

// decode YOLOv8 pose output — handles both [1,56,8400] and [1,8400,56]
function decodeYoloPose(
  data: Float32Array,
  dims: number[],
  scale: number,
  dx: number,
  dy: number,
  sw: number,
  sh: number,
  confThresh = YOLO_CONF_THRESHOLD,
): WorkerPose[] {
  const [, d1, d2] = dims;
  const transposed = d2 === 56; // [1, 8400, 56] vs [1, 56, 8400]
  const numAnchors = transposed ? d1 : d2;
  const get = (feat: number, anchor: number) =>
    transposed ? data[anchor * 56 + feat] : data[feat * numAnchors + anchor];

  const candidates: Array<{ score: number; box: [number,number,number,number]; keypoints: Keypoint[] }> = [];
  for (let i = 0; i < numAnchors; i++) {
    const score = get(4, i);
    if (score < confThresh) continue;
    const cx = get(0, i), cy = get(1, i), bw = get(2, i), bh = get(3, i);
    const box: [number,number,number,number] = [cx - bw/2, cy - bh/2, cx + bw/2, cy + bh/2];
    const keypoints: Keypoint[] = [];
    for (let k = 0; k < 17; k++) {
      // map from 640×640 letterbox space back to [0,1] fractions of original video
      const kx = (get(5 + k*3,     i) - dx) / scale / sw;
      const ky = (get(5 + k*3 + 1, i) - dy) / scale / sh;
      const kc =  get(5 + k*3 + 2, i);
      keypoints.push({ x: kx, y: ky, conf: kc });
    }
    candidates.push({ score, box, keypoints });
  }

  // greedy NMS
  candidates.sort((a, b) => b.score - a.score);
  const kept: typeof candidates = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(candidates[i]);
    for (let j = i + 1; j < candidates.length; j++) {
      if (!suppressed.has(j) && iou(candidates[i].box, candidates[j].box) > 0.45)
        suppressed.add(j);
    }
  }
  return kept.map(({ score, keypoints }) => ({ score, keypoints, posture: classifyPosture(keypoints) }));
}

// OffscreenCanvas reused across frames for YOLOv8 preprocessing
const yoloCanvas = new OffscreenCanvas(YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
const yoloCtx = yoloCanvas.getContext("2d")!;

function preprocessBitmap(bitmap: ImageBitmap): { data: Float32Array; scale: number; dx: number; dy: number; sw: number; sh: number } {
  const sw = bitmap.width;
  const sh = bitmap.height;
  const scale = Math.min(YOLO_INPUT_SIZE / sw, YOLO_INPUT_SIZE / sh);
  const nw = Math.round(sw * scale);
  const nh = Math.round(sh * scale);
  const dx = (YOLO_INPUT_SIZE - nw) / 2;
  const dy = (YOLO_INPUT_SIZE - nh) / 2;

  yoloCtx.fillStyle = "#808080"; // gray letterbox padding
  yoloCtx.fillRect(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  yoloCtx.drawImage(bitmap, dx, dy, nw, nh);

  const { data } = yoloCtx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  const float32 = new Float32Array(3 * YOLO_INPUT_SIZE * YOLO_INPUT_SIZE);
  const px = YOLO_INPUT_SIZE * YOLO_INPUT_SIZE;
  for (let i = 0; i < px; i++) {
    float32[i]        = data[i * 4]     / 255; // R channel
    float32[px + i]   = data[i * 4 + 1] / 255; // G channel
    float32[2*px + i] = data[i * 4 + 2] / 255; // B channel
  }
  return { data: float32, scale, dx, dy, sw, sh };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mpLandmarker: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let yoloSession: any = null;

type Mode = "mediapipe" | "yolo";
let mode: Mode = "mediapipe";
let lowCountStreak = 0; // consecutive YOLO frames with < 3 people

async function loadMediaPipe() {
  const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm`,
  );
  mpLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 4, // detect up to 4 so we know when to escalate to YOLO
  });
}

async function loadYolo() {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
  yoloSession = await ort.InferenceSession.create(
    "https://huggingface.co/Xenova/yolov8n-pose/resolve/main/onnx/model_quantized.onnx",
    { executionProviders: ["webgpu", "wasm"] },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runMediaPipe(bitmap: ImageBitmap): WorkerPose[] {
  if (!mpLandmarker) return [];
  const result = mpLandmarker.detectForVideo(bitmap, performance.now());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result.landmarks as any[][]).map((landmarks: any[]) => {
    const keypoints: Keypoint[] = MP_TO_COCO.map((mpIdx) => ({
      x: landmarks[mpIdx].x,
      y: landmarks[mpIdx].y,
      conf: landmarks[mpIdx].visibility ?? 1,
    }));
    return { keypoints, score: 1.0, posture: classifyPosture(keypoints) };
  });
}

async function runYolo(bitmap: ImageBitmap): Promise<WorkerPose[]> {
  if (!yoloSession) return [];
  const { data, scale, dx, dy, sw, sh } = preprocessBitmap(bitmap);
  const ort = await import("onnxruntime-web");
  const tensor = new ort.Tensor("float32", data, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
  const result = await yoloSession.run({ images: tensor });
  const outTensor = result[Object.keys(result)[0]];
  return decodeYoloPose(outTensor.data, outTensor.dims, scale, dx, dy, sw, sh);
}

// Serialize YOLO inference — concurrent session.run() calls on a single ONNX session
// are unsafe (especially with WebGPU), so queue them one at a time.
let yoloInferQueue: Promise<void> = Promise.resolve();
function enqueueYolo(bitmap: ImageBitmap): Promise<WorkerPose[]> {
  let resolve!: (poses: WorkerPose[]) => void;
  const result = new Promise<WorkerPose[]>(r => { resolve = r; });
  yoloInferQueue = yoloInferQueue.then(() => runYolo(bitmap).then(resolve).catch(() => resolve([])));
  return result;
}

_self.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data as {
    type: string;
    id?: string;
    bitmap?: ImageBitmap;
  };

  if (msg.type === "force-yolo") {
    if (yoloSession) { mode = "yolo"; lowCountStreak = 0; }
    else loadYolo().then(() => { mode = "yolo"; lowCountStreak = 0; }).catch(() => {});
    return;
  }

  if (msg.type === "load") {
    try {
      await loadMediaPipe();
      _self.postMessage({ type: "ready", mode: "mediapipe" });
      // load YOLOv8 in the background — will be used automatically when 3+ people detected
      loadYolo().catch((err) => console.warn("[YOLOv8 worker] YOLO load failed:", err));
    } catch (err) {
      console.warn("[YOLOv8 worker] MediaPipe load failed:", err);
      _self.postMessage({ type: "load-error", error: String(err) });
    }
    return;
  }

  if (msg.type === "infer" && msg.bitmap) {
    let poses: WorkerPose[];
    const prevMode = mode;

    if (mode === "yolo" && yoloSession) {
      poses = await enqueueYolo(msg.bitmap);
      if (poses.length < 3) {
        lowCountStreak++;
        if (lowCountStreak >= LOW_COUNT_SWITCH_FRAMES) {
          // switch back to MediaPipe — fewer people now
          mode = "mediapipe";
          lowCountStreak = 0;
          _self.postMessage({ type: "mode-change", mode });
        }
      } else {
        lowCountStreak = 0;
      }
    } else {
      // MediaPipe mode (sync, fast)
      poses = runMediaPipe(msg.bitmap);
      // can change depending on how good yolo is
      if (poses.length >= 3 && yoloSession) {
        // escalate to YOLOv8 — 3+ people detected
        mode = "yolo";
        lowCountStreak = 0;
        _self.postMessage({ type: "mode-change", mode });
      }
    }

    void prevMode; // suppress unused warning
    msg.bitmap.close(); // release GPU memory
    _self.postMessage({ type: "poses", id: msg.id, poses });
  }
});
