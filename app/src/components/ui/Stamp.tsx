// A die-cut postage-stamp frame — inspired by the "punched paper" look of
// a physical rubber stamp, not a photo frame: this stamps an approval, so
// it reads as ink on paper (an outline + text in one color), not an image.
//
// The scalloped edge is small background-colored circles along each side,
// not a true CSS mask — far simpler, and correct as long as the stamp sits
// on a background that matches `punch` (it defaults to --paper-laid, the
// app ground; pass an explicit `punch` color when it sits on something
// else, e.g. inside a colored ticket panel).
export default function Stamp({
  role, name, caption, date, rotate = -3, punch,
}: {
  role: string;
  name: string;
  caption?: string;
  date: string;
  rotate?: number;
  punch?: string;
}) {
  const style = punch ? ({ '--pf-punch': punch } as React.CSSProperties) : undefined;
  return (
    <div className="pf-stamp" style={{ ...style, transform: `rotate(${rotate}deg)` }}>
      <span className="pf-stamp__edge pf-stamp__edge--top" aria-hidden="true" />
      <span className="pf-stamp__edge pf-stamp__edge--bottom" aria-hidden="true" />
      <span className="pf-stamp__edge pf-stamp__edge--left" aria-hidden="true" />
      <span className="pf-stamp__edge pf-stamp__edge--right" aria-hidden="true" />
      <div className="pf-stamp__row">
        <span className="pf-stamp__role">{role}</span>
        <span className="pf-stamp__date">{date}</span>
      </div>
      <div className="pf-stamp__name">{name}</div>
      <div className="pf-stamp__caption">{caption ?? 'APPROVED'}</div>
    </div>
  );
}
