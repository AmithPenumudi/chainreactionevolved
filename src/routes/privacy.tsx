import { createFileRoute, Link } from "@tanstack/react-router";
import { PRIVACY_CONTACT, PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/content/privacy";

/**
 * The public privacy policy. The Play Console requires a URL that is reachable without
 * installing the app, so this route exists for the web deploy; the in-app copy
 * (PrivacyScreen) renders the same source.
 */
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Chain Reaction: Evolved" },
      {
        name: "description",
        content:
          "What Chain Reaction: Evolved stores, what it sends, and what it never collects. " +
          "No ads, no trackers, no personal details.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-20">
        <Link
          to="/"
          className="text-[10px] tracking-[0.3em] text-muted-foreground transition hover:text-foreground"
        >
          ← CHAIN REACTION: EVOLVED
        </Link>

        <h1 className="mt-8 font-display text-3xl font-black tracking-tight text-foreground">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated {PRIVACY_LAST_UPDATED}</p>

        <div className="mt-10 space-y-10">
          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                {section.heading}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {section.bullets && (
                <ul className="mt-4 space-y-2">
                  {section.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
                    >
                      <span aria-hidden="true" className="text-[oklch(0.72_0.18_235)]">
                        ◆
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-white/10 pt-6 text-xs text-muted-foreground">
          Chain Reaction: Evolved · {PRIVACY_CONTACT}
        </p>
      </div>
    </div>
  );
}
