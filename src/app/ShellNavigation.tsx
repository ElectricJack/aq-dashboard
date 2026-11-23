import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Ellipsis } from "lucide-react";
import { DESTINATION_ICON, Icon } from "../components/icons";
import { destination, PHONE_PRIMARY, type Destination } from "./destinations";
import type { Badge } from "./usePendingBadge";
import styles from "./Shell.module.css";
export function DestinationLink({
  dest,
  search,
  badge,
}: {
  dest: Destination;
  search: string;
  badge?: Badge | null;
}) {
  return (
    <NavLink
      to={{ pathname: `/${dest.id}`, search }}
      className={styles.navLink}
      aria-label={badge ? `${dest.label}, ${badge.label}` : undefined}
    >
      <Icon icon={DESTINATION_ICON[dest.id]} />
      <span>{dest.label}</span>
      {/* A real space keeps the visible text "Decisions 3" inside the accessible name (WCAG 2.5.3). */}
      {badge && " "}
      {badge && (
        <span className={styles.badge} aria-hidden="true">
          {badge.text}
        </span>
      )}
    </NavLink>
  );
}

function useMoreDestinations() {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const moreButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [location.pathname]);
  // SO-21: a tap outside the bar and its sheet closes the sheet.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !nav.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return { open, setOpen, listId, moreButton, location, nav };
}
export function PhoneNav({
  search,
  badge,
  destinations,
}: {
  search: string;
  badge: Badge | null;
  destinations: readonly Destination[];
}) {
  const { open, setOpen, listId, moreButton, location, nav } = useMoreDestinations();
  const more = destinations.filter((d) => d.phone === "more");
  // SO-21: More carries the active cue while one of its destinations is open.
  const inMore = more.some(
    (d) => location.pathname === `/${d.id}` || location.pathname.startsWith(`/${d.id}/`),
  );

  return (
    <nav
      ref={nav}
      aria-label="Primary (compact)"
      className={styles.phoneNav}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          moreButton.current?.focus();
        }
      }}
    >
      <ul className={styles.phoneBar}>
        {PHONE_PRIMARY.map((id) => (
          <li key={id}>
            <DestinationLink dest={destination(id)} search={search} />
          </li>
        ))}
        <li>
          <button
            ref={moreButton}
            type="button"
            className={styles.navLink}
            data-active={inMore || undefined}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon icon={Ellipsis} />
            <span>More</span>
            {inMore && <span className="visually-hidden">, current section</span>}
          </button>
        </li>
      </ul>
      {/* After the bar in DOM so Tab from More enters the list; CSS places it above. */}
      {open && (
        <ul id={listId} className={styles.moreList} aria-label="More destinations">
          {more.map((d) => (
            <li key={d.id}>
              <DestinationLink dest={d} search={search} badge={d.id === "decisions" ? badge : null} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
