/**
 * The data-deletion instructions, as data.
 *
 * Play requires a public URL for this, and is specific about what it must contain: it has to name
 * the app, set out the steps prominently, and say which data is deleted, which is kept, and for
 * how long. The privacy policy mentions deletion in a sentence, which is not the same thing — so
 * this is its own page rather than an anchor into that one.
 *
 * KEEP THIS TRUE. If what the game stores changes, this page changes with it, in the same commit.
 */

import { PRIVACY_CONTACT } from "./privacy";

export const DELETE_DATA_CONTACT = PRIVACY_CONTACT;

/** Stated on the page, and the window we hold ourselves to once a request arrives. */
export const DELETION_WINDOW_DAYS = 30;

export interface DeletionStep {
  title: string;
  detail: string;
}

export const DELETION_STEPS: DeletionStep[] = [
  {
    title: "Open Settings in the game",
    detail: "From the main menu, tap SETTINGS, then scroll down to the SUPPORT section.",
  },
  {
    title: "Copy your Player ID",
    detail:
      "Tap COPY next to Player ID. This is the random identifier your backup is stored under. " +
      "It is the only way to find your data, because the account is anonymous — there is no " +
      "email address or username attached to it. If no Player ID is shown, nothing of yours has " +
      "ever been uploaded and there is nothing to delete.",
  },
  {
    title: `Email ${PRIVACY_CONTACT}`,
    detail:
      "Paste your Player ID into the message and ask for your data to be deleted. You do not " +
      "need to explain why, and no other details are required.",
  },
  {
    title: "That is it",
    detail:
      `Your data is deleted within ${DELETION_WINDOW_DAYS} days of the request, usually sooner. ` +
      "You will get a reply confirming it is done.",
  },
];

export interface DeletionFact {
  heading: string;
  body: string[];
  bullets?: string[];
}

export const DELETION_FACTS: DeletionFact[] = [
  {
    heading: "What is deleted",
    body: ["Everything stored for your Player ID is deleted. In full, that is:"],
    bullets: [
      "Your display name and chosen avatar.",
      "Your experience points, win and loss counts per game mode, streaks, and recent match results.",
      "Which puzzles you have solved and your best move count on each.",
      "Daily challenge progress and which rewards you have claimed.",
      "The anonymous account itself, so the Player ID stops existing.",
    ],
  },
  {
    heading: "What is kept",
    body: [
      "Nothing. There is no copy retained after deletion, and no separate profile, log or " +
        "analytics record to keep — the game collects none of those. Backups held by our " +
        "database provider are cycled out on their own schedule and are not used to restore " +
        "deleted rows.",
    ],
  },
  {
    heading: "Retention",
    body: [
      `Requests are completed within ${DELETION_WINDOW_DAYS} days. Until you ask, your data is ` +
        "kept so your progress can be restored — it is a backup, and it is not deleted on a timer.",
    ],
  },
  {
    heading: "Deleting the app instead",
    body: [
      "Uninstalling removes everything stored on your device immediately. It does not remove the " +
        "backup, and because the account is anonymous it cannot be recovered afterwards either — " +
        "so if you want the stored copy gone as well, copy your Player ID before uninstalling and " +
        "email it to us.",
    ],
  },
];
