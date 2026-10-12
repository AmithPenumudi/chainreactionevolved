import { createFileRoute, Link } from "@tanstack/react-router";
import { DELETE_DATA_CONTACT, DELETION_FACTS, DELETION_STEPS } from "@/content/delete-data";

/**
 * The public data-deletion page Play requires. It names the app, leads with the steps, and says
 * what is deleted, what is kept and over what period — the three things the Console asks for.
 */
export const Route = createFileRoute("/delete-data")({
  head: () => ({
    meta: [
      { title: "Delete your data — Chain Reaction: Evolved" },
      {
        name: "description",
        content:
          "How to request deletion of your Chain Reaction: Evolved data, what is deleted, and " +
          "what is kept.",
      },
    ],
  }),
  component: DeleteDataPage,
});

function DeleteDataPage() {
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
          Delete your data
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This page is for <strong className="text-foreground">Chain Reaction: Evolved</strong>. It
          explains how to ask for the data the game has backed up to be deleted, exactly what gets
          removed, and what is kept.
        </p>

        <h2 className="mt-12 font-display text-lg font-bold tracking-tight text-foreground">
          How to request deletion
        </h2>
        <ol className="mt-5 space-y-6">
          {DELETION_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[oklch(0.72_0.18_235/0.5)] font-display text-xs text-[oklch(0.72_0.18_235)]"
              >
                {i + 1}
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">{step.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 rounded-md border border-[oklch(0.72_0.18_235/0.35)] bg-[oklch(0.72_0.18_235/0.06)] p-5">
          <div className="font-display text-[10px] tracking-[0.3em] text-[oklch(0.72_0.18_235)]">
            SEND REQUESTS TO
          </div>
          <a
            href={`mailto:${DELETE_DATA_CONTACT}?subject=Delete%20my%20data`}
            className="mt-2 block break-all text-base text-foreground underline underline-offset-4"
          >
            {DELETE_DATA_CONTACT}
          </a>
        </div>

        <div className="mt-12 space-y-10">
          {DELETION_FACTS.map((fact) => (
            <section key={fact.heading}>
              <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                {fact.heading}
              </h2>
              {fact.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {fact.bullets && (
                <ul className="mt-4 space-y-2">
                  {fact.bullets.map((bullet) => (
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
          See also the{" "}
          <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
            privacy policy
          </Link>{" "}
          for what the game collects in the first place.
        </p>
      </div>
    </div>
  );
}
