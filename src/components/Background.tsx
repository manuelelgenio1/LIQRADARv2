export default function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      {/* base wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 520px at 12% -6%, rgba(20,184,166,0.075), transparent 62%)," +
            "radial-gradient(1000px 560px at 88% 108%, rgba(245,158,11,0.07), transparent 60%)," +
            "radial-gradient(760px 420px at 78% -10%, rgba(59,91,153,0.10), transparent 65%)," +
            "linear-gradient(180deg, #070d18 0%, #060b14 42%, #05090f 100%)",
        }}
      />
      {/* grid */}
      <div className="absolute inset-0 bg-gridlines" />
      {/* slow scan band */}
      <div className="absolute inset-0 scan-band" />
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(3,6,12,0.75) 100%)",
        }}
      />
    </div>
  );
}
