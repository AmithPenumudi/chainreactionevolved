# Releasing to Google Play

Everything needed to ship a build, and the answers to the Console's questions. `TESTING.md`
covers what to verify first; this covers getting it into the store.

---

## 1. Build the bundle

```bash
npm run release:bump -- patch   # or minor / major / 1.2.3 / nothing at all
npm run release:android
```

`release:bump` raises `versionCode` in `android/version.properties` (always) and `versionName`
in `package.json` (when asked). `release:android` then runs the whole chain — web assets, cap
sync, `bundleRelease` — and **verifies the result is actually signed** before telling you it
worked. An unsigned bundle builds perfectly happily and is only rejected once you reach the
Console, having already spent a `versionCode`.

The output lands at `android/app/build/outputs/bundle/release/app-release.aab`.

> **`versionCode` is one-way.** Play rejects any upload whose code is not strictly greater than
> every code uploaded before, and a number can never be reused — not after a rejected review,
> not after you delete a draft. When in doubt, bump it again; they are free.

### Before the first upload

Back up `android/keystore/release.keystore` **and** `keystore.properties` somewhere outside this
machine. They are deliberately not in git. The key is valid until 2054, and Play App Signing
gives you a recovery path, but losing the upload key without a backup is a genuinely bad day.

---

## 2. Store listing assets

```bash
npm run store-assets        # icon-512.png + feature-graphic.png
npm run store-screenshots   # drives the real app on a running emulator/device
```

Both write into `store/`. The icon is composited from the launcher icon the app actually ships,
so the store and the home screen cannot drift apart. Screenshots are captured from a live
match — the system status and gesture bars are cropped out of the captured pixels, without
changing any setting on the device.

Requires the **debug** APK installed and running: DevTools only attaches to a debuggable
WebView. The layout is identical in the release build.

| Slot              | Requirement         | File                        |
| ----------------- | ------------------- | --------------------------- |
| App icon          | 512×512, 32-bit PNG | `store/icon-512.png`        |
| Feature graphic   | 1024×500            | `store/feature-graphic.png` |
| Phone screenshots | 2–8, 16:9 to 9:16   | `store/screenshots/*.png`   |

---

## 3. Listing copy

**Short description** (80 characters max):

```
Explosive grid strategy. Place orbs, trigger chain reactions, take the board.
```

**Full description** (4000 characters max):

```
Every move can set off an explosion.

Chain Reaction: Evolved is a turn-based strategy game about pressure. Place an orb in a cell;
when a cell holds more than it can take, it detonates into its neighbours, capturing them — and
those cells can detonate too. One well-placed orb can cascade across half the board and flip a
losing position in a single turn.

THREE MODES
• CLASSIC — pure strategy. No powers, no special tiles. Just the board and the chain.
• ABILITIES — build energy as you play, then spend it on shields, EMPs, double drops and more.
• ARENA — fight across boards with portals, walls, amplifiers and dead zones.

Plus rule variants inside Classic: timed Blitz turns, and Sudden Death, where the board shrinks
around you every few rounds.

PLAY YOUR WAY
• Up to 8 players on one device — pass and play.
• Offline bots at three difficulties, from a forgiving opponent to one that reads your chains.
• 30 hand-built puzzles with a fixed solution and a medal for finding it in the fewest moves.
• Daily challenges that rotate every day.

BUILT TO BE PLAYED ANYWHERE
• Works fully offline. No connection needed, ever.
• No ads. No trackers. No sign-up.
• Board sizes from 6×9 up to 10×15, with a zoom for the larger boards.
• Screen-reader labels on every cell, a reduced-motion setting, and distinct symbols per player
  so colour is never the only difference.

Your progress — experience, streaks, puzzle medals and challenge rewards — is backed up
anonymously so it survives between sessions. No account to create, no email to hand over.
```

---

## 4. Data safety

These answers describe what the code does **today**. If sync or metrics change, the answers
change with them — `src/lib/__tests__/release-wiring.test.ts` fails if the game starts writing
a table the policy does not cover.

**Does the app collect or share user data?** Yes, collect. **Nothing is shared** with anyone.

| Data type                         | Collected | Shared | Optional? | Purpose           |
| --------------------------------- | --------- | ------ | --------- | ----------------- |
| Personal info → User IDs          | Yes       | No     | Required  | App functionality |
| Personal info → Name              | Yes       | No     | Required  | App functionality |
| App activity → Other user actions | Yes       | No     | Required  | App functionality |

- **User IDs** — the anonymous account identifier. No email, no password, nothing linking it to
  a person.
- **Name** — the display name the player chooses for their profile. Declared because Play counts
  a self-chosen nickname under "Name", even though the game never asks for a real one.
- **Other user actions** — experience, win/loss counts, streaks, recent match results, puzzle
  medals and challenge progress.

Then:

- **Is data encrypted in transit?** Yes — HTTPS to Supabase.
- **Can users request deletion?** Yes. Uninstalling ends access to the backup, and there is a
  contact address in the policy for deleting a stored copy.

**Answer "No" to**, because the game genuinely does none of it: location, financial info,
health, messages, photos, videos, audio, files, contacts, calendar, search history, installed
apps, purchase history, and **crash logs and diagnostics** — the crash log stays on the device
and is only ever shared if a player copies it into a bug report themselves.

### Not collected, worth knowing

`src/game/metrics/activity.ts` exists and is tested, but **nothing imports it**, so no activity
or session metrics are uploaded today. If it is ever wired up, the Data safety form needs an
"App activity → App interactions" entry and the privacy policy needs a matching line, in the
same commit.

---

## 5. Privacy policy

Play requires a policy at a URL reachable without installing the app. The web build serves one
at **`/privacy`**, from the same source as the in-app copy (Settings → Support → Privacy policy),
so the two cannot disagree.

Deploy the web build and use `https://<your-domain>/privacy`.

> **The mailbox must exist before you deploy.** The policy publishes
> `chainreactionevolved@gmail.com` (set in `src/content/privacy.ts`) as the deletion-request
> route, on a public page and inside the app. Play requires that route to work, so register the
> account first — and if the name turns out to be taken, change the constant to whatever you
> did register. It is deliberately a project address rather than a personal one: a contact line
> on a public page gets scraped, and player mail is easier to deal with away from a personal
> inbox.

---

## 6. Content rating

Answer the questionnaire honestly; for this game the answers are all "no": no violence, no
sexual content, no profanity, no drugs, no gambling, no user-to-user communication, no
user-generated content shared between players, no ads. That lands at "Everyone" / PEGI 3.

---

## 7. Testing track

A developer account registered as an **individual** (rather than an organisation) generally has
to run a closed test — around 12 testers, opted in, for 14 continuous days — before it can apply
for production access. Check the current rule in the Console: it has changed more than once, and
it is a two-week floor on the timeline rather than a formality.

Plan for: internal testing → closed testing (the 14 days) → production.

---

## 8. Before you upload

- [ ] `npm test` — the full suite
- [ ] `npm run lint` and `npx tsc --noEmit`
- [ ] `npm run test:android` — 9 checks against the debug APK on a device
- [ ] **Install the signed release build and play it by hand.** The smoke test cannot do this:
      it drives the WebView through DevTools, which only attaches to debug builds. The release
      APK is a different artifact, and a release-only problem would not show up anywhere else.
      `adb install -r` the universal APK from `bundletool`, or push the AAB to an internal track
      and install it from Play.
- [ ] Privacy policy deployed and the URL reachable in a private window
- [ ] The contact mailbox in the policy exists, and a test message to it arrives
- [ ] `ARCHITECTURE.md` updated if anything about the system changed
