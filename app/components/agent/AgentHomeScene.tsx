import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { AgentHomeSceneConfig, SceneLayer } from '../../types/agentHomeScene';
import { DEFAULT_AGENT_HOME_SCENE } from '../../types/agentHomeScene';
import '../../styles/agent-home-tokens.css';
import './AgentHomeScene.css';

interface AgentHomeSceneProps {
  config?: AgentHomeSceneConfig;
  paused?: boolean;
}

/** CMS-resolved gradient/image layers — no CSS orb presets. */
export function AgentHomeScene({ config, paused }: AgentHomeSceneProps) {
  const scene = config ?? DEFAULT_AGENT_HOME_SCENE;
  const reducedMotion = usePrefersReducedMotion();
  const vignette = scene.atmosphere?.vignette ?? 0.38;
  const grain = scene.atmosphere?.grain ?? 0.035;

  return (
    <div className="agent-scene" aria-hidden="true">
      {scene.layers.map((layer, i) => (
        <SceneLayerView key={i} layer={layer} paused={paused || reducedMotion} />
      ))}
      <div className="agent-scene__vignette" style={{ opacity: vignette }} />
      {!reducedMotion ? <div className="agent-scene__grain" style={{ opacity: grain }} /> : null}
    </div>
  );
}

function SceneLayerView({ layer, paused }: { layer: SceneLayer; paused?: boolean }) {
  switch (layer.type) {
    case 'preset':
      if (layer.id === 'minimal-dark') {
        return <div className="agent-scene__preset agent-scene__preset--minimal-dark" />;
      }
      return null;
    case 'gradient':
      return (
        <div
          className="agent-scene__gradient"
          style={{
            backgroundImage: `linear-gradient(${layer.angle}deg, ${layer.stops.join(', ')})`,
          }}
        />
      );
    case 'image':
      return (
        <div
          className="agent-scene__image"
          style={{
            backgroundImage: `url(${layer.url})`,
            filter: layer.blur ? `blur(${layer.blur}px)` : undefined,
          }}
        />
      );
    case 'video':
      return (
        <video
          className="agent-scene__video"
          src={layer.url}
          muted={layer.muted}
          autoPlay={!paused}
          loop
          playsInline
        />
      );
    case 'webgl':
      return <LazyWebglLayer presetId={layer.presetId} params={layer.params} paused={paused} />;
    default:
      return null;
  }
}

const WEBGL_PRESET_LOADERS: Record<
  string,
  () => Promise<{ default: ComponentType<{ params: Record<string, number>; paused?: boolean }> }>
> = {};

function LazyWebglLayer({
  presetId,
  params,
  paused,
}: {
  presetId: string;
  params: Record<string, number>;
  paused?: boolean;
}) {
  const [Comp, setComp] = useState<ComponentType<{ params: Record<string, number>; paused?: boolean }> | null>(null);

  useEffect(() => {
    let active = true;
    const loader = WEBGL_PRESET_LOADERS[presetId];
    if (!loader) {
      setComp(null);
      return () => {
        active = false;
      };
    }
    loader()
      .then((mod) => {
        if (active) setComp(() => mod.default);
      })
      .catch(() => {
        if (active) setComp(null);
      });
    return () => {
      active = false;
    };
  }, [presetId]);

  return <div className="agent-scene__webgl">{Comp ? <Comp params={params} paused={paused} /> : null}</div>;
}

function usePrefersReducedMotion() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
}
