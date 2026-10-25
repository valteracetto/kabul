// The one place to configure the landing page.
// Everything that changes per deployment (domain, links, donation accounts) lives here.
//
// Donation and sponsor buttons are hidden automatically while their value is empty or still starts
// with "TODO_". Fill the real value in and rebuild; nothing else has to change.

export type Donation = {
  /** Stable id, used for the CSS class and the analytics-free data attribute. */
  id: "github-sponsors" | "buy-me-a-coffee" | "ko-fi" | "open-collective";
  /** Full https URL. Leave "TODO_..." to hide the button. */
  url: string;
};

export type Pix = {
  /** Pix key (e-mail, phone, CPF/CNPJ or random key). Leave "TODO_..." to hide the Pix block. */
  key: string;
  /** Optional QR code image, a path under site/public (for example "/pix-qr.png"). Leave "" for none. */
  qrImage: string;
  /** Name shown next to the key, so people know who receives it. */
  receiver: string;
};

export const config = {
  /**
   * Public address of the site, without a trailing slash. Used for canonical, hreflang, Open Graph,
   * sitemap.xml, robots.txt and JSON-LD. The SITE_URL environment variable wins over this value
   * (handy in CI or for a preview build).
   */
  siteUrl: (process.env.SITE_URL || "https://kabul.dev").replace(/\/+$/, ""),

  /** Shown in JSON-LD (softwareVersion). Read from Cargo.toml by the build when it can. */
  fallbackVersion: "0.9.0",

  repo: "https://github.com/valteracetto/kabul",
  download: {
    mac: "https://github.com/valteracetto/kabul/releases/latest",
    windows: "https://github.com/valteracetto/kabul/releases/latest",
  },
  docs: {
    en: "https://valteracetto.github.io/kabul/",
    "pt-BR": "https://valteracetto.github.io/kabul/pt-BR/",
  },

  /** Donation buttons, in the order they appear. For now only GitHub Sponsors is on; the others stay TODO_ (hidden). */
  donations: [
    { id: "github-sponsors", url: "https://github.com/sponsors/valteracetto" },
    { id: "buy-me-a-coffee", url: "TODO_BUY_ME_A_COFFEE_URL" }, // e.g. https://buymeacoffee.com/<user>
    { id: "ko-fi", url: "TODO_KO_FI_URL" }, // e.g. https://ko-fi.com/<user>
    { id: "open-collective", url: "TODO_OPEN_COLLECTIVE_URL" }, // e.g. https://opencollective.com/kabul
  ] satisfies Donation[] as Donation[],

  pix: {
    key: "TODO_PIX_KEY",
    qrImage: "",
    receiver: "TODO_PIX_RECEIVER_NAME",
  } satisfies Pix as Pix,
};

/** True when a configurable value was filled in (not empty and not a TODO_ placeholder). */
export function isSet(value: string | undefined | null): value is string {
  return !!value && value.trim() !== "" && !value.trim().startsWith("TODO_");
}
