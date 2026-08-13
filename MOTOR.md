# Trolling motor link — Minn Kota Terrova (2023+ Advanced GPS Navigation)

How to make FishApp talk to the motor, using only an iPhone and a Windows PC. Nothing to buy.

## Read this first

A trolling motor is a propeller that this code can start. Everything below is done with the
**prop out of the water**, on the trailer or a stand, with the foot pedal in reach. The
software interlocks in `js/motor.js` (arm gate, deadman, auto-stop on backgrounding) are real,
but they run in a browser on a phone that can lock or be killed without warning — they are
best-effort, not a guarantee. The foot pedal and the physical remote are the only true kill.

Reverse engineering a device you own, to make your own software interoperate with it, is
broadly defensible. The One-Boat Network app's terms probably forbid it anyway. Keep this
personal, don't redistribute captures or decoded frames. Not legal advice.

## Why there's a capture step at all

Johnson Outdoors publishes no SDK and no protocol, and there is no prior public work to build
on. On top of that, **Web Bluetooth only hands you services you named in advance** —
`getPrimaryServices()` returns what was granted, not what exists. A proprietary 128-bit service
UUID cannot be guessed or discovered from the browser.

So the capture is not optional and it is not a shortcut. It is the only way to learn the UUIDs.
Until you have them, the Trolling Motor panel connects and shows you nothing, correctly.

The good news: an HCI capture is taken **between the phone's host stack and its Bluetooth
controller**, which is *below* your app but *above* link-layer encryption. BLE pairing/bonding
encryption is therefore not a barrier — you see plaintext ATT operations. Only application-layer
crypto inside the payload would hide anything, and you'll know within minutes if that's the case.

---

## Step 1 — Turn on Bluetooth logging (iPhone)

1. On the iPhone, open Safari → `developer.apple.com/bug-reporting/profiles-and-logs/`
2. Sign in with your normal Apple ID. A **free** account is enough; you are not enrolling in
   anything paid.
3. Find the **Bluetooth** profile and download it.
4. **Settings → General → VPN & Device Management** → install the downloaded profile.
5. **Reboot the phone.** The logging doesn't engage until you do, and skipping this is the
   single most common reason people end up with an empty capture.

## Step 2 — Run a scripted session

Prop out of the water. Motor powered. Then, with the **One-Boat Network app**:

1. Pair to the motor (hold PAIR on the control head; it appears as `Minn Kota Controller 4.0`).
2. Now perform **one action at a time, roughly 5 seconds apart**, and write down what you did
   in order on paper. The pauses are what make the bytes readable — back-to-back actions
   produce an undecodable smear.

A good first script:

```
idle 10s (baseline — this is what "nothing happening" looks like)
Spot-Lock ON
idle 5s
Spot-Lock OFF
idle 5s
prop speed 1
prop speed 2
prop speed 3
prop speed 1
idle 5s
steer left (one tap)
steer right (one tap)
idle 10s
```

Do the *same* action more than once. A frame that repeats identically for "Spot-Lock ON" is
confirmed; one you only saw once might be a coincidence.

## Step 3 — Pull the log off the phone

1. **Immediately** after the session: press and hold **both volume buttons + the side button**
   for about 1.5 seconds, then release. There's no visible confirmation; this is normal.
2. Wait ~5 minutes for the phone to assemble it.
3. **Settings → Privacy & Security → Analytics & Improvements → Analytics Data**
4. Scroll to `sysdiagnose_<date>…`, tap it, then the share button → save to Files, or mail it
   to yourself. Either way you now have a `.tar.gz` you can get onto the PC.

## Step 4 — Extract and open on Windows

Windows 10+ has `tar` built in:

```bash
tar -xzf sysdiagnose_2026.08.13.tar.gz
```

Inside the extracted folder, find the **bluetooth** directory. It contains `.pklg` files —
Apple PacketLogger format.

Install [Wireshark](https://www.wireshark.org/) (free) and open the `.pklg` directly. Wireshark
reads PacketLogger natively; you do not need a Mac and you do not need Apple's PacketLogger app.

## Step 5 — Find the protocol

In Wireshark's filter bar:

```
btatt
```

That narrows to GATT traffic. What you're looking for:

| What you see | What it means |
|---|---|
| `Find Information Response` / `Read By Group Type Response` near the start | The service discovery. **This is your UUID map** — handles ↔ UUIDs. |
| `Write Request` / `Write Command` | The app commanding the motor. Note the **Handle** and the **Value**. |
| `Handle Value Notification` | The motor reporting back — heading, speed, battery, Spot-Lock state. |

Work backwards from your paper log. The write that lands ~2s after you wrote "Spot-Lock ON" is
the Spot-Lock frame. Cross-reference the handle against the discovery packets to get the
characteristic UUID, and the service it sits under.

**The two decision points:**

- **If the ATT values look structured and repeat identically for the same action** — you're in
  business. Move to step 6.
- **If the same button produces different bytes every time**, that's application-layer crypto or
  a rolling counter/auth scheme. That's a materially bigger project and I'd stop here rather
  than sink weeks into it.
- **If you see no `btatt` at all** but do see RFCOMM/SPP traffic, the motor is using Bluetooth
  **Classic**, not LE. Web Bluetooth cannot do Classic at all, and Bluefy can't help — an
  ESP32 bridge box would be the only route, and that means buying hardware.

## Step 6 — Load it into FishApp

Open FishApp in **Bluefy** (free, App Store — Safari has no Web Bluetooth and never has), then
**More → Trolling Motor**:

1. Paste the **service**, **write** and **notify** UUIDs into section 3, save.
2. Tap **Connect**. The log should now print the full GATT tree and subscribe to every notify
   characteristic. Frames start streaming.
3. Drive the motor with the *real remote* while watching the log — that's how you decode
   telemetry. Use **⏺ Record frames** and **★ Mark what I just did** to timestamp your actions
   against the bytes, then **⇩ Export session** to study it later.
4. Add each decoded command with **➕ Add captured command**. Answer **yes** to "can this move
   the boat" for anything that touches prop or steering — that flags it so it can only fire
   when the link is armed, and only after a confirm.

## Step 7 — First live test

In this order, no skipping:

1. **Prop out of the water.** Boat on the trailer.
2. Send a read-only / status frame first. Confirm the motor responds as expected.
3. Send one *danger* frame with the prop still dry. Watch the motor respond. Confirm **STOP**
   takes it back.
4. Let the deadman expire on purpose — walk away for 20 seconds and confirm it disarms itself.
5. Background the app on purpose and confirm it disarms.
6. Only then, in open water, well clear of anything, with a hand on the foot pedal.

---

## Current status

`js/motor.js` ships with **no protocol knowledge at all** — no UUIDs, no frames, nothing
invented. It is the transport, the recon workbench, and the safety cage. Everything it sends is
something you captured and saved yourself. That's deliberate: the alternative is guessed frames
going to a machine that moves a boat.
