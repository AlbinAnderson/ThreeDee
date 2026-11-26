import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Scene } from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';
import { getCurrentScene, useCurrentScene } from '../state/hooks';
import { sendEphemeral } from '../state/session';
import { screenToWorld, useUi, type Camera } from '../state/uiStore';
import { getTool } from '../tools';
import type { BoardPointer, ToolContext } from '../tools/types';
import { useInteraction } from './interactionStore';
import { boardLayers } from './layers';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;

type Gesture = { kind: 'pan'; pointerId: number; lastX: number; lastY: number } | { kind: 'tool'; pointerId: number };

export function fitCamera(scene: Scene, viewport: { width: number; height: number }): Camera {
  const margin = 40;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min((viewport.width - margin * 2) / scene.width, (viewport.height - margin * 2) / scene.height)),
  );
  return {
    zoom,
    x: (viewport.width - scene.width * zoom) / 2,
    y: (viewport.height - scene.height * zoom) / 2,
  };
}

export function Board() {
  const scene = useCurrentScene();
  const camera = useUi((s) => s.camera);
  const toolId = useUi((s) => s.toolId);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const spaceHeld = useRef(false);
  const toolSession = useRef<{ id: string; state: unknown } | null>(null);
  const fittedSceneId = useRef<string | null>(null);

  const tool = getTool(toolId);

  // Reads everything from the stores at call time, so it is stable and never stale.
  const buildContext = useCallback((): ToolContext | null => {
    const game = useGameStore.getState().view;
    const self = getSelf();
    const scene = getCurrentScene();
    if (!game || !self || !scene) return null;
    return {
      scene,
      game,
      self,
      camera: useUi.getState().camera,
      dispatch,
      sendEphemeral,
      ui: useUi.getState(),
      interaction: useInteraction.getState(),
    };
  }, []);

  const getToolState = useCallback(() => {
    if (toolSession.current?.id !== tool.id) toolSession.current = { id: tool.id, state: tool.createState() };
    return toolSession.current.state;
  }, [tool]);

  // Cancel any in-progress tool gesture when the tool changes or the board unmounts.
  useEffect(() => {
    return () => {
      const ctx = buildContext();
      if (ctx && toolSession.current?.id === tool.id) tool.onCancel?.(ctx, toolSession.current.state);
      toolSession.current = null;
      gesture.current = null;
    };
  }, [tool, buildContext]);

  // Track viewport size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      useUi.getState().setViewport({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the camera the first time each scene is shown.
  const viewportWidth = useUi((s) => s.viewport.width);
  useEffect(() => {
    if (!scene || viewportWidth === 0 || fittedSceneId.current === scene.id) return;
    fittedSceneId.current = scene.id;
    const ui = useUi.getState();
    ui.setCamera(fitCamera(scene, ui.viewport));
  }, [scene, viewportWidth]);

  // Wheel zoom around the cursor (native listener so we can preventDefault).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = useUi.getState().camera;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
      const f = zoom / cam.zoom;
      useUi.getState().setCamera({ zoom, x: sx - (sx - cam.x) * f, y: sy - (sy - cam.y) * f });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Space + drag pans.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, select');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        spaceHeld.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  function toBoardPointer(e: ReactPointerEvent): BoardPointer {
    const rect = svgRef.current!.getBoundingClientRect();
    const target = (e.target as Element).closest('[data-token-id]');
    return {
      world: screenToWorld(useUi.getState().camera, e.clientX - rect.left, e.clientY - rect.top),
      tokenId: target?.getAttribute('data-token-id') ?? null,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  }

  function startPan(e: ReactPointerEvent) {
    gesture.current = { kind: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (gesture.current) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld.current)) return startPan(e);
    if (e.button !== 0) return;
    const ctx = buildContext();
    if (!ctx) return;
    const result = tool.onPointerDown?.(toBoardPointer(e), ctx, getToolState());
    if (result === 'pan') startPan(e);
    else gesture.current = { kind: 'tool', pointerId: e.pointerId };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === 'pan') {
      const cam = useUi.getState().camera;
      useUi.getState().setCamera({ ...cam, x: cam.x + e.clientX - g.lastX, y: cam.y + e.clientY - g.lastY });
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      return;
    }
    const ctx = buildContext();
    if (ctx) tool.onPointerMove?.(toBoardPointer(e), ctx, getToolState());
  }

  function onPointerUp(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.kind === 'tool') {
      const ctx = buildContext();
      if (ctx) tool.onPointerUp?.(toBoardPointer(e), ctx, getToolState());
    }
  }

  function onPointerCancel(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    const ctx = buildContext();
    if (g.kind === 'tool' && ctx) tool.onCancel?.(ctx, getToolState());
  }

  return (
    <div className="board" ref={containerRef}>
      <svg
        ref={svgRef}
        className="board-svg"
        style={{ cursor: tool.cursor ?? 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {scene && (
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
            {boardLayers.map(({ id, Component }) => (
              <Component key={id} scene={scene} />
            ))}
          </g>
        )}
      </svg>
      {!scene && <div className="board-empty">No scene. The GM can create one in the Scenes tab.</div>}
    </div>
  );
}
