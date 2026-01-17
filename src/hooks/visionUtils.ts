// src/hooks/visionUtils.ts
import { FilesetResolver } from "@mediapipe/tasks-vision";

export async function getVision() {
  return FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
  );
}
