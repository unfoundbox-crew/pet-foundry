# SCENE_SPEC — garage-vision (v1)

Goal: FZ-E build QA visualizer. Shows what the camera checks: torque stripes, weld spots, parts-bin count.

## Units & frame
- Units: millimeters. Origin: workbench center. Camera frustum shown, not simulated.

## Slots
- `camera_elp`: OV9281 module + frustum cone (1280x800 FOV) + mount arm.
- `bench_bike_zone`: frame triangle ghost + 3 check markers:
  - `check_torque`: bolt + yellow stripe decals, pass = continuous.
  - `check_weld`: 6 spot markers per joint (dia 4-7mm), pass = all present.
  - `check_bin`: bin box + count readout vs BOM qty.
- `verdict_bar`: PASS/FAIL per check + photo-log button (stub).

## Cameras
- `CAM_OVERHEAD`: bin counting view.
- `CAM_CLOSEUP`: torque/weld macro view.
- `CAM_PERSP`: whole station hero.

## Palette
- Bench: zinc. Pass: green #16a34a. Fail: red #dc2626. Markers: amber #f59e0b.

## Build order
1. bench + camera → 2. checks → 3. verdict bar.

## QA
- All 3 checks + verdict visible at thumbnail.
- Preset: `garage.json`.

## Out of scope v1
Live camera feed (static geometry first), YOLO overlay (v2, Mac-side).
