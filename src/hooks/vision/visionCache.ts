import { FilesetResolver } from "@mediapipe/tasks-vision";

let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null =
  null;

export function getVision() {
  visionPromise ??= FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
  );
  return visionPromise;
}
