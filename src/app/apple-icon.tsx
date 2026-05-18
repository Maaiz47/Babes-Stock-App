import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: 40,
          background: 'linear-gradient(135deg, #0d0d1f 0%, #1a0a3d 50%, #2d1b69 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Glow effect */}
        <div
          style={{
            position: 'absolute',
            width: 100,
            height: 100,
            borderRadius: 50,
            background: 'radial-gradient(circle, rgba(124,58,237,0.4) 0%, transparent 70%)',
            top: 40,
            left: 40,
          }}
        />
        {/* Icon */}
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none">
          {/* Box/package layers */}
          <path d="M12 2L2 7l10 5 10-5-10-5z" fill="white" />
          <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
          {/* Vertical line (spine) */}
          <path d="M12 12v10" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
        </svg>
        {/* Bottom label */}
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            fontSize: 18,
            fontWeight: 800,
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: 3,
            fontFamily: 'system-ui',
          }}
        >
          PS
        </div>
      </div>
    ),
    { ...size }
  );
}
