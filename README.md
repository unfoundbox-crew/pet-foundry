# pet-foundry

Agentic-driven hardware / co-design tinkering prototypes. Small chips, big attitudes. Private while it cooks.

## Prototypes

| # | Build | BOM | First step |
|---|---|---|---|
| 1 | Ambient voice nodes | ~$40/node (S3 + INMP441 + MAX98357A) | ESPHome microWakeWord → tailnet → herdr duplex |
| 2 | See-and-do pendant | ~$25-30 (XIAO S3 Sense + LiPo) | capture → SmolVLM caption on Mac → Notes.md |
| 3 | Self-writing home | ~$420/2BR (HA Green + Matter) | 1 presence sensor, one auto-off automation |
| 4 | Health coach | ~$430-600 kit | HealthKit trends → on-device spoken brief |
| 5 | Garage vision QA | ~$130 (ELP cam + ring + arm) | torque-stripe template match, photo log |
| 6 | Farm nodes | ~$60/node (S3 + LoRa + solar) | soil + vibe anomaly → SMS via tailnet |
| 7 | Companion toy | ~$35-45 (S3 + mic + amp) | ESP-SR "Hi Buddy" + SD stories |
| 8 | Foundry loop (CFU → silicon) | ~$520-600 (ECP5 + €70 tile + $300 token) | Amaranth MAC → Verilator → nextpnr → GDS |

Plus: **FZ-E Rajsamand** — 2011 FZ-S → electric neo-bobber (72V 4.8kWh / 96V 6.1kWh). See `fz-e/`.

## Co-design lanes (no beefy GPUs)

- `codesign/open-eda` — Yosys/OpenROAD, TinyTapeout €70 tile path
- `codesign/fpga` — Tang 9K ($19) + ECP5 ($50) starter kit
- `codesign/riscv` — CFU-Playground 5× inner-loop cut, Renode-only
- `codesign/tinyml` — MLX vs llama.cpp measure-first, S3 wake
- `codesign/sim` — MAESTRO → Timeloop → SCALE-Sim → $2 Vast anchor

## Design stack (decided)

- **Web viewer**: three.js (WebGPU default, WebGL2 fallback), one `EnclosureViewer`, STEP→GLB offline. First file: `viewer/app.js`.
- **Spec process**: realengine — `SCENE_SPEC.md` contract → web backend. First demo: FZ-E pack envelope viewer.
- **CAD→render**: FreeCAD STEP → Blender (Eevee draft, Cycles master) → glTF/PNG/STL. First script: `tools/step_to_blend.py`.

## Map

- `viewer/` — three.js EnclosureViewer
- `scenes/` — realengine SCENE_SPEC + presets per prototype
- `tools/` — step_to_blend.py, bom helpers
- `assets/<proto>/` — STEP, STL, glTF, renders
- `fz-e/` — Rajsamand conversion (specs, roadmap, suppliers)
- `codesign/` — lane notes + measurements

Sister board: tokenomics (compute leases, spot truth) lives alongside agentworth — ask the human.
