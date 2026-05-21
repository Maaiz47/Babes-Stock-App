'use client';
import { useEffect, useRef, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';

const COLORS = ['#8b5cf6', '#a78bfa', '#10b981', '#34d399', '#f59e0b', '#fbbf24', '#6366f1', '#ec4899', '#38bdf8'];
const COUNT = 42;

export function Celebration({ onDone }: { onDone?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Deterministic sizes/shapes so no hydration risk
  const particles = useMemo(() =>
    Array.from({ length: COUNT }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      size: 5 + (i * 3) % 7,
      isRect: i % 4 === 0,
    })), []
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>('.cp');
    nodes.forEach((node, i) => {
      const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.8;
      const dist = 90 + Math.random() * 180;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist - 70;
      const rot = (Math.random() - 0.5) * 600;
      node.animate(
        [
          { opacity: '1', transform: 'translate(-50%,-50%) scale(1) rotate(0deg)' },
          { opacity: '0', transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.2) rotate(${rot}deg)` },
        ],
        {
          duration: 800 + Math.random() * 600,
          delay: Math.random() * 180,
          easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
          fill: 'both',
        }
      );
    });

    const t = setTimeout(() => onDone?.(), 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center">
      {/* Confetti origin */}
      <div ref={containerRef} className="absolute inset-0 flex items-center justify-center">
        {particles.map(p => (
          <div
            key={p.id}
            className="cp absolute"
            style={{
              width: p.size,
              height: p.isRect ? Math.ceil(p.size * 0.5) : p.size,
              borderRadius: p.isRect ? 2 : '50%',
              backgroundColor: p.color,
              left: '50%',
              top: '45%',
            }}
          />
        ))}
      </div>

      {/* Check + text */}
      <div style={{ animation: 'celebrate-pop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both, celebrate-exit 0.4s ease-in 1.9s both' }}
        className="flex flex-col items-center gap-2"
      >
        <div
          className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center"
          style={{ animation: 'celebrate-ring 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.05s both' }}
        >
          <CheckCircle2 size={44} className="text-emerald-400" />
        </div>
        <div className="text-center" style={{ animation: 'celebrate-pop 0.35s ease-out 0.2s both' }}>
          <p className="text-xl font-bold text-white drop-shadow-lg">Match!</p>
          <p className="text-sm text-emerald-400">Mismatch resolved ✓</p>
        </div>
      </div>
    </div>
  );
}
