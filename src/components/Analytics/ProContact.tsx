import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ProContact.module.css';

const TWITTER_URL = 'https://x.com/CaptainFrozeCR';
const TWITTER_HANDLE = '@CaptainFrozeCR';
const EMAIL = 'singh.divyanshu1121@gmail.com';

function XIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.2 3h3.3l-7.2 8.2L21.8 21h-6.6l-5.2-6.7L4.1 21H.8l7.7-8.8L.5 3h6.8l4.7 6.2L17.2 3zm-1.2 16h1.8L7.9 4.9H6L16 19z" />
    </svg>
  );
}

function MailIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6 8.5-6" />
    </svg>
  );
}

function CrownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

/**
 * What "Subscribe to Royal Pro" actually does: says there is no till yet, and
 * hands over the two ways to reach a person.
 *
 * A button that opens a checkout that does not exist would be the one dishonest
 * thing on a screen whose whole argument is that its numbers are measured. So
 * the gate's CTA is wired to the truth — write to me — with the handle and the
 * address as real links rather than text to retype.
 *
 * Portalled to `document.body` on the project's usual reasoning: panels carry
 * `backdrop-filter`, each of which creates a stacking context that traps a
 * dialog rendered inside it however high its z-index.
 */
export function ProContact({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // The deck screens listen for Escape to drop a slot selection; closing
        // the dialog on top is the nearer meaning.
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  function copyEmail() {
    navigator.clipboard?.writeText(EMAIL).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-contact-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <button type="button" className={styles.close} data-metal onClick={onClose} aria-label="Close">
          ×
        </button>

        <span className={styles.badge}>
          <CrownIcon />
          Royal Pro
        </span>

        <h2 className={styles.title} id="pro-contact-title">
          Write to me
        </h2>
        <p className={styles.blurb}>
          There is no checkout yet — Royal Pro is set up by hand. Send a message either way
          below and I will sort your account out.
        </p>

        <div className={styles.links}>
          <a
            className={styles.link}
            href={TWITTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-net="x"
          >
            <span className={styles.linkIcon}>
              <XIcon />
            </span>
            <span className={styles.linkText}>
              <span className={styles.linkLabel}>X / Twitter</span>
              <span className={styles.linkValue}>{TWITTER_HANDLE}</span>
            </span>
            <span className={styles.linkGo} aria-hidden="true">
              ↗
            </span>
          </a>

          <a className={styles.link} href={`mailto:${EMAIL}`} data-net="mail">
            <span className={styles.linkIcon}>
              <MailIcon />
            </span>
            <span className={styles.linkText}>
              <span className={styles.linkLabel}>Email</span>
              <span className={styles.linkValue}>{EMAIL}</span>
            </span>
            <span
              className={styles.linkGo}
              role="button"
              tabIndex={0}
              title="Copy the address"
              aria-label="Copy the email address"
              onClick={(e) => {
                // The row is a mailto link; copying is a second action inside
                // it, so it must not also open a mail client.
                e.preventDefault();
                e.stopPropagation();
                copyEmail();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  copyEmail();
                }
              }}
            >
              {copied ? '✓' : '⧉'}
            </span>
          </a>
        </div>

        <p className={styles.note}>
          {copied ? 'Address copied.' : 'Unofficial fan project — not affiliated with Supercell.'}
        </p>
      </div>
    </div>,
    document.body,
  );
}
