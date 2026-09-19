import { type MouseEvent, type ReactNode } from 'react';

import { cn } from './cn';
import './footer-5.css';

/**
 * VENDORED from watermelon.sh — `Footer5`.
 * https://registry.watermelon.sh/r/footer-5.json
 *
 * A brand row with social buttons, a rule, a "get in touch" card beside up to
 * three columns of links, and the brand name set enormous and faded as a
 * watermark with the copyright line laid over its foot. The layout, the order
 * of the parts and the prop shape are the upstream component.
 *
 * NOT INSTALLED WITH `npx shadcn add`, for the reasons recorded on
 * `continuous-pagination.tsx`: no `components.json`, no Tailwind, and the demo
 * pulls in `react-icons` plus two base-ui primitives (`Button`, `Separator`)
 * for what is a styled anchor and a 1px rule. Ported by hand.
 *
 * ── SEVEN DEVIATIONS, ALL DELIBERATE ────────────────────────────────────────
 *
 * 1. **NO `Button` / `Separator` IMPORTS.** Upstream's `Button asChild` renders
 *    its child anchor with button classes; here it IS the anchor. The
 *    separator is an `<hr>`.
 *
 * 2. **A LINK MAY BE AN ACTION.** Upstream links are `href` only. This app's
 *    routes are hashes, and some destinations are not routes at all — the
 *    Meta board is a section of the home screen, the release feed is a dialog.
 *    A link takes `onClick` as well as or instead of `href`; with no `href` it
 *    renders as a `<button>`, because an anchor that goes nowhere is not a
 *    link. `target="_blank"` is applied to http(s) only — upstream put it on
 *    every social link, which would open a `mailto:` in a blank tab.
 *
 * 3. **A LINK MAY CARRY AN ICON AND A HUE.** So a tool is listed with the same
 *    glyph and the same identity colour it wears everywhere else on the site.
 *
 * 4. **THE CONTACT CARD MAY BE AN ACTION** for the same reason (it opens a
 *    dialog here), and its heading is a prop — upstream hardcodes "Get in
 *    touch".
 *
 * 5. **THE WATERMARK'S MARK IS ITS OWN PROP.** Upstream reuses `logo` and
 *    tints it with `currentColor`, which only works on an SVG. A raster logo
 *    has to be drawn as a mask to take the watermark's colour, so the caller
 *    passes that separately; absent, `logo` is used as upstream does.
 *
 * 6. **THE WATERMARK FADES BY MASK, NOT BY AN OVERLAY.** Upstream lays a
 *    `from-background` gradient over the word's lower half. Here the page has
 *    fireflies drifting behind it, and an opaque gradient the width of the word
 *    erased them in a visible rectangle. A mask fades the letters themselves
 *    and paints nothing, so it needs no background colour in either theme.
 *
 * 7. **SIZED FROM ITS OWN WIDTH, AND EVERY COLOUR IS A TOKEN.** Upstream steps
 *    through five viewport breakpoints for the watermark alone; here the root
 *    is an inline-size container and the type is a share of it, so the word
 *    fills the footer at any width. Upstream's `text-muted` is shadcn's pale
 *    surface grey used as ink; the watermark here is the page's own text
 *    colour at a few percent, which is the same idea in both themes.
 */

export interface Footer5Link {
  label: string;
  href?: string;
  /** Runs instead of following `href` when both are given. */
  onClick?: () => void;
  icon?: ReactNode;
  /** An identity hue (`violet`, `blue`, `pink`, `green`, `red`) for the icon. */
  hue?: string;
}

export interface Footer5LinkGroup {
  title: string;
  links: Footer5Link[];
}

export interface Footer5SocialLink {
  icon: ReactNode;
  href: string;
  label: string;
}

export interface Footer5ContactCta {
  icon: ReactNode;
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
}

export interface Footer5Props {
  logo?: ReactNode;
  brandName: string;
  topNavLabel?: string;
  socialLinks?: Footer5SocialLink[];
  contactCta?: Footer5ContactCta;
  /** Upstream hardcodes "Get in touch". */
  contactHeading?: string;
  linkGroups?: Footer5LinkGroup[];
  brandWatermark?: string;
  /** The mark drawn beside the watermark; defaults to `logo`. */
  watermarkMark?: ReactNode;
  copyright: ReactNode;
  legalLinks?: Footer5Link[];
  className?: string;
}

const isWeb = (href: string) => /^https?:\/\//.test(href);

function FooterLink({ link, className }: { link: Footer5Link; className: string }) {
  const inner = (
    <>
      {link.icon && (
        <span className="f5-link-icon" data-hue={link.hue}>
          {link.icon}
        </span>
      )}
      <span className="f5-link-text">{link.label}</span>
    </>
  );

  if (!link.href) {
    return (
      <button type="button" className={className} onClick={link.onClick}>
        {inner}
      </button>
    );
  }

  const onClick = link.onClick
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        link.onClick?.();
      }
    : undefined;

  return (
    <a
      href={link.href}
      className={className}
      onClick={onClick}
      {...(isWeb(link.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {inner}
    </a>
  );
}

export function Footer5({
  logo,
  brandName,
  topNavLabel,
  socialLinks = [],
  contactCta,
  contactHeading = 'Get in touch',
  linkGroups = [],
  brandWatermark,
  watermarkMark,
  copyright,
  legalLinks = [],
  className,
}: Footer5Props) {
  const ctaBody = contactCta && (
    <>
      <span className="f5-cta-icon">{contactCta.icon}</span>
      <span className="f5-cta-text">
        <span className="f5-cta-title">{contactCta.title}</span>
        <span className="f5-cta-desc">{contactCta.description}</span>
      </span>
    </>
  );

  return (
    <footer className={cn('footer-5', className)}>
      <div className="f5-wrap f5-top">
        <div className="f5-brand">
          {logo && <div className="f5-logo">{logo}</div>}
          <span className="f5-brand-name">{brandName}</span>
        </div>

        <div className="f5-connect">
          {topNavLabel && <span className="f5-connect-label">{topNavLabel}</span>}
          {socialLinks.length > 0 && (
            <div className="f5-socials">
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="f5-social"
                  aria-label={link.label}
                  title={link.label}
                  {...(isWeb(link.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {link.icon}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="f5-wrap">
        <hr className="f5-rule" />
      </div>

      <div className="f5-wrap f5-body">
        {contactCta && (
          <div className="f5-contact">
            <h3 className="f5-heading">{contactHeading}</h3>
            {contactCta.href ? (
              <a
                href={contactCta.href}
                className="f5-cta"
                onClick={
                  contactCta.onClick
                    ? (e) => {
                        e.preventDefault();
                        contactCta.onClick?.();
                      }
                    : undefined
                }
              >
                {ctaBody}
              </a>
            ) : (
              <button type="button" className="f5-cta" onClick={contactCta.onClick}>
                {ctaBody}
              </button>
            )}
          </div>
        )}

        {linkGroups.length > 0 && (
          <nav className="f5-groups" aria-label={`${brandName} site map`}>
            {linkGroups.map((group) => (
              <div key={group.title} className="f5-group">
                <h4 className="f5-heading">{group.title}</h4>
                <ul className="f5-links">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <FooterLink link={link} className="f5-link" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="f5-wrap f5-foot">
        {brandWatermark && (
          <div className="f5-watermark" aria-hidden="true">
            <div className="f5-watermark-row">
              {(watermarkMark ?? logo) && <div className="f5-watermark-mark">{watermarkMark ?? logo}</div>}
              <span className="f5-watermark-word">{brandWatermark}</span>
            </div>
          </div>
        )}
        <div className="f5-legal">
          <p className="f5-copyright">{copyright}</p>
          {legalLinks.length > 0 && (
            <div className="f5-legal-links">
              {legalLinks.map((link) => (
                <FooterLink key={link.label} link={link} className="f5-legal-link" />
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
