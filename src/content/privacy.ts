/**
 * The privacy policy, as data.
 *
 * One source, rendered in two places: the in-app screen (Settings → Support), and the `/privacy`
 * web route that gives the Play Console a public URL. Keeping it as data rather than duplicating
 * markup means the two can never disagree — and a privacy policy that disagrees with itself is
 * worse than none.
 *
 * KEEP THIS HONEST. It must describe what the code actually does, not what it might do later.
 * If you add a network call that sends anything about a player, it belongs here in the same
 * commit. See `supabase/migrations/` for what the server can hold, and `src/game/sync/` for
 * what is actually sent.
 */

export const PRIVACY_LAST_UPDATED = "30 September 2026";

export const PRIVACY_CONTACT = "amith.penumudi494@gmail.com";

export interface PolicySection {
  heading: string;
  /** Paragraphs. */
  body: string[];
  /** Optional bullets, rendered after the paragraphs. */
  bullets?: string[];
}

export const PRIVACY_SECTIONS: PolicySection[] = [
  {
    heading: "The short version",
    body: [
      "Chain Reaction: Evolved is a single-player and pass-and-play game. It has no ads, no " +
        "trackers, no third-party analytics, and no advertising identifiers. It does not ask " +
        "for your name, email address, phone number or location, and it cannot read your " +
        "contacts, photos or files.",
      "The game is fully playable with no account and no internet connection. If you never " +
        "finish a match online, nothing about you ever leaves your device.",
    ],
  },
  {
    heading: "What is stored on your device",
    body: ["Your progress lives on your device, in the app's own storage. This includes:"],
    bullets: [
      "The display name and avatar you choose.",
      "Your experience points, win/loss counts per game mode, streaks, and your recent match results.",
      "Which puzzles you have solved and your best move count on each.",
      "Daily challenge progress and which rewards you have claimed.",
      "Your settings — sound, haptics, animation speed, colours.",
      "A short log of any errors the app hit, so you can copy them into a bug report. " +
        "This log stays on your device and is never sent anywhere automatically.",
    ],
  },
  {
    heading: "What is sent off your device, and when",
    body: [
      "So your progress is not lost, the game can back it up to a server. This happens only " +
        "after you finish a match — not when you simply open the app.",
      "At that point the game creates an anonymous account for you. Anonymous means exactly " +
        "that: it is a random identifier with no email address, no password, and nothing " +
        "linking it to you personally. You are never asked to sign up, and you never provide " +
        "any personal detail to create it.",
      "What is uploaded is the progress listed above: your chosen display name and avatar, " +
        "your scores and statistics, your recent match results, and your puzzle and challenge " +
        "progress. Nothing else. Specifically, the game does not collect or send your location, " +
        "your contacts, your device's advertising ID, a list of your installed apps, your " +
        "photos or files, or the contents of anything you type outside your own display name.",
      "Please keep in mind that the display name is the one field you control and it is stored " +
        "as you type it, so avoid putting your real full name or anything private in it.",
    ],
  },
  {
    heading: "Who can see it",
    body: [
      "Your data is readable only by your own anonymous account. This is enforced by the " +
        "database itself through row-level security, not merely by the app: another player's " +
        "copy of the game cannot read your row even if they tried, and this has been tested " +
        "directly against the live server.",
      "Your data is not sold, rented or shared with anyone. There are no advertising partners, " +
        "data brokers or analytics vendors involved, because the game uses none.",
    ],
  },
  {
    heading: "Where it is stored",
    body: [
      "Backups are stored with Supabase, which hosts the database on behalf of this game. " +
        "Supabase acts only as the hosting provider and processes the data solely to store it. " +
        "As with any internet service, its servers necessarily see the network requests your " +
        "device makes, which includes your IP address, as a normal part of delivering the " +
        "connection. The game itself does not record, store or use your IP address.",
    ],
  },
  {
    heading: "Children",
    body: [
      "The game is suitable for all ages and does not knowingly collect personal information " +
        "from anyone, including children. Because no account with personal details is ever " +
        "created, there is no personal profile to collect.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      "You can play entirely offline. With no internet connection the game works exactly the " +
        "same and nothing is uploaded.",
      "You can change or clear your display name at any time from the Profile screen.",
      "Uninstalling the app removes everything stored on your device. Because the account is " +
        "anonymous and lives only in that installation, uninstalling also permanently ends " +
        "access to the backup — there is no way to recover it afterwards, and no way for " +
        "anyone to connect it back to you.",
      "If you would like the stored copy deleted while the app is still installed, contact " +
        "the address below and it will be removed.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "If the game ever starts collecting something new, this policy will be updated in the " +
        "same release that changes it, and the date at the top will change.",
    ],
  },
  {
    heading: "Contact",
    body: [`Questions, or a request to delete stored data: ${PRIVACY_CONTACT}`],
  },
];
