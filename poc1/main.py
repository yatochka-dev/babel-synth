import time

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from scipy import signal

# ────────────────────────────────────────────────
# CONFIG
# ────────────────────────────────────────────────
BUFFER_SECONDS = 10
MIN_BPM = 42
MAX_BPM = 180

F_LOW = MIN_BPM / 60.0
F_HIGH = MAX_BPM / 60.0

SHOW_FPS = True
SHOW_CONF = True
SHOW_STATUS = True

# Motion / head-turn gating
YAW_THRESH = 0.035  # tweak: lower = stricter (try 0.03–0.05)
MIN_FACE_WIDTH_PX = 80  # if face too small, don’t trust
CONF_THRESH = 0.10  # signal confidence threshold
HOLD_SECONDS_AFTER_BAD = 1.0  # freeze HR briefly after bad frames

# Smoothing
bpm_alpha = 0.15

# ────────────────────────────────────────────────
# Face Landmarker
# ────────────────────────────────────────────────
BaseOptions = python.BaseOptions
FaceLandmarker = vision.FaceLandmarker
FaceLandmarkerOptions = vision.FaceLandmarkerOptions
VisionRunningMode = vision.RunningMode

base_options = BaseOptions(model_asset_path="./face_landmarker.task")
options = FaceLandmarkerOptions(
    base_options=base_options,
    running_mode=VisionRunningMode.VIDEO,
    num_faces=1,
    output_face_blendshapes=False,
    output_facial_transformation_matrixes=False,
)
landmarker = FaceLandmarker.create_from_options(options)


# ────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────
def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def roi_rect(frame, x0, y0, x1, y1):
    h, w = frame.shape[:2]
    x0 = clamp(int(x0), 0, w)
    x1 = clamp(int(x1), 0, w)
    y0 = clamp(int(y0), 0, h)
    y1 = clamp(int(y1), 0, h)
    if x1 <= x0 or y1 <= y0:
        return None
    r = frame[y0:y1, x0:x1]
    return None if r.size == 0 else r


def get_face_box_and_yaw(frame, detection_result):
    """
    Returns:
      (x_min, y_min, x_max, y_max), yaw_metric, ok
    yaw_metric is a simple proxy: (nose_x - mid_eye_x) / face_width
    """
    if not detection_result.face_landmarks:
        return None, 0.0, False

    lms = detection_result.face_landmarks[0]
    h, w = frame.shape[:2]

    # Indices: left face edge, right face edge, forehead top, chin
    idx_left, idx_right, idx_top, idx_bottom = 234, 454, 10, 152
    # Eyes and nose for yaw proxy
    idx_leye, idx_reye, idx_nose = 33, 263, 1  # 1 is nose tip-ish

    try:
        xl = lms[idx_left].x * w
        xr = lms[idx_right].x * w
        yt = lms[idx_top].y * h
        yb = lms[idx_bottom].y * h

        x_le = lms[idx_leye].x * w
        x_re = lms[idx_reye].x * w
        x_n = lms[idx_nose].x * w
    except Exception:
        return None, 0.0, False

    x_min, x_max = sorted([xl, xr])
    y_min, y_max = sorted([yt, yb])

    face_w = x_max - x_min
    face_h = y_max - y_min
    if face_w < MIN_FACE_WIDTH_PX or face_h < MIN_FACE_WIDTH_PX:
        return None, 0.0, False

    mid_eye = 0.5 * (x_le + x_re)
    yaw = (x_n - mid_eye) / face_w  # ~0 when facing forward

    # Slight padding
    pad_x = 0.04 * face_w
    pad_y = 0.03 * face_h
    x_min -= pad_x
    x_max += pad_x
    y_min -= pad_y
    y_max += pad_y

    return (x_min, y_min, x_max, y_max), float(yaw), True


def get_two_cheek_rois(frame, face_box):
    """
    Build two cheek ROIs inside the face box:
    - Use a mid-lower vertical band
    - Split left/right, avoid center nose region
    """
    x_min, y_min, x_max, y_max = face_box
    face_w = x_max - x_min
    face_h = y_max - y_min

    band_top = y_min + 0.42 * face_h
    band_bot = y_min + 0.72 * face_h

    # Avoid central 20% of width
    center_pad = 0.10 * face_w
    left_x0 = x_min + 0.10 * face_w
    left_x1 = x_min + 0.50 * face_w - center_pad

    right_x0 = x_min + 0.50 * face_w + center_pad
    right_x1 = x_min + 0.90 * face_w

    left = roi_rect(frame, left_x0, band_top, left_x1, band_bot)
    right = roi_rect(frame, right_x0, band_top, right_x1, band_bot)
    return left, right


def resample_uniform(ts, x, fs_target):
    ts = np.asarray(ts, dtype=np.float64)
    x = np.asarray(x, dtype=np.float64)
    if len(ts) < 10:
        return None, None

    order = np.argsort(ts)
    ts = ts[order]
    x = x[order]

    dt = np.diff(ts)
    keep = np.hstack(([True], dt > 1e-6))
    ts = ts[keep]
    x = x[keep]
    if len(ts) < 10:
        return None, None

    dur = ts[-1] - ts[0]
    if dur < 5.0:
        return None, None

    n = int(dur * fs_target)
    if n < 128:
        return None, None

    t_u = np.linspace(ts[0], ts[-1], n)
    x_u = np.interp(t_u, ts, x)
    return t_u, x_u


def bandpass_filter(x, fs, f_low, f_high):
    x = signal.detrend(x)
    sos = signal.butter(4, [f_low, f_high], btype="bandpass", fs=fs, output="sos")
    return signal.sosfiltfilt(sos, x)


def bpm_from_psd(x, fs, f_low, f_high):
    nperseg = min(len(x), int(fs * 6))
    if nperseg < 64:
        return None, None

    f, pxx = signal.welch(x, fs=fs, nperseg=nperseg, noverlap=nperseg // 2)
    band = (f >= f_low) & (f <= f_high)
    if not np.any(band):
        return None, None

    f_band = f[band]
    p_band = pxx[band]
    if np.all(p_band <= 0):
        return None, None

    i = int(np.argmax(p_band))
    bpm = float(f_band[i] * 60.0)

    total = float(np.sum(p_band) + 1e-12)
    conf = float(p_band[i] / total)
    return bpm, conf


# ────────────────────────────────────────────────
# MAIN
# ────────────────────────────────────────────────
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("Cannot open webcam")
    raise SystemExit(1)

print("Press 'q' to quit")

t0 = time.perf_counter()
fps_start = time.perf_counter()
frame_count = 0
fps = 0.0

ts_list = []
g_list = []

bpm_display = None
conf_display = 0.0
last_good_time = 0.0
hold_until = 0.0

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    now = time.perf_counter()
    timestamp_ms = int((now - t0) * 1000)

    # FPS
    frame_count += 1
    dt = now - fps_start
    if dt >= 1.0:
        fps = frame_count / dt
        frame_count = 0
        fps_start = now

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    result = landmarker.detect_for_video(mp_image, timestamp_ms)

    face_box, yaw, ok = get_face_box_and_yaw(frame, result)
    face_detected = ok and (face_box is not None)

    status = "NO FACE"
    can_sample = False

    if face_detected:
        # Head-turn gate
        if abs(yaw) > YAW_THRESH:
            status = f"TURNING (yaw={yaw:+.3f})"
            can_sample = False
        else:
            status = "OK"
            can_sample = True

    # Collect green signal only when stable
    if can_sample:
        left, right = get_two_cheek_rois(frame, face_box)
        if left is None or right is None:
            can_sample = False
            status = "ROI FAIL"
        else:
            g = 0.5 * (float(np.mean(left[:, :, 1])) + float(np.mean(right[:, :, 1])))
            ts_list.append(now)
            g_list.append(g)

            cutoff = now - BUFFER_SECONDS
            while ts_list and ts_list[0] < cutoff:
                ts_list.pop(0)
                g_list.pop(0)

    # BPM compute
    current_bpm = "--"

    if len(ts_list) >= 80:
        dts = np.diff(np.asarray(ts_list, dtype=np.float64))
        dts = dts[dts > 1e-6]
        if len(dts) > 10:
            fs_est = 1.0 / float(np.mean(dts))
            fs_resample = float(np.clip(fs_est, 20.0, 60.0))

            t_u, x_u = resample_uniform(ts_list, g_list, fs_resample)
            if x_u is not None and len(x_u) >= int(fs_resample * 6):
                ysig = bandpass_filter(x_u, fs_resample, F_LOW, F_HIGH)
                if np.std(ysig) > 1e-8:
                    ysig = (ysig - np.mean(ysig)) / np.std(ysig)
                    bpm, conf = bpm_from_psd(ysig, fs_resample, F_LOW, F_HIGH)

                    if bpm is not None and MIN_BPM <= bpm <= MAX_BPM:
                        # If confidence is low, don't update (prevents fake drops)
                        conf_display = 0.8 * conf_display + 0.2 * conf
                        if conf_display >= CONF_THRESH and now >= hold_until:
                            if bpm_display is None:
                                bpm_display = bpm
                            else:
                                bpm_display = (
                                    1.0 - bpm_alpha
                                ) * bpm_display + bpm_alpha * bpm
                            last_good_time = now
                        else:
                            # freeze for a bit after bad confidence
                            hold_until = max(hold_until, now + HOLD_SECONDS_AFTER_BAD)

    if bpm_display is not None:
        current_bpm = f"{bpm_display:.1f}"

    # Display colors
    good = (bpm_display is not None) and (now - last_good_time < 2.0)
    color = (0, 255, 0) if good else (0, 165, 255) if face_detected else (0, 0, 255)

    cv2.putText(
        frame,
        f"HR: {current_bpm} BPM",
        (20, 60),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.2,
        color,
        3,
    )

    if SHOW_CONF:
        cv2.putText(
            frame,
            f"Signal: {conf_display:.2f}",
            (20, 100),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 200, 0),
            2,
        )

    if SHOW_FPS:
        cv2.putText(
            frame,
            f"FPS: {fps:.1f}",
            (20, 140),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 200, 0),
            2,
        )

    if SHOW_STATUS:
        cv2.putText(
            frame,
            f"{status}",
            (20, 180),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (200, 255, 200),
            2,
        )

    # Optional: draw face box
    if face_detected:
        x0, y0, x1, y1 = map(int, face_box)
        cv2.rectangle(frame, (x0, y0), (x1, y1), (180, 180, 180), 1)

    cv2.imshow("rPPG (Gated + 2-Cheek ROI)", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
landmarker.close()
