import { PRIVACY_CONTACT, PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/content/privacy";
import { APP_VERSION } from "@/lib/version";

interface Props {
  onBack: () => void;
}

/**
 * The policy, in the app.
 *
 * Play requires a policy at a public URL (the `/privacy` route serves the same text), but a
 * player who wants to know what the game collects should not have to leave the game — and the
 * app is offline-first, so an outbound link would be a dead end on a plane.
 */
export function PrivacyScreen({ onBack }: Props) {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="text-[10px] tracking-[0.3em] text-muted-foreground transition hover:text-foreground"
          >
            ← BACK
          </button>
          <h1 className="font-display text-xl font-black tracking-tight sm:text-3xl">PRIVACY</h1>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Last updated {PRIVACY_LAST_UPDATED} · App version {APP_VERSION}
        </p>

        <div className="mt-8 space-y-8">
          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-sm tracking-[0.2em] text-foreground">
                {section.heading.toUpperCase()}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {section.bullets && (
                <ul className="mt-3 space-y-2">
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

        <p className="mt-10 border-t border-white/10 pt-6 text-xs text-muted-foreground">
          Chain Reaction: Evolved · {PRIVACY_CONTACT}
        </p>
      </div>
    </div>
  );
}
