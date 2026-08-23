import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network, ChevronDown, Users, Search, X, CornerDownRight, Info } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import {
  loadHierarchy, descendantOrgUnits, countStudents, fetchStudentPage,
  searchPeople, filterIsEmpty, EMPTY_FILTER,
  type HierarchySnapshot, type Position, type StudentRow, type StudentScope,
  type PeopleFilter, type PersonResult, type MemberType,
} from '../../lib/hierarchy';
import type { OrgUnit, PriorityLevel } from '../../types';
import PersonCard from '../ui/PersonCard';

// The organisation board — the authority ladder read top to bottom.
//
// One rung per priority level, in rank order, so the board *is* the ladder
// rather than a picture of one: the captain is at the top because the captain
// is at the top. Choosing somebody narrows every rung beneath them to their
// people, which is the only question this screen exists to answer — not "who
// exists", which Accounts already lists, but "who reports to whom, and through
// which unit".
//
// The base rung is the one that can be enormous. A real campus is 8,000+
// students and they all belong to somebody, so it opens collapsed to a
// handful and expands on request into a windowed list — rows pulled a page at
// a time, only the visible slice ever in the DOM. Dropping 8,000 rows into the
// document because somebody clicked a Dean is how this page would die.

const ROW_HEIGHT = 52;    // keep in sync with .hier-row height
const PAGE_SIZE = 100;
const OVERSCAN = 6;
const PREVIEW = 8;        // students shown before "show all"

interface ScopeChain {
  // The deepest selection above a given rung decides what it shows.
  scope: StudentScope;
  label: string | null;
}

function scopeFor(
  selected: (Position | null)[],
  rungIndex: number,
  orgUnits: OrgUnit[],
): ScopeChain {
  for (let i = rungIndex - 1; i >= 0; i -= 1) {
    const p = selected[i];
    if (!p) continue;
    if (p.sectionId) return { scope: { orgUnitIds: null, sectionId: p.sectionId }, label: p.fullName };
    if (p.orgUnitId) {
      return {
        scope: { orgUnitIds: descendantOrgUnits(orgUnits, p.orgUnitId), sectionId: null },
        label: p.fullName,
      };
    }
    // Somebody holding a rung with no unit — the captain — scopes nothing.
    // Their reach is the whole organisation, so the rungs below stay whole.
    return { scope: { orgUnitIds: null, sectionId: null }, label: p.fullName };
  }
  return { scope: { orgUnitIds: null, sectionId: null }, label: null };
}

function inScope(p: Position, scope: StudentScope): boolean {
  if (scope.sectionId) return p.sectionId === scope.sectionId;
  if (scope.orgUnitIds) return p.orgUnitId !== null && scope.orgUnitIds.includes(p.orgUnitId);
  return true;
}

export default function HierarchyPage() {
  const [snap, setSnap] = useState<HierarchySnapshot | null>(null);
  const [selected, setSelected] = useState<(Position | null)[]>([]);
  const [filter, setFilter] = useState<PeopleFilter>(EMPTY_FILTER);
  const [card, setCard] = useState<{ userId: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const rungRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    loadHierarchy()
      .then((s) => { setSnap(s); setSelected(new Array(s.levels.length).fill(null)); })
      .catch((err) => setError(errorMessage(err, 'Could not load the organisation.')));
  }, []);

  const choose = (rungIndex: number, person: Position | null) => {
    setSelected((prev) => {
      const next = prev.slice();
      next[rungIndex] = person;
      // Selecting a person invalidates every choice below — those people may
      // not be under them at all.
      for (let i = rungIndex + 1; i < next.length; i += 1) next[i] = null;
      return next;
    });
    // Bring the rung this selection just filtered into view. This is the
    // board's one authored movement: the ladder steps down by one.
    const nextRung = rungRefs.current[rungIndex + 1];
    if (person && nextRung) {
      // Smooth scrolling is not exempt from the reduced-motion preference the
      // way a CSS transition is — the browser animates it regardless unless
      // asked not to.
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => {
        nextRung.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
      });
    }
  };

  // Arrow keys walk the board the way its shape implies: left and right along
  // a rung, up and down between rungs.
  const onRungKeyDown = (e: React.KeyboardEvent, rungIndex: number) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const rung = rungRefs.current[rungIndex + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!rung) return;
      e.preventDefault();
      rung.querySelector<HTMLElement>('.hier-card-hit, .hier-rows--tall, .hier-more')?.focus();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const options = [...(rungRefs.current[rungIndex]?.querySelectorAll<HTMLElement>('.hier-card-hit') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    const next = options[at + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  if (error) return <><Header /><div className="alert alert-danger">{error}</div></>;
  if (!snap) return <><Header /><div className="loading-spinner" role="status" aria-label="Loading the organisation" /></>;

  if (snap.levels.length === 0) {
    return (
      <>
        <Header />
        <div className="empty-state">
          <span className="empty-icon"><Network size={20} /></span>
          <span className="empty-title">No levels defined yet</span>
          <span>The board draws one rung per priority level. Create the ladder first and it fills in.</span>
        </div>
      </>
    );
  }

  const searching = !filterIsEmpty(filter);

  return (
    <>
      <Header />
      <PeopleSearch snap={snap} filter={filter} onChange={setFilter} />

      {searching ? (
        <SearchResults filter={filter} onOpen={setCard} />
      ) : (
        <div className="hier-ladder">
          {snap.levels.map((level, i) => {
            const { scope, label } = scopeFor(selected, i, snap.orgUnits);
            return (
              <section
                key={level.id}
                className="hier-rung"
                aria-label={level.name}
                ref={(el) => { rungRefs.current[i] = el; }}
              >
                {level.is_base ? (
                  <StudentRung
                    level={level}
                    scope={scope}
                    scopedTo={label}
                    onOpen={setCard}
                    onKeyDown={(e) => onRungKeyDown(e, i)}
                  />
                ) : (
                  <PositionRung
                    level={level}
                    people={snap.positions.filter((p) => p.levelId === level.id && inScope(p, scope))}
                    selectedId={selected[i]?.userId ?? null}
                    scopedTo={label}
                    orgUnits={snap.orgUnits}
                    onSelect={(p) => choose(i, p)}
                    onOpen={setCard}
                    onKeyDown={(e) => onRungKeyDown(e, i)}
                  />
                )}
                {i < snap.levels.length - 1 && <span className="hier-drop" aria-hidden="true" />}
              </section>
            );
          })}
        </div>
      )}

      {card && (
        <PersonCard userId={card.userId} name={card.name} onClose={() => setCard(null)} />
      )}
    </>
  );
}

// The affordance PRD-V2 §9 calls for. It is a real button rather than an icon
// on the card itself, because opening a profile and choosing somebody to filter
// by are two different intentions and a card that did both on click would
// guess wrong half the time.
function InfoButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="pcard-open"
      aria-label={`Profile of ${name}`}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      <Info size={15} aria-hidden="true" />
    </button>
  );
}

function Header() {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title"><Network size={22} /> Organisation</h1>
        <p className="page-subtitle">
          The ladder, read top to bottom. Choose somebody to narrow the rungs below them to their people.
        </p>
      </div>
    </div>
  );
}

// ── Search ────────────────────────────────────────────────────────────────
//
// The facets change with who you are looking for, because the two questions
// are genuinely different. Staff are found by FET ID, by the rung they hold,
// or by department. Students are found by register number, or by walking
// department → batch → class. Showing both sets at once would be a form that
// is mostly irrelevant whichever answer you wanted.

function PeopleSearch({
  snap, filter, onChange,
}: {
  snap: HierarchySnapshot;
  filter: PeopleFilter;
  onChange: (f: PeopleFilter) => void;
}) {
  const set = (patch: Partial<PeopleFilter>) => onChange({ ...filter, ...patch });

  // Choosing a department invalidates a batch from a different one, and a
  // batch invalidates a class from a different one. Clearing them here rather
  // than filtering the results later keeps the form honest about what it is
  // actually asking for.
  const batches = filter.orgUnitId
    ? snap.batches.filter((b) => b.org_unit_id === filter.orgUnitId)
    : snap.batches;
  const sections = filter.batchId
    ? snap.sections.filter((s) => s.batch_id === filter.batchId)
    : snap.sections.filter((s) => batches.some((b) => b.id === s.batch_id));

  // Every programme runs its own "2024-2028", so with no department chosen the
  // batch list is four identical lines. Say which programme each one belongs to
  // when — and only when — the name alone does not settle it.
  const unitName = new Map(snap.orgUnits.map((u) => [u.id, u.name]));
  const batchLabel = (b: { id: string; name: string; org_unit_id: string | null }) =>
    batches.some((o) => o.id !== b.id && o.name === b.name)
      ? `${b.name} · ${unitName.get(b.org_unit_id ?? '') ?? '—'}`
      : b.name;

  const isStudent = filter.memberType === 'student';
  const isStaff = filter.memberType === 'staff';

  return (
    <div className="card hier-search">
      <div className="hier-search-row">
        <div className="hier-kind" role="group" aria-label="Who are you looking for">
          {(['staff', 'student'] as MemberType[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`hier-kind-btn ${filter.memberType === k ? 'active' : ''}`}
              aria-pressed={filter.memberType === k}
              onClick={() => set({
                memberType: filter.memberType === k ? null : k,
                // The facets below are kind-specific; keeping a class filter
                // while switching to Staff would silently return nothing.
                levelId: null, batchId: null, sectionId: null,
              })}
            >
              {k === 'staff' ? 'Staff' : 'Students'}
            </button>
          ))}
        </div>

        <div className="hier-search-input">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            className="form-input"
            value={filter.query}
            placeholder={
              isStudent ? 'Register number, name or email'
                : isStaff ? 'FET ID, name or email'
                  : 'Register number, FET ID, name or email'
            }
            aria-label="Search people"
            onChange={(e) => set({ query: e.target.value })}
          />
        </div>

        {!filterIsEmpty(filter) && (
          <button type="button" className="btn btn-ghost" onClick={() => onChange(EMPTY_FILTER)}>
            <X size={15} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      <div className="hier-facets">
        <label className="hier-facet">
          <span className="hier-facet-label">Department</span>
          <select
            className="form-input"
            value={filter.orgUnitId ?? ''}
            onChange={(e) => set({ orgUnitId: e.target.value || null, batchId: null, sectionId: null })}
          >
            <option value="">Any</option>
            {snap.orgUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>

        {!isStaff && (
          <>
            <label className="hier-facet">
              <span className="hier-facet-label">Batch</span>
              <select
                className="form-input"
                value={filter.batchId ?? ''}
                onChange={(e) => set({ batchId: e.target.value || null, sectionId: null })}
              >
                <option value="">Any</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{batchLabel(b)}</option>)}
              </select>
            </label>

            <label className="hier-facet">
              <span className="hier-facet-label">Class</span>
              <select
                className="form-input"
                value={filter.sectionId ?? ''}
                onChange={(e) => set({ sectionId: e.target.value || null })}
              >
                <option value="">Any</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        )}

        {!isStudent && (
          <label className="hier-facet">
            <span className="hier-facet-label">Role</span>
            <select
              className="form-input"
              value={filter.levelId ?? ''}
              onChange={(e) => set({ levelId: e.target.value || null })}
            >
              <option value="">Any</option>
              {snap.levels.filter((l) => !l.is_base).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function SearchResults({
  filter, onOpen,
}: {
  filter: PeopleFilter;
  onOpen: (p: { userId: string; name: string }) => void;
}) {
  const [rows, setRows] = useState<PersonResult[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  // Compared by value: the filter object is rebuilt on every keystroke, and
  // depending on the object itself would refetch on renders that changed
  // nothing.
  const key = JSON.stringify(filter);

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    // A short pause so typing a register number is one query, not fifteen.
    const t = window.setTimeout(() => {
      searchPeople(filter, 50, 0)
        .then((res) => { if (!live) return; setRows(res.rows); setTotal(res.total); })
        .catch((err) => { if (live) setError(errorMessage(err, 'Could not search.')); })
        .finally(() => { if (live) setBusy(false); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
    // filter is captured by value through key; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (busy) return <div className="loading-spinner" role="status" aria-label="Searching" />;

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Search size={20} /></span>
        <span className="empty-title">Nobody matches that</span>
        <span>Try a shorter register number or FET ID, or widen the department.</span>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="hier-results-head">
        <Users size={14} aria-hidden="true" />
        {total > rows.length
          ? `${rows.length} of ${total} people`
          : `${total} ${total === 1 ? 'person' : 'people'}`}
      </div>
      <ul className="hier-results" role="list">
        {rows.map((r) => (
          <li key={r.userId} className="stub hier-row hier-row--static">
            <span className="stub__perf" aria-hidden="true" />
            <span className="hier-who">
              <span className="stub__title">{r.fullName}</span>
              <span className="stub__ref">
                {[r.regNo ?? r.fetId, r.levelName, r.orgUnitName, r.sectionName]
                  .filter(Boolean).join(' · ') || r.email}
              </span>
            </span>
            <InfoButton name={r.fullName} onOpen={() => onOpen({ userId: r.userId, name: r.fullName })} />
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <p className="hier-results-more">
          Narrow the search to see the rest — {total - rows.length} more match.
        </p>
      )}
    </div>
  );
}

// ── The ladder ────────────────────────────────────────────────────────────

function RungHead({
  level, count, scopedTo,
}: { level: PriorityLevel; count: number | null; scopedTo: string | null }) {
  return (
    <div className="hier-head">
      <span className="hier-level">{level.name}</span>
      <span className="hier-count">{count === null ? '—' : count}</span>
      {scopedTo && (
        <span className="hier-scope">
          <CornerDownRight size={12} aria-hidden="true" /> under {scopedTo}
        </span>
      )}
    </div>
  );
}

function PositionRung({
  level, people, selectedId, scopedTo, orgUnits, onSelect, onOpen, onKeyDown,
}: {
  level: PriorityLevel;
  people: Position[];
  selectedId: string | null;
  scopedTo: string | null;
  orgUnits: OrgUnit[];
  onSelect: (p: Position | null) => void;
  onOpen: (p: { userId: string; name: string }) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const unitName = useMemo(() => {
    const byId = new Map(orgUnits.map((u) => [u.id, u.name]));
    return (id: string | null) => (id ? byId.get(id) ?? null : null);
  }, [orgUnits]);

  const found = people.findIndex((p) => p.userId === selectedId);
  const activeIndex = found === -1 ? 0 : found;

  return (
    <>
      <RungHead level={level} count={people.length} scopedTo={scopedTo} />
      {people.length === 0 ? (
        <div className="hier-empty">
          {scopedTo ? `Nobody at this level under ${scopedTo}.` : 'Nobody holds this level yet.'}
        </div>
      ) : (
        <div className="hier-people" role="list" aria-label={level.name} onKeyDown={onKeyDown}>
          {people.map((p, i) => {
            const isSelected = p.userId === selectedId;
            const unit = unitName(p.orgUnitId);
            return (
              // The info control is a sibling, not a child: a button inside a
              // button is invalid HTML and browsers resolve it by dropping one
              // of them.
              <div
                key={p.userId + p.levelId + (p.orgUnitId ?? '')}
                role="listitem"
                className={`stub hier-card ${isSelected ? 'hier-card--on' : ''}`}
              >
                <span className="stub__perf" aria-hidden="true" />
                <button
                  type="button"
                  // Not a listbox option: choosing somebody filters the rungs
                  // below rather than picking a value, and clicking again
                  // releases it. That is a toggle, so it says so.
                  aria-pressed={isSelected}
                  // Roving tabindex: one stop per rung. Falling back to the
                  // first card matters when the selected person has been
                  // filtered out by a choice above — without it the rung would
                  // have no tab stop at all.
                  tabIndex={i === activeIndex ? 0 : -1}
                  className="hier-card-hit"
                  onClick={() => onSelect(isSelected ? null : p)}
                >
                  <span className="hier-who">
                    <span className="stub__title">{p.fullName}</span>
                    <span className="stub__ref">{unit ?? p.email}</span>
                  </span>
                </button>
                <InfoButton name={p.fullName} onOpen={() => onOpen({ userId: p.userId, name: p.fullName })} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// The cohort rung. It opens showing a handful and says how many there are.
// Expanding switches to a windowed list: pages fetched on demand and cached by
// index, so scrolling through 8,000 students issues eighty small queries over
// the life of the screen rather than one enormous one up front — and revisiting
// a stretch already scrolled past costs nothing.
function StudentRung({
  level, scope, scopedTo, onOpen, onKeyDown,
}: {
  level: PriorityLevel;
  scope: StudentScope;
  scopedTo: string | null;
  onOpen: (p: { userId: string; name: string }) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState<Map<number, StudentRow[]>>(new Map());
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef<Set<number>>(new Set());

  // The scope is an object rebuilt on every render, so it is compared by value
  // here — otherwise every parent render would refetch the cohort.
  const scopeKey = `${scope.sectionId ?? ''}|${(scope.orgUnitIds ?? []).join(',')}`;

  const ensurePage = useCallback((page: number) => {
    if (inFlight.current.has(page)) return;
    inFlight.current.add(page);
    fetchStudentPage(scope, page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ rows }) => setPages((prev) => new Map(prev).set(page, rows)))
      .catch((err) => setError(errorMessage(err, 'Could not load students.')))
      .finally(() => inFlight.current.delete(page));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    setPages(new Map());
    setTotal(null);
    setError('');
    // A new scope is a different cohort, so an expansion of the old one is not
    // a statement about this one.
    setExpanded(false);
    setScrollTop(0);
    inFlight.current.clear();
    countStudents(scope)
      .then(setTotal)
      .catch((err) => setError(errorMessage(err, 'Could not count students.')));
    ensurePage(0);
    // scope is captured by value through scopeKey; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 400);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = total === null
    ? first
    : Math.min(total - 1, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    if (!expanded || total === null || total === 0) return;
    for (let p = Math.floor(first / PAGE_SIZE); p <= Math.floor(last / PAGE_SIZE); p += 1) {
      if (!pages.has(p)) ensurePage(p);
    }
  }, [expanded, first, last, total, pages, ensurePage]);

  const rowAt = (index: number): StudentRow | undefined =>
    pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];

  const row = (index: number) => {
    const r = rowAt(index);
    return (
      <div key={index} role="listitem" className="stub hier-row hier-row--static">
        <span className="stub__perf" aria-hidden="true" />
        <span className="hier-who">
          <span className="stub__title">{r ? r.fullName : ' '}</span>
          <span className="stub__ref">{r?.regNo ?? ''}</span>
        </span>
        {!r && <span className="hier-loading" aria-hidden="true" />}
        {r && <InfoButton name={r.fullName} onOpen={() => onOpen({ userId: r.userId, name: r.fullName })} />}
      </div>
    );
  };

  const visible: number[] = [];
  if (expanded && total !== null) for (let i = first; i <= last; i += 1) visible.push(i);

  const preview: number[] = [];
  if (!expanded && total !== null) {
    for (let i = 0; i < Math.min(PREVIEW, total); i += 1) preview.push(i);
  }

  return (
    <>
      <RungHead level={level} count={total} scopedTo={scopedTo} />
      {error && <div className="hier-empty">{error}</div>}
      {total === 0 && !error && (
        <div className="hier-empty">
          {scopedTo ? `No students under ${scopedTo}.` : 'No students have registered yet.'}
        </div>
      )}

      {total !== null && total > 0 && !expanded && (
        <>
          <div className="hier-rows" role="list" aria-label={`${level.name} — first ${preview.length} of ${total}`}>
            {preview.map(row)}
          </div>
          {total > PREVIEW && (
            <button type="button" className="btn btn-ghost hier-more" onClick={() => setExpanded(true)}>
              <ChevronDown size={15} aria-hidden="true" />
              Show all {total} students
            </button>
          )}
        </>
      )}

      {total !== null && total > 0 && expanded && (
        <div
          className="hier-rows hier-rows--tall"
          // A list, not a listbox: nothing here is selectable, because there is
          // no rung below a student to narrow. It still needs to be focusable
          // so a keyboard can scroll a cohort this long.
          role="list"
          tabIndex={0}
          aria-label={`${level.name} — ${total} people`}
          ref={listRef}
          onKeyDown={onKeyDown}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          {/* The spacer carries the full height of the cohort so the scrollbar
              tells the truth about how many people there are. */}
          <div className="hier-spacer" style={{ height: total * ROW_HEIGHT }}>
            <div className="hier-window" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
              {visible.map(row)}
            </div>
          </div>
        </div>
      )}

      {total !== null && total > 0 && expanded && (
        <div className="hier-foot">
          <Users size={13} aria-hidden="true" /> {total} in view
        </div>
      )}
    </>
  );
}
