import colorLogo from '../../assets/srm-logo-color.jpeg';
import whiteLogo from '../../assets/srm-logo-white.png';

// The institution's mark, used as-is rather than redrawn. The colour
// asset ships as a JPEG on a white ground, so on the faintly warm form
// stock it sits on it needs `mix-blend-mode: multiply` — that drops the
// white box without us shipping a re-cut PNG we'd have to keep in sync
// with whatever the institution issues next.
export default function Brand({
  variant = 'color',
  height = 32,
}: {
  variant?: 'color' | 'white';
  height?: number;
}) {
  const white = variant === 'white';
  return (
    <img
      src={white ? whiteLogo : colorLogo}
      alt="SRM Institute of Science and Technology, Tiruchirappalli"
      height={height}
      style={{
        height,
        width: 'auto',
        display: 'block',
        mixBlendMode: white ? 'normal' : 'multiply',
      }}
    />
  );
}
