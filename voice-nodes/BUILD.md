# Ambient Voice Nodes — Weekend Build Checklist

Lane 6 of 6. One weekend, two rooms talking. Target: **~$40/node**,
wake word fully on-device (ESPHome `micro_wake_word`), nothing leaves
the tailnet.

Lane findings this checklist is built on:

- Wake = `micro_wake_word` on the S3, no cloud keyword spotting.
- I2S mic stride: **<10 ms frame / 20 ms stride** keeps "okay nabu"
  detection reliable without starving the loop.
- STT (whisper) + TTS (Piper) run on the Mac over Wyoming; nodes are
  dumb mic/speaker endpoints.

## 0. BOM (~$40/node, prices approx Sep 2026 — verify at checkout)

| Part | Pick | ~Price | Link / search |
| --- | --- | --- | --- |
| ESP32-S3 devkit | ESP32-S3-DevKitC-1 (N8R2, native USB) | $9–12 | [Espressif hw docs](https://docs.espressif.com/projects/hardware/en/latest/esp32s3/esp32-s3-devkitc-1.html) · search "ESP32-S3-DevKitC-1" on [Adafruit](https://www.adafruit.com) / [AliExpress](https://www.aliexpress.com) / [Amazon](https://www.amazon.com) |
| I2S mic | INMP441 breakout | $3–5 | search "INMP441 I2S microphone" on Adafruit / AliExpress / Amazon |
| I2S DAC/amp | MAX98357A breakout | $5–7 | search "MAX98357A I2S amp" on Adafruit / AliExpress / Amazon |
| Speaker | 4 Ω 3 W, 40–57 mm | $4–6 | search "4 ohm 3W speaker 50mm" on AliExpress / Amazon |
| PSU | 5 V 2 A USB-C supply + cable | $8–10 | any branded 5V/2A (Pi shop, Amazon) — no phone-charger lottery |
| Enclosure | 3D-print or 80×80 mm junction box | $0–8 | print it, or search "80x80 junction box" |
| Misc | Mute button + LED, dupont, screws | ~$3 | parts bin |
| **Total** | | **~$37–48/node** | buy 2× everything for the 2-room test |

⚑ One decision before ordering: **DevKitC-1 vs FeatherS3** — Feather costs
~$5 more but the MAX98357A STEMMA wiring is solder-free. Say which and
I'll lock the pinout below.

## Saturday — one node hears its name

### S1. Solder the I2S chain (30–45 min)

INMP441 (input) + MAX98357A (output) share BCLK/WS, separate data lines.
3V3 only — 5 V kills the mic.

| Signal | S3 GPIO (default) | INMP441 | MAX98357A |
| --- | --- | --- | --- |
| BCLK / SCK | GPIO 14 | SCK | BCLK |
| WS / LRCK | GPIO 15 | WS | LRC |
| Mic data | GPIO 16 | SD | — |
| Amp data | GPIO 17 | — | DIN |
| Power | 3V3 + GND | VCC/GND (L/R→GND = left slot) | VIN/GND (gain 9 dB: GAIN→GND) |

Checks: continuity on 3V3/GND first, L/R pin tied (floating = channel
roulette), speaker leads twisted, amp gain jumper set before power.

### S2. Flash ESPHome (30 min)

- Install ESPHome on the Mac (`pip install esphome` or the dashboard).
- `esphome wizard node1.yaml`, board `esp32-s3-devkitc-1`, PSRAM on
  (`octal`, it matters for the wake model).
- Enable `micro_wake_word` with the `okay_nabu` (or `hey_jarvis`) model,
  `i2s_audio` mic at 16 kHz, `media_player` on the MAX98357A.
- `esphome run node1.yaml` over USB. First flash wired; OTA after that.
- Done = node appears in Home Assistant with a media_player entity.

### S3. Tune the wake cutoff (30–60 min, the actual job)

- Start: probability threshold **0.55**, sliding window per defaults.
- Say the wake word 20× from 1 m / 3 m / with TV on. Log hits + misses.
- False wakes in an hour of TV? Raise to 0.65. Misses at 3 m? Drop to
  0.5 and re-test — below 0.5 the TV starts waking it.
- Confirm audio stride stays **<10 ms frame / 20 ms stride**; if logs
  show underruns, the S3 is doing too much — strip everything but
  mic + wake + speaker.
- Ship threshold = the value with ≥19/20 close-range hits and zero
  TV-hour false wakes. Write it down — it differs per room.

### S4. Verify logs, declare Saturday done

- `esphome logs node1.yaml`: wake detections print with probability.
- Clap test: loud claps must NOT trigger (they will at 0.45 — that's
  how you know the tuner is honest).
- Checklist: ☐ boots after power-pull ☐ OTA works ☐ wake chime plays
  on the local speaker ☐ threshold written on tape on the box.

## Sunday — two rooms, one brain

### U1. Wyoming + whisper + Piper on the Mac (45–60 min)

- Run the three Wyoming services (docker or bare): `whisper`
  (base.en is fine to start, small if the Mac breathes easy),
  `piper` + a voice, `openwakeword` NOT needed (wake is on-device).
- Point Home Assistant Voice Assistant at them; set the S3 as the
  satellite (wake on-device → stream to Wyoming on wake only).
- Test from the HA voice panel first: STT text appears, Piper speaks
  back through the laptop. Node joins only after this works.

### U2. Tailscale — the tailnet (15 min)

- Tailscale on the Mac + phone. Nodes stay on LAN talking to HA;
  remote access rides the tailnet, never a port forward.
- Test: phone on cell data → tailnet → HA → ping node1. No open ports
  on the router, ever.

### U3. Herdr duplex prompt (30 min)

- Herdr action: on STT text from a satellite, route to the duplex
  prompt (short spoken reply + optional HA action), reply via Piper
  to the SAME satellite's media_player.
- Keep the prompt tight: one intent per utterance, confirm before
  toggling anything real (locks, alarms, anything with a motor).
- Log every turn (text in, text out, which room) — that's the eval set.

### U4. Two-room test (the demo)

- Flash node2 identically, different name, re-tune threshold in ITS
  room (S3 step — thresholds don't transfer).
- Script: wake node1 → ask time → wake node2 → ask same → cross-talk
  check (node2 must stay silent while node1 talks, and vice versa).
- Pass = 5/5 per room, no cross-wakes, replies come from the right
  ceiling.

### U5. Latency budget (measure, don't guess)

| Leg | Where | Budget | Measure with |
| --- | --- | --- | --- |
| Wake detect → chime | S3 on-device | <500 ms | ESPHome log timestamps |
| Stream open → STT final | Mac whisper | <1.5 s (base.en) | Wyoming log |
| Prompt → reply text | herdr duplex | <1 s | herdr turn log |
| Reply text → first audio | Piper + I2S | <500 ms | HA voice debug |
| **Wake → spoken answer** | end to end | **<3 s** | phone stopwatch, 10 samples |

Over budget? First knob: whisper `tiny` vs `base` (halves STT, costs
accuracy). Second: shorten the duplex prompt's max tokens. The S3 is
never the bottleneck — don't overclock it, fix the Mac side.

## Privacy — GPIO mute, local-first

- **Hardware mute button** (in BOM): momentary switch on a GPIO —
  pressed = mic task suspended + red LED on. No software path around
  it; test by pressing and shouting the wake word (silence = pass).
- **Local-first**: wake on S3, STT/TTS on the Mac, HA local. No cloud
  voice vendor in the loop. Tailnet for remote, no port forwards.
- **No retention**: no audio stored beyond the turn buffer; turn logs
  are text only. Say this out loud before demoing in someone else's
  house.
- Power-pull = full reset to muted-until-boot state is NOT guaranteed —
  confirm the node rejoins silent and re-arms wake itself.

## Done = ?

☐ 2 nodes, 2 rooms, tuned thresholds taped to boxes ☐ <3 s wake→answer
☐ cross-talk test passed ☐ mute buttons tested ☐ turn log has 20+ rows.
Then it graduates from weekend build to house infrastructure.
