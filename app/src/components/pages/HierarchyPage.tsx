import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network, ChevronRight, Users } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import {
  loadHierarchy, descendantOrgUnits, countStudents, fetchStudentPage,
  type HierarchySnapshot, type Position, type StudentRow, type StudentScope,
} from '../../lib/hierarchy';
import type { OrgUnit, PriorityLevel } from '../../types';

// The organisation board — the authority ladder read left to right.
//
// One column per priority level, in rank order, so the board *is* the ladder
// rather than a picture of one. Selecting somebody narrows every column to
// their right to the people under them, which is the only question this
// screen exists to answer: not "who exists", which Accounts already lists,
// but "who reports to whom, and through which unit".
//
// The student column is windowed. A real campus is 8,000+ students and they
// all belong to somebody, so the column has to be able to hold the whole
// cohort without fetching it — rows are pulled a page at a time as the
// column is scrolled, and only the visible slice is ever in the DOM.

const ROW_HEIGHT = 52;   // keep in sync with .hier-row min-height
const PAGE_SIZE = 100;
const OVERSCAN = 6;

interface ScopeChain {
  // The deepest selection above a given column decides what it shows.
  scope: StudentScope;
  label: string | null;
}

function scopeFor(
  selected: (Position | null)[],
  columnIndex: number,
  orgUnits: OrgUnit[],
): ScopeChain {
  for (let i = columnIndex - 1; i >= 0; i -= 1) {
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
    // Their reach is the whole organisation, so the columns below stay whole.
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
  const [error, setError] = useState('');
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    loadHierarchy()
      .then((s) => { setSnap(s); setSelected(new Array(s.levels.length).fill(null)); })
      .catch((err) => setError(errorMessage(err, 'Could not load the organisation.')));
  }, []);

  const choose = (columnIndex: number, person: Position | null) => {
    setSelected((prev) => {
      const next = prev.slice();
      next[columnIndex] = person;
      // Selecting a person invalidates every choice to their right — those
      // people may not be under them at all.
      for (let i = columnIndex + 1; i < next.length; i += 1) next[i] = null;
      return next;
    });
    // Bring the column this selection just filtered into view. This is the
    // board's one authored movement: the ledger slides one column along.
    const nextColumn = columnRefs.current[columnIndex + 1];
    if (person && nextColumn) {
      // Smooth scrolling is not exempt from the reduced-motion preference the
      // way a CSS transition is — the browser will animate this regardless
      // unless it is asked not to.
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => {
        nextColumn.scrollIntoView({ behavior: still ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' });
      });
    }
  };

  // Arrow keys walk the board the way a column browser should: up and down
  // within a rung, left and right between them. A student column has no
  // selectable options, so the scrollable list itself takes the focus.
  const onColumnKeyDown = (e: React.KeyboardEvent, columnIndex: number) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const column = columnRefs.current[columnIndex + (e.key === 'ArrowRight' ? 1 : -1)];
      if (!column) return;
      e.preventDefault();
      column.querySelector<HTMLElement>('[role="option"], [role="list"]')?.focus();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const options = [...(columnRefs.current[columnIndex]?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    const next = options[at + (e.key === 'ArrowDown' ? 1 : -1)];
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
          <span>The board draws one column per priority level. Create the ladder first and it fills in.</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="hier-board">
        {snap.levels.map((level, i) => {
          const { scope, label } = scopeFor(selected, i, snap.orgUnits);
          return (
            <div
              key={level.id}
              className="hier-col"
              ref={(el) => { columnRefs.current[i] = el; }}
            >
              {level.is_base ? (
                <StudentColumn
                  level={level}
                  scope={scope}
                  scopedTo={label}
                  onKeyDown={(e) => onColumnKeyDown(e, i)}
                />
              ) : (
                <PositionColumn
                  level={level}
                  people={snap.positions.filter((p) => p.levelId === level.id && inScope(p, scope))}
                  selectedId={selected[i]?.userId ?? null}
                  scopedTo={label}
                  orgUnits={snap.orgUnits}
                  onSelect={(p) => choose(i, p)}
                  onKeyDown={(e) => onColumnKeyDown(e, i)}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title"><Network size={22} /> Organisation</h1>
        <p className="page-subtitle">
          The ladder, read left to right. Choose somebody to narrow the rungs below them to their people.
        </p>
      </div>
    </div>
  );
}

function ColumnHead({ level, count, scopedTo }: { level: PriorityLevel; count: number | null; scopedTo: string | null }) {
  return (
    <div className="hier-head">
      <div className="hier-head-row">
        <span className="hier-level">{level.name}</span>
        <span className="hier-count">{count === null ? '—' : count}</span>
      </div>
      {scopedTo && <span className="hier-scope">under {scopedTo}</span>}
    </div>
  );
}

function PositionColumn({
  level, people, selectedId, scopedTo, orgUnits, onSelect, onKeyDown,
}: {
  level: PriorityLevel;
  people: Position[];
  selectedId: string | null;
  scopedTo: string | null;
  orgUnits: OrgUnit[];
  onSelect: (p: Position | null) => void;
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
      <ColumnHead level={level} count={people.length} scopedTo={scopedTo} />
      {people.length === 0 ? (
        <div className="hier-empty">
          {scopedTo ? `Nobody at this level under ${scopedTo}.` : 'Nobody holds this level yet.'}
        </div>
      ) : (
        <div className="hier-list" role="listbox" aria-label={level.name} onKeyDown={onKeyDown}>
          {people.map((p, i) => {
            const isSelected = p.userId === selectedId;
            const unit = unitName(p.orgUnitId);
            return (
              <button
                key={p.userId + p.levelId + (p.orgUnitId ?? '')}
                type="button"
                role="option"
                aria-selected={isSelected}
                // Roving tabindex: one stop per column. Falling back to the
                // first row matters when the selected person has been filtered
                // out by a choice further left — without it the column would
                // have no tab stop at all.
                tabIndex={i === activeIndex ? 0 : -1}
                className={`stub hier-row ${isSelected ? 'hier-row--on' : ''}`}
                onClick={() => onSelect(isSelected ? null : p)}
              >
                <span className="stub__perf" aria-hidden="true" />
                <span className="hier-who">
                  <span className="stub__title">{p.fullName}</span>
                  <span className="stub__ref">{unit ?? p.email}</span>
                </span>
                <ChevronRight size={15} className="hier-chev" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// The windowed cohort. Pages are fetched on demand and cached by index, so
// scrolling to the bottom of 8,000 students issues eighty small queries over
// the life of the screen rather than one enormous one up front — and revisiting
// a stretch you have already scrolled past costs nothing.
function StudentColumn({
  level, scope, scopedTo, onKeyDown,
}: {
  level: PriorityLevel;
  scope: StudentScope;
  scopedTo: string | null;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState<Map<number, StudentRow[]>>(new Map());
  const [error, setError] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef<Set<number>>(new Set());

  // The scope is an object rebuilt on every render, so it is compared by
  // value here — otherwise every parent render would refetch the cohort.
  const scopeKey = `${scope.sectionId ?? ''}|${(scope.orgUnitIds ?? []).join(',')}`;

  useEffect(() => {
    setPages(new Map());
    setTotal(null);
    setError('');
    inFlight.current.clear();
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
    countStudents(scope)
      .then(setTotal)
      .catch((err) => setError(errorMessage(err, 'Could not count students.')));
    // scope is captured by value through scopeKey; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

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
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 400);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = total === null
    ? first
    : Math.min(total - 1, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    if (total === null || total === 0) return;
    for (let p = Math.floor(first / PAGE_SIZE); p <= Math.floor(last / PAGE_SIZE); p += 1) {
      if (!pages.has(p)) ensurePage(p);
    }
  }, [first, last, total, pages, ensurePage]);

  const rowAt = (index: number): StudentRow | undefined =>
    pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];

  const visible: number[] = [];
  if (total !== null) for (let i = first; i <= last; i += 1) visible.push(i);

  return (
    <>
      <ColumnHead level={level} count={total} scopedTo={scopedTo} />
      {error && <div className="hier-empty">{error}</div>}
      {total === 0 && !error && (
        <div className="hier-empty">
          {scopedTo ? `No students under ${scopedTo}.` : 'No students have registered yet.'}
        </div>
      )}
      {total !== null && total > 0 && (
        <div
          className="hier-list"
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
          {/* The spacer carries the full height of the cohort so the
              scrollbar tells the truth about how many people there are. */}
          <div className="hier-spacer" style={{ height: total * ROW_HEIGHT }}>
            <div className="hier-window" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
              {visible.map((index) => {
                const row = rowAt(index);
                return (
                  <div key={index} role="listitem" className="stub hier-row hier-row--static">
                    <span className="stub__perf" aria-hidden="true" />
                    <span className="hier-who">
                      <span className="stub__title">{row ? row.fullName : ' '}</span>
                      <span className="stub__ref">{row?.regNo ?? ''}</span>
                    </span>
                    {!row && <span className="hier-loading" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {total !== null && total > 0 && (
        <div className="hier-foot">
          <Users size={13} aria-hidden="true" /> {total} in view
        </div>
      )}
    </>
  );
}
