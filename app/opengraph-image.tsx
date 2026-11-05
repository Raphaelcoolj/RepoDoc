import { ImageResponse } from 'next/og';

export const alt = 'GramDoc — AI-Powered Repository Documentation';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#16162a',
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.35), transparent 50%), radial-gradient(circle at 80% 80%, rgba(168,85,247,0.3), transparent 50%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '10px 28px',
            borderRadius: 9999,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#818cf8',
            fontSize: 28,
          }}
        >
          Powered by GPT-4o, Claude, Gemini &amp; more
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 96,
            fontWeight: 900,
            marginTop: 40,
            color: '#ffffff',
            letterSpacing: -3,
          }}
        >
          Instant docs for any
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 96,
            fontWeight: 900,
            color: 'transparent',
            backgroundImage: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)',
            backgroundClip: 'text',
            letterSpacing: -3,
          }}
        >
          GitHub repo
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 36,
            fontSize: 32,
            color: '#94a3b8',
          }}
        >
          AI-generated documentation with Mermaid architecture diagrams
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 48,
            fontSize: 40,
            fontWeight: 700,
            color: '#ffffff',
          }}
        >
          GramDoc
        </div>
      </div>
    ),
    { ...size }
  );
}
