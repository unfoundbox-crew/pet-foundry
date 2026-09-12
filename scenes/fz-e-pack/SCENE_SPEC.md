# SCENE_SPEC — fz-e-pack (v1)

Goal: FZ-E battery envelope viewer. Answers "does the pack fit the triangle" before metal is cut.

## Units & frame
- Units: millimeters. Origin: steering-head center, ground plane y=0. Bike faces +X.

## Slots (all bound, loud fail otherwise)
- `frame_triangle`: diamond-frame polyline (3 tubes as cylinders) + dims.
- `pack_72v`: box 280x180x200 + mass 32kg marker (low, central).
- `pack_96v`: box 430x280x200 + mass 42kg marker. Toggle vs 72V, never both.
- `controller_box`, `motor_qs138`: placeholder boxes with mounts.
- `clearance`: min gap readout (pack-to-tube), red if <10mm.

## Cameras
- `CAM_SIDE`: orthographic-ish side elevation with dims.
- `CAM_TOP`: top-down CG marker (battery centroid vs wheelbase).
- `CAM_PERSP`: 3/4 hero, studio HDRI.

## Palette
- Frame: zinc #52525b. Pack: violet accent #7c6bb3. Interference: red #dc2626. Per house tokens.

## Build order (gapless)
1. frame → 2. pack → 3. controller/motor → 4. clearance check → 5. CG marker.

## QA
- Labels: pack dims + clearance + CG present at thumbnail.
- No overlap of dims text at 400px wide.
- Preset: `fz-e.json` (72V default, 96V toggle).

## Out of scope v1
Blender path, thermal overlay (v2), real STEP import (placeholder boxes first, STEP via tools/step_to_blend.py in v2).
